"""
DNS Control — Deploy Service
Full production deployment lifecycle: validate → generate → backup → write → reload → verify.
"""

import json
import os
import shutil
import time
import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.services.config_service import validate_config, generate_preview
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.deploy")

BACKUP_ROOT = getattr(settings, "BACKUP_DIR", "/var/lib/dns-control/backups")
DEPLOY_STATE_FILE = os.path.join(
    getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "deploy-state.json"
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _step(order: int, name: str, command: str | None = None) -> dict:
    return {
        "order": order,
        "name": name,
        "status": "pending",
        "output": "",
        "durationMs": 0,
        "command": command,
        "startedAt": None,
        "finishedAt": None,
        "rollbackHint": None,
        "stderr": "",
    }


def _run_step(step: dict, fn) -> dict:
    """Execute fn and populate step timing/status."""
    step["startedAt"] = _now_iso()
    t0 = time.monotonic()
    try:
        result = fn()
        step["durationMs"] = int((time.monotonic() - t0) * 1000)
        step["finishedAt"] = _now_iso()
        if isinstance(result, dict):
            step["status"] = result.get("status", "success")
            step["output"] = result.get("output", "")
            step["stderr"] = result.get("stderr", "")
            step["rollbackHint"] = result.get("rollbackHint")
        else:
            step["status"] = "success"
            step["output"] = str(result) if result else "OK"
        return step
    except Exception as e:
        step["durationMs"] = int((time.monotonic() - t0) * 1000)
        step["finishedAt"] = _now_iso()
        step["status"] = "failed"
        step["output"] = str(e)
        step["stderr"] = str(e)
        return step


def execute_deploy(
    payload: dict[str, Any],
    scope: str = "full",
    dry_run: bool = False,
    operator: str = "system",
) -> dict:
    """Full deployment pipeline with step-by-step execution."""
    deploy_id = str(uuid.uuid4())[:12]
    steps: list[dict] = []
    all_ok = True
    backup_id = None
    changed_files: list[str] = []

    # ═══ Step 1: Validate ═══
    s1 = _step(1, "Validar modelo de configuração")
    def validate():
        v = validate_config(payload)
        if not v["valid"]:
            return {"status": "failed", "output": f"Erros: {v['errors']}", "stderr": json.dumps(v["errors"])}
        return {"status": "success", "output": f"Validação OK — {len(v.get('warnings', []))} avisos"}
    _run_step(s1, validate)
    steps.append(s1)
    if s1["status"] == "failed":
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, [], [], backup_id)

    # ═══ Step 2: Generate files ═══
    s2 = _step(2, "Gerar artefatos de deploy")
    files = []
    def generate():
        nonlocal files
        files = generate_preview(payload)
        return {"status": "success", "output": f"{len(files)} arquivos gerados"}
    _run_step(s2, generate)
    steps.append(s2)
    if s2["status"] == "failed":
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, [], [], backup_id)

    if dry_run:
        s_dry = _step(3, "Dry-run concluído")
        s_dry["status"] = "success"
        s_dry["output"] = "Nenhuma alteração aplicada (modo dry-run)"
        s_dry["startedAt"] = _now_iso()
        s_dry["finishedAt"] = _now_iso()
        steps.append(s_dry)
        health_checks = _generate_health_checks(payload, dry_run=True)
        return _build_result(deploy_id, steps, True, True, scope, operator, files, health_checks, None)

    # ═══ Step 3: Backup ═══
    s3 = _step(3, "Backup configuração atual", None)
    s3["rollbackHint"] = "Restaurar backup anterior"
    def backup():
        nonlocal backup_id
        backup_id = datetime.now().strftime("%Y%m%d_%H%M%S") + f"_{deploy_id}"
        backup_dir = os.path.join(BACKUP_ROOT, backup_id)
        os.makedirs(backup_dir, exist_ok=True)
        backed = 0
        for f in files:
            src = f["path"]
            if os.path.exists(src):
                dst = os.path.join(backup_dir, src.lstrip("/").replace("/", "__"))
                shutil.copy2(src, dst)
                backed += 1
        # Save manifest
        with open(os.path.join(backup_dir, "manifest.json"), "w") as mf:
            json.dump({
                "deploy_id": deploy_id,
                "timestamp": _now_iso(),
                "operator": operator,
                "files_backed": backed,
                "file_paths": [f["path"] for f in files],
            }, mf, indent=2)
        return {"status": "success", "output": f"Backup salvo: {backup_dir} ({backed} arquivos)"}
    _run_step(s3, backup)
    steps.append(s3)

    # ═══ Step 4: Write network configs ═══
    s4 = _step(4, "Gravar configuração de rede")
    def write_network():
        written = 0
        for f in files:
            if _scope_matches(f["path"], "network") and _scope_matches(f["path"], scope):
                _write_file(f)
                changed_files.append(f["path"])
                written += 1
        return {"status": "success", "output": f"{written} arquivos de rede gravados"}
    _run_step(s4, write_network)
    steps.append(s4)
    if s4["status"] == "failed":
        all_ok = False

    # ═══ Step 5: Write unbound configs ═══
    s5 = _step(5, "Gravar configuração Unbound")
    def write_unbound():
        written = 0
        for f in files:
            if _scope_matches(f["path"], "dns") and _scope_matches(f["path"], scope):
                _write_file(f)
                changed_files.append(f["path"])
                written += 1
        return {"status": "success", "output": f"{written} arquivos Unbound gravados"}
    _run_step(s5, write_unbound)
    steps.append(s5)
    if s5["status"] == "failed":
        all_ok = False

    # ═══ Step 6: Write nftables configs ═══
    s6 = _step(6, "Gravar configuração nftables")
    def write_nftables():
        written = 0
        for f in files:
            if _scope_matches(f["path"], "nftables") and _scope_matches(f["path"], scope):
                _write_file(f)
                changed_files.append(f["path"])
                written += 1
        return {"status": "success", "output": f"{written} arquivos nftables gravados"}
    _run_step(s6, write_nftables)
    steps.append(s6)
    if s6["status"] == "failed":
        all_ok = False

    # ═══ Step 7: Write sysctl + FRR + systemd ═══
    s7 = _step(7, "Gravar sysctl, FRR e systemd units")
    def write_rest():
        written = 0
        for f in files:
            p = f["path"]
            if p not in changed_files and _scope_matches(p, scope):
                _write_file(f)
                changed_files.append(p)
                written += 1
        return {"status": "success", "output": f"{written} arquivos adicionais gravados"}
    _run_step(s7, write_rest)
    steps.append(s7)

    # ═══ Step 8: daemon-reload ═══
    s8 = _step(8, "Recarregar daemons (systemctl daemon-reload)", "systemctl daemon-reload")
    s8["rollbackHint"] = "Não requer rollback"
    def daemon_reload():
        r = run_command("systemctl", ["daemon-reload"], timeout=15)
        return {
            "status": "success" if r["exit_code"] == 0 else "failed",
            "output": r["stdout"][:500] or "daemon-reload executado",
            "stderr": r["stderr"][:500],
        }
    _run_step(s8, daemon_reload)
    steps.append(s8)
    if s8["status"] == "failed":
        all_ok = False

    # ═══ Step 9: Restart/reload services ═══
    restart_cmds = _get_restart_commands(scope, payload)
    order = 9
    for cmd_name, cmd_args, hint in restart_cmds:
        s = _step(order, cmd_name, " ".join(cmd_args))
        s["rollbackHint"] = hint
        def restart(args=cmd_args):
            r = run_command(args[0], args[1:], timeout=30)
            return {
                "status": "success" if r["exit_code"] == 0 else "failed",
                "output": r["stdout"][:500],
                "stderr": r["stderr"][:500],
            }
        _run_step(s, restart)
        steps.append(s)
        if s["status"] == "failed":
            all_ok = False
            # Stop pipeline on critical failure
            break
        order += 1

    # ═══ Step N: Post-deploy health checks ═══
    health_checks = []
    if all_ok:
        s_health = _step(order, "Verificação pós-deploy")
        def verify():
            nonlocal health_checks
            health_checks = _run_health_checks(payload)
            passed = sum(1 for h in health_checks if h["status"] == "pass")
            total = len(health_checks)
            failed = total - passed
            if failed > 0:
                return {"status": "failed", "output": f"{passed}/{total} checks OK — {failed} falharam"}
            return {"status": "success", "output": f"{passed}/{total} checks OK"}
        _run_step(s_health, verify)
        steps.append(s_health)
        if s_health["status"] == "failed":
            all_ok = False

    # Save deploy state
    _save_deploy_state(deploy_id, operator, all_ok, backup_id)

    return _build_result(deploy_id, steps, all_ok, dry_run, scope, operator, files, health_checks, backup_id)


