"""
DNS Control — Audit & Application Logging
Writes structured log entries to the database.
"""

import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.log_entry import LogEntry


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


def log_command_event(db: Session, command_id: str, user: str, exit_code: int, duration_ms: int):
    log_event(db, "command", "info" if exit_code == 0 else "error", f"Command executed: {command_id}", {
        "command_id": command_id,
        "user": user,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
    })
