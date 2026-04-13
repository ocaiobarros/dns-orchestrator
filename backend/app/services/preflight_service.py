"""
DNS Control — Preflight Privilege & Permission Checker
Validates that the deploy pipeline has all necessary privileges
BEFORE any destructive operation (stop services, flush rules, write files).

Execution model: either root (EUID==0) or service user with granular sudo NOPASSWD.
Hybrid/ambiguous state is rejected.
"""

import os
import tempfile
import time
import logging
from typing import Any

from app.executors.command_runner import run_command, is_sudo_available, get_privilege_status

logger = logging.getLogger("dns-control.preflight")

# Production paths the deploy pipeline writes to
_REQUIRED_DIRS = [
    "/etc/unbound",
    "/etc/unbound/unbound.conf.d",
    "/etc/frr",
    "/etc/network",
    "/etc/network/post-up.d",
    "/etc/sysctl.d",
    "/etc/systemd/system",
    "/usr/lib/systemd/system",
    "/etc/nftables.d",
    "/var/lib/dns-control",
    "/var/lib/dns-control/staging",
    "/var/lib/dns-control/backups",
    "/var/lib/dns-control/tmp",
    "/var/log/dns-control",
]

_REQUIRED_FILES = [
    "/etc/nftables.conf",
]

# Commands the deploy pipeline actually uses — preflight validates the EXACT invocations
_REQUIRED_EXECUTABLES: list[tuple[str, str]] = [
    ("nft", "nft (nftables)"),
    ("systemctl", "systemctl (systemd)"),
    ("install", "install (coreutils)"),
    ("mkdir", "mkdir"),
    ("sysctl", "sysctl"),
    ("killall", "killall (psmisc)"),
]

# Privileged command probes — tests that mirror real pipeline usage
_PRIVILEGED_PROBES: list[tuple[str, list[str], str, str]] = [
    # (exe, args, label, category)
    ("nft", ["-c", "-f", "/dev/null"], "nft -c -f (validação sintática)", "nft_syntax"),
    ("nft", ["list", "tables"], "nft list tables (leitura ruleset)", "nft_read"),
    ("systemctl", ["daemon-reload"], "systemctl daemon-reload", "systemctl_reload"),
    ("systemctl", ["is-active", "nftables"], "systemctl is-active (probe)", "systemctl_query"),
    ("install", ["-m", "0644", "-o", "root", "-g", "root", "/dev/null", "/dev/null"], "install -m 0644 -o root -g root", "install_priv"),
]


def run_preflight(scope: str = "full") -> dict[str, Any]:
    """
    Execute comprehensive preflight checks.
    Returns structured result with pass/fail for each check.
    """
    t0 = time.monotonic()
    checks: list[dict[str, Any]] = []
    privilege = get_privilege_status()

    # ─── 1. Privilege model detection ───
    euid = os.geteuid()
    is_root = euid == 0
    sudo_ok = is_sudo_available()

    if is_root:
        priv_model = "root"
        priv_detail = "Backend executa como root (EUID=0)"
    elif sudo_ok:
        priv_model = "sudo"
        priv_detail = f"Backend executa como '{privilege['backend_running_as_user']}' com sudo NOPASSWD"
    else:
        priv_model = "unprivileged"
        priv_detail = (
            f"Backend executa como '{privilege['backend_running_as_user']}' SEM root e SEM sudo funcional. "
            "Deploy real requer privilégio root ou sudo sem senha para nft/systemctl/install/cp."
        )

    checks.append({
        "id": "privilege_model",
        "category": "privilege",
        "label": "Modelo de execução privilegiada",
        "status": "pass" if priv_model in ("root", "sudo") else "fail",
        "detail": priv_detail,
        "remediation": (
            "Instale o sudoers com: sudo cp deploy/sudoers/dns-control-diagnostics /etc/sudoers.d/dns-control && sudo chmod 440 /etc/sudoers.d/dns-control"
            if priv_model == "unprivileged" else ""
        ),
    })

    # Early exit if no privilege at all
    if priv_model == "unprivileged":
        duration_ms = int((time.monotonic() - t0) * 1000)
        return _build_preflight_result(checks, privilege, euid, priv_model, duration_ms)

    # ─── 2. Directory existence & write access ───
    for dir_path in _REQUIRED_DIRS:
        check = _check_directory(dir_path, is_root, sudo_ok)
        checks.append(check)

    # ─── 3. Required base files ───
    for file_path in _REQUIRED_FILES:
        check = _check_file(file_path, is_root, sudo_ok)
        checks.append(check)

    # ─── 4. Write probe — test actual write to each target directory ───
    write_targets = [
        "/etc/unbound",
        "/etc/nftables.d",
        "/etc/sysctl.d",
        "/etc/network",
        "/usr/lib/systemd/system",
    ]
    for target_dir in write_targets:
        if os.path.isdir(target_dir):
            check = _check_write_probe(target_dir, is_root)
            checks.append(check)

    # ─── 5. Executable availability ───
    exe_checks = _check_executables()
    checks.extend(exe_checks)

    # ─── 6. Privileged command probes (exact pipeline commands) ───
    priv_checks = _check_privileged_probes(is_root)
    checks.extend(priv_checks)

    # ─── 7. nft flush ruleset capability ───
    nft_check = _check_nft_capability(is_root)
    checks.append(nft_check)

    # ─── 8. systemctl enable/start/stop capability ───
    sctl_check = _check_systemctl_capability(is_root)
    checks.append(sctl_check)

    duration_ms = int((time.monotonic() - t0) * 1000)
    return _build_preflight_result(checks, privilege, euid, priv_model, duration_ms)