def execute_rollback(backup_id: str, operator: str = "system") -> dict:
    """Rollback to a previous backup snapshot."""
    steps: list[dict] = []
    restored_files: list[str] = []
    services_to_restart: set[str] = set()

    backup_dir = os.path.join(BACKUP_ROOT, backup_id)
    if not os.path.isdir(backup_dir):
        return {"success": False, "error": f"Backup não encontrado: {backup_id}",
                "restoredFiles": [], "restartedServices": [], "steps": [], "duration": 0}

    t0 = time.monotonic()

    # Read manifest
    manifest_path = os.path.join(backup_dir, "manifest.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path) as mf:
            manifest = json.load(mf)

    # Step 1: Restore files
    s1 = _step(1, "Restaurar arquivos do backup")
    def restore():
        for fname in os.listdir(backup_dir):
            if fname == "manifest.json":
                continue
            original_path = "/" + fname.replace("__", "/")
            src = os.path.join(backup_dir, fname)
            ddir = os.path.dirname(original_path)
            os.makedirs(ddir, exist_ok=True)
            shutil.copy2(src, original_path)
            restored_files.append(original_path)
            # Determine services to restart
            if "/unbound/" in original_path:
                name = os.path.basename(original_path).replace(".conf", "")
                services_to_restart.add(name)
            if "nftables" in original_path:
                services_to_restart.add("nftables")
            if "/frr/" in original_path:
                services_to_restart.add("frr")
        return {"status": "success", "output": f"{len(restored_files)} arquivos restaurados"}
    _run_step(s1, restore)
    steps.append(s1)

    # Step 2: daemon-reload
    s2 = _step(2, "daemon-reload", "systemctl daemon-reload")
    def reload_d():
        r = run_command("systemctl", ["daemon-reload"], timeout=15)
        return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
    _run_step(s2, reload_d)
    steps.append(s2)

    # Step 3: Restart affected services
    order = 3
    for svc in sorted(services_to_restart):
        s = _step(order, f"Reiniciar {svc}", f"systemctl restart {svc}")
        def restart_svc(name=svc):
            r = run_command("systemctl", ["restart", name], timeout=30)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, restart_svc)
        steps.append(s)
        order += 1

    # Apply nftables if it was restored
    if "nftables" in services_to_restart:
        s = _step(order, "Recarregar nftables", "nft -f /etc/nftables.conf")
        def reload_nft():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, reload_nft)
        steps.append(s)

    duration = int((time.monotonic() - t0) * 1000)
    all_ok = all(s["status"] == "success" for s in steps)

    return {
        "success": all_ok,
        "restoredFiles": restored_files,
        "restartedServices": list(services_to_restart),
        "steps": steps,
        "duration": duration,
    }


