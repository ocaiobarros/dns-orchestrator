"""
DNS Control — Secure Command Runner
Executes whitelisted system commands with subprocess.
Never accepts arbitrary shell input from the frontend.
Supports controlled privilege escalation via sudo for allowlisted commands.
"""

import subprocess
import time
import os
import shutil
import logging

logger = logging.getLogger("dns-control.executor")

# Whitelist of allowed executables
# Whitelist of allowed executables
ALLOWED_EXECUTABLES = frozenset({
    "systemctl", "ss", "ip", "nft", "vtysh", "dig",
    "unbound-control", "unbound-checkconf",
    "journalctl", "uptime", "free", "df", "cat", "stat",
    "ping", "traceroute", "ifreload", "ifquery",
    "dpkg", "apt",
    "chmod", "sysctl", "echo",
    "install", "mkdir", "bash", "killall", "chown",
    "/etc/network/post-up.d/dns-control",
})

# Strict allowlist: only these exact (executable, args_prefix) combos may use sudo
_SUDO_ALLOWED_COMMANDS: list[tuple[str, list[str]]] = [
    # Diagnostics
    ("unbound-control", ["-s"]),
    ("unbound-control", ["-c"]),
    ("unbound-control", ["stats_noreset"]),
    ("unbound-control", ["status"]),
    ("unbound-control", ["dump_cache"]),
    ("nft", ["list", "tables"]),
    ("nft", ["list", "ruleset"]),
    ("nft", ["list", "counters"]),
    ("nft", ["-j", "list", "ruleset"]),
    ("nft", ["-j", "list", "counters"]),
    ("nft", ["-j", "list", "tables"]),
    ("nft", ["-c", "-f"]),
    ("nft", ["-f"]),
    ("nft", ["flush", "ruleset"]),
    ("vtysh", ["-c"]),
    ("journalctl", ["--no-pager"]),
    # Deploy operations
    ("chmod", []),
    ("chown", []),
    ("install", ["-m"]),
    ("mkdir", ["-p"]),
    ("systemctl", ["daemon-reload"]),
    ("systemctl", ["restart"]),
    ("systemctl", ["start"]),
    ("systemctl", ["stop"]),
    ("systemctl", ["enable"]),
    ("systemctl", ["disable"]),
    ("systemctl", ["mask"]),
    ("systemctl", ["unmask"]),
    ("systemctl", ["status"]),
    ("systemctl", ["is-active"]),
    ("systemctl", ["is-enabled"]),
    ("systemctl", ["list-units"]),
    ("systemctl", ["show-environment"]),
    ("sysctl", ["--load"]),
    ("sysctl", ["--system"]),
    ("ifreload", ["-a"]),
    ("ip", ["addr"]),
    ("ip", ["-4", "addr"]),
    ("ip", ["-6", "addr"]),
    ("ip", ["link"]),
    ("killall", ["-q"]),
    ("bash", ["-n"]),
    ("bash", ["-c"]),
    ("/etc/network/post-up.d/dns-control", []),
]

# Cache for sudo availability check (with TTL to retry on failure)
_sudo_available: bool | None = None
_sudo_checked_at: float = 0.0
_SUDO_CACHE_TTL_OK = 3600      # Cache positive result for 1 hour
_SUDO_CACHE_TTL_FAIL = 120     # Retry negative result after 2 minutes


def is_sudo_available() -> bool:
    """Check if sudo is available and the current user can use it without password for diagnostics."""
    global _sudo_available, _sudo_checked_at

    now = time.monotonic()
    if _sudo_available is not None:
        ttl = _SUDO_CACHE_TTL_OK if _sudo_available else _SUDO_CACHE_TTL_FAIL
        if (now - _sudo_checked_at) < ttl:
            return _sudo_available

    if not shutil.which("sudo"):
        _sudo_available = False
        _sudo_checked_at = now
        return False

    try:
        result = subprocess.run(
            ["sudo", "-n", "-l"],
            capture_output=True, text=True, timeout=5, shell=False,
        )
        _sudo_available = result.returncode == 0
    except Exception:
        _sudo_available = False

    _sudo_checked_at = now
    logger.info(f"Sudo availability check: {'available' if _sudo_available else 'not available'}")
    return _sudo_available


def _is_sudo_allowed(executable: str, args: list[str]) -> bool:
    """Check if this specific command+args combo is in the sudo allowlist."""
    for allowed_exe, allowed_prefix in _SUDO_ALLOWED_COMMANDS:
        if executable == allowed_exe:
            # Check that args start with the allowed prefix
            if len(args) >= len(allowed_prefix):
                if args[:len(allowed_prefix)] == allowed_prefix:
                    return True
    return False


def _must_not_fallback_without_privilege(executable: str, args: list[str]) -> bool:
    """Return True for commands that must fail closed if sudo is unavailable."""
    if executable in {
        "install", "mkdir", "chmod", "chown", "systemctl", "nft", "sysctl", "killall", "ip",
        "/etc/network/post-up.d/dns-control",
    }:
        return True
    return executable == "bash" and bool(args) and args[0] == "-c"


def get_privilege_status() -> dict:
    """Return current privilege environment info."""
    try:
        user = os.getenv("USER", "") or os.getenv("LOGNAME", "")
        if not user:
            import pwd
            user = pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        user = "unknown"

    try:
        import grp
        groups = [g.gr_name for g in grp.getgrall() if user in g.gr_mem]
        # Also add primary group
        try:
            import pwd
            primary_gid = pwd.getpwnam(user).pw_gid
            groups.insert(0, grp.getgrgid(primary_gid).gr_name)
        except Exception:
            pass
    except Exception:
        groups = []

    sudo_ok = is_sudo_available()

    return {
        "backend_running_as_user": user,
        "backend_groups": groups,
        "privilege_wrapper_available": sudo_ok,
        "privileged_commands_enabled": sudo_ok,
    }