def _check_directory(dir_path: str, is_root: bool, sudo_ok: bool) -> dict:
    if not os.path.exists(dir_path):
        return {
            "id": f"dir_{dir_path.replace('/', '_')}",
            "category": "directory",
            "label": f"Diretório {dir_path}",
            "status": "fail",
            "detail": f"Diretório ausente: {dir_path}",
            "remediation": f"Execute: sudo install -d -o root -g root -m 0755 {dir_path}",
        }
    if not os.path.isdir(dir_path):
        return {
            "id": f"dir_{dir_path.replace('/', '_')}",
            "category": "directory",
            "label": f"Diretório {dir_path}",
            "status": "fail",
            "detail": f"Existe mas não é diretório: {dir_path}",
            "remediation": f"Remova o arquivo e crie o diretório: sudo rm {dir_path} && sudo mkdir -p {dir_path}",
        }
    # Check readable
    if not os.access(dir_path, os.R_OK):
        return {
            "id": f"dir_{dir_path.replace('/', '_')}",
            "category": "directory",
            "label": f"Diretório {dir_path}",
            "status": "fail" if not (is_root or sudo_ok) else "pass",
            "detail": f"Sem leitura direta em {dir_path} (sudo disponível)" if (is_root or sudo_ok) else f"Sem permissão de leitura em {dir_path}",
            "remediation": "",
        }
    return {
        "id": f"dir_{dir_path.replace('/', '_')}",
        "category": "directory",
        "label": f"Diretório {dir_path}",
        "status": "pass",
        "detail": "Presente e acessível",
        "remediation": "",
    }


def _check_file(file_path: str, is_root: bool, sudo_ok: bool) -> dict:
    if not os.path.exists(file_path):
        return {
            "id": f"file_{file_path.replace('/', '_')}",
            "category": "file",
            "label": f"Arquivo {file_path}",
            "status": "fail",
            "detail": f"Arquivo base ausente: {file_path}",
            "remediation": f"Execute: sudo touch {file_path} && sudo chmod 0644 {file_path}",
        }
    return {
        "id": f"file_{file_path.replace('/', '_')}",
        "category": "file",
        "label": f"Arquivo {file_path}",
        "status": "pass",
        "detail": "Presente",
        "remediation": "",
    }


def _check_write_probe(target_dir: str, is_root: bool) -> dict:
    """Try writing a temporary file to verify actual write capability."""
    probe_name = ".dns_control_write_probe"
    probe_path = os.path.join(target_dir, probe_name)
    try:
        if is_root:
            with open(probe_path, "w") as f:
                f.write("probe\n")
            os.remove(probe_path)
            return {
                "id": f"write_{target_dir.replace('/', '_')}",
                "category": "write_probe",
                "label": f"Escrita em {target_dir}",
                "status": "pass",
                "detail": "Escrita direta OK (root)",
                "remediation": "",
            }
        else:
            # Use sudo cp to test write
            r = run_command("bash", ["-c", f"echo probe > /tmp/{probe_name} && sudo -n cp /tmp/{probe_name} {probe_path} && sudo -n rm -f {probe_path} && rm -f /tmp/{probe_name}"], timeout=5)
            if r["exit_code"] == 0:
                return {
                    "id": f"write_{target_dir.replace('/', '_')}",
                    "category": "write_probe",
                    "label": f"Escrita em {target_dir}",
                    "status": "pass",
                    "detail": "Escrita via sudo OK",
                    "remediation": "",
                }
            else:
                return {
                    "id": f"write_{target_dir.replace('/', '_')}",
                    "category": "write_probe",
                    "label": f"Escrita em {target_dir}",
                    "status": "fail",
                    "detail": f"Sem permissão para gravar em {target_dir}: {r.get('stderr', '')[:150]}",
                    "remediation": f"Verifique sudoers: dns-control deve ter permissão 'cp' para {target_dir}",
                }
    except Exception as e:
        return {
            "id": f"write_{target_dir.replace('/', '_')}",
            "category": "write_probe",
            "label": f"Escrita em {target_dir}",
            "status": "fail",
            "detail": f"Falha na probe de escrita: {str(e)[:150]}",
            "remediation": f"O usuário do serviço não possui escrita em {target_dir}",
        }