def get_deploy_state() -> dict:
    """Read current deploy state from disk."""
    if os.path.exists(DEPLOY_STATE_FILE):
        try:
            with open(DEPLOY_STATE_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "configVersion": "none",
        "lastApplyAt": None,
        "lastApplyOperator": None,
        "lastApplyStatus": None,
        "pendingChanges": False,
        "lastDeploymentId": None,
        "totalDeployments": 0,
        "rollbackAvailable": False,
    }


def list_backups() -> list[dict]:
    """List available backup snapshots."""
    if not os.path.isdir(BACKUP_ROOT):
        return []
    backups = []
    for name in sorted(os.listdir(BACKUP_ROOT), reverse=True):
        bdir = os.path.join(BACKUP_ROOT, name)
        if not os.path.isdir(bdir):
            continue
        manifest = {}
        mpath = os.path.join(bdir, "manifest.json")
        if os.path.exists(mpath):
            try:
                with open(mpath) as f:
                    manifest = json.load(f)
            except Exception:
                pass
        backups.append({
            "backupId": name,
            "timestamp": manifest.get("timestamp", ""),
            "operator": manifest.get("operator", ""),
            "fileCount": manifest.get("files_backed", 0),
            "filePaths": manifest.get("file_paths", []),
            "deployId": manifest.get("deploy_id", ""),
        })
    return backups[:20]


