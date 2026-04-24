"""
DNS Control — Telemetry Routes
Serves collector JSON output to the frontend.
"""

import json
import os
import logging
import shutil
import subprocess
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
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


@router.get("/history")
def telemetry_history(_: User = Depends(get_current_user)):
    """Get metrics time-series history (circular buffer from collector)."""
    path = TELEMETRY_DIR / "history.json"
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return []
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []


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


# ──────────────────────────────────────────────────────────────────────
# AnaBlock observability — surfaces the 3 required metrics:
#   anablock_last_update_timestamp
#   anablock_domains_loaded_count
#   anablock_last_status (OK/FAIL)
# Source: /var/lib/dns-control/anablock-status.json (written by gen-anablock.sh)
# ──────────────────────────────────────────────────────────────────────

ANABLOCK_STATUS_FILE = Path("/var/lib/dns-control/anablock-status.json")
ANABLOCK_CONF_FILE = Path("/etc/unbound/anablock.conf")


@router.get("/anablock")
def telemetry_anablock(_: User = Depends(get_current_user)):
    """Return AnaBlock sync metrics for the dashboard."""
    import time

    response = {
        "enabled": Path("/etc/unbound/gen-anablock.sh").exists(),
        "anablock_last_update_timestamp": None,
        "anablock_last_update_iso": None,
        "anablock_domains_loaded_count": 0,
        "anablock_last_status": "UNKNOWN",
        "message": "",
        "mode": None,
        "api_url": None,
        "stale": False,
        "age_seconds": None,
        "conf_present": ANABLOCK_CONF_FILE.exists(),
    }

    if not ANABLOCK_STATUS_FILE.exists():
        response["message"] = (
            "Sem dados de execução. Aguardando primeira execução do timer "
            "anablock-update.timer ou execução manual de /etc/unbound/gen-anablock.sh."
        )
        return response

    try:
        with open(ANABLOCK_STATUS_FILE) as f:
            status = json.load(f)
        ts = status.get("last_update_timestamp")
        response.update({
            "anablock_last_update_timestamp": ts,
            "anablock_last_update_iso": status.get("last_update_iso"),
            "anablock_domains_loaded_count": int(status.get("domains_loaded_count") or 0),
            "anablock_last_status": str(status.get("last_status") or "UNKNOWN").upper(),
            "message": status.get("message", ""),
            "mode": status.get("mode"),
            "api_url": status.get("api_url"),
        })
        if ts:
            age = int(time.time() - int(ts))
            response["age_seconds"] = age
            response["stale"] = age > 12 * 3600
    except (json.JSONDecodeError, OSError, ValueError) as e:
        response["anablock_last_status"] = "FAIL"
        response["message"] = f"Status corrompido: {e}"

    return response


# ──────────────────────────────────────────────────────────────────────
# Recollect endpoint — observation/observed mode helper.
# Re-runs the collector synchronously and (optionally) restarts the
# collector service so the next timer cycle starts fresh.
# ──────────────────────────────────────────────────────────────────────

COLLECTOR_SCRIPT_CANDIDATES = [
    Path("/opt/dns-control/collector/collector.py"),
    Path("/opt/dns-control/backend/collector/collector.py"),
    Path(__file__).resolve().parents[3] / "collector" / "collector.py",
]


def _find_collector_script() -> Path | None:
    for p in COLLECTOR_SCRIPT_CANDIDATES:
        try:
            if p.exists():
                return p
        except OSError:
            continue
    return None


