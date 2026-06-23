"""
DNS Control — Logs Routes

Sources:
- "auth" (or no source / "all"): events from the LogEntry table (login, password changes, etc.)
- "apply", "unbound", "frr", "nftables", "system": real journald logs read via the
  existing privileged journalctl mechanism (sudoers already allows
  `/usr/bin/journalctl --no-pager *`). Units are taken from a strict allowlist; the
  client never injects raw `-u` arguments.

Failure is honest: if journalctl cannot read a unit (no privilege, unit missing),
the response carries `error` so the UI can distinguish "no permission" from
"no entries".
"""

import re
from typing import Iterable

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.log_entry import LogEntry
from app.executors.command_runner import run_command
from app.executors.command_catalog import _discover_runtime_instances

router = APIRouter()


# --- Source → systemd unit allowlist -----------------------------------------

_STATIC_UNIT_MAP: dict[str, list[str]] = {
    "frr":      ["frr"],
    "nftables": ["nftables"],
    # The apply / deploy pipeline runs inside the backend API process.
    "apply":    ["dns-control-api"],
    # System journal: no -u, full system view.
    "system":   [],
}

_JOURNAL_SOURCES = frozenset({"apply", "unbound", "frr", "nftables", "system"})
_APP_SOURCES = frozenset({"auth"})

# Strict unit-name allowlist — never accept arbitrary `-u` from clients.
_UNIT_NAME_RE = re.compile(r"^[a-zA-Z0-9@._-]+$")


def _resolve_units(source: str) -> list[str]:
    if source == "unbound":
        try:
            names = [i["name"] for i in _discover_runtime_instances()]
        except Exception:
            names = []
        if not names:
            # Fallback to the canonical 4-instance naming used by the installer.
            names = ["unbound01", "unbound02", "unbound03", "unbound04"]
        return [n for n in names if _UNIT_NAME_RE.match(n)]
    units = _STATIC_UNIT_MAP.get(source, [])
    return [u for u in units if _UNIT_NAME_RE.match(u)]


# --- Journald reader ---------------------------------------------------------

# `2026-06-23T14:05:01-0300 host unitname[pid]: message`
_SHORT_ISO_LINE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:?\d{2}|Z)?)\s+"
    r"\S+\s+"
    r"(?P<svc>[^:\[\s]+(?:\[\d+\])?):\s?"
    r"(?P<msg>.*)$"
)


def _infer_level(message: str) -> str:
    m = message.lower()
    if any(k in m for k in (" error", "error:", "failed", "failure", "fatal", "critical", "panic")):
        return "error"
    if any(k in m for k in (" warn", "warning", "warn:")):
        return "warn"
    if any(k in m for k in ("debug:", " debug ")):
        return "debug"
    return "info"


def _parse_journal_line(line: str, source: str, idx: int) -> dict:
    m = _SHORT_ISO_LINE.match(line)
    if m:
        ts = m.group("ts")
        svc = m.group("svc")
        msg = m.group("msg")
    else:
        ts = ""
        svc = None
        msg = line
    return {
        "id": f"{source}-{idx}",
        "source": source,
        "level": _infer_level(msg),
        "message": msg,
        "service": svc,
        "timestamp": ts,
        # Backward-compat alias for existing consumers.
        "created_at": ts,
        "context_json": None,
    }


def _read_journal(source: str, limit: int) -> tuple[list[dict], str | None]:
    units = _resolve_units(source)
    args = ["--no-pager", "-n", str(limit), "-o", "short-iso"]
    for u in units:
        args.extend(["-u", u])
    result = run_command("journalctl", args, timeout=15, use_privilege=True)
    if result.get("exit_code") != 0:
        err = (result.get("stderr") or result.get("stdout") or "").strip()
        return [], (err or f"journalctl falhou para {source}")
    stdout = result.get("stdout") or ""
    raw_lines = [ln for ln in stdout.splitlines() if ln and not ln.startswith("-- ")]
    items = [_parse_journal_line(ln, source, i) for i, ln in enumerate(raw_lines)]
    # Newest first (journalctl emits oldest→newest by default).
    items.reverse()
    return items, None


# --- App-event reader (LogEntry table) ---------------------------------------

def _read_app_entries(
    db: Session, search: str | None, source_filter: str | None = None
) -> list[dict]:
    query = db.query(LogEntry)
    if source_filter:
        query = query.filter(LogEntry.source == source_filter)
    if search:
        query = query.filter(LogEntry.message.ilike(f"%{search}%"))
    rows = query.order_by(LogEntry.created_at.desc()).limit(5000).all()
    return [
        {
            "id": e.id,
            "source": e.source,
            "level": e.level,
            "message": e.message,
            "context_json": e.context_json,
            "service": e.source,
            "timestamp": e.created_at.isoformat() if e.created_at else "",
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows
    ]


def _apply_search(items: Iterable[dict], search: str | None) -> list[dict]:
    if not search:
        return list(items)
    needle = search.lower()
    return [i for i in items if needle in (i.get("message") or "").lower()]


# --- Routes ------------------------------------------------------------------

@router.get("")
def list_logs(
    source: str | None = None,
    level: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    error: str | None = None

    if source in _JOURNAL_SOURCES:
        items, error = _read_journal(source, limit=1000)
        items = _apply_search(items, search)
    elif source in _APP_SOURCES:
        items = _read_app_entries(db, search, source_filter=source)
    else:
        # 'all' or unspecified → application event log (LogEntry).
        items = _read_app_entries(db, search)

    if level:
        items = [i for i in items if (i.get("level") or "").lower() == level.lower()]

    total = len(items)
    start = (page - 1) * page_size
    page_items = items[start:start + page_size]

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
        "source": source or "all",
        "error": error,
    }


@router.get("/export")
def export_logs(
    source: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    error: str | None = None
    if source in _JOURNAL_SOURCES:
        items, error = _read_journal(source, limit=10000)
    elif source in _APP_SOURCES:
        items = _read_app_entries(db, None, source_filter=source)
    else:
        items = _read_app_entries(db, None)

    lines = [
        f"{i.get('timestamp','')} [{(i.get('level') or 'info').upper()}] "
        f"[{i.get('service') or i.get('source') or '-'}] {i.get('message','')}"
        for i in items
    ]
    return {"content": "\n".join(lines), "count": len(lines), "error": error}
