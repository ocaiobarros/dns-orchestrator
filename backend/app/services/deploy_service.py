"""
DNS Control — Deploy Service
Total-replace deployment pipeline: every execution produces a clean, predictable
state derived 100% from current input. No residual config from previous runs.

Pipeline (13 steps):
 1. Validate model
 2. Generate artifacts (staging)
 3. Validate staged (unbound-checkconf, nft -c -f, bash -n, systemd-analyze verify)
 4. Comprehensive backup (ALL affected directories)
 5. Stop ALL existing services
 6. Selective cleanup (remove ONLY wizard-generated files)
 7. Apply files (staging → production)
 8. systemctl daemon-reload
 9. Apply sysctl
10. Materialize network (post-up)
11. Start unbound instances
12. Load nftables
13. Health checks

On failure after backup → automatic rollback.
"""

import json
import os
import glob
import shutil
import time
import uuid
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings
from app.services.config_service import validate_config, generate_preview
from app.services.payload_normalizer import normalize_payload
from app.generators.nftables_generator import generate_nftables_config
from app.generators.nftables_simple_generator import generate_simple_nftables_config
from app.executors.command_runner import run_command
from app.services.deploy_lock import deploy_lock
from app.services.drift_service import write_version_manifest

logger = logging.getLogger("dns-control.deploy")

BACKUP_ROOT = getattr(settings, "BACKUP_DIR", "/var/lib/dns-control/backups")
STAGING_ROOT = os.path.join(getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "staging")
DEPLOY_STATE_FILE = os.path.join(
    getattr(settings, "DATA_DIR", "/var/lib/dns-control"), "deploy-state.json"
)

# Directories/globs to backup comprehensively BEFORE any changes
_BACKUP_TARGETS = [
    "/etc/network/interfaces",
    "/etc/network/post-up.sh",
    "/etc/network/post-up.d/dns-control",
    "/etc/sysctl.d/*.conf",
    "/etc/unbound/*",
    "/usr/lib/systemd/system/unbound*.service",
    "/etc/nftables.conf",
    "/etc/nftables.d/*",
]

# Files that the wizard GENERATES — safe to remove during cleanup
_CLEANUP_GLOBS = {
    "unbound_configs": "/etc/unbound/unbound*.conf",
    "unbound_units": "/usr/lib/systemd/system/unbound*.service",
    "nftables_snippets": "/etc/nftables.d/*.nft",
    "nftables_conf": "/etc/nftables.conf",
    "sysctl_dns": "/etc/sysctl.d/05[0-9]-*.conf",
    "sysctl_net": "/etc/sysctl.d/06[0-9]-*.conf",
    "sysctl_fs": "/etc/sysctl.d/07[0-9]-*.conf",
    "sysctl_kernel": "/etc/sysctl.d/08[0-9]-*.conf",
    "sysctl_nf": "/etc/sysctl.d/09[0-9]-*.conf",
    "network_postup": "/etc/network/post-up.sh",
    "network_postup_d": "/etc/network/post-up.d/dns-control",
}

# Files NEVER to touch
_NEVER_TOUCH = frozenset({
    "/etc/passwd", "/etc/shadow", "/etc/group",
    "/etc/resolv.conf", "/etc/hostname", "/etc/hosts",
    "/etc/fstab", "/etc/sudoers",
})

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
    """Return current deploy state for the dashboard."""
    disk_state = get_deploy_state()

    if not disk_state.get("lastApplyAt"):
        try:
            from app.core.database import SessionLocal
            from app.models.apply_job import ApplyJob
            db = SessionLocal()
            try:
                last_job = db.query(ApplyJob).filter(
                    ApplyJob.job_type != "dry-run"
                ).order_by(ApplyJob.created_at.desc()).first()
                total = db.query(ApplyJob).filter(
                    ApplyJob.job_type != "dry-run"
                ).count()
                if last_job:
                    disk_state["lastApplyAt"] = last_job.finished_at.isoformat() if last_job.finished_at else (last_job.created_at.isoformat() if last_job.created_at else None)
                    disk_state["lastApplyOperator"] = last_job.created_by
                    disk_state["lastApplyStatus"] = last_job.status
                    disk_state["totalDeployments"] = total
                    disk_state["rollbackAvailable"] = total > 0
                    disk_state["lastDeploymentId"] = last_job.id
            finally:
                db.close()
        except Exception:
            pass

    return {
        **disk_state,
        "phase": _live_state.get("phase", "idle"),
        "currentStep": _live_state.get("currentStep"),
        "totalSteps": _live_state.get("totalSteps", 0),
        "completedSteps": _live_state.get("completedSteps", 0),
        "lastMessage": _live_state.get("lastMessage", ""),
        "startedAt": _live_state.get("startedAt"),
        "updatedAt": _live_state.get("updatedAt"),
        "deployId": _live_state.get("deployId"),
        "errors": _live_state.get("errors", []),
        "warnings": _live_state.get("warnings", []),
        "diskState": disk_state,
    }


def execute_deploy(
    payload: dict[str, Any],
    scope: str = "full",
    dry_run: bool = False,
    operator: str = "system",
) -> dict:
    """Full deployment pipeline with global lock."""
    try:
        with deploy_lock("deploy" if not dry_run else "dry-run", timeout=60):
            return _execute_deploy_locked(payload, scope, dry_run, operator)
    except RuntimeError as e:
        return {
            "id": "blocked",
            "success": False,
            "status": "blocked",
            "steps": [],
            "error": str(e),
            "duration": 0,
        }


