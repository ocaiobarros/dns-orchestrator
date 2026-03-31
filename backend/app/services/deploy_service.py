"""
DNS Control — Deploy Service
Full production deployment lifecycle: validate → generate → stage → validate-staged → backup → apply → reload → verify.
Includes global deploy lock, bash -n validation, and version manifest tracking.
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
from app.services.payload_normalizer import normalize_payload
from app.generators.nftables_generator import generate_nftables_config
from app.executors.command_runner import run_command
from app.services.deploy_lock import deploy_lock
from app.services.drift_service import write_version_manifest

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
    """Full deployment pipeline with staging directory validation and global lock."""
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
    nft_validation_staged_path: str | None = None

    def write_staging():
        nonlocal staging_dir, nft_validation_staged_path
        staging_dir = os.path.join(STAGING_ROOT, f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{deploy_id}")
        os.makedirs(staging_dir, exist_ok=True)

        for f in files:
            staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
            os.makedirs(os.path.dirname(staged_path), exist_ok=True)
            with open(staged_path, "w") as fp:
                fp.write(f["content"])

        # Generate safe nftables artifact for syntax validation (no flush ruleset)
        try:
            normalized_payload = normalize_payload(payload)
            validation_files = generate_nftables_config(normalized_payload, validation_mode=True)
            if validation_files:
                rel_path = validation_files[0]["path"].lstrip("/")
                nft_validation_staged_path = os.path.join(staging_dir, rel_path)
                os.makedirs(os.path.dirname(nft_validation_staged_path), exist_ok=True)
                with open(nft_validation_staged_path, "w") as vf:
                    vf.write(validation_files[0]["content"])
        except Exception as exc:
            logger.warning(f"Failed to generate nftables validation artifact: {exc}")

        extra = " + nftables.validate.conf" if nft_validation_staged_path else ""
        return {"status": "success", "output": f"{len(files)} arquivos gravados em staging{extra}: {staging_dir}"}

    _run_step(s3_stage, write_staging)
    steps.append(s3_stage)
    _update_live_state(completedSteps=3)

    # ═══ Step 4: Validate staged files ═══
    s4_validate = _step(4, "Validar arquivos em staging")
    validation_errors: list[dict[str, Any]] = []
    validation_results: dict[str, list[dict[str, Any]]] = {
        "unbound": [],
        "nftables": [],
        "network": [],
        "ipCollision": [],
    }

    def _add_validation_result(
        bucket: str,
        status: str,
        file_path: str | None,
        command: str | None,
        stderr: str = "",
        remediation: str = "",
        details: str = "",
    ):
        validation_results.setdefault(bucket, []).append({
            "status": status,
            "file": file_path,
            "command": command,
            "stderr": stderr,
            "remediation": remediation,
            "details": details,
        })

    def validate_staged():
        nonlocal validation_errors
        if not staging_dir:
            return {"status": "failed", "output": "Staging directory missing"}

        # ═══ Pre-validate: check include targets and auto-create placeholders ═══
        import re
        include_pattern = re.compile(r'^\s*include:\s*["\']?([^"\'#\s]+)', re.MULTILINE)
        # Known placeholder files that are populated at runtime (sync scripts)
        _RUNTIME_INCLUDES = {"anablock.conf", "unbound-block-domains.conf"}
        for f in files:
            if "/unbound/" in f["path"] and f["path"].endswith(".conf"):
                matches = include_pattern.findall(f.get("content", ""))
                for inc_path in matches:
                    if "*" in inc_path:
                        continue
                    staged_inc = os.path.join(staging_dir, inc_path.lstrip("/"))
                    basename = os.path.basename(inc_path)
                    if not os.path.exists(staged_inc):
                        # Auto-create placeholder for known runtime files
                        if basename in _RUNTIME_INCLUDES:
                            os.makedirs(os.path.dirname(staged_inc), exist_ok=True)
                            with open(staged_inc, "w") as ph:
                                ph.write("# auto-placeholder — populated by sync scripts\n")
                            logger.info(f"Auto-created runtime placeholder: {inc_path}")
                        else:
                            err = {
                                "category": "unbound-include-missing",
                                "command": None,
                                "file": f["path"],
                                "stderr": f"Missing generated include target: {inc_path} (referenced in {f['path']})",
                                "remediation": "Blocklist disabled but include still emitted, or include target file was not generated. Check enableBlocklist toggle.",
                            }
                            validation_errors.append(err)
                            _add_validation_result("unbound", "fail", f["path"], None, err["stderr"], err["remediation"])

        # ═══ Create empty placeholders for missing include targets in staging ═══
        # Blocklist/anablock files may not be generated but are referenced via include:
        # Create empty stubs so unbound-checkconf doesn't fail on missing files.
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
                        logger.debug(f"Created placeholder for include: {inc_path}")

        # Validate unbound configs (skip blocklist placeholder files)
        for f in files:
            if "/unbound/" in f["path"] and f["path"].endswith(".conf") and "block" not in f["path"] and "anablock" not in f["path"]:
                staged_path = os.path.join(staging_dir, f["path"].lstrip("/"))
                if os.path.exists(staged_path):
                    # ═══ Rewrite absolute include paths to staging paths for checkconf ═══
                    original_content = open(staged_path).read()

                    def _rewrite_inc(match):
                        inc = match.group(1)
                        return match.group(0).replace(inc, os.path.join(staging_dir, inc.lstrip("/")))

                    rewritten = include_pattern.sub(_rewrite_inc, original_content)

                    checkconf_path = staged_path + ".checkconf"
                    with open(checkconf_path, "w") as tmp:
                        tmp.write(rewritten)

                    logger.debug(f"Checkconf rewrite for {f['path']}: {'paths rewritten' if rewritten != original_content else 'no includes found'}")

                    r = run_command("unbound-checkconf", [checkconf_path], timeout=10)

                    # Cleanup temp file
                    if checkconf_path != staged_path and os.path.exists(checkconf_path):
                        os.remove(checkconf_path)

                    if r["exit_code"] != 0:
                        err = {
                            "category": "unbound-validation",
                            "command": f"unbound-checkconf {staged_path}",
                            "file": f["path"],
                            "stderr": (r.get("stderr") or r.get("stdout") or "Falha de validação do Unbound").strip(),
                            "remediation": "Verifique a sintaxe do arquivo Unbound e os blocos include/remote-control.",
                        }
                        validation_errors.append(err)
                        _add_validation_result("unbound", "fail", f["path"], err["command"], err["stderr"], err["remediation"])
                    else:
                        _add_validation_result("unbound", "pass", f["path"], f"unbound-checkconf {staged_path}", "")

        # Validate nftables safe config (without flush ruleset)
        if nft_validation_staged_path and os.path.exists(nft_validation_staged_path):
            nft_cmd = f"nft -c -f {nft_validation_staged_path}"
            nft_result = run_command("nft", ["-c", "-f", nft_validation_staged_path], timeout=10, use_privilege=True)
            if nft_result["exit_code"] != 0:
                nft_stderr = (nft_result.get("stderr") or nft_result.get("stdout") or "Falha de validação nftables").strip()
                err = {
                    "category": "nftables-validation",
                    "command": nft_cmd,
                    "file": "/etc/nftables.validate.conf",
                    "stderr": nft_stderr,
                    "remediation": "Revise regras DNAT, sets e sintaxe nftables. O arquivo de validação não executa flush ruleset.",
                }
                validation_errors.append(err)
                _add_validation_result("nftables", "fail", err["file"], nft_cmd, nft_stderr, err["remediation"])
            else:
                _add_validation_result("nftables", "pass", "/etc/nftables.validate.conf", nft_cmd)
        else:
            err = {
                "category": "nftables-validation",
                "command": None,
                "file": "/etc/nftables.validate.conf",
                "stderr": "Arquivo de validação nftables não foi gerado no staging.",
                "remediation": "Regenere os artefatos de staging e confirme a criação de /etc/nftables.validate.conf.",
            }
            validation_errors.append(err)
            _add_validation_result("nftables", "fail", err["file"], None, err["stderr"], err["remediation"])

        # Validate network files (static consistency)
        network_candidates = [
            "/etc/network/interfaces",
            "/etc/network/post-up.sh",
        ]
        found_network_artifact = False
        for network_path in network_candidates:
            staged_network_path = os.path.join(staging_dir, network_path.lstrip("/"))
            if not os.path.exists(staged_network_path):
                continue
            found_network_artifact = True
            with open(staged_network_path, "r") as nf:
                content = nf.read()

            if network_path.endswith("interfaces"):
                ok = "iface" in content and "address" in content and "gateway" in content
                cmd = f"static-check {staged_network_path}"
                if not ok:
                    err = {
                        "category": "network-validation",
                        "command": cmd,
                        "file": network_path,
                        "stderr": "Arquivo de interfaces sem blocos obrigatórios (iface/address/gateway).",
                        "remediation": "Revise /etc/network/interfaces gerado e confirme interface principal, endereço e gateway.",
                    }
                    validation_errors.append(err)
                    _add_validation_result("network", "fail", network_path, cmd, err["stderr"], err["remediation"])
                else:
                    _add_validation_result("network", "pass", network_path, cmd)
            else:
                ok = content.startswith("#!/") and "ip " in content
                cmd = f"static-check {staged_network_path}"
                if not ok:
                    err = {
                        "category": "network-validation",
                        "command": cmd,
                        "file": network_path,
                        "stderr": "Script post-up inválido (faltando shebang ou comandos de rede).",
                        "remediation": "Revise /etc/network/post-up.sh e garanta comandos ip válidos.",
                    }
                    validation_errors.append(err)
                    _add_validation_result("network", "fail", network_path, cmd, err["stderr"], err["remediation"])
                else:
                    _add_validation_result("network", "pass", network_path, cmd)

                # bash -n syntax validation for shell scripts
                bash_cmd = f"bash -n {staged_network_path}"
                bash_result = run_command("bash", ["-n", staged_network_path], timeout=10)
                if bash_result["exit_code"] != 0:
                    bash_stderr = (bash_result.get("stderr") or bash_result.get("stdout") or "Erro de sintaxe bash").strip()
                    err = {
                        "category": "bash-syntax-validation",
                        "command": bash_cmd,
                        "file": network_path,
                        "stderr": bash_stderr,
                        "remediation": "Corrija erros de sintaxe no script shell antes de aplicar.",
                    }
                    validation_errors.append(err)
                    _add_validation_result("network", "fail", network_path, bash_cmd, bash_stderr, err["remediation"])
                else:
                    _add_validation_result("network", "pass", network_path, bash_cmd, "", "", "bash -n OK")

        if not found_network_artifact:
            _add_validation_result(
                "network",
                "pass",
                None,
                None,
                "",
                "",
                "Nenhum artefato de rede foi gerado para este escopo/modo de deploy.",
            )

        # IP collision detection
        ip_collisions = _detect_ip_collisions(payload)
        if ip_collisions:
            for collision in ip_collisions:
                err = {
                    "category": "ip-collision",
                    "command": "ip-collision-check",
                    "file": None,
                    "stderr": collision,
                    "remediation": "Garanta separação entre camadas VIP, listener, egress e host. bindIp/controlInterface iguais só são aceitos na mesma instância.",
                }
                validation_errors.append(err)
                _add_validation_result("ipCollision", "fail", None, "ip-collision-check", collision, err["remediation"])
        else:
            _add_validation_result("ipCollision", "pass", None, "ip-collision-check", "")

        if validation_errors:
            _update_live_state(errors=validation_errors)
            stderr_dump = "\n\n".join(
                f"[{err.get('category', 'validation')}] {err.get('stderr', '')}" for err in validation_errors
            )
            return {
                "status": "failed",
                "output": f"{len(validation_errors)} erros de validação",
                "stderr": stderr_dump,
            }

        total_checks = sum(len(items) for items in validation_results.values())
        return {"status": "success", "output": f"Validação staging OK: {total_checks} verificações"}

    _run_step(s4_validate, validate_staged)
    steps.append(s4_validate)
    _update_live_state(completedSteps=4)

    if dry_run:
        # Generate commands that would run
        restart_cmds = _get_restart_commands(scope, payload)
        sysctl_plan = [f"sysctl --load {path}" for path in _get_scoped_sysctl_files(files, scope)]
        commands_plan = [
            "systemctl daemon-reload",
            *sysctl_plan,
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

        result = _build_result(
            deploy_id,
            steps,
            not bool(validation_errors),
            True,
            scope,
            operator,
            files,
            health_checks,
            None,
            validation_errors,
            validation_results,
        )
        result["commandsPlan"] = commands_plan
        result["warnings"] = _live_state.get("warnings", [])
        _update_live_state(phase="idle", lastMessage="Dry-run concluído")
        return result

    if s4_validate["status"] == "failed":
        _update_live_state(phase="failed", lastMessage="Validação de staging falhou")
        return _build_result(
            deploy_id,
            steps,
            False,
            dry_run,
            scope,
            operator,
            files,
            [],
            backup_id,
            validation_errors,
            validation_results,
        )

    # ═══ Step 5: Backup ═══
    total_apply_steps = 14  # estimate
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

    # ═══ Step 6: Cleanup existing services (stop old, flush nftables, remove stale IPs) ═══
    s6_cleanup = _step(6, "Limpeza de serviços existentes")
    s6_cleanup["rollbackHint"] = "Restaurar backup anterior"
    def cleanup_existing():
        cleanup_msgs = []

        # 6a: Stop legacy unbound.service if active
        r = run_command("systemctl", ["is-active", "unbound"], timeout=5)
        if r["exit_code"] == 0 and "active" in (r.get("stdout") or ""):
            run_command("systemctl", ["stop", "unbound"], timeout=15, use_privilege=True)
            run_command("systemctl", ["disable", "unbound"], timeout=10, use_privilege=True)
            run_command("systemctl", ["mask", "unbound"], timeout=10, use_privilege=True)
            cleanup_msgs.append("Legacy unbound.service parado/mascarado")

        # 6b: Stop all existing unbound instances
        r = run_command("bash", ["-c", "systemctl list-units --type=service --state=active --no-pager --plain | grep '^unbound' | awk '{print $1}'"], timeout=10)
        active_unbounds = [s.strip() for s in (r.get("stdout") or "").splitlines() if s.strip()]
        for unit in active_unbounds:
            name = unit.replace(".service", "")
            run_command("systemctl", ["stop", name], timeout=15, use_privilege=True)
            cleanup_msgs.append(f"Parado: {name}")

        # 6c: Flush nftables ruleset
        r_flush = run_command("nft", ["flush", "ruleset"], timeout=10, use_privilege=True)
        if r_flush["exit_code"] == 0:
            cleanup_msgs.append("nftables: ruleset flush OK")
        else:
            cleanup_msgs.append(f"nftables flush: {r_flush.get('stderr', '')[:100]}")

        # 6d: Remove DNS-related loopback IPs (keep only 127.0.0.1)
        r_lo = run_command("ip", ["-4", "addr", "show", "dev", "lo"], timeout=5)
        lo_output = r_lo.get("stdout") or ""
        import re as _re
        lo_ips_found = _re.findall(r'inet (\d+\.\d+\.\d+\.\d+)/\d+', lo_output)
        removed_ips = 0
        for ip in lo_ips_found:
            if ip == "127.0.0.1":
                continue
            run_command("ip", ["addr", "del", f"{ip}/32", "dev", "lo"], timeout=5, use_privilege=True)
            removed_ips += 1
        if removed_ips:
            cleanup_msgs.append(f"Removidos {removed_ips} IPs do loopback")

        # 6e: Remove IPv6 non-link-local loopback IPs
        r_lo6 = run_command("ip", ["-6", "addr", "show", "dev", "lo"], timeout=5)
        lo6_output = r_lo6.get("stdout") or ""
        lo6_ips = _re.findall(r'inet6 ([0-9a-fA-F:]+)/\d+', lo6_output)
        removed_v6 = 0
        for ip6 in lo6_ips:
            if ip6 == "::1" or ip6.startswith("fe80"):
                continue
            run_command("ip", ["-6", "addr", "del", f"{ip6}/128", "dev", "lo"], timeout=5, use_privilege=True)
            removed_v6 += 1
        if removed_v6:
            cleanup_msgs.append(f"Removidos {removed_v6} IPv6 do loopback")

        # 6f: Clean old nftables.d snippets
        r_clean = run_command("bash", ["-c", "rm -f /etc/nftables.d/*.nft 2>/dev/null; echo ok"], timeout=5, use_privilege=True)
        cleanup_msgs.append("Snippets /etc/nftables.d/*.nft limpos")

        # 6g: Kill any remaining unbound processes
        run_command("killall", ["-q", "unbound"], timeout=5, use_privilege=True)

        return {
            "status": "success",
            "output": "; ".join(cleanup_msgs) if cleanup_msgs else "Limpeza concluída (nada encontrado)",
        }
    _run_step(s6_cleanup, cleanup_existing)
    steps.append(s6_cleanup)
    _update_live_state(completedSteps=6)

    # ═══ Step 7: Apply files from staging to final paths ═══
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
        all_ok = False

    # ═══ Step 8: chmod scripts ═══
    s8_chmod = _step(8, "Ajustar permissões de scripts")
    def chmod_scripts():
        return {"status": "success", "output": "Permissões já aplicadas durante install"}
    _run_step(s8_chmod, chmod_scripts)
    steps.append(s8_chmod)
    _update_live_state(completedSteps=8)

    # ═══ Step 8: daemon-reload ═══
    s8 = _step(8, "Recarregar daemons (systemctl daemon-reload)", "systemctl daemon-reload")
    s8["rollbackHint"] = "Não requer rollback"
    def daemon_reload():
        r = run_command("systemctl", ["daemon-reload"], timeout=15, use_privilege=True)
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

    # ═══ Step 9: targeted sysctl reload ═══
    s9_sysctl = _step(9, "Aplicar parâmetros sysctl", "sysctl --load <arquivo>")
    def apply_sysctl():
        sysctl_files = _get_scoped_sysctl_files(files, scope)
        if not sysctl_files:
            return {"status": "success", "output": "Nenhum arquivo sysctl no escopo"}

        errors: list[str] = []
        for sysctl_path in sysctl_files:
            r = run_command("sysctl", ["--load", sysctl_path], timeout=15, use_privilege=True)
            if r["exit_code"] != 0:
                errors.append(f"{sysctl_path}: {(r['stderr'] or r['stdout'])[:200]}")

        if errors:
            return {
                "status": "failed",
                "output": f"Falha ao aplicar {len(errors)} arquivo(s) sysctl",
                "stderr": "; ".join(errors),
            }

        return {"status": "success", "output": f"{len(sysctl_files)} arquivo(s) sysctl aplicados"}
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
            use_privilege = args[0] in {"nft", "systemctl", "ifreload", "/etc/network/post-up.d/dns-control"}
            r = run_command(args[0], args[1:], timeout=30, use_privilege=use_privilege)

            stderr = r["stderr"][:1200]
            if r["exit_code"] != 0 and len(args) >= 3 and args[0] == "systemctl" and args[1] == "restart":
                service_name = args[2]
                status_result = run_command(
                    "systemctl",
                    ["status", service_name, "--no-pager"],
                    timeout=20,
                    use_privilege=True,
                )
                journal_result = run_command(
                    "journalctl",
                    ["--no-pager", "-n", "40", "-u", service_name],
                    timeout=20,
                    use_privilege=True,
                )
                status_output = (status_result.get("stdout") or status_result.get("stderr") or "").strip()
                journal_output = (journal_result.get("stdout") or journal_result.get("stderr") or "").strip()
                diagnostics = []
                if status_output:
                    diagnostics.append(f"systemctl status {service_name}:\n{status_output[:1500]}")
                if journal_output:
                    diagnostics.append(f"journalctl -u {service_name} (últimas 40 linhas):\n{journal_output[:2000]}")
                if diagnostics:
                    stderr = (stderr + "\n\n" + "\n\n".join(diagnostics)).strip()

            return {
                "status": "success" if r["exit_code"] == 0 else "failed",
                "output": r["stdout"][:500],
                "stderr": stderr,
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

    # Save deploy state + version manifest
    final_status = "success" if all_ok else "failed"
    _save_deploy_state(deploy_id, operator, all_ok, backup_id)
    if all_ok:
        try:
            write_version_manifest(deploy_id, operator, files)
        except Exception as e:
            logger.warning(f"Failed to write version manifest: {e}")
    _update_live_state(
        phase=final_status,
        lastMessage=f"Deploy {'concluído com sucesso' if all_ok else 'falhou'}",
        completedSteps=len(steps),
        totalSteps=len(steps),
    )

    return _build_result(
        deploy_id,
        steps,
        all_ok,
        dry_run,
        scope,
        operator,
        files,
        health_checks,
        backup_id,
        validation_errors,
        validation_results,
    )


def execute_rollback(backup_id: str, operator: str = "system") -> dict:
    """Rollback to a previous backup snapshot with global lock."""
    try:
        with deploy_lock("rollback", timeout=60):
            return _execute_rollback_locked(backup_id, operator)
    except RuntimeError as e:
        return {"success": False, "error": str(e), "restoredFiles": [], "restartedServices": [], "steps": [], "duration": 0}


def _execute_rollback_locked(backup_id: str, operator: str = "system") -> dict:
    """Internal rollback implementation (runs under deploy lock)."""
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

    # Step 4+: Restart services in correct order:
    # 1. Network post-up (materialize IPs on loopback — required before Unbound bind)
    # 2. nftables (load DNAT rules — requires listener IPs to exist)
    # 3. Unbound instances (bind on listener IPs — requires IPs + DNAT ready)
    # 4. FRR (routing — independent, last)
    order = 4

    # Determine which categories are affected
    has_network = any("/network/" in f or "post-up" in f for f in restored_files)
    has_nftables = "nftables" in services_to_restart
    unbound_services = sorted(s for s in services_to_restart if s.startswith("unbound"))
    has_frr = "frr" in services_to_restart

    # Phase 1: Network materialization
    if has_network:
        s = _step(order, "Materializar IPs de rede (post-up)", "/etc/network/post-up.d/dns-control")
        def run_postup():
            r = run_command("/etc/network/post-up.d/dns-control", [], timeout=30, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, run_postup)
        steps.append(s)
        order += 1

    # Phase 2: nftables
    if has_nftables:
        s = _step(order, "Recarregar nftables", "nft -f /etc/nftables.conf")
        def reload_nft():
            r = run_command("nft", ["-f", "/etc/nftables.conf"], timeout=15, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, reload_nft)
        steps.append(s)
        order += 1

    # Phase 3: Unbound instances
    for svc in unbound_services:
        s = _step(order, f"Reiniciar {svc}", f"systemctl restart {svc}")
        def restart_svc(name=svc):
            r = run_command("systemctl", ["restart", name], timeout=30, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, restart_svc)
        steps.append(s)
        order += 1

    # Phase 4: FRR
    if has_frr:
        s = _step(order, "Reiniciar FRR", "systemctl restart frr")
        def restart_frr():
            r = run_command("systemctl", ["restart", "frr"], timeout=30, use_privilege=True)
            return {"status": "success" if r["exit_code"] == 0 else "failed", "output": r["stdout"][:500]}
        _run_step(s, restart_frr)
        steps.append(s)
        order += 1

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


def _detect_ip_collisions(payload: dict[str, Any]) -> list[str]:
    """Detect invalid IP reuse across VIP, listener, egress and host layers.

    Allowed exception: bindIp == controlInterface within the same instance.
    """
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
        entries_by_ip.setdefault(ip, []).append({
            "layer": layer,
            "instance": instance_name,
        })

    host_ip = (
        normalized.get("environment", {}).get("ipv4Address", "")
        or payload.get("ipv4Address", "")
    )
    if host_ip:
        add(str(host_ip).split("/")[0], "host")

    for vip in vips:
        vip_ip = (vip or {}).get("ipv4", "")
        add(vip_ip, "vip")

    for inst in instances:
        name = inst.get("name", "unknown")
        add(inst.get("bindIp", ""), "bindIp", name)
        add(inst.get("exitIp", ""), "egressIpv4", name)
        add(inst.get("controlInterface", ""), "controlInterface", name)

    collisions: list[str] = []
    for ip, users in entries_by_ip.items():
        if len(users) <= 1:
            continue

        # Allowed: same instance sharing bind/control IP
        if len(users) == 2:
            a, b = users
            same_instance = a.get("instance") and a.get("instance") == b.get("instance")
            allowed_layers = {a.get("layer"), b.get("layer")} == {"bindIp", "controlInterface"}
            if same_instance and allowed_layers:
                continue

        labels = [
            f"{u['instance']}/{u['layer']}" if u.get("instance") else u["layer"]
            for u in users
        ]
        collisions.append(f"IP {ip} usado por {', '.join(labels)}")

    return collisions


# ═══ Internal helpers ═══

def _install_file_from_staging(staging_dir: str, target_path: str, permissions: str = "0644") -> dict[str, Any]:
    staged_path = os.path.join(staging_dir, target_path.lstrip("/"))
    if not os.path.exists(staged_path):
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Arquivo de staging ausente: {staged_path}",
            "duration_ms": 0,
        }

    target_dir = os.path.dirname(target_path)
    mkdir_result = run_command("mkdir", ["-p", target_dir], timeout=10, use_privilege=True)
    if mkdir_result["exit_code"] != 0:
        return mkdir_result

    return run_command(
        "install",
        ["-m", permissions, staged_path, target_path],
        timeout=15,
        use_privilege=True,
    )


def _get_scoped_sysctl_files(files: list[dict[str, Any]], scope: str) -> list[str]:
    return [
        f["path"]
        for f in files
        if "sysctl" in f["path"] and _scope_matches(f["path"], scope)
    ]


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
    # Network post-up MUST run FIRST to materialize listener + egress IPs on loopback
    # before Unbound tries to bind on them (outgoing-interface requires local IP)
    if scope in ("full", "network"):
        cmds.append((
            "Materializar IPs de rede (post-up)",
            ["/etc/network/post-up.d/dns-control"],
            "Desfazer IPs adicionados ao loopback",
        ))
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
    return cmds


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

    # ═══ nftables loaded ═══
    t0 = time.monotonic()
    r = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
    checks.append({
        "name": "nftables rules loaded",
        "target": "nftables",
        "status": "pass" if r["exit_code"] == 0 and r["stdout"].strip() else "fail",
        "detail": r["stdout"].strip()[:200] or "No tables",
        "durationMs": int((time.monotonic() - t0) * 1000),
    })

    # ═══ nftables DNAT verification — check each backend has DNAT rules ═══
    t0 = time.monotonic()
    r = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
    nft_ruleset = r.get("stdout") or ""
    nft_check_duration = int((time.monotonic() - t0) * 1000)

    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "")
        if bind_ip:
            has_dnat = f"dnat to {bind_ip}:53" in nft_ruleset or f"dnat to {bind_ip}" in nft_ruleset
            checks.append({
                "name": f"nftables DNAT → {name} ({bind_ip})",
                "target": f"nftables/{name}",
                "status": "pass" if has_dnat else "fail",
                "detail": f"DNAT rule para {bind_ip}:53 {'encontrada' if has_dnat else 'AUSENTE no ruleset'}",
                "durationMs": nft_check_duration,
            })

    # ═══ nftables sticky sets verification ═══
    for inst in instances:
        name = inst.get("name", "unbound")
        set_name = f"ipv4_users_{name}"
        has_set = set_name in nft_ruleset
        checks.append({
            "name": f"nftables sticky set {set_name}",
            "target": f"nftables/{set_name}",
            "status": "pass" if has_set else "fail",
            "detail": f"Set dinâmico {set_name} {'presente' if has_set else 'AUSENTE'} no ruleset",
            "durationMs": 0,
        })

    # ═══ nftables counters ═══
    t0 = time.monotonic()
    r = run_command("nft", ["list", "counters"], timeout=5, use_privilege=True)
    checks.append({
        "name": "nftables counters",
        "target": "nftables",
        "status": "pass" if r["exit_code"] == 0 else "fail",
        "detail": r["stdout"].strip()[:200] or "No counters",
        "durationMs": int((time.monotonic() - t0) * 1000),
    })

    # ═══ VIP reachability ═══
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

    # ═══ FRR (optional) ═══
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

    # ═══ Egress delivery mode checks ═══
    egress_delivery = str(
        payload.get("egressDeliveryMode")
        or payload.get("_wizardConfig", {}).get("egressDeliveryMode", "")
        or "host-owned"
    )

    if egress_delivery == "border-routed":
        has_masq = "masquerade" in nft_ruleset
        checks.append({
            "name": "Border-routed: no masquerade in ruleset",
            "target": "nftables",
            "status": "fail" if has_masq else "pass",
            "detail": "ERRO: masquerade genérico encontrado — conflita com identidade de egress" if has_masq
                      else "OK — sem masquerade genérico no ruleset",
            "durationMs": 0,
        })

    # ═══ Listener IP materialization ═══
    t0 = time.monotonic()
    r = run_command("ip", ["-4", "addr", "show", "dev", "lo"], timeout=5)
    lo_ips = r.get("stdout") or ""
    lo_check_duration = int((time.monotonic() - t0) * 1000)

    for inst in instances:
        bind_ip = inst.get("bindIp", "")
        name = inst.get("name", "unbound")
        if bind_ip and bind_ip not in ("127.0.0.1", "0.0.0.0"):
            ip_present = bind_ip in lo_ips
            checks.append({
                "name": f"{name} listener IP on host ({bind_ip})",
                "target": bind_ip,
                "status": "pass" if ip_present else "fail",
                "detail": f"Listener IP {bind_ip} {'presente' if ip_present else 'AUSENTE'} no loopback",
                "durationMs": lo_check_duration,
            })

    # ═══ Egress IP materialization (host-owned) ═══
    if egress_delivery == "host-owned":
        for inst in instances:
            egress_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
            name = inst.get("name", "unbound")
            if egress_ip:
                ip_present = egress_ip in lo_ips
                checks.append({
                    "name": f"{name} egress IP on loopback ({egress_ip})",
                    "target": egress_ip,
                    "status": "pass" if ip_present else "fail",
                    "detail": f"Egress IP {egress_ip} {'presente' if ip_present else 'AUSENTE — outgoing-interface falhará'} no loopback",
                    "durationMs": 0,
                })

    # ═══ Egress IP verification — confirm each instance exits via expected IP ═══
    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "")
        expected_egress = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
        if bind_ip and expected_egress and egress_delivery == "host-owned":
            t0 = time.monotonic()
            # Use dig with -b to force source from listener IP, query whoami to check exit IP
            r = run_command("dig", [
                f"@{bind_ip}", "whoami.akamai.net", "+short", "+time=3", "+tries=1"
            ], timeout=8)
            actual_ip = r["stdout"].strip().split("\n")[0] if r["exit_code"] == 0 else ""
            egress_ok = actual_ip == expected_egress
            checks.append({
                "name": f"{name} egress verification ({expected_egress})",
                "target": expected_egress,
                "status": "pass" if egress_ok else ("warn" if actual_ip else "fail"),
                "detail": f"Esperado: {expected_egress} · Observado: {actual_ip or 'sem resposta'}"
                          + ("" if egress_ok else " — IP de saída DIFERENTE do esperado"),
                "durationMs": int((time.monotonic() - t0) * 1000),
            })

    # ═══ Legacy default unbound detection ═══
    t0 = time.monotonic()
    r = run_command("systemctl", ["is-active", "unbound"], timeout=5)
    legacy_active = r["exit_code"] == 0 and "active" in (r.get("stdout") or "")
    if legacy_active:
        checks.append({
            "name": "Legacy unbound.service detection",
            "target": "unbound",
            "status": "fail",
            "detail": "AVISO: unbound.service padrão está ativo e pode interferir. "
                      "Recomendação: systemctl disable --now unbound && systemctl mask unbound",
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
        "unbound": [],
        "nftables": [],
        "network": [],
        "ipCollision": [],
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
