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
    "journalctl", "uptime", "free", "df", "cat",
    "ping", "traceroute", "ifreload", "ifquery",
    "dpkg", "apt",
    "chmod", "sysctl", "echo",
    "install", "mkdir", "bash",
    "/etc/network/post-up.d/dns-control",
})

# Strict allowlist: only these exact (executable, args_prefix) combos may use sudo
_SUDO_ALLOWED_COMMANDS: list[tuple[str, list[str]]] = [
    # Diagnostics
    ("unbound-control", ["-s"]),   # per-instance targeting via -s <ip>@<port>
    ("unbound-control", ["stats_noreset"]),
    ("unbound-control", ["status"]),
    ("unbound-control", ["dump_cache"]),
    ("nft", ["list", "tables"]),
    ("nft", ["list", "ruleset"]),
    ("nft", ["list", "counters"]),
    ("nft", ["-c", "-f"]),  # staging syntax validation
    ("nft", ["-f"]),          # apply ruleset
    ("vtysh", ["-c"]),  # read-only vtysh commands
    ("journalctl", ["--no-pager"]),
    # Deploy operations
    ("install", ["-m"]),      # file install with permissions
    ("mkdir", ["-p"]),        # create directories
    ("systemctl", ["daemon-reload"]),
    ("systemctl", ["restart"]),
    ("systemctl", ["status"]),
    ("sysctl", ["--load"]),   # targeted sysctl load
    ("ifreload", ["-a"]),     # network reload
    ("/etc/network/post-up.d/dns-control", []),  # materialize listener/egress IPs
]

# Cache for sudo availability check
_sudo_available: bool | None = None


def is_sudo_available() -> bool:
    """Check if sudo is available and the current user can use it without password for diagnostics."""
    global _sudo_available
    if _sudo_available is not None:
        return _sudo_available

    if not shutil.which("sudo"):
        _sudo_available = False
        return False

    try:
        # Use sudo -n -l to check if the user has ANY sudo privileges.
        # We cannot use "sudo -n true" because the sudoers policy only allows specific commands.
        result = subprocess.run(
            ["sudo", "-n", "-l"],
            capture_output=True, text=True, timeout=5, shell=False,
        )
        # sudo -l returns 0 if the user has any sudo rules configured
        _sudo_available = result.returncode == 0
    except Exception:
        _sudo_available = False

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

    # Determine if we should use sudo
    should_sudo = (
        use_privilege
        and is_sudo_available()
        and _is_sudo_allowed(executable, sanitized_args)
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
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,  # NEVER use shell=True
        )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        return {
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "duration_ms": elapsed_ms,
            "executed_privileged": should_sudo,
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
        }
    except FileNotFoundError:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Executável não encontrado: {executable}",
            "duration_ms": 0,
            "executed_privileged": False,
        }
    except Exception as e:
        logger.exception(f"Unexpected error executing command: {e}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "duration_ms": 0,
            "executed_privileged": False,
        }


def _sanitize_arg(arg: str) -> str:
    """Remove shell metacharacters from arguments."""
    dangerous_chars = set(";|&$`\\\"'(){}<>!")
    return "".join(c for c in arg if c not in dangerous_chars)