def _execute_deploy_locked(
    payload: dict[str, Any],
    scope: str = "full",
    dry_run: bool = False,
    operator: str = "system",
) -> dict:
    deploy_id = str(uuid.uuid4())[:12]
    steps: list[dict] = []
    all_ok = True
    backup_id = None
    backup_dir = None
    changed_files: list[str] = []
    staging_dir = None
    validation_errors: list[dict[str, Any]] = []
    validation_results: dict[str, list[dict[str, Any]]] = {
        "unbound": [], "nftables": [], "network": [], "ipCollision": [],
    }

    total_steps = 5 if dry_run else 19
    _update_live_state(
        phase="dry_run_validating" if dry_run else "applying",
        deployId=deploy_id, startedAt=_now_iso(),
        completedSteps=0, totalSteps=total_steps,
        errors=[], warnings=[],
        currentStep="Iniciando pipeline", lastMessage="Pipeline iniciado"
    )

    # ════════════════════════════════════════════════════════════════
    # STEP 1: Validate model
    # ════════════════════════════════════════════════════════════════
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

    # ════════════════════════════════════════════════════════════════
    # STEP 2: Generate files (into staging)
    # ════════════════════════════════════════════════════════════════
    s2 = _step(2, "Gerar artefatos de deploy")
    files: list[dict] = []
    nft_validation_staged_path: str | None = None

    def generate_and_stage():
        nonlocal files, staging_dir, nft_validation_staged_path
        files = generate_preview(payload)

        staging_dir = os.path.join(STAGING_ROOT, f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{deploy_id}")
        os.makedirs(staging_dir, exist_ok=True)

        for f in files:
            staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
            os.makedirs(os.path.dirname(staged_path), exist_ok=True)
            with open(staged_path, "w") as fp:
                fp.write(f["content"])

        # Create directories for glob includes
        unbound_confd_staging = os.path.join(staging_dir, "etc/unbound/unbound.conf.d")
        os.makedirs(unbound_confd_staging, exist_ok=True)

        # Stub named.cache for validation
        named_cache_staging = os.path.join(staging_dir, "etc/unbound/named.cache")
        if not os.path.exists(named_cache_staging):
            prod_named_cache = "/etc/unbound/named.cache"
            if os.path.exists(prod_named_cache):
                shutil.copy2(prod_named_cache, named_cache_staging)
            else:
                with open(named_cache_staging, "w") as nc:
                    nc.write(".\t\t\t3600000\tNS\tA.ROOT-SERVERS.NET.\n"
                             "A.ROOT-SERVERS.NET.\t3600000\tA\t198.41.0.4\n")

        # Generate nftables validation artifact
        normalized_payload = normalize_payload(payload)
        is_simple_mode = normalized_payload.get("operationMode") == "simple"
        try:
            if is_simple_mode:
                vfiles = generate_simple_nftables_config(normalized_payload, validation_mode=True)
            else:
                vfiles = generate_nftables_config(normalized_payload, validation_mode=True)
            if vfiles:
                rel_path = vfiles[0]["path"].lstrip("/")
                nft_validation_staged_path = os.path.join(staging_dir, rel_path)
                os.makedirs(os.path.dirname(nft_validation_staged_path), exist_ok=True)
                with open(nft_validation_staged_path, "w") as vf:
                    vf.write(vfiles[0]["content"])
        except Exception as exc:
            logger.warning(f"Failed to generate nftables validation artifact: {exc}")

        # ── Structural guard: simple mode MUST NOT produce interception artifacts ──
        # Local balancing nftables (local_* chains, DNS_FRONTEND_IP) are ALLOWED.
        # Only external interception artifacts (DNS_ANYCAST_*, intercept-* files,
        # ipv4_tcp_dns/ipv4_udp_dns chains) are BLOCKED.
        if is_simple_mode:
            # Patterns that indicate external interception — NOT local balancing
            nft_interception_patterns = (
                "DNS_ANYCAST_IPV4", "DNS_ANYCAST_IPV6", "DNS_ANYCAST_IP",
                "intercept-",
            )
            # Chain names used by interception mode (NOT prefixed with "local_")
            nft_interception_chain_patterns = (
                "chain ipv4_tcp_dns", "chain ipv4_udp_dns",
                "chain ipv6_tcp_dns", "chain ipv6_udp_dns",
                "jump ipv4_tcp_dns", "jump ipv4_udp_dns",
                "jump ipv6_tcp_dns", "jump ipv6_udp_dns",
                "set users_unbound",
            )
            all_blocked = nft_interception_patterns + nft_interception_chain_patterns
            for f in files:
                combined = f["path"] + "\n" + f.get("content", "")
                if any(pat in combined for pat in all_blocked):
                    return {"status": "failed",
                            "output": f"Modo simples gerou artefato de interceptação: {f['path']}",
                            "stderr": "Erro de modelagem: artefatos nftables de interceptação não são permitidos no modo Recursivo Simples"}

        return {"status": "success", "output": f"{len(files)} arquivos gerados em staging: {staging_dir}"}

    _run_step(s2, generate_and_stage)
    steps.append(s2)
    _update_live_state(completedSteps=2)
    if s2["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Geração de arquivos falhou")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, [], [], backup_id)

    # ════════════════════════════════════════════════════════════════
    # STEP 3: Validate ALL staged files (CRITICAL)
    # ════════════════════════════════════════════════════════════════
    s3 = _step(3, "Validar arquivos em staging")

    def validate_staged():
        nonlocal validation_errors
        if not staging_dir:
            return {"status": "failed", "output": "Staging directory missing"}

        import re
        include_pattern = re.compile(r'^\s*include:\s*["\']?([^"\'#\s]+)', re.MULTILINE)
        _RUNTIME_INCLUDES = {"anablock.conf", "unbound-block-domains.conf"}

        # Pre-create placeholders for include targets
        for f in files:
            if "/unbound/" in f["path"] and f["path"].endswith(".conf"):
                matches = include_pattern.findall(f.get("content", ""))
                for inc_path in matches:
                    if "*" in inc_path:
                        continue
                    staged_inc = os.path.join(staging_dir, inc_path.lstrip("/"))
                    if not os.path.exists(staged_inc):
                        os.makedirs(os.path.dirname(staged_inc), exist_ok=True)
                        with open(staged_inc, "w") as ph:
                            ph.write("# placeholder for validation\n")

        # ── unbound-checkconf ──
        for f in files:
            if "/unbound/" in f["path"] and f["path"].endswith(".conf") and "block" not in f["path"] and "anablock" not in f["path"]:
                staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
                if not os.path.exists(staged_path):
                    continue

                original_content = open(staged_path).read()

                def _rewrite_inc(match):
                    inc = match.group(1)
                    return match.group(0).replace(inc, os.path.join(staging_dir, inc.lstrip("/")))

                rewritten = include_pattern.sub(_rewrite_inc, original_content)

                # Rewrite root-hints path
                root_hints_re = re.compile(r'(\s*root-hints:\s*["\']?)(/[^"\'#\s]+)', re.MULTILINE)
                def _rewrite_root_hints(m):
                    return f"{m.group(1)}{os.path.join(staging_dir, m.group(2).lstrip('/'))}"
                rewritten = root_hints_re.sub(_rewrite_root_hints, rewritten)

                checkconf_path = staged_path + ".checkconf"
                with open(checkconf_path, "w") as tmp:
                    tmp.write(rewritten)

                r = run_command("unbound-checkconf", [checkconf_path], timeout=10)
                if os.path.exists(checkconf_path):
                    os.remove(checkconf_path)

                if r["exit_code"] != 0:
                    err = {
                        "category": "unbound-validation",
                        "command": f"unbound-checkconf {f['path']}",
                        "file": f["path"],
                        "stderr": (r.get("stderr") or r.get("stdout") or "Falha").strip(),
                        "remediation": "Verifique a sintaxe do arquivo Unbound.",
                    }
                    validation_errors.append(err)
                    _add_vr(validation_results, "unbound", "fail", f["path"], err["command"], err["stderr"])
                else:
                    _add_vr(validation_results, "unbound", "pass", f["path"], f"unbound-checkconf {f['path']}")

        # ── nft -c -f ──
        if nft_validation_staged_path and os.path.exists(nft_validation_staged_path):
            nft_result = run_command("nft", ["-c", "-f", nft_validation_staged_path], timeout=10, use_privilege=True)
            if nft_result["exit_code"] != 0:
                err = {
                    "category": "nftables-validation",
                    "command": f"nft -c -f {nft_validation_staged_path}",
                    "file": "/etc/nftables.validate.conf",
                    "stderr": (nft_result.get("stderr") or "Falha nftables").strip(),
                    "remediation": "Revise regras DNAT, sets e sintaxe nftables.",
                }
                validation_errors.append(err)
                _add_vr(validation_results, "nftables", "fail", err["file"], err["command"], err["stderr"])
            else:
                _add_vr(validation_results, "nftables", "pass", "/etc/nftables.validate.conf", "nft -c -f")

        # ── bash -n on shell scripts ──
        for f in files:
            if f["path"].endswith(".sh") or f["path"].endswith("/dns-control"):
                staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
                if os.path.exists(staged_path):
                    r = run_command("bash", ["-n", staged_path], timeout=10)
                    if r["exit_code"] != 0:
                        err = {
                            "category": "bash-syntax",
                            "command": f"bash -n {f['path']}",
                            "file": f["path"],
                            "stderr": (r.get("stderr") or "Erro de sintaxe").strip(),
                            "remediation": "Corrija erros de sintaxe no script.",
                        }
                        validation_errors.append(err)
                        _add_vr(validation_results, "network", "fail", f["path"], err["command"], err["stderr"])
                    else:
                        _add_vr(validation_results, "network", "pass", f["path"], f"bash -n {f['path']}")

        # ── Network files static check ──
        for f in files:
            if f["path"] == "/etc/network/interfaces":
                content = f.get("content", "")
                ok = "iface" in content and "address" in content
                if not ok:
                    err = {
                        "category": "network-validation",
                        "command": "static-check",
                        "file": f["path"],
                        "stderr": "Arquivo de interfaces sem blocos obrigatórios (iface/address).",
                        "remediation": "Revise /etc/network/interfaces.",
                    }
                    validation_errors.append(err)
                    _add_vr(validation_results, "network", "fail", f["path"], "static-check", err["stderr"])
                else:
                    _add_vr(validation_results, "network", "pass", f["path"], "static-check")

        # ── systemd-analyze verify on staged units ──
        for f in files:
            if f["path"].endswith(".service"):
                staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
                if os.path.exists(staged_path):
                    # systemd-analyze verify accepts unit file paths
                    r = run_command("bash", ["-c", f"SYSTEMD_LOG_LEVEL=warning systemd-analyze verify {staged_path} 2>&1 || true"], timeout=10)
                    # systemd-analyze verify returns warnings but rarely fails fatally
                    _add_vr(validation_results, "unbound", "pass", f["path"],
                            f"systemd-analyze verify {f['path']}",
                            (r.get("stdout") or "")[:300])

        # ── IP collision detection ──
        ip_collisions = _detect_ip_collisions(payload)
        if ip_collisions:
            for collision in ip_collisions:
                err = {
                    "category": "ip-collision",
                    "command": "ip-collision-check",
                    "file": None,
                    "stderr": collision,
                    "remediation": "Garanta separação entre camadas VIP, listener, egress e host.",
                }
                validation_errors.append(err)
                _add_vr(validation_results, "ipCollision", "fail", None, "ip-collision-check", collision)
        else:
            _add_vr(validation_results, "ipCollision", "pass", None, "ip-collision-check")

        if validation_errors:
            _update_live_state(errors=validation_errors)
            return {
                "status": "failed",
                "output": f"{len(validation_errors)} erros de validação",
                "stderr": "\n".join(f"[{e.get('category')}] {e.get('stderr', '')}" for e in validation_errors),
            }

        total_checks = sum(len(items) for items in validation_results.values())
        return {"status": "success", "output": f"Validação staging OK: {total_checks} verificações"}

    _run_step(s3, validate_staged)
    steps.append(s3)
    _update_live_state(completedSteps=3)

    # ═══ DRY-RUN EXIT ═══
    if dry_run:
        s_dry = _step(4, "Dry-run concluído")
        s_dry["status"] = "success" if not validation_errors else "failed"
        s_dry["output"] = (
            "Nenhuma alteração aplicada (modo dry-run)" if not validation_errors
            else f"Dry-run falhou com {len(validation_errors)} erros"
        )
        s_dry["startedAt"] = _now_iso()
        s_dry["finishedAt"] = _now_iso()
        steps.append(s_dry)
        health_checks = _generate_health_checks(payload, dry_run=True)

        if staging_dir and os.path.isdir(staging_dir):
            try:
                shutil.rmtree(staging_dir)
            except Exception:
                pass

        result = _build_result(
            deploy_id, steps, not bool(validation_errors), True, scope, operator,
            files, health_checks, None, validation_errors, validation_results,
        )
        _update_live_state(phase="idle", lastMessage="Dry-run concluído")
        return result

    if s3["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Validação de staging falhou")
        if staging_dir and os.path.isdir(staging_dir):
            try:
                shutil.rmtree(staging_dir)
            except Exception:
                pass
        return _build_result(
            deploy_id, steps, False, dry_run, scope, operator,
            files, [], backup_id, validation_errors, validation_results,
        )

    # ════════════════════════════════════════════════════════════════
    # STEP 4: Comprehensive backup (ALL affected directories)
    # ════════════════════════════════════════════════════════════════
    _update_live_state(totalSteps=19)

    s4 = _step(4, "Backup completo de configuração atual")
    s4["rollbackHint"] = "Restaurar backup anterior"
    def comprehensive_backup():
        nonlocal backup_id, backup_dir
        backup_id = datetime.now().strftime("%Y%m%d_%H%M%S") + f"_{deploy_id}"
        backup_dir = os.path.join(BACKUP_ROOT, backup_id)
        os.makedirs(backup_dir, exist_ok=True)
        backed = 0

        for pattern in _BACKUP_TARGETS:
            matched = glob.glob(pattern)
            for src in matched:
                if not os.path.isfile(src):
                    continue
                dst = os.path.join(backup_dir, src.lstrip("/").replace("/", "__"))
                try:
                    shutil.copy2(src, dst)
                    backed += 1
                except Exception as e:
                    logger.warning(f"Backup failed for {src}: {e}")

        with open(os.path.join(backup_dir, "manifest.json"), "w") as mf:
            json.dump({
                "deploy_id": deploy_id,
                "timestamp": _now_iso(),
                "operator": operator,
                "files_backed": backed,
                "file_paths": [f["path"] for f in files],
                "backup_targets": _BACKUP_TARGETS,
            }, mf, indent=2)
        return {"status": "success", "output": f"Backup salvo: {backup_dir} ({backed} arquivos)"}
    _run_step(s4, comprehensive_backup)
    steps.append(s4)
    _update_live_state(completedSteps=4)

    # ════════════════════════════════════════════════════════════════
    # STEP 5: Stop ALL existing services
    # ════════════════════════════════════════════════════════════════
    s5 = _step(5, "Parar todos os serviços DNS existentes")
    def stop_all_services():
        msgs = []

        # Stop legacy unbound.service
        r = run_command("systemctl", ["is-active", "unbound"], timeout=5)
        if r["exit_code"] == 0 and "active" in (r.get("stdout") or ""):
            run_command("systemctl", ["stop", "unbound"], timeout=15, use_privilege=True)
            run_command("systemctl", ["disable", "unbound"], timeout=10, use_privilege=True)
            run_command("systemctl", ["mask", "unbound"], timeout=10, use_privilege=True)
            msgs.append("Legacy unbound.service parado/mascarado")

        # Stop systemd-resolved if active
        r = run_command("systemctl", ["is-active", "systemd-resolved"], timeout=5)
        if r["exit_code"] == 0 and "active" in (r.get("stdout") or ""):
            run_command("systemctl", ["stop", "systemd-resolved"], timeout=10, use_privilege=True)
            run_command("systemctl", ["disable", "systemd-resolved"], timeout=10, use_privilege=True)
            msgs.append("systemd-resolved parado/desabilitado")

        # Discover and stop ALL unbound instances (unbound01, unbound02, etc.)
        r = run_command("bash", ["-c",
            "systemctl list-units --type=service --all --no-pager --plain 2>/dev/null | grep '^unbound' | awk '{print $1}'"
        ], timeout=10)
        discovered_units = [s.strip().replace(".service", "") for s in (r.get("stdout") or "").splitlines() if s.strip()]
        for unit in discovered_units:
            run_command("systemctl", ["stop", unit], timeout=15, use_privilege=True)
            run_command("systemctl", ["disable", unit], timeout=10, use_privilege=True)
            msgs.append(f"Parado + desabilitado: {unit}")

        # Kill remaining unbound processes
        run_command("killall", ["-q", "unbound"], timeout=5, use_privilege=True)

        # Flush nftables ruleset
        r_flush = run_command("nft", ["flush", "ruleset"], timeout=10, use_privilege=True)
        if r_flush["exit_code"] == 0:
            msgs.append("nftables: ruleset flush OK")
        else:
            msgs.append(f"nftables flush: {r_flush.get('stderr', '')[:100]}")

        return {"status": "success", "output": "; ".join(msgs) if msgs else "Nenhum serviço ativo encontrado"}

    _run_step(s5, stop_all_services)
    steps.append(s5)
    _update_live_state(completedSteps=5)

    # ════════════════════════════════════════════════════════════════
    # STEP 6: Selective cleanup (ONLY wizard-generated files)
    # ════════════════════════════════════════════════════════════════
    s6 = _step(6, "Limpeza seletiva de configurações geradas")
    def selective_cleanup():
        msgs = []

        # ── 1. Remove ALL non-system IPv4 from lo (keep only 127.0.0.1) ──
        import re as _re
        r_lo = run_command("ip", ["-4", "addr", "show", "dev", "lo"], timeout=5)
        # Capture IP WITH its actual prefix length to ensure correct deletion
        lo_entries = _re.findall(r'inet (\d+\.\d+\.\d+\.\d+)/(\d+)', r_lo.get("stdout") or "")
        removed_v4 = 0
        for ip, prefix in lo_entries:
            if ip == "127.0.0.1":
                continue
            run_command("ip", ["-4", "addr", "del", f"{ip}/{prefix}", "dev", "lo"], timeout=5, use_privilege=True)
            removed_v4 += 1

        # ── 2. Remove ALL non-system IPv6 from lo (keep ::1 and link-local) ──
        r_lo6 = run_command("ip", ["-6", "addr", "show", "dev", "lo"], timeout=5)
        lo6_entries = _re.findall(r'inet6 ([0-9a-fA-F:]+)/(\d+)', r_lo6.get("stdout") or "")
        removed_v6 = 0
        for ip6, prefix in lo6_entries:
            if ip6 == "::1" or ip6.startswith("fe80"):
                continue
            run_command("ip", ["-6", "addr", "del", f"{ip6}/{prefix}", "dev", "lo"], timeout=5, use_privilege=True)
            removed_v6 += 1

        total_lo = removed_v4 + removed_v6
        if total_lo:
            msgs.append(f"lo: {total_lo} IPs removidos ({removed_v4} v4, {removed_v6} v6)")

        # ── 3. Remove dummy lo0 entirely (destroys ALL IPs bound to it) ──
        r_lo0 = run_command("ip", ["link", "show", "lo0"], timeout=5)
        if r_lo0.get("exit_code") == 0:
            run_command("ip", ["addr", "flush", "dev", "lo0"], timeout=5, use_privilege=True)
            run_command("ip", ["link", "set", "lo0", "down"], timeout=5, use_privilege=True)
            run_command("ip", ["link", "del", "lo0"], timeout=5, use_privilege=True)
            msgs.append("Interface dummy lo0 removida (todos os IPs destruídos)")
        else:
            msgs.append("lo0 não existia")

        # Remove wizard-generated files via globs
        for label, pattern in _CLEANUP_GLOBS.items():
            matched = glob.glob(pattern)
            removed = 0
            for fpath in matched:
                if fpath in _NEVER_TOUCH:
                    continue
                try:
                    os.remove(fpath)
                    removed += 1
                except OSError:
                    # File owned by root
                    run_command("bash", ["-c", f"rm -f '{fpath}'"], timeout=3, use_privilege=True)
                    removed += 1
            if removed:
                msgs.append(f"{label}: {removed} removidos")

        return {"status": "success", "output": "; ".join(msgs) if msgs else "Nenhum resíduo encontrado"}

    _run_step(s6, selective_cleanup)
    steps.append(s6)
    _update_live_state(completedSteps=6)

    # ════════════════════════════════════════════════════════════════
    # Helper: auto-rollback on critical failure
    # ════════════════════════════════════════════════════════════════
    def _auto_rollback(failed_step_name: str):
        """Attempt automatic rollback from backup."""
        nonlocal all_ok
        all_ok = False
        logger.error(f"Auto-rollback triggered by failure at: {failed_step_name}")

        rb_step = _step(len(steps) + 1, "Rollback automático")
        def do_rollback():
            if not backup_dir or not os.path.isdir(backup_dir):
                return {"status": "failed", "output": "Backup não disponível para rollback"}

            restored = 0
            for fname in os.listdir(backup_dir):
                if fname == "manifest.json":
                    continue
                original_path = "/" + fname.replace("__", "/")
                src = os.path.join(backup_dir, fname)
                ddir = os.path.dirname(original_path)
                run_command("mkdir", ["-p", ddir], timeout=5, use_privilege=True)
                result = run_command("cp", ["--no-preserve=ownership", src, original_path], timeout=10, use_privilege=True)
                if result["exit_code"] == 0:
                    restored += 1

            # Reload daemons
            run_command("systemctl", ["daemon-reload"], timeout=15, use_privilege=True)
            # Reload sysctl
            run_command("sysctl", ["--system"], timeout=15, use_privilege=True)
            # Re-materialize network
            run_command("/etc/network/post-up.d/dns-control", [], timeout=30, use_privilege=True)
            # Reload nftables
            run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15, use_privilege=True)
            # Start unbound instances from backup
            for fname in sorted(os.listdir(backup_dir)):
                if "unbound" in fname and fname.endswith(".service"):
                    svc_name = fname.split("__")[-1].replace(".service", "")
                    run_command("systemctl", ["start", svc_name], timeout=15, use_privilege=True)

            return {"status": "success", "output": f"Rollback concluído: {restored} arquivos restaurados de {backup_id}"}

        _run_step(rb_step, do_rollback)
        steps.append(rb_step)
        _update_live_state(phase="rollback_complete", lastMessage=f"Rollback automático após falha em: {failed_step_name}")

    # ════════════════════════════════════════════════════════════════
    # STEP 7: Apply files (staging → production)
    # ════════════════════════════════════════════════════════════════
    s7 = _step(7, "Aplicar arquivos (staging → produção)")
    def apply_from_staging():
        if not staging_dir:
            return {"status": "failed", "output": "Diretório de staging não encontrado"}

        written = 0
        apply_errors: list[str] = []
        for f in files:
            target_path = f["path"]
            if not _scope_matches(target_path, scope):
                continue

            result = _install_file_from_staging(
                staging_dir=staging_dir,
                target_path=target_path,
                permissions=f.get("permissions", "0644"),
            )
            if result["exit_code"] != 0:
                apply_errors.append(f"{target_path}: {result['stderr'][:200]}")
                continue

            changed_files.append(target_path)
            written += 1

        if apply_errors:
            return {
                "status": "failed",
                "output": f"Falha em {len(apply_errors)} arquivo(s)",
                "stderr": "; ".join(apply_errors),
            }

        return {"status": "success", "output": f"{written} arquivos aplicados"}

    _run_step(s7, apply_from_staging)
    steps.append(s7)
    _update_live_state(completedSteps=7)
    if s7["status"] == "failed":
        _auto_rollback("Aplicar arquivos")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)

    # ════════════════════════════════════════════════════════════════
    # STEP 8: systemctl daemon-reload
    # ════════════════════════════════════════════════════════════════
    s8 = _step(8, "Recarregar daemons (systemctl daemon-reload)", "systemctl daemon-reload")
    def daemon_reload():
        r = run_command("systemctl", ["daemon-reload"], timeout=15, use_privilege=True)
        return {
            "status": "success" if r["exit_code"] == 0 else "failed",
            "output": "daemon-reload executado",
            "stderr": r["stderr"][:500],
        }
    _run_step(s8, daemon_reload)
    steps.append(s8)
    _update_live_state(completedSteps=8)
    if s8["status"] == "failed":
        _auto_rollback("daemon-reload")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)

    # ════════════════════════════════════════════════════════════════
    # STEP 9: Apply sysctl
    # ════════════════════════════════════════════════════════════════
    s9 = _step(9, "Aplicar parâmetros sysctl", "sysctl --system")
    def apply_sysctl():
        sysctl_files = _get_scoped_sysctl_files(files, scope)
        if not sysctl_files:
            return {"status": "success", "output": "Nenhum arquivo sysctl no escopo"}

        errors: list[str] = []
        for sysctl_path in sysctl_files:
            r = run_command("sysctl", ["--load", sysctl_path], timeout=15, use_privilege=True)
            if r["exit_code"] != 0:
                errors.append(f"{sysctl_path}: {(r['stderr'] or r['stdout'])[:200]}")

        r_sys = run_command("sysctl", ["--system"], timeout=15, use_privilege=True)

        if errors:
            return {
                "status": "failed",
                "output": f"Falha ao aplicar {len(errors)} arquivo(s) sysctl",
                "stderr": "; ".join(errors),
            }
        return {"status": "success", "output": f"{len(sysctl_files)} arquivo(s) sysctl aplicados + sysctl --system"}

    _run_step(s9, apply_sysctl)
    steps.append(s9)
    _update_live_state(completedSteps=9)
    # sysctl failure is non-fatal (continue)

    # ════════════════════════════════════════════════════════════════
    # STEP 10: Materialize network (post-up)
    # ════════════════════════════════════════════════════════════════
    s10 = _step(10, "Materializar IPs de rede (post-up)", "/etc/network/post-up.d/dns-control")
    def run_postup():
        r = run_command("/etc/network/post-up.d/dns-control", [], timeout=30, use_privilege=True)
        return {
            "status": "success" if r["exit_code"] == 0 else "failed",
            "output": r["stdout"][:500] or "post-up executado",
            "stderr": r["stderr"][:500],
        }
    _run_step(s10, run_postup)
    steps.append(s10)
    _update_live_state(completedSteps=10)
    if s10["status"] == "failed":
        _auto_rollback("Materializar IPs de rede")
        return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)

    # ════════════════════════════════════════════════════════════════
    # STEPS 11-14: Enable + Start unbound instances
    # ════════════════════════════════════════════════════════════════
    order = 11
    instances = payload.get("instances", [])
    for inst in instances:
        name = inst.get("name", "unbound")

        # Enable
        s_enable = _step(order, f"Habilitar {name} no boot", f"systemctl enable {name}")
        def enable_svc(svc_name=name):
            r = run_command("systemctl", ["enable", svc_name], timeout=10, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:300] or "OK", "stderr": r["stderr"][:300]}
        _run_step(s_enable, enable_svc)
        steps.append(s_enable)
        _update_live_state(completedSteps=order)
        order += 1

        # Start
        s_start = _step(order, f"Iniciar {name}", f"systemctl restart {name}")
        def start_svc(svc_name=name):
            r = run_command("systemctl", ["restart", svc_name], timeout=30, use_privilege=True)
            if r["exit_code"] != 0:
                # Capture diagnostics
                status_r = run_command("systemctl", ["status", svc_name, "--no-pager"], timeout=10, use_privilege=True)
                journal_r = run_command("journalctl", ["--no-pager", "-n", "40", "-u", svc_name], timeout=10, use_privilege=True)
                diag = (status_r.get("stdout") or "") + "\n" + (journal_r.get("stdout") or "")
                return {"status": "failed", "output": r["stdout"][:300], "stderr": (r["stderr"][:500] + "\n" + diag[:2000]).strip()}
            return {"status": "success", "output": f"{svc_name} iniciado", "stderr": ""}
        _run_step(s_start, start_svc)
        steps.append(s_start)
        _update_live_state(completedSteps=order)
        if s_start["status"] == "failed":
            _auto_rollback(f"Iniciar {name}")
            return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)
        order += 1

    # ════════════════════════════════════════════════════════════════
    # STEP N: Load nftables — ONLY for interception mode
    # ════════════════════════════════════════════════════════════════
    _normalized_for_mode = normalize_payload(payload)
    _is_simple_mode = _normalized_for_mode.get("operationMode") == "simple"

    if _is_simple_mode:
        # Simple mode: apply local balancing nftables (NOT interception)
        s_nft_simple = _step(order, "Aplicar balanceamento local (nftables)", "nft -f /etc/nftables.conf")
        def apply_nft_simple():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15, use_privilege=True)
            return {
                "status": "success" if r["exit_code"] == 0 else "failed",
                "output": r["stdout"][:500] or "Balanceamento local carregado",
                "stderr": r["stderr"][:500],
            }
        _run_step(s_nft_simple, apply_nft_simple)
        steps.append(s_nft_simple)
        _update_live_state(completedSteps=order)
        if s_nft_simple["status"] == "failed":
            _auto_rollback("Aplicar balanceamento local")
            return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)
        order += 1
    else:
        s_nft = _step(order, "Aplicar nftables", "nft -f /etc/nftables.conf")
        def apply_nft():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15, use_privilege=True)
            return {
                "status": "success" if r["exit_code"] == 0 else "failed",
                "output": r["stdout"][:500] or "nftables carregado",
                "stderr": r["stderr"][:500],
            }
        _run_step(s_nft, apply_nft)
        steps.append(s_nft)
        _update_live_state(completedSteps=order)
        if s_nft["status"] == "failed":
            _auto_rollback("Aplicar nftables")
            return _build_result(deploy_id, steps, False, dry_run, scope, operator, files, [], backup_id, validation_errors, validation_results)
        order += 1

        # Enable + start nftables service
        s_nft_enable = _step(order, "Habilitar nftables no boot", "systemctl enable nftables")
        def enable_nft():
            run_command("systemctl", ["enable", "nftables"], timeout=10, use_privilege=True)
            r = run_command("systemctl", ["start", "nftables"], timeout=10, use_privilege=True)
            return {"status": "success", "output": "nftables habilitado e ativo"}
        _run_step(s_nft_enable, enable_nft)
        steps.append(s_nft_enable)
        _update_live_state(completedSteps=order)
        order += 1

    # ════════════════════════════════════════════════════════════════
    # STEP N: Health checks
    # ════════════════════════════════════════════════════════════════
    _update_live_state(phase="verifying", currentStep="Verificação pós-deploy")
    health_checks: list[dict] = []
    s_health = _step(order, "Verificação pós-deploy")
    def verify():
        nonlocal health_checks
        health_checks = _run_health_checks(payload)
        passed = sum(1 for h in health_checks if h["status"] == "pass")
        skipped = sum(1 for h in health_checks if h["status"] in ("skip", "warn"))
        applicable = len(health_checks) - skipped
        failed = applicable - passed
        skip_note = f" · {skipped} ignorados" if skipped else ""
        if failed > 0:
            failed_names = [h["name"] for h in health_checks if h["status"] == "fail"]
            detail = "; ".join(failed_names[:5])
            return {"status": "failed", "output": f"{passed}/{applicable} checks OK — {failed} falharam ({detail}){skip_note}"}
        return {"status": "success", "output": f"{passed}/{applicable} checks OK{skip_note}"}
    _run_step(s_health, verify)
    steps.append(s_health)

    # Cleanup staging
    if staging_dir and os.path.isdir(staging_dir):
        try:
            shutil.rmtree(staging_dir)
        except Exception:
            pass

    # Save deploy state + version manifest
    _save_deploy_state(deploy_id, operator, all_ok, backup_id)
    if all_ok:
        try:
            write_version_manifest(deploy_id, operator, files)
        except Exception as e:
            logger.warning(f"Failed to write version manifest: {e}")

    _update_live_state(
        phase="success" if all_ok else "failed",
        lastMessage=f"Deploy {'concluído com sucesso' if all_ok else 'falhou'}",
        completedSteps=len(steps),
        totalSteps=len(steps),
    )

    return _build_result(
        deploy_id, steps, all_ok, dry_run, scope, operator,
        files, health_checks, backup_id, validation_errors, validation_results,
    )


