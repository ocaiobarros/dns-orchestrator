"""
DNS Control — Global Deploy Lock
File-lock based mutual exclusion for deploy, rollback, and reconciliation.
Prevents concurrent critical operations that could corrupt host state.
"""

import fcntl
import logging
import os
import time
from contextlib import contextmanager

logger = logging.getLogger("dns-control.deploy-lock")

LOCK_PATH = "/var/lib/dns-control/deploy.lock"


@contextmanager
def deploy_lock(operation: str, timeout: int = 30):
    """
    Acquire exclusive file lock for critical operations.
    Raises RuntimeError if lock cannot be acquired within timeout.

    Usage:
        with deploy_lock("deploy"):
            execute_deploy(...)
    """
    os.makedirs(os.path.dirname(LOCK_PATH), exist_ok=True)
    fd = None
    acquired = False
    deadline = time.monotonic() + timeout

    try:
        fd = open(LOCK_PATH, "w")
        while time.monotonic() < deadline:
            try:
                fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except (IOError, OSError):
                time.sleep(0.5)

        if not acquired:
            raise RuntimeError(
                f"Cannot acquire deploy lock for '{operation}' — "
                f"another critical operation is in progress (timeout={timeout}s)"
            )

        fd.write(f"{os.getpid()}:{operation}:{time.time()}\n")
        fd.flush()
        logger.info(f"Deploy lock acquired for '{operation}' (pid={os.getpid()})")
        yield

    finally:
        if fd:
            if acquired:
                try:
                    fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
                except Exception:
                    pass
                logger.info(f"Deploy lock released for '{operation}'")
            try:
                fd.close()
            except Exception:
                pass


def is_locked() -> dict:
    """Check if the deploy lock is currently held (non-blocking probe)."""
    if not os.path.exists(LOCK_PATH):
        return {"locked": False, "holder": None}
    try:
        fd = open(LOCK_PATH, "r+")
        try:
            fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
            fd.close()
            return {"locked": False, "holder": None}
        except (IOError, OSError):
            content = ""
            try:
                fd.seek(0)
                content = fd.read().strip()
            except Exception:
                pass
            fd.close()
            return {"locked": True, "holder": content}
    except Exception:
        return {"locked": False, "holder": None}
