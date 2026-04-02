"""
DNS Control — Kiosk / NOC TV Dashboard Endpoint
Consolidated payload for TV/kiosk display with host + DNS metrics.
"""

import os
import time
import json
import subprocess
import logging
from pathlib import Path
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter()
logger = logging.getLogger("dns-control.kiosk")

TELEMETRY_DIR = Path(os.environ.get("COLLECTOR_OUTPUT_DIR", "/var/lib/dns-control/telemetry"))


def _run(cmd: list[str], timeout: int = 5) -> str:
    """Run command and return stdout."""
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def _collect_host_metrics() -> dict:
    """Collect host-level metrics from /proc and system commands."""
    host = {}

    # Hostname
    try:
        host["hostname"] = os.uname().nodename
    except Exception:
        host["hostname"] = "unknown"

    # Uptime
    try:
        with open("/proc/uptime") as f:
            uptime_secs = int(float(f.read().split()[0]))
        days = uptime_secs // 86400
        hours = (uptime_secs % 86400) // 3600
        mins = (uptime_secs % 3600) // 60
        host["uptime_seconds"] = uptime_secs
        host["uptime_display"] = f"{days}d {hours}h {mins}m"
    except Exception:
        host["uptime_seconds"] = 0
        host["uptime_display"] = "—"

    # Load average
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
        host["load_1m"] = float(parts[0])
        host["load_5m"] = float(parts[1])
        host["load_15m"] = float(parts[2])
    except Exception:
        host["load_1m"] = host["load_5m"] = host["load_15m"] = 0.0

    # CPU usage from /proc/stat (instantaneous — not perfectly accurate but fast)
    try:
        with open("/proc/stat") as f:
            line = f.readline()
        vals = [int(x) for x in line.split()[1:]]
        idle = vals[3] + (vals[4] if len(vals) > 4 else 0)  # idle + iowait
        total = sum(vals)
        # Use load average as approximation for CPU %
        cpu_count = os.cpu_count() or 1
        host["cpu_count"] = cpu_count
        host["cpu_percent"] = round(min(host["load_1m"] / cpu_count * 100, 100), 1)
    except Exception:
        host["cpu_count"] = os.cpu_count() or 1
        host["cpu_percent"] = 0.0

    # Memory from /proc/meminfo
    try:
        meminfo = {}
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split(":")
                if len(parts) == 2:
                    key = parts[0].strip()
                    val = int(parts[1].strip().split()[0])  # kB
                    meminfo[key] = val
        total_kb = meminfo.get("MemTotal", 0)
        avail_kb = meminfo.get("MemAvailable", meminfo.get("MemFree", 0))
        used_kb = total_kb - avail_kb
        total_mb = round(total_kb / 1024)
        used_mb = round(used_kb / 1024)
        if total_mb >= 1024:
            host["ram_total_display"] = f"{total_mb / 1024:.1f} GB"
            host["ram_used_display"] = f"{used_mb / 1024:.1f} GB"
        else:
            host["ram_total_display"] = f"{total_mb} MB"
            host["ram_used_display"] = f"{used_mb} MB"
        host["ram_total_mb"] = total_mb
        host["ram_used_mb"] = used_mb
        host["ram_percent"] = round(used_kb / total_kb * 100, 1) if total_kb > 0 else 0.0
    except Exception:
        host["ram_total_mb"] = host["ram_used_mb"] = 0
        host["ram_percent"] = 0.0

    # Disk usage (root partition)
    try:
        st = os.statvfs("/")
        total_bytes = st.f_blocks * st.f_frsize
        free_bytes = st.f_bavail * st.f_frsize
        used_bytes = total_bytes - free_bytes
        host["disk_total_gb"] = round(total_bytes / (1024**3), 1)
        host["disk_used_gb"] = round(used_bytes / (1024**3), 1)
        host["disk_percent"] = round(used_bytes / total_bytes * 100, 1) if total_bytes > 0 else 0.0
    except Exception:
        host["disk_total_gb"] = host["disk_used_gb"] = 0.0
        host["disk_percent"] = 0.0

    # Service statuses
    services_to_check = [
        "dns-control-api",
        "nginx",
        "unbound01",
        "unbound02",
        "dns-control-collector.timer",
        "nftables",
    ]
    service_statuses = {}
    for svc in services_to_check:
        status = _run(["systemctl", "is-active", svc])
        service_statuses[svc] = status if status else "inactive"
    host["services"] = service_statuses

    # Timezone
    try:
        host["timezone"] = time.strftime("%Z")
    except Exception:
        host["timezone"] = "UTC"

    # Primary IP (from hostname -I)
    ip_out = _run(["hostname", "-I"])
    host["primary_ip"] = ip_out.split()[0] if ip_out else "127.0.0.1"

    return host


def _read_telemetry() -> dict:
    """Read latest collector telemetry."""
    path = TELEMETRY_DIR / "latest.json"
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _read_telemetry_history() -> list:
    """Read telemetry time series."""
    path = TELEMETRY_DIR / "history.json"
    try:
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


@router.get("/summary")
def kiosk_summary(_: User = Depends(get_current_user)):
    """Consolidated kiosk payload: host metrics + DNS telemetry + history."""
    now = datetime.now(timezone.utc)
    host = _collect_host_metrics()
    telemetry = _read_telemetry()
    history = _read_telemetry_history()

    # Operation mode
    mode = telemetry.get("mode", "unknown")
    for path in ["/var/lib/dns-control/deploy-state.json", "/opt/dns-control/deploy-state.json"]:
        try:
            with open(path) as f:
                ds = json.load(f)
            op = ds.get("operationMode", "")
            if op == "simple":
                mode = "Recursivo Simples"
            elif op == "interception":
                mode = "Recursivo com Interceptação"
            break
        except Exception:
            continue

    return {
        "timestamp": now.isoformat(),
        "host": host,
        "operation_mode": mode,
        "dns": {
            "frontend": telemetry.get("frontend", {}),
            "resolver": telemetry.get("resolver", {}),
            "traffic": telemetry.get("traffic", {}),
            "backends": telemetry.get("backends", []),
            "top_domains": telemetry.get("top_domains", []),
            "top_clients": telemetry.get("top_clients", []),
            "recent_queries": telemetry.get("recent_queries", []),
            "health": telemetry.get("health", {}),
        },
        "history": history[-60:],  # Last ~10 minutes of data points
    }
