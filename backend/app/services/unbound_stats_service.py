"""
DNS Control — Unbound Stats Service
Parses unbound-control stats_noreset into structured dashboard data.
Multi-instance aware: targets each instance via -s <control_ip>@<port>.
"""

from app.executors.command_runner import run_command


# Known instances with their control interfaces.
# Discovered dynamically from config files, with fallback to these defaults.
_DEFAULT_INSTANCES = [
    {"name": "unbound01", "control_interface": "127.0.0.11", "control_port": 8953},
    {"name": "unbound02", "control_interface": "127.0.0.12", "control_port": 8953},
]


def get_instance_real_stats(instances: list[dict] | None = None) -> list[dict]:
    """
    Collect real stats from each Unbound instance via unbound-control.
    Uses -s <ip>@<port> to target the correct instance control socket.
    Returns structured per-instance metrics for the dashboard.
    """
    if instances is None:
        instances = _discover_instances()

    results = []
    for inst in instances:
        name = inst.get("name", "unbound")
        control_ip = inst.get("control_interface", "127.0.0.1")
        control_port = inst.get("control_port", 8953)
        config_path = f"/etc/unbound/{name}.conf"

        result = run_command(
            "unbound-control",
            ["-s", f"{control_ip}@{control_port}", "-c", config_path, "stats_noreset"],
            timeout=10,
            use_privilege=True,
        )

        if result["exit_code"] == 0:
            stats = _parse_stats(result["stdout"])
            total_q = stats.get("total.num.queries", 0)
            cache_hits = stats.get("total.num.cachehits", 0)
            cache_miss = stats.get("total.num.cachemiss", 0)
            recursion_avg = stats.get("total.recursion.time.avg", 0)
            uptime = stats.get("time.up", 0)
            threads = stats.get("num.threads", 4)
            requestlist_current = stats.get("total.requestlist.current.all", 0)
            requestlist_max = stats.get("total.requestlist.max", 0)

            hit_ratio = (cache_hits / total_q * 100) if total_q > 0 else 0

            results.append({
                "instance": name,
                "totalQueries": int(total_q),
                "cacheHitRatio": round(hit_ratio, 1),
                "avgLatencyMs": round(recursion_avg * 1000, 1),
                "uptime": _format_uptime(uptime),
                "uptimeSeconds": int(uptime),
                "threads": int(threads),
                "cacheHits": int(cache_hits),
                "cacheMisses": int(cache_miss),
                "requestlistCurrent": int(requestlist_current),
                "requestlistMax": int(requestlist_max),
                "servfail": int(stats.get("num.answer.rcode.SERVFAIL", 0)),
                "nxdomain": int(stats.get("num.answer.rcode.NXDOMAIN", 0)),
                "noerror": int(stats.get("num.answer.rcode.NOERROR", 0)),
                "refused": int(stats.get("num.answer.rcode.REFUSED", 0)),
                "recursionTimeAvg": round(recursion_avg * 1000, 2),
                "recursionTimeMedian": round(float(stats.get("total.recursion.time.median", 0)) * 1000, 2),
                "source": "live",
                "control_interface": control_ip,
                "control_port": control_port,
            })
        else:
            results.append({
                "instance": name,
                "totalQueries": 0,
                "cacheHitRatio": 0,
                "avgLatencyMs": 0,
                "uptime": "offline",
                "uptimeSeconds": 0,
                "threads": 0,
                "cacheHits": 0,
                "cacheMisses": 0,
                "requestlistCurrent": 0,
                "requestlistMax": 0,
                "servfail": 0,
                "nxdomain": 0,
                "noerror": 0,
                "refused": 0,
                "recursionTimeAvg": 0,
                "recursionTimeMedian": 0,
                "source": "unavailable",
                "error": result.get("stderr", "")[:200],
                "control_interface": control_ip,
                "control_port": control_port,
            })

    return results


def _parse_stats(raw: str) -> dict:
    """Parse unbound-control stats key=value output."""
    stats = {}
    for line in raw.split("\n"):
        if "=" in line:
            key, val = line.split("=", 1)
            try:
                stats[key.strip()] = float(val.strip())
            except ValueError:
                stats[key.strip()] = val.strip()
    return stats


def _format_uptime(seconds: float) -> str:
    """Format seconds into human-readable uptime."""
    s = int(seconds)
    if s <= 0:
        return "0s"
    days = s // 86400
    hours = (s % 86400) // 3600
    mins = (s % 3600) // 60
    parts = []
    if days:
        parts.append(f"{days}d")
    if hours:
        parts.append(f"{hours}h")
    if mins:
        parts.append(f"{mins}m")
    return " ".join(parts) if parts else f"{s}s"


def _discover_instances() -> list[dict]:
    """
    Discover Unbound instances from systemd units named unbound*.service.
    For each, parse config file to extract control-interface and control-port.
    """
    result = run_command(
        "systemctl", ["list-units", "--type=service", "--state=running", "--no-pager", "--plain"],
        timeout=10,
    )
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                # Skip the default unbound.service if running alongside instances
                if name == "unbound":
                    continue
                ctrl = _get_control_from_config(name)
                instances.append({
                    "name": name,
                    "control_interface": ctrl.get("control_interface", "127.0.0.1"),
                    "control_port": ctrl.get("control_port", 8953),
                })

    return instances if instances else _DEFAULT_INSTANCES


def _get_control_from_config(instance_name: str) -> dict:
    """Extract control-interface and control-port from unbound config file."""
    result = run_command(
        "cat", [f"/etc/unbound/{instance_name}.conf"],
        timeout=5,
    )
    ctrl = {"control_interface": "127.0.0.1", "control_port": 8953}
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            stripped = line.strip()
            if stripped.startswith("control-interface:"):
                ctrl["control_interface"] = stripped.split(":", 1)[1].strip()
            elif stripped.startswith("control-port:"):
                try:
                    ctrl["control_port"] = int(stripped.split(":", 1)[1].strip())
                except ValueError:
                    pass
    return ctrl
