"""
DNS Control — Secure Command Runner
Executes whitelisted system commands with subprocess.
Never accepts arbitrary shell input from the frontend.
"""

import subprocess
import time
import logging

logger = logging.getLogger("dns-control.executor")

# Whitelist of allowed executables
ALLOWED_EXECUTABLES = frozenset({
    "systemctl", "ss", "ip", "nft", "vtysh", "dig",
    "unbound-control", "unbound-checkconf",
    "journalctl", "uptime", "free", "df", "cat",
    "ping", "traceroute", "ifreload", "ifquery",
    "dpkg", "apt",
})


def run_command(
    executable: str,
    args: list[str],
    timeout: int = 30,
    stdin_data: str | None = None,
) -> dict:
    """
    Execute a system command safely.
    Only whitelisted executables are allowed.
    Shell=False always — no shell injection possible.
    """
    if executable not in ALLOWED_EXECUTABLES:
        logger.warning(f"Blocked execution of non-whitelisted command: {executable}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando não permitido: {executable}",
            "duration_ms": 0,
        }

    # Sanitize args — no shell metacharacters
    sanitized_args = [_sanitize_arg(a) for a in args]
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
        }
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        logger.error(f"Command timed out after {timeout}s: {' '.join(cmd)}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Comando expirou após {timeout} segundos",
            "duration_ms": elapsed_ms,
        }
    except FileNotFoundError:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": f"Executável não encontrado: {executable}",
            "duration_ms": 0,
        }
    except Exception as e:
        logger.exception(f"Unexpected error executing command: {e}")
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "duration_ms": 0,
        }


def _sanitize_arg(arg: str) -> str:
    """Remove shell metacharacters from arguments."""
    dangerous_chars = set(";|&$`\\\"'(){}<>!")
    return "".join(c for c in arg if c not in dangerous_chars)