def run_command(
    executable: str,
    args: list[str],
    timeout: int = 30,
    stdin_data: str | None = None,
    use_privilege: bool = False,
) -> dict:
    """
    Execute a system command safely.
    Only whitelisted executables are allowed.
    Shell=False always — no shell injection possible.
    If use_privilege=True and command is in sudo allowlist, execute via sudo -n.
    """
    if executable not in ALLOWED_EXECUTABLES:
        logger.debug(f"Skipped non-whitelisted command: {executable}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando não permitido: {executable}",
            "duration_ms": 0,
        }

    # Sanitize args — no shell metacharacters
    sanitized_args = [_sanitize_arg(a) for a in args]

    privilege_required = use_privilege and _must_not_fallback_without_privilege(executable, sanitized_args)
    sudo_allowed = _is_sudo_allowed(executable, sanitized_args) if use_privilege else False
    sudo_available = is_sudo_available() if use_privilege else False

    if privilege_required and not sudo_allowed:
        logger.error(f"Privilege-required command is not allowed via sudo: {executable} {' '.join(sanitized_args)}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando requer privilégio, mas não está autorizado no sudoers: {executable}",
            "duration_ms": 0,
            "executed_privileged": False,
            "command": f"{executable} {' '.join(sanitized_args)}".strip(),
        }

    if privilege_required and not sudo_available:
        logger.error(f"Privilege-required command blocked because sudo is unavailable: {executable} {' '.join(sanitized_args)}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando requer sudo efetivo e não pode executar sem privilégio: {executable}",
            "duration_ms": 0,
            "executed_privileged": False,
            "command": f"{executable} {' '.join(sanitized_args)}".strip(),
        }

    # Determine if we should use sudo
    should_sudo = (
        use_privilege
        and sudo_available
        and sudo_allowed
    )

    if should_sudo:
        cmd = ["sudo", "-n", executable] + sanitized_args
        logger.info(f"Executing (privileged): {' '.join(cmd)}")
    else:
        cmd = [executable] + sanitized_args
        logger.info(f"Executing: {' '.join(cmd)}")

    start = time.monotonic()

    try:
        result = subprocess.run(
            cmd,
            input=stdin_data,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,  # NEVER use shell=True
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        # Detect sudo password failure and auto-retry without sudo for non-critical commands.
        # Do NOT poison the global sudo cache here: command-specific sudoers mismatches
        # must not disable sudo for subsequent unrelated commands in the same deploy.
        if should_sudo and result.returncode != 0 and _is_sudo_password_failure(result.stderr):
            stderr_lower = result.stderr.lower()
            is_command_specific = "not allowed to execute" in stderr_lower or "not allowed to run" in stderr_lower
            logger.warning(
                "Sudo failed for %s (%s): %s",
                executable,
                "command-specific" if is_command_specific else "password-required",
                " ".join(sanitized_args[:4]),
            )
            if _must_not_fallback_without_privilege(executable, sanitized_args):
                return {
                    "exit_code": result.returncode,
                    "stdout": result.stdout,
                    "stderr": result.stderr,
                    "duration_ms": elapsed_ms,
                    "executed_privileged": False,
                    "sudo_fallback": False,
                }
            cmd_nosudo = [executable] + sanitized_args
            start2 = time.monotonic()
            try:
                result2 = subprocess.run(
                    cmd_nosudo, input=stdin_data, capture_output=True, text=True,
                    timeout=timeout, shell=False,
                )
                elapsed_ms2 = int((time.monotonic() - start2) * 1000)
                return {
                    "exit_code": result2.returncode,
                    "stdout": result2.stdout,
                    "stderr": result2.stderr,
                    "duration_ms": elapsed_ms2,
                    "executed_privileged": False,
                    "sudo_fallback": True,
                }
            except Exception:
                pass  # Fall through to return original sudo failure

        return {
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "duration_ms": elapsed_ms,
            "executed_privileged": should_sudo,
            "command": " ".join(cmd),
        }
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error(f"Command timed out after {timeout}s: {' '.join(cmd)}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando expirou após {timeout} segundos",
            "duration_ms": elapsed_ms,
            "executed_privileged": should_sudo,
            "command": " ".join(cmd),
        }
    except FileNotFoundError:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Executável não encontrado: {executable}",
            "duration_ms": 0,
            "executed_privileged": False,
            "command": f"{executable} {' '.join(sanitized_args)}".strip(),
        }
    except Exception as e:
        logger.exception(f"Unexpected error executing command: {e}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "duration_ms": 0,
            "executed_privileged": False,
            "command": f"{executable} {' '.join(sanitized_args)}".strip(),
        }


def _is_sudo_password_failure(stderr: str) -> bool:
    """Detect if sudo failed because it requires a password."""
    markers = ("a password is required", "no tty present", "sorry, a password is required",
               "sudo: a password is required", "no askpass program specified")
    stderr_lower = stderr.lower()
    return any(m in stderr_lower for m in markers)


def _sanitize_arg(arg: str) -> str:
    """Remove shell metacharacters from arguments."""
    dangerous_chars = set(";|&$`\\\"'(){}<>!")
    return "".join(c for c in arg if c not in dangerous_chars)