# ═══════════════════════════════════════════════════════════════════
# Rollback
# ═══════════════════════════════════════════════════════════════════

def execute_rollback(backup_id: str, operator: str = "system") -> dict:
    """Rollback to a previous backup snapshot with global lock."""
    try:
        with deploy_lock("rollback", timeout=60):
            return _execute_rollback_locked(backup_id, operator)
    except RuntimeError as e:
        return {"success": False, "error": str(e), "restoredFiles": [], "restartedServices": [], "steps": [], "duration": 0}


def _execute_rollback_locked(backup_id: str, operator: str = "system") -> dict:
    """Internal rollback: stop → clean → restore → reload → restart."""
    steps: list[dict] = []
    restored_files: list[str] = []
    services_to_restart: set[str] = set()

    _update_live_state(phase="rollback_in_progress", startedAt=_now_iso(), currentStep="Rollback", lastMessage="Iniciando rollback")

    bdir = os.path.join(BACKUP_ROOT, backup_id)
    if not os.path.isdir(bdir):
        _update_live_state(phase="rollback_failed", lastMessage="Backup não encontrado")
        return {"success": False, "error": f"Backup não encontrado: {backup_id}",
                "restoredFiles": [], "restartedServices": [], "steps": [], "duration": 0}

    t0 = time.monotonic()

    # Step 1: Stop current services
    s1 = _step(1, "Parar serviços atuais")
    def stop():
        r = run_command("bash", ["-c",
            "systemctl list-units --type=service --all --no-pager --plain 2>/dev/null | grep '^unbound' | awk '{print $1}'"
        ], timeout=10)
        units = [s.strip().replace(".service", "") for s in (r.get("stdout") or "").splitlines() if s.strip()]
        for u in units:
            run_command("systemctl", ["stop", u], timeout=15, use_privilege=True)
        run_command("killall", ["-q", "unbound"], timeout=5, use_privilege=True)
        run_command("nft", ["flush", "ruleset"], timeout=10, use_privilege=True)
        return {"status": "success", "output": f"Parados: {', '.join(units) if units else 'nenhum'}"}
    _run_step(s1, stop)
    steps.append(s1)

    # Step 2: Remove loopback IPs + lo0
    s2 = _step(2, "Limpar IPs de rede")
    def clean_ips():
        import re as _re
        r_lo = run_command("ip", ["-4", "addr", "show", "dev", "lo"], timeout=5)
        for ip in _re.findall(r'inet (\d+\.\d+\.\d+\.\d+)/\d+', r_lo.get("stdout") or ""):
            if ip != "127.0.0.1":
                run_command("ip", ["addr", "del", f"{ip}/32", "dev", "lo"], timeout=5, use_privilege=True)
        r_lo0 = run_command("ip", ["link", "show", "lo0"], timeout=5)
        if r_lo0.get("exit_code") == 0:
            run_command("ip", ["link", "del", "lo0"], timeout=5, use_privilege=True)
        return {"status": "success", "output": "IPs limpos"}
    _run_step(s2, clean_ips)
    steps.append(s2)

    # Step 3: Restore files
    s3 = _step(3, "Restaurar arquivos do backup")
    def restore():
        for fname in os.listdir(bdir):
            if fname == "manifest.json":
                continue
            original_path = "/" + fname.replace("__", "/")
            src = os.path.join(bdir, fname)
            ddir = os.path.dirname(original_path)
            run_command("mkdir", ["-p", ddir], timeout=5, use_privilege=True)
            run_command("cp", ["--no-preserve=ownership", src, original_path], timeout=10, use_privilege=True)
            restored_files.append(original_path)
            if "/unbound/" in original_path and original_path.endswith(".service"):
                name = os.path.basename(original_path).replace(".service", "")
                services_to_restart.add(name)
            elif "/unbound/" in original_path and original_path.endswith(".conf"):
                name = os.path.basename(original_path).replace(".conf", "")
                if name.startswith("unbound"):
                    services_to_restart.add(name)
            if "nftables" in original_path:
                services_to_restart.add("nftables")
        return {"status": "success", "output": f"{len(restored_files)} arquivos restaurados"}
    _run_step(s3, restore)
    steps.append(s3)

    # Step 4: daemon-reload
    s4 = _step(4, "daemon-reload")
    def reload_d():
        r = run_command("systemctl", ["daemon-reload"], timeout=15, use_privilege=True)
        return {"status": "success" if r["exit_code"] == 0 else "failed", "output": "OK"}
    _run_step(s4, reload_d)
    steps.append(s4)

    # Step 5: sysctl --system
    s5 = _step(5, "sysctl --system")
    def sysctl_reload():
        r = run_command("sysctl", ["--system"], timeout=15, use_privilege=True)
        return {"status": "success" if r["exit_code"] == 0 else "failed", "output": "OK"}
    _run_step(s5, sysctl_reload)
    steps.append(s5)

    # Step 6: Network post-up
    order = 6
    has_network = any("post-up" in f or "interfaces" in f for f in restored_files)
    if has_network:
        s = _step(order, "Materializar IPs de rede (post-up)")
        def run_postup():
            r = run_command("/etc/network/post-up.d/dns-control", [], timeout=30, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, run_postup)
        steps.append(s)
        order += 1

    # Step 7: nftables
    if "nftables" in services_to_restart:
        s = _step(order, "Recarregar nftables")
        def reload_nft():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, reload_nft)
        steps.append(s)
        order += 1

    # Step 8+: Unbound instances
    unbound_services = sorted(s for s in services_to_restart if s.startswith("unbound"))
    for svc in unbound_services:
        s = _step(order, f"Reiniciar {svc}")
        def restart_svc(name=svc):
            run_command("systemctl", ["enable", name], timeout=10, use_privilege=True)
            r = run_command("systemctl", ["restart", name], timeout=30, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, restart_svc)
        steps.append(s)
        order += 1

    duration = int((time.monotonic() - t0) * 1000)
    all_ok = all(s["status"] == "success" for s in steps)

    _update_live_state(
        phase="rollback_success" if all_ok else "rollback_failed",
        lastMessage=f"Rollback {'concluído' if all_ok else 'falhou'}",
    )

    return {
        "success": all_ok,
        "restoredFiles": restored_files,
        "restartedServices": list(services_to_restart),
        "steps": steps,
        "duration": duration,
    }