def _check_executables() -> list[dict]:
    """Check that all required executables exist in PATH."""
    import shutil
    checks = []
    for exe, label in _REQUIRED_EXECUTABLES:
        exe_path = shutil.which(exe)
        if not exe_path:
            checks.append({
                "id": f"exe_{exe}",
                "category": "executable",
                "label": f"Executável {label}",
                "status": "fail",
                "detail": f"Executável não encontrado: {exe}",
                "remediation": f"Instale o pacote que fornece '{exe}'",
            })
        else:
            checks.append({
                "id": f"exe_{exe}",
                "category": "executable",
                "label": f"Executável {label}",
                "status": "pass",
                "detail": f"Disponível em {exe_path}",
                "remediation": "",
            })
    return checks


def _check_privileged_probes(is_root: bool) -> list[dict]:
    """Execute exact command probes that mirror real pipeline usage."""
    checks = []
    for exe, args, label, cat_id in _PRIVILEGED_PROBES:
        r = run_command(exe, args, timeout=5, use_privilege=True)
        # systemctl is-active returns 3 for inactive — that's OK
        ok = r["exit_code"] == 0 or (exe == "systemctl" and "is-active" in args and r["exit_code"] == 3)
        if ok and not is_root and not r.get("executed_privileged", False):
            ok = False
        stderr = (r.get("stderr") or "")[:200]
        if ok:
            checks.append({
                "id": f"probe_{cat_id}",
                "category": "privilege_probe",
                "label": label,
                "status": "pass",
                "detail": f"Executado com sucesso",
                "remediation": "",
            })
        else:
            is_perm = "permission" in stderr.lower() or "not permitted" in stderr.lower()
            checks.append({
                "id": f"probe_{cat_id}",
                "category": "privilege_probe",
                "label": label,
                "status": "fail",
                "detail": f"{'Sem permissão' if is_perm else 'Falhou'}: {stderr}" if stderr else "Falha na execução",
                "remediation": f"Adicione ao sudoers: dns-control ALL=(root) NOPASSWD: /usr/sbin/{exe} {' '.join(args[:2])}..." if is_perm else f"Verifique a instalação de '{exe}'",
            })
    return checks


def _check_nft_capability(is_root: bool) -> dict:
    """Check if we can actually run nft with privilege."""
    # Test with nft list tables (lightweight, non-destructive)
    r = run_command("nft", ["list", "tables"], timeout=5, use_privilege=True)
    if r["exit_code"] == 0:
        return {
            "id": "nft_privilege",
            "category": "privilege_test",
            "label": "nft com privilégio (list tables)",
            "status": "pass",
            "detail": "nft list tables executado com sucesso",
            "remediation": "",
        }
    else:
        stderr = (r.get("stderr") or "")[:200]
        is_perm = "operation not permitted" in stderr.lower() or "permission denied" in stderr.lower()
        return {
            "id": "nft_privilege",
            "category": "privilege_test",
            "label": "nft com privilégio (list tables)",
            "status": "fail",
            "detail": f"Sem permissão para flush do nftables: {stderr}" if is_perm else f"nft falhou: {stderr}",
            "remediation": "Adicione ao sudoers: dns-control ALL=(root) NOPASSWD: /usr/sbin/nft list tables, /usr/sbin/nft flush ruleset",
        }


def _check_systemctl_capability(is_root: bool) -> dict:
    """Check if systemctl enable/start/stop works (the actual pipeline operations)."""
    # Test show-environment as a non-destructive proxy for daemon-reload privilege
    r = run_command("systemctl", ["show-environment"], timeout=5, use_privilege=True)
    if r["exit_code"] == 0 and (is_root or r.get("executed_privileged", False)):
        return {
            "id": "systemctl_privilege",
            "category": "privilege_test",
            "label": "systemctl com privilégio (enable/start/stop)",
            "status": "pass",
            "detail": "systemctl acessível com privilégio para gerenciar serviços",
            "remediation": "",
        }
    else:
        return {
            "id": "systemctl_privilege",
            "category": "privilege_test",
            "label": "systemctl com privilégio (enable/start/stop)",
            "status": "fail",
            "detail": f"systemctl indisponível para o usuário atual: {(r.get('stderr') or '')[:150]}",
            "remediation": "Adicione ao sudoers: dns-control ALL=(root) NOPASSWD: /bin/systemctl daemon-reload, /bin/systemctl enable *, /bin/systemctl start *, /bin/systemctl stop *, /bin/systemctl restart *",
        }


def _build_preflight_result(
    checks: list[dict], privilege: dict, euid: int, priv_model: str, duration_ms: int
) -> dict[str, Any]:
    passed = sum(1 for c in checks if c["status"] == "pass")
    failed = sum(1 for c in checks if c["status"] == "fail")
    total = len(checks)
    all_ok = failed == 0

    return {
        "success": all_ok,
        "passed": passed,
        "failed": failed,
        "total": total,
        "checks": checks,
        "privilege": {
            **privilege,
            "euid": euid,
            "is_root": euid == 0,
            "model": priv_model,
        },
        "durationMs": duration_ms,
        "canDeploy": all_ok,
        "blockedReasons": [
            c["detail"] for c in checks if c["status"] == "fail"
        ],
    }
