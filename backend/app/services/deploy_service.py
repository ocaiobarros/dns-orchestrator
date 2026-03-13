"""
DNS Control — Deploy Service
Full production deployment lifecycle: validate → generate → stage → validate-staged → backup → apply → reload → verify.
"""

import json
import os
import shutil
import tempfile
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
STAGING_ROOT = os.path.join(getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "staging")
DEPLOY_STATE_FILE = os.path.join(
    getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "deploy-state.json"
)

# ═══ In-memory deploy state for polling ═══
_live_state: dict = {
    "phase": "idle",
    "currentStep": None,
    "totalSteps": 0,
    "completedSteps": 0,
    "lastMessage": "",
    "startedAt": None,
    "updatedAt": None,
    "deployId": None,
    "errors": [],
    "warnings": [],
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_live_state(**kwargs):
    global _live_state
    _live_state = {**_live_state, **kwargs, "updatedAt": _now_iso()}


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
    _update_live_state(currentStep=step["name"], lastMessage=f"Executando: {step['name']}")
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


def get_live_deploy_state() -> dict:
    """Return current in-memory deploy state for polling."""
    disk_state = get_deploy_state()
    return {
        **_live_state,
        "diskState": disk_state,
    }


def execute_deploy(
    payload: dict[str, Any],
    scope: str = "full",
    dry_run: bool = False,
    operator: str = "system",
) -> dict:
    """Full deployment pipeline with staging directory validation."""
    deploy_id = str(uuid.uuid4())[:12]
    steps: list[dict] = []
    all_ok = True
    backup_id = None
    changed_files: list[str] = []
    staging_dir = None

    phase = "dry_run_validating" if dry_run else "applying"
    _update_live_state(
        phase=phase, deployId=deploy_id, startedAt=_now_iso(),
        completedSteps=0, totalSteps=0, errors=[], warnings=[],
        currentStep="Iniciando pipeline", lastMessage="Pipeline iniciado"
    )

    # ═══ Step 1: Validate ═══
    s1 = _step(1, "Validar modelo de configuração")
    def validate():
        v = validate_config(payload)
        if not v["valid"]:
            return {"status": "failed", "output": f"Erros: {v['errors']}", "stderr": json.dumps(v["errors"])}
        warnings = v.get("warnings", [])
        if warnings:
            _update_live_state(warnings=warnings)
        return {"status": "success", "output": f"Validação OK — {len(warnings)} avisos"}
    _run_step(s1, validate)
    steps.append(s1)
    _update_live_state(completedSteps=1)
    if s1["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Validação falhou")
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
    _update_live_state(completedSteps=2)
    if s2["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Geração de arquivos falhou")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, [], [], backup_id)

    # ═══ Step 3: Write to staging directory ═══
    s3_stage = _step(3, "Gravar em diretório de staging")
    def write_staging():
        nonlocal staging_dir
        staging_dir = os.path.join(STAGING_ROOT, f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{deploy_id}")
        os.makedirs(staging_dir, exist_ok=True)
        for f in files:
            staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
            os.makedirs(os.path.dirname(staged_path), exist_ok=True)
            with open(staged_path, "w") as fp:
                fp.write(f["content"])
        return {"status": "success", "output": f"{len(files)} arquivos gravados em staging: {staging_dir}"}
    _run_step(s3_stage, write_staging)
    steps.append(s3_stage)
    _update_live_state(completedSteps=3)

    # ═══ Step 4: Validate staged files ═══
    s4_validate = _step(4, "Validar arquivos em staging")
    validation_errors = []
    def validate_staged():
        nonlocal validation_errors
        results = []
        if not staging_dir:
            return {"status": "failed", "output": "Staging directory missing"}

        # Validate unbound configs
        for f in files:
            if "/unbound/" in f["path"] and f["path"].endswith(".conf") and "block" not in f["path"]:
                staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
                if os.path.exists(staged_path):
                    r = run_command("unbound-checkconf", [staged_path], timeout=10)
                    if r["exit_code"] != 0:
                        validation_errors.append(f"unbound-checkconf {f['path']}: {r['stderr'][:200]}")
                        results.append(f"FAIL: {f['path']}")
                    else:
                        results.append(f"OK: {f['path']}")

        # Validate nftables config (generate validation-safe version without flush ruleset)
        for f in files:
            if f["path"] == "/etc/nftables.conf" or (f["path"].endswith(".nft") and "nftables" in f["path"]):
                if f["path"] == "/etc/nftables.conf" and staging_dir:
                    # Generate validation-safe config without "flush ruleset"
                    from app.generators.nftables_generator import generate_nftables_config
                    val_files = generate_nftables_config(payload, validation_mode=True)
                    if val_files:
                        val_path = os.path.join(staging_dir, "etc", "nftables.validate.conf")
                        os.makedirs(os.path.dirname(val_path), exist_ok=True)
                        with open(val_path, "w") as vf:
                            vf.write(val_files[0]["content"])
                        r = run_command("nft", ["-c", "-f", val_path], timeout=10, use_privilege=True)
                        if r["exit_code"] != 0:
                            validation_errors.append({
                                "category": "nftables-validation",
                                "command": f"nft -c -f {f['path']}",
                                "file": f["path"],
                                "stderr": r["stderr"][:500],
                                "remediation": "Verifique a sintaxe do nftables gerado. Erros comuns: regras conflitantes, interfaces inexistentes."
                            })
                            results.append(f"FAIL: {f['path']}")
                        else:
                            results.append(f"OK: nftables syntax valid")

        # IP collision detection
        ip_map: dict[str, list[str]] = {}
        instances = payload.get("instances", [])
        vips = payload.get("serviceVips", [])
        for inst in instances:
            for field in ("bindIp", "egressIpv4", "controlInterface"):
                ip = inst.get(field, "")
                if ip:
                    ip_map.setdefault(ip, []).append(f"{inst.get('name', '?')}/{field}")
        for vip in vips:
            ip = vip.get("ipv4", "")
            if ip:
                ip_map.setdefault(ip, []).append(f"VIP/{ip}")
        host_ip = payload.get("ipv4Address", "").split("/")[0]
        if host_ip:
            ip_map.setdefault(host_ip, []).append("host/ipv4Address")

        for ip, users in ip_map.items():
            if len(users) > 1:
                validation_errors.append(f"IP collision: {ip} used by {', '.join(users)}")

        if validation_errors:
            _update_live_state(errors=validation_errors)
            return {"status": "failed", "output": f"{len(validation_errors)} erros de validação", "stderr": "\n".join(validation_errors)}
        return {"status": "success", "output": f"Validação staging OK: {len(results)} verificações"}
    _run_step(s4_validate, validate_staged)
    steps.append(s4_validate)
    _update_live_state(completedSteps=4)

    if dry_run:
        # Generate commands that would run
        restart_cmds = _get_restart_commands(scope, payload)
        commands_plan = [
            "systemctl daemon-reload",
            "sysctl --system",
        ] + [" ".join(cmd_args) for _, cmd_args, _ in restart_cmds]

        s_dry = _step(5, "Dry-run concluído")
        s_dry["status"] = "success" if not validation_errors else "failed"
        s_dry["output"] = (
            "Nenhuma alteração aplicada (modo dry-run)" if not validation_errors
            else f"Dry-run falhou com {len(validation_errors)} erros"
        )
        s_dry["startedAt"] = _now_iso()
        s_dry["finishedAt"] = _now_iso()
        steps.append(s_dry)
        health_checks = _generate_health_checks(payload, dry_run=True)

        # Cleanup staging
        if staging_dir and os.path.isdir(staging_dir):
            try:
                shutil.rmtree(staging_dir)
            except Exception:
                pass

        result = _build_result(deploy_id, steps, not bool(validation_errors), True, scope, operator, files, health_checks, None)
        result["commandsPlan"] = commands_plan
        result["validationErrors"] = validation_errors
        result["warnings"] = _live_state.get("warnings", [])
        _update_live_state(phase="idle", lastMessage="Dry-run concluído")
        return result

    if s4_validate["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Validação de staging falhou")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id)

    # ═══ Step 5: Backup ═══
    total_apply_steps = 12  # estimate
    _update_live_state(totalSteps=total_apply_steps)

    s5 = _step(5, "Backup configuração atual", None)
    s5["rollbackHint"] = "Restaurar backup anterior"
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
        with open(os.path.join(backup_dir, "manifest.json"), "w") as mf:
            json.dump({
                "deploy_id": deploy_id,
                "timestamp": _now_iso(),
                "operator": operator,
                "files_backed": backed,
                "file_paths": [f["path"] for f in files],
            }, mf, indent=2)
        return {"status": "success", "output": f"Backup salvo: {backup_dir} ({backed} arquivos)"}
    _run_step(s5, backup)
    steps.append(s5)
    _update_live_state(completedSteps=5)

    # ═══ Step 6: Apply files from staging to final paths ═══
    s6 = _step(6, "Aplicar arquivos (staging → produção)")
    def apply_from_staging():
        written = 0
        for f in files:
            if _scope_matches(f["path"], scope):
                _write_file(f)
                changed_files.append(f["path"])
                written += 1
        return {"status": "success", "output": f"{written} arquivos aplicados"}
    _run_step(s6, apply_from_staging)
    steps.append(s6)
    _update_live_state(completedSteps=6)
    if s6["status"] == "failed":
        all_ok = False

    # ═══ Step 7: chmod scripts ═══
    s7_chmod = _step(7, "Ajustar permissões de scripts")
    def chmod_scripts():
        for f in files:
            if f["path"].endswith(".sh"):
                run_command("chmod", ["+x", f["path"]], timeout=5)
        return {"status": "success", "output": "Permissões ajustadas"}
    _run_step(s7_chmod, chmod_scripts)
    steps.append(s7_chmod)
    _update_live_state(completedSteps=7)

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
    _update_live_state(completedSteps=8)
    if s8["status"] == "failed":
        all_ok = False

    # ═══ Step 9: sysctl --system ═══
    s9_sysctl = _step(9, "Aplicar parâmetros sysctl", "sysctl --system")
    def apply_sysctl():
        r = run_command("sysctl", ["--system"], timeout=15)
        return {
            "status": "success" if r["exit_code"] == 0 else "failed",
            "output": r["stdout"][:500] or "sysctl aplicado",
            "stderr": r["stderr"][:500],
        }
    _run_step(s9_sysctl, apply_sysctl)
    steps.append(s9_sysctl)
    _update_live_state(completedSteps=9)

    # ═══ Step 10+: Restart/reload services ═══
    restart_cmds = _get_restart_commands(scope, payload)
    order = 10
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
        _update_live_state(completedSteps=order)
        if s["status"] == "failed":
            all_ok = False
            break
        order += 1

    # ═══ Post-deploy health checks ═══
    health_checks = []
    if all_ok:
        _update_live_state(phase="verifying", currentStep="Verificação pós-deploy")
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

    # Cleanup staging
    if staging_dir and os.path.isdir(staging_dir):
        try:
            shutil.rmtree(staging_dir)
        except Exception:
            pass

    # Save deploy state
    final_status = "success" if all_ok else "failed"
    _save_deploy_state(deploy_id, operator, all_ok, backup_id)
    _update_live_state(
        phase=final_status,
        lastMessage=f"Deploy {'concluído com sucesso' if all_ok else 'falhou'}",
        completedSteps=len(steps),
        totalSteps=len(steps),
    )

    return _build_result(deploy_id, steps, all_ok, dry_run, scope, operator, files, health_checks, backup_id)