# ═══════════════════════════════════════════════════════════════════
# State management
# ═══════════════════════════════════════════════════════════════════

def get_deploy_state() -> dict:
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


# ═══════════════════════════════════════════════════════════════════
# Internal helpers
# ═══════════════════════════════════════════════════════════════════

def _add_vr(results: dict, bucket: str, status: str, file_path: str | None,
            command: str | None = None, stderr: str = "", remediation: str = "", details: str = ""):
    results.setdefault(bucket, []).append({
        "status": status, "file": file_path, "command": command,
        "stderr": stderr, "remediation": remediation, "details": details,
    })


def _install_file_from_staging(staging_dir: str, target_path: str, permissions: str = "0644") -> dict[str, Any]:
    staged_path = os.path.join(staging_dir, target_path.lstrip("/"))
    if not os.path.exists(staged_path):
        return {"exit_code": -1, "stdout": "", "stderr": f"Arquivo staging ausente: {staged_path}", "duration_ms": 0}

    target_dir = os.path.dirname(target_path)
    mkdir_result = run_command("mkdir", ["-p", target_dir], timeout=10, use_privilege=True)
    if mkdir_result["exit_code"] != 0:
        return mkdir_result

    result = run_command("cp", ["--no-preserve=ownership", staged_path, target_path], timeout=15, use_privilege=True)
    if result["exit_code"] != 0:
        return result

    return run_command("chmod", [permissions, target_path], timeout=10, use_privilege=True)