# ═══ Internal helpers ═══

def _write_file(f: dict):
    path = f["path"]
    ddir = os.path.dirname(path)
    os.makedirs(ddir, exist_ok=True)
    with open(path, "w") as fp:
        fp.write(f["content"])
    perms = f.get("permissions", "0644")
    try:
        os.chmod(path, int(perms, 8))
    except (ValueError, OSError):
        pass


def _scope_matches(path: str, scope: str) -> bool:
    if scope == "full":
        return True
    if scope == "dns" and "/unbound/" in path:
        return True
    if scope == "nftables" and "nftables" in path:
        return True
    if scope == "frr" and "/frr/" in path:
        return True
    if scope == "network" and ("/network/" in path or "interfaces" in path or "sysctl" in path or "post-up" in path):
        return True
    return False


def _get_restart_commands(scope: str, payload: dict) -> list[tuple[str, list[str], str]]:
    cmds = []
    if scope in ("full", "nftables"):
        cmds.append(("Aplicar nftables", ["nft", "-f", "/etc/nftables.conf"], "nft -f <backup>/nftables.conf"))
    if scope in ("full", "dns"):
        instances = payload.get("instances", [])
        for inst in instances:
            name = inst.get("name", "unbound")
            cmds.append((f"Reiniciar {name}", ["systemctl", "restart", name], f"systemctl restart {name} (from backup)"))
    if scope in ("full", "frr"):
        routing = payload.get("routingMode", "static")
        if routing != "static":
            cmds.append(("Reiniciar FRR", ["systemctl", "restart", "frr"], "systemctl restart frr (from backup)"))
    if scope in ("full", "network"):
        cmds.append(("Recarregar rede", ["ifreload", "-a"], "ifreload -a (from backup)"))
    return cmds


