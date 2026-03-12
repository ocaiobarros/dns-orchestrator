"""
DNS Control — Audit & Application Logging
Writes structured log entries to the database.
Implements semantic severity for NOC-grade operational logging.
"""

import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.log_entry import LogEntry

# ── Status → Log Severity Mapping ──
# Maps diagnostic classification status to appropriate log level.
# This prevents expected privilege limitations from appearing as ERROR.
_STATUS_SEVERITY_MAP = {
    "ok": "info",
    "inactive": "info",
    "permission_limited": "warning",
    "permission_error": "warning",       # legacy alias
    "service_not_running": "warning",
    "misconfigured": "warning",
    "dependency_error": "warning",
    "degraded": "warning",
    "timeout_error": "error",
    "runtime_error": "error",
    "error": "error",
}


def log_event(
    db: Session,
    source: str,
    level: str,
    message: str,
    context: dict | None = None,
):
    entry = LogEntry(
        source=source,
        level=level,
        message=message,
        context_json=json.dumps(context) if context else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(entry)
    db.commit()


def log_auth_event(db: Session, message: str, username: str, ip: str = "", success: bool = True):
    log_event(db, "auth", "info" if success else "warning", message, {
        "username": username,
        "ip": ip,
        "success": success,
    })


def log_command_event(
    db: Session,
    command_id: str,
    user: str,
    exit_code: int,
    duration_ms: int,
    diagnostic_status: str | None = None,
    requires_privilege: bool = False,
    executed_privileged: bool = False,
):
    """
    Log a command execution with semantic severity.

    If diagnostic_status is provided, severity is derived from the status taxonomy
    instead of raw exit_code. This prevents expected privilege limitations from
    being logged as ERROR.

    Args:
        diagnostic_status: Classified status from _classify_result (ok, permission_limited, etc.)
        requires_privilege: Whether the command requires elevated privileges
        executed_privileged: Whether the command actually ran with sudo
    """
    # Determine severity from diagnostic status if available
    if diagnostic_status:
        level = _STATUS_SEVERITY_MAP.get(diagnostic_status, "error" if exit_code != 0 else "info")
    else:
        level = "info" if exit_code == 0 else "error"

    # Build structured message
    if diagnostic_status in ("permission_limited", "permission_error") and requires_privilege and not executed_privileged:
        message = f"Expected privilege limitation: {command_id}"
    elif exit_code == 0:
        message = f"Command executed: {command_id}"
    else:
        message = f"Command failed: {command_id}"

    log_event(db, "command", level, message, {
        "command_id": command_id,
        "user": user,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "diagnostic_status": diagnostic_status,
        "requires_privilege": requires_privilege,
        "executed_privileged": executed_privileged,
    })