def _get_scoped_sysctl_files(files: list[dict[str, Any]], scope: str) -> list[str]:
    return [f["path"] for f in files if "sysctl" in f["path"] and _scope_matches(f["path"], scope)]


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


def _detect_ip_collisions(payload: dict[str, Any]) -> list[str]:
    normalized = normalize_payload(payload)
    instances = normalized.get("instances", []) or []
    vips = (
        normalized.get("nat", {}).get("serviceVips", [])
        or payload.get("serviceVips", [])
        or []
    )

    entries_by_ip: dict[str, list[dict[str, str]]] = {}

    def add(ip: str, layer: str, instance_name: str = ""):
        if not ip:
            return
        entries_by_ip.setdefault(ip, []).append({"layer": layer, "instance": instance_name})

    host_ip = (normalized.get("environment", {}).get("ipv4Address", "") or payload.get("ipv4Address", ""))
    if host_ip:
        add(str(host_ip).split("/")[0], "host")

    for vip in vips:
        add((vip or {}).get("ipv4", ""), "vip")

    for inst in instances:
        name = inst.get("name", "unknown")
        add(inst.get("bindIp", ""), "bindIp", name)
        add(inst.get("exitIp", ""), "egressIpv4", name)
        add(inst.get("controlInterface", ""), "controlInterface", name)

    collisions: list[str] = []
    for ip, users in entries_by_ip.items():
        if len(users) <= 1:
            continue
        if len(users) == 2:
            a, b = users
            same_inst = a.get("instance") and a.get("instance") == b.get("instance")
            allowed_layers = {a.get("layer"), b.get("layer")} == {"bindIp", "controlInterface"}
            if same_inst and allowed_layers:
                continue
        labels = [f"{u['instance']}/{u['layer']}" if u.get("instance") else u["layer"] for u in users]
        collisions.append(f"IP {ip} usado por {', '.join(labels)}")

    return collisions