def execute_rollback(backup_id: str, operator: str = "system") -> dict:
    """Rollback to a previous backup snapshot."""
    steps: list[dict] = []
    restored_files: list[str] = []
    services_to_restart: set[str] = set()

    _update_live_state(phase="rollback_in_progress", startedAt=_now_iso(), currentStep="Rollback", lastMessage="Iniciando rollback")

    backup_dir = os.path.join(BACKUP_ROOT, backup_id)
    if not os.path.isdir(backup_dir):
        _update_live_state(phase="rollback_failed", lastMessage="Backup não encontrado")
        return {"success": False, "error": f"Backup não encontrado: {backup_id}",
                "restoredFiles": [], "restartedServices": [], "steps": [], "duration": 0}

    t0 = time.monotonic()

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

    # Step 3: sysctl --system
    s3 = _step(3, "sysctl --system", "sysctl --system")
    def sysctl_reload():
        r = run_command("sysctl", ["--system"], timeout=15)
        return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
    _run_step(s3, sysctl_reload)
    steps.append(s3)

    # Step 4+: Restart affected services
    order = 4
    for svc in sorted(services_to_restart):
        s = _step(order, f"Reiniciar {svc}", f"systemctl restart {svc}")
        def restart_svc(name=svc):
            r = run_command("systemctl", ["restart", name], timeout=30)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, restart_svc)
        steps.append(s)
        order += 1

    if "nftables" in services_to_restart:
        s = _step(order, "Recarregar nftables", "nft -f /etc/nftables.conf")
        def reload_nft():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, reload_nft)
        steps.append(s)

    duration = int((time.monotonic() - t0) * 1000)
    all_ok = all(s["status"] == "success" for s in steps)

    final_phase = "rollback_success" if all_ok else "rollback_failed"
    _update_live_state(phase=final_phase, lastMessage=f"Rollback {'concluído' if all_ok else 'falhou'}")

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
    # Network restart is safe-gated: mark as manual-required
    if scope in ("full", "network"):
        cmds.append(("Rede: escrita OK (restart manual)", ["echo", "network-manual-required"], "Rede requer restart manual"))
    return cmds