def _run_health_checks(payload: dict) -> list[dict]:
    """Post-deploy health checks."""
    checks = []
    instances = payload.get("instances", [])
    vips = payload.get("serviceVips", [])

    # Check each instance health
    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "")
        control_iface = inst.get("controlInterface", "")
        control_port = inst.get("controlPort", 8953)

        # systemd status
        t0 = time.monotonic()
        r = run_command("systemctl", ["is-active", name], timeout=5)
        checks.append({
            "name": f"{name} systemd status",
            "target": name,
            "status": "pass" if r["exit_code"] == 0 else "fail",
            "detail": r["stdout"].strip() or r["stderr"].strip(),
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

        # DNS probe on listener
        if bind_ip:
            t0 = time.monotonic()
            r = run_command("dig", [f"@{bind_ip}", "localhost", "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"{name} DNS probe ({bind_ip})",
                "target": bind_ip,
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or "No response",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

        # Control interface reachable
        if control_iface:
            t0 = time.monotonic()
            r = run_command("unbound-control", [
                "-c", f"/etc/unbound/{name}.conf",
                "-s", f"{control_iface}@{control_port}",
                "status"
            ], timeout=5, use_privilege=True)
            checks.append({
                "name": f"{name} control interface",
                "target": f"{control_iface}:{control_port}",
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or r["stderr"].strip()[:200],
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    # Check nftables loaded
    t0 = time.monotonic()
    r = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
    checks.append({
        "name": "nftables rules loaded",
        "target": "nftables",
        "status": "pass" if r["exit_code"] == 0 and r["stdout"].strip() else "fail",
        "detail": r["stdout"].strip()[:200] or "No tables",
        "durationMs": int((time.monotonic() - t0) * 1000),
    })

    # Check VIP reachability
    for vip in vips:
        vip_ip = vip.get("ipv4", "")
        if vip_ip:
            t0 = time.monotonic()
            r = run_command("dig", [f"@{vip_ip}", "localhost", "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"VIP {vip_ip} reachable",
                "target": vip_ip,
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or "No response",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    # Check FRR if enabled
    routing = payload.get("routingMode", "static")
    if routing in ("frr-ospf", "frr-bgp"):
        t0 = time.monotonic()
        r = run_command("systemctl", ["is-active", "frr"], timeout=5)
        checks.append({
            "name": "FRR daemon status",
            "target": "frr",
            "status": "pass" if r["exit_code"] == 0 else "fail",
            "detail": r["stdout"].strip(),
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

    return checks


def _generate_health_checks(payload: dict, dry_run: bool = False) -> list[dict]:
    """Generate health check definitions without running them."""
    checks = []
    instances = payload.get("instances", [])
    for inst in instances:
        name = inst.get("name", "unbound")
        checks.append({"name": f"{name} systemd status", "target": name, "status": "skip", "detail": "Dry-run — não executado", "durationMs": 0})
    checks.append({"name": "nftables rules loaded", "target": "nftables", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    return checks


def _save_deploy_state(deploy_id: str, operator: str, success: bool, backup_id: str | None):
    """Persist deploy state to disk."""
    try:
        existing = get_deploy_state()
        total = existing.get("totalDeployments", 0) + 1
        state = {
            "configVersion": f"v{total}",
            "lastApplyAt": _now_iso(),
            "lastApplyOperator": operator,
            "lastApplyStatus": "success" if success else "failed",
            "pendingChanges": False,
            "lastDeploymentId": deploy_id,
            "totalDeployments": total,
            "rollbackAvailable": backup_id is not None,
        }
        os.makedirs(os.path.dirname(DEPLOY_STATE_FILE), exist_ok=True)
        with open(DEPLOY_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        logger.error(f"Failed to save deploy state: {e}")


def _build_result(
    deploy_id: str, steps: list[dict], success: bool, dry_run: bool,
    scope: str, operator: str, files: list, health_checks: list, backup_id: str | None,
) -> dict:
    total_duration = sum(s.get("durationMs", 0) for s in steps)
    status = "dry-run" if dry_run else ("success" if success else "failed")
    state = get_deploy_state()
    return {
        "id": deploy_id,
        "timestamp": _now_iso(),
        "user": operator,
        "status": status,
        "scope": scope,
        "dryRun": dry_run,
        "steps": steps,
        "filesGenerated": [{"path": f["path"], "changed": True} for f in files],
        "duration": total_duration,
        "configVersion": state.get("configVersion", "v0"),
        "environment": "production",
        "changedFiles": [f["path"] for f in files],
        "healthResult": health_checks,
        "rollbackAvailable": backup_id is not None,
        "backupId": backup_id,
        "success": success,
    }