def _run_health_checks(payload: dict) -> list[dict]:
    """Post-deploy health checks — validates full topology."""
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
            "name": f"{name} systemd status", "target": name,
            "status": "pass" if r["exit_code"] == 0 else "fail",
            "detail": r["stdout"].strip() or r["stderr"].strip(),
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

        # DNS probe
        if bind_ip:
            t0 = time.monotonic()
            r = run_command("dig", [f"@{bind_ip}", "localhost", "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"{name} DNS probe ({bind_ip})", "target": bind_ip,
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or "No response",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

        # Port binding (ss :53)
        if bind_ip:
            t0 = time.monotonic()
            r = run_command("ss", ["-lntup"], timeout=5)
            port_bound = bind_ip in r["stdout"] and ":53" in r["stdout"]
            checks.append({
                "name": f"{name} port 53 bound ({bind_ip})", "target": f"{bind_ip}:53",
                "status": "pass" if port_bound else "fail",
                "detail": "Port 53 bound" if port_bound else "Port 53 NOT bound",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

        # Control interface
        if control_iface:
            t0 = time.monotonic()
            r = run_command("unbound-control", [
                "-s", f"{control_iface}@{control_port}",
                "-c", f"/etc/unbound/{name}.conf",
                "status"
            ], timeout=5, use_privilege=True)
            checks.append({
                "name": f"{name} control interface", "target": f"{control_iface}:{control_port}",
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or r["stderr"].strip()[:200],
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    # ── nftables checks: mode-dependent ──
    operation_mode = str(
        payload.get("operationMode")
        or payload.get("_wizardConfig", {}).get("operationMode", "")
        or ""
    ).lower()
    is_simple_mode = operation_mode in ("simple", "recursivo_simples", "recursivo simples")
    is_no_mode = operation_mode == ""

    nft_ruleset = ""

    if is_simple_mode:
        # ── Simple mode: check local balancing ──
        frontend_ip = str(
            payload.get("frontendDnsIp")
            or payload.get("_wizardConfig", {}).get("frontendDnsIp", "")
            or ""
        ).strip()

        # Check nftables local balancing loaded
        t0 = time.monotonic()
        r = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
        checks.append({
            "name": "Balanceamento local (nftables) carregado", "target": "nftables",
            "status": "pass" if r["exit_code"] == 0 and r["stdout"].strip() else "fail",
            "detail": r["stdout"].strip()[:200] or "No tables",
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

        # Check DNAT rules for each backend
        t0 = time.monotonic()
        r = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
        nft_ruleset = r.get("stdout") or ""
        nft_dur = int((time.monotonic() - t0) * 1000)

        for inst in instances:
            name = inst.get("name", "unbound")
            bind_ip = inst.get("bindIp", "")
            if bind_ip:
                has_dnat = f"dnat to {bind_ip}:53" in nft_ruleset
                checks.append({
                    "name": f"Balanceamento local → {name} ({bind_ip})", "target": f"local/{name}",
                    "status": "pass" if has_dnat else "fail",
                    "detail": f"DNAT local para {bind_ip}:53 {'encontrada' if has_dnat else 'AUSENTE'}",
                    "durationMs": nft_dur,
                })

        # Frontend DNS probe
        if frontend_ip:
            t0 = time.monotonic()
            r = run_command("dig", [f"@{frontend_ip}", "localhost", "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"Frontend DNS ({frontend_ip}) responde", "target": frontend_ip,
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or "Sem resposta",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    elif not is_no_mode:
        # ── Interception mode: full nftables checks ──
        # nftables loaded
        t0 = time.monotonic()
        r = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
        checks.append({
            "name": "nftables rules loaded", "target": "nftables",
            "status": "pass" if r["exit_code"] == 0 and r["stdout"].strip() else "fail",
            "detail": r["stdout"].strip()[:200] or "No tables",
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

        # nft list ruleset for DNAT + sticky verification
        t0 = time.monotonic()
        r = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
        nft_ruleset = r.get("stdout") or ""
        nft_dur = int((time.monotonic() - t0) * 1000)

        for inst in instances:
            name = inst.get("name", "unbound")
            bind_ip = inst.get("bindIp", "")
            if bind_ip:
                has_dnat = f"dnat to {bind_ip}:53" in nft_ruleset
                checks.append({
                    "name": f"nftables DNAT → {name} ({bind_ip})", "target": f"nftables/{name}",
                    "status": "pass" if has_dnat else "fail",
                    "detail": f"DNAT rule para {bind_ip}:53 {'encontrada' if has_dnat else 'AUSENTE'}",
                    "durationMs": nft_dur,
                })

        for inst in instances:
            name = inst.get("name", "unbound")
            set_name = f"ipv4_users_{name}"
            has_set = set_name in nft_ruleset
            checks.append({
                "name": f"nftables sticky set {set_name}", "target": f"nftables/{set_name}",
                "status": "pass" if has_set else "fail",
                "detail": f"Set dinâmico {set_name} {'presente' if has_set else 'AUSENTE'}",
                "durationMs": 0,
            })

        # nftables counters
        t0 = time.monotonic()
        r = run_command("nft", ["list", "counters"], timeout=5, use_privilege=True)
        checks.append({
            "name": "nftables counters", "target": "nftables",
            "status": "pass" if r["exit_code"] == 0 else "fail",
            "detail": r["stdout"].strip()[:200] or "No counters",
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

    # VIP reachability
    for vip in (vips or []):
        vip_ip = vip.get("ipv4", "")
        if vip_ip:
            probe_domain = vip.get("healthCheckDomain", "google.com") or "google.com"
            if not vip.get("healthCheckEnabled", True):
                checks.append({"name": f"VIP {vip_ip} health check", "target": vip_ip, "status": "skip", "detail": "Desabilitado", "durationMs": 0})
                continue
            t0 = time.monotonic()
            r = run_command("dig", [f"@{vip_ip}", probe_domain, "+short", "+time=2", "+tries=1"], timeout=5)
            checks.append({
                "name": f"VIP {vip_ip} reachable (dig {probe_domain})", "target": vip_ip,
                "status": "pass" if r["exit_code"] == 0 else "fail",
                "detail": r["stdout"].strip()[:200] or "No response",
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    # Border-routed masquerade check
    egress_delivery = str(
        payload.get("egressDeliveryMode")
        or payload.get("_wizardConfig", {}).get("egressDeliveryMode", "")
        or "host-owned"
    )
    if egress_delivery == "border-routed":
        checks.append({
            "name": "Border-routed: no masquerade in ruleset", "target": "nftables",
            "status": "fail" if "masquerade" in nft_ruleset else "pass",
            "detail": "masquerade encontrado" if "masquerade" in nft_ruleset else "OK",
            "durationMs": 0,
        })

    # Listener IP materialization (check lo AND lo0)
    t0 = time.monotonic()
    r_lo = run_command("ip", ["-4", "addr"], timeout=5)
    all_ips = r_lo.get("stdout") or ""
    ip_dur = int((time.monotonic() - t0) * 1000)

    for inst in instances:
        bind_ip = inst.get("bindIp", "")
        name = inst.get("name", "unbound")
        if bind_ip and bind_ip not in ("127.0.0.1", "0.0.0.0"):
            checks.append({
                "name": f"{name} listener IP on host ({bind_ip})", "target": bind_ip,
                "status": "pass" if bind_ip in all_ips else "fail",
                "detail": f"Listener IP {bind_ip} {'presente' if bind_ip in all_ips else 'AUSENTE'}",
                "durationMs": ip_dur,
            })

    # Egress IP materialization (host-owned) — skip in simple mode (no outgoing-interface)
    if egress_delivery == "host-owned" and not is_simple_mode:
        for inst in instances:
            egress_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
            name = inst.get("name", "unbound")
            if egress_ip:
                checks.append({
                    "name": f"{name} egress IP on loopback ({egress_ip})", "target": egress_ip,
                    "status": "pass" if egress_ip in all_ips else "fail",
                    "detail": f"Egress IP {egress_ip} {'presente' if egress_ip in all_ips else 'AUSENTE'}",
                    "durationMs": 0,
                })
    elif egress_delivery == "host-owned" and is_simple_mode:
        for inst in instances:
            egress_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
            name = inst.get("name", "unbound")
            if egress_ip:
                checks.append({
                    "name": f"{name} egress IP on loopback ({egress_ip})", "target": egress_ip,
                    "status": "skip",
                    "detail": "Não aplicável no modo simples (sem outgoing-interface dedicada)",
                    "durationMs": 0,
                })

    # Legacy unbound detection — warning only in simple mode
    t0 = time.monotonic()
    r = run_command("systemctl", ["is-active", "unbound"], timeout=5)
    if r["exit_code"] == 0 and "active" in (r.get("stdout") or ""):
        checks.append({
            "name": "Legacy unbound.service detection", "target": "unbound",
            "status": "warn" if is_simple_mode else "fail",
            "detail": "unbound.service padrão ativo — pode interferir" if not is_simple_mode else "unbound.service padrão ativo (não interfere no modo simples com balanceamento local)",
            "durationMs": int((time.monotonic() - t0) * 1000),
        })

    return checks


def _generate_health_checks(payload: dict, dry_run: bool = False) -> list[dict]:
    checks = []
    instances = payload.get("instances", [])
    for inst in instances:
        name = inst.get("name", "unbound")
        checks.append({"name": f"{name} systemd status", "target": name, "status": "skip", "detail": "Dry-run", "durationMs": 0})
        if inst.get("bindIp"):
            checks.append({"name": f"{name} DNS probe ({inst['bindIp']})", "target": inst["bindIp"], "status": "skip", "detail": "Dry-run", "durationMs": 0})
            checks.append({"name": f"{name} port 53 bound ({inst['bindIp']})", "target": f"{inst['bindIp']}:53", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    checks.append({"name": "nftables rules loaded", "target": "nftables", "status": "skip", "detail": "Dry-run", "durationMs": 0})
    return checks


def _save_deploy_state(deploy_id: str, operator: str, success: bool, backup_id: str | None,
                       payload: dict | None = None):
    try:
        existing = get_deploy_state()
        total = existing.get("totalDeployments", 0) + 1

        # Extract operation mode and frontend IP from payload
        operation_mode = ""
        frontend_dns_ip = ""
        if payload:
            normalized = normalize_payload(payload)
            operation_mode = normalized.get("operationMode", "")
            frontend_dns_ip = normalized.get("frontendDnsIp", "")

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
            "operationMode": operation_mode,
            "frontendDnsIp": frontend_dns_ip,
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
    deploy_id: str,
    steps: list[dict],
    success: bool,
    dry_run: bool,
    scope: str,
    operator: str,
    files: list,
    health_checks: list,
    backup_id: str | None,
    validation_errors: list[dict[str, Any]] | None = None,
    validation_results: dict[str, list[dict[str, Any]]] | None = None,
) -> dict:
    total_duration = sum(s.get("durationMs", 0) for s in steps)
    status = "dry-run" if dry_run else ("success" if success else "failed")
    state = get_deploy_state()
    validation_errors = validation_errors or []
    validation_results = validation_results or {
        "unbound": [], "nftables": [], "network": [], "ipCollision": [],
    }

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
        "validationErrors": validation_errors,
        "validationResults": validation_results,
    }
