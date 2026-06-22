"""
DNS Control — AnaBlock status worker.

Tails /var/lib/dns-control/anablock-events.jsonl (one line per sync run,
written by /etc/unbound/gen-anablock.sh) and turns each new line into an
OperationalEvent (anablock.sync.applied / .unchanged / .failed).

Also reads /var/lib/dns-control/anablock-status.json and emits a
debounced anablock.sync.stale event when the last successful run is older
than 2× the configured cadence (mínimo 12h). The bash script never speaks
to the DB — backend is the only writer of OperationalEvent.

Idempotente:
  - tail-position is persisted at /var/lib/dns-control/anablock-events.offset
  - stale dedup via in-memory marker keyed by last_update_timestamp
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from app.core.database import SessionLocal
from app.models.operational import OperationalEvent

logger = logging.getLogger("dns-control.anablock_status_worker")

EVENTS_LOG = Path("/var/lib/dns-control/anablock-events.jsonl")
STATUS_FILE = Path("/var/lib/dns-control/anablock-status.json")
OFFSET_FILE = Path("/var/lib/dns-control/anablock-events.offset")
DEFAULT_SYNC_HOURS = 6
STALE_FACTOR = 2

# In-memory dedup for stale notifications — only one event per ts window.
_last_stale_marker: int | None = None


def _read_offset() -> int:
    try:
        return int(OFFSET_FILE.read_text().strip() or "0")
    except (OSError, ValueError):
        return 0


def _write_offset(off: int) -> None:
    try:
        OFFSET_FILE.parent.mkdir(parents=True, exist_ok=True)
        OFFSET_FILE.write_text(str(off))
    except OSError as e:
        logger.debug("offset write failed: %s", e)


_SEVERITY_BY_TYPE = {
    "anablock.sync.applied": "info",
    "anablock.sync.unchanged": "info",
    "anablock.sync.failed": "warning",
    "anablock.sync.stale": "warning",
}


def _emit(db, event_type: str, message: str, details: dict) -> None:
    sev = _SEVERITY_BY_TYPE.get(event_type, "info")
    db.add(OperationalEvent(
        event_type=event_type,
        severity=sev,
        instance_id=None,
        message=message,
        details_json=json.dumps(details, sort_keys=True),
    ))


def _drain_events(db, log_path: Path = EVENTS_LOG, offset_path: Path = OFFSET_FILE) -> int:
    """Read new lines from EVENTS_LOG starting at the persisted offset.
    Returns the number of events emitted.
    """
    if not log_path.exists():
        return 0
    emitted = 0
    try:
        size = log_path.stat().st_size
    except OSError:
        return 0
    off = _read_offset_for(offset_path)
    if off > size:
        # File rotated/truncated — restart from beginning.
        off = 0
    try:
        with open(log_path, "rb") as fh:
            fh.seek(off)
            chunk = fh.read()
            new_off = off + len(chunk)
    except OSError as e:
        logger.debug("events log read failed: %s", e)
        return 0
    for raw in chunk.splitlines():
        line = raw.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        et = str(ev.get("event_type") or "")
        if not et.startswith("anablock.sync."):
            continue
        details = {
            "reason": ev.get("reason"),
            "domains": ev.get("domains"),
            "md5": ev.get("md5") or None,
            "version": str(ev.get("version") or "") or None,
            "ts": ev.get("ts"),
        }
        msg = f"AnaBlock: {ev.get('reason') or et.split('.')[-1]}"
        _emit(db, et, msg, details)
        emitted += 1
    _write_offset_for(offset_path, new_off)
    return emitted


def _read_offset_for(p: Path) -> int:
    try:
        return int(p.read_text().strip() or "0")
    except (OSError, ValueError):
        return 0


def _write_offset_for(p: Path, off: int) -> None:
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(off))
    except OSError as e:
        logger.debug("offset write failed: %s", e)


def _check_stale(db, status_path: Path = STATUS_FILE) -> bool:
    """Emit anablock.sync.stale if status age exceeds 2× cadência. Dedup."""
    global _last_stale_marker
    if not status_path.exists():
        return False
    try:
        status = json.loads(status_path.read_text())
    except (OSError, json.JSONDecodeError):
        return False
    ts = status.get("last_update_timestamp")
    if not isinstance(ts, (int, float)):
        return False
    hours = status.get("sync_interval_hours") or DEFAULT_SYNC_HOURS
    try:
        hours = int(hours)
    except (TypeError, ValueError):
        hours = DEFAULT_SYNC_HOURS
    threshold = max(12, hours * STALE_FACTOR) * 3600
    age = int(time.time() - int(ts))
    if age <= threshold:
        return False
    marker = int(ts)
    if _last_stale_marker == marker:
        return False
    _last_stale_marker = marker
    _emit(db, "anablock.sync.stale", (
        f"AnaBlock: STALE — último sync OK há {age}s "
        f"(limite {threshold}s, cadência {hours}h)"
    ), {
        "reason": "stale",
        "age_seconds": age,
        "threshold_seconds": threshold,
        "sync_interval_hours": hours,
        "last_status": status.get("last_status"),
        "last_md5": status.get("last_md5") or None,
        "last_version_applied": status.get("last_version_applied") or None,
    })
    return True


def anablock_status_job(
    log_path: Path = EVENTS_LOG,
    status_path: Path = STATUS_FILE,
    offset_path: Path = OFFSET_FILE,
    *,
    session_factory=SessionLocal,
) -> dict:
    """Background job. Idempotente; safe to call repeatedly."""
    db = session_factory()
    try:
        emitted = _drain_events(db, log_path=log_path, offset_path=offset_path)
        stale = _check_stale(db, status_path=status_path)
        if emitted or stale:
            db.commit()
        return {"emitted": emitted, "stale_emitted": bool(stale)}
    except Exception as e:  # pragma: no cover (defensive)
        logger.exception("anablock_status_job failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return {"emitted": 0, "stale_emitted": False, "error": str(e)}
    finally:
        db.close()