def _run_health_checks(payload: dict) -> list[dict]:
    """Post-deploy health checks."""
    checks = []
    instances = payload.get("instances", [])
    vips = payload.get("serviceVips", [])

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

        # Port binding check
        if bind_ip:
            t0 = time.monotonic()
            r = run_command("ss", ["-lntup"], timeout=5)
            port_bound = bind_ip in r["stdout"] and ":53" in r["stdout"]
            checks.append({
                "name": f"{name} port 53 bound ({bind_ip})",
                "target": f"{bind_ip}:53",
                "status": "pass" if port_bound else "fail",
                "detail": "Port 53 bound" if port_bound else "Port 53 NOT bound",
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

    # Check nftables counters
    t0 = time.monotonic()
    r = run_command("nft", ["list", "counters"], timeout=5, use_privilege=True)
    checks.append({
        "name": "nftables counters",
        "target": "nftables",
        "status": "pass" if r["exit_code"] == 0 else "fail",
        "detail": r["stdout"].strip()[:200] or "No counters",
        "durationMs": int((time.monotonic() - t0) * 1000),
    })

    # Check VIP reachability
    for vip in vips:
        vip_ip = vip.get("ipv4", "")
        if vip_ip:
            probe_domain = vip.get("healthCheckDomain", "google.com") or "google.com"
            health_enabled = vip.get("healthCheckEnabled", True)
            if not health_enabled:
                checks.append({
                    "name": f"VIP {vip_ip} health check",
                    "target": vip_ip,
                    "status": "skip",
                    "detail": "Health check desabilitado para este VIP",
                    "durationMs": 0,
                })
                continue
            t0 = time.monotonic()
            r = run_command("dig", [f"@{vip_ip}", probe_domain, "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"VIP {vip_ip} reachable (dig {probe_domain})",
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
        if inst.get("bindIp"):
            checks.append({"name": f"{name} DNS probe ({inst['bindIp']})", "target": inst["bindIp"], "status": "skip", "detail": "Dry-run", "durationMs": 0})
            checks.append({"name": f"{name} port 53 bound ({inst['bindIp']})", "target": f"{inst['bindIp']}:53", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    checks.append({"name": "nftables rules loaded", "target": "nftables", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    checks.append({"name": "nftables counters", "target": "nftables", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    return checks


def _save_deploy_state(deploy_id: str, operator: str, success: bool, backup_id: str | None):
    """Persist deploy state and deployment record to disk."""
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
            "lastBackupPath": os.path.join(BACKUP_ROOT, backup_id) if backup_id else None,
        }
        os.makedirs(os.path.dirname(DEPLOY_STATE_FILE), exist_ok=True)
        with open(DEPLOY_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)

        deploy_dir = os.path.join(
            getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "deployments", deploy_id
        )
        os.makedirs(deploy_dir, exist_ok=True)
        with open(os.path.join(deploy_dir, "manifest.json"), "w") as f:
            json.dump({
                "deploy_id": deploy_id,
                "timestamp": _now_iso(),
                "operator": operator,
                "status": "success" if success else "failed",
                "config_version": f"v{total}",
                "backup_id": backup_id,
            }, f, indent=2)
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