@router.post("/recollect")
def telemetry_recollect(_: User = Depends(get_current_user)):
    """Re-run collector synchronously and restart its systemd service.

    Used by the Observation Mode panel to refresh top domains/clients
    and re-validate the log parser after fixing host configuration.
    """
    started = time.time()
    steps: list[dict] = []

    script = _find_collector_script()
    if not script:
        return {
            "success": False,
            "error": "collector.py not found in expected paths",
            "candidates": [str(p) for p in COLLECTOR_SCRIPT_CANDIDATES],
        }

    python_bin = shutil.which("python3") or "/usr/bin/python3"
    try:
        proc = subprocess.run(
            [python_bin, str(script)],
            capture_output=True,
            text=True,
            timeout=45,
            env={**os.environ},
        )
        steps.append({
            "step": "run_collector",
            "code": proc.returncode,
            "stdout_tail": (proc.stdout or "")[-500:],
            "stderr_tail": (proc.stderr or "")[-500:],
        })
    except subprocess.TimeoutExpired:
        steps.append({"step": "run_collector", "code": -1, "error": "timeout"})

    # Best-effort restart (non-fatal — service may not exist in dev hosts)
    try:
        rc = subprocess.run(
            ["sudo", "-n", "systemctl", "restart", "dns-control-collector.service"],
            capture_output=True, text=True, timeout=15,
        )
        steps.append({
            "step": "restart_service",
            "code": rc.returncode,
            "stderr_tail": (rc.stderr or "")[-300:],
        })
    except Exception as e:
        steps.append({"step": "restart_service", "code": -1, "error": str(e)[:200]})

    latest = _read_telemetry("latest.json")
    return {
        "success": True,
        "duration_ms": int((time.time() - started) * 1000),
        "steps": steps,
        "telemetry_mode": latest.get("telemetry_mode"),
        "queries_parsed": latest.get("query_analytics", {}).get("queries_parsed", 0),
        "log_source": latest.get("query_analytics", {}).get("log_source", "none"),
        "top_domains_count": len(latest.get("top_domains", [])),
        "top_clients_count": len(latest.get("top_clients", [])),
    }


# ──────────────────────────────────────────────────────────────────────
# Log validation endpoint — exposes per-instance log discovery so the
# operator can confirm which logfile/parser is feeding the dashboard.
# ──────────────────────────────────────────────────────────────────────

@router.get("/log-validation")
def telemetry_log_validation(_: User = Depends(get_current_user)):
    """Return per-instance log file detection + active parser source."""
    data = _read_telemetry("latest.json")
    detection = data.get("log_detection", {}) or {}
    analytics = data.get("query_analytics", {}) or {}

    log_source_raw = analytics.get("log_source", "none") or "none"
    if log_source_raw.startswith("logfile:"):
        active_parser = "logfile"
        active_path = log_source_raw.split(":", 1)[1]
    elif log_source_raw == "journalctl":
        active_parser = "journalctl"
        active_path = "systemd-journal"
    else:
        active_parser = "none"
        active_path = ""

    instances = []
    for d in detection.get("details", []):
        instances.append({
            "instance": d.get("instance"),
            "log_queries": d.get("log_queries", False),
            "use_syslog": d.get("use_syslog", False),
            "logfile": d.get("logfile") or "",
            "expected_parser": (
                "logfile" if d.get("logfile") else
                "journalctl" if d.get("use_syslog") else
                "none"
            ),
        })

    return {
        "telemetry_mode": detection.get("telemetry_mode", "unknown"),
        "active_parser": active_parser,
        "active_path": active_path,
        "queries_parsed_last_cycle": analytics.get("queries_parsed", 0),
        "domains_available": analytics.get("domains_available", False),
        "clients_available": analytics.get("clients_available", False),
        "log_files_discovered": detection.get("log_files", []),
        "log_queries_configured": detection.get("log_queries_configured", False),
        "use_syslog": detection.get("use_syslog", False),
        "journal_entries_found": detection.get("journal_entries_found", False),
        "instances": instances,
        "diag": analytics.get("diag", {}),
    }


# ──────────────────────────────────────────────────────────────────────
# Recent queries — exposes the collector's recent_queries buffer with
# basic filtering for the observation page.
# ──────────────────────────────────────────────────────────────────────

@router.get("/recent-queries")
def telemetry_recent_queries(
    instance: str | None = None,
    qtype: str | None = None,
    limit: int = 200,
    _: User = Depends(get_current_user),
):
    """Return the most recent DNS queries collected by the telemetry agent."""
    data = _read_telemetry("latest.json")
    queries = data.get("recent_queries", []) or []

    if instance:
        # recent_queries don't carry instance attribution today — keep filter
        # available for forward compatibility (collector enhancement).
        queries = [q for q in queries if (q.get("instance") or "").lower() == instance.lower()]
    if qtype:
        queries = [q for q in queries if (q.get("type") or "").upper() == qtype.upper()]

    queries = queries[-max(1, min(limit, 1000)) :]
    return {
        "items": list(reversed(queries)),
        "count": len(queries),
        "telemetry_mode": data.get("telemetry_mode"),
        "log_source": data.get("query_analytics", {}).get("log_source"),
        "available_types": sorted({q.get("type", "?") for q in data.get("recent_queries", []) if q.get("type")}),
        "available_instances": [i.get("name") for i in data.get("backends", []) if i.get("name")],
    }
