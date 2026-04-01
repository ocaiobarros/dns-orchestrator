"""
DNS Control — Telemetry Routes
Serves collector JSON output to the frontend.
"""

import json
import os
import logging
from pathlib import Path
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()
logger = logging.getLogger("dns-control.telemetry")

TELEMETRY_DIR = Path(os.environ.get("COLLECTOR_OUTPUT_DIR", "/var/lib/dns-control/telemetry"))


def _read_telemetry(filename: str = "latest.json") -> dict:
    """Read collector output JSON."""
    path = TELEMETRY_DIR / filename
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "health": {"collector": "not_running", "last_update": None},
            "error": "Collector output not found. Is dns-control-collector.timer enabled?",
        }
    except json.JSONDecodeError as e:
        return {
            "health": {"collector": "error", "last_update": None},
            "error": f"Collector output corrupted: {e}",
        }


@router.get("/latest")
def telemetry_latest(_: User = Depends(get_current_user)):
    """Get latest collector telemetry snapshot."""
    return _read_telemetry("latest.json")


@router.get("/simple")
def telemetry_simple(_: User = Depends(get_current_user)):
    """Get recursive-simple mode telemetry."""
    return _read_telemetry("recursive-simple.json")


@router.get("/interception")
def telemetry_interception(_: User = Depends(get_current_user)):
    """Get recursive-interception mode telemetry."""
    return _read_telemetry("recursive-interception.json")


@router.get("/status")
def telemetry_status(_: User = Depends(get_current_user)):
    """Quick status check of collector health."""
    data = _read_telemetry("latest.json")
    health = data.get("health", {})

    # Check file age
    import time
    latest_path = TELEMETRY_DIR / "latest.json"
    file_age_seconds = None
    try:
        stat = latest_path.stat()
        file_age_seconds = int(time.time() - stat.st_mtime)
    except (FileNotFoundError, OSError):
        pass

    return {
        "collector_status": health.get("collector", "unknown"),
        "last_update": health.get("last_update"),
        "collection_duration_ms": health.get("collection_duration_ms"),
        "file_age_seconds": file_age_seconds,
        "stale": file_age_seconds is not None and file_age_seconds > 60,
        "mode": data.get("mode", "unknown"),
        "error": data.get("error"),
    }
