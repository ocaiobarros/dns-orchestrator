"""
DNS Control — Unbound Stats Service
Parses unbound-control stats_noreset into structured dashboard data.
"""

from app.executors.command_runner import run_command


def get_instance_real_stats(instances: list[dict] | None = None) -> list[dict]:
    """
    Collect real stats from each Unbound instance via unbound-control.
    Returns structured per-instance metrics for the dashboard.
    """
    if instances is None:
        instances = _discover_instances()

    results = []
    for inst in instances:
        name = inst.get("name", "unbound")
        config_path = f"/etc/unbound/unbound.conf.d/{name}.conf"

        result = run_command(
            "unbound-control",
            ["-c", config_path, "stats_noreset"],
            timeout=10,
        )

        if result["exit_code"] == 0:
            stats = _parse_stats(result["stdout"])
            total_q = stats.get("total.num.queries", 0)
            cache_hits = stats.get("total.num.cachehits", 0)
            cache_miss = stats.get("total.num.cachemiss", 0)
            recursion_avg = stats.get("total.recursion.time.avg", 0)
            uptime = stats.get("time.up", 0)
            threads = stats.get("num.threads", 4)

            hit_ratio = (cache_hits / total_q * 100) if total_q > 0 else 0

            results.append({
                "instance": name,
                "totalQueries": int(total_q),
                "cacheHitRatio": round(hit_ratio, 1),
                "avgLatencyMs": round(recursion_avg * 1000, 1),
                "uptime": _format_uptime(uptime),
                "threads": int(threads),
                "cacheHits": int(cache_hits),
                "cacheMisses": int(cache_miss),
                "currentConnections": int(stats.get("total.num.queries_ip_ratelimited", 0)),
                "servfail": int(stats.get("num.answer.rcode.SERVFAIL", 0)),
                "nxdomain": int(stats.get("num.answer.rcode.NXDOMAIN", 0)),
                "noerror": int(stats.get("num.answer.rcode.NOERROR", 0)),
                "source": "live",
            })
        else:
            results.append({
                "instance": name,
                "totalQueries": 0,
                "cacheHitRatio": 0,
                "avgLatencyMs": 0,
                "uptime": "offline",
                "threads": 0,
                "cacheHits": 0,
                "cacheMisses": 0,
                "currentConnections": 0,
                "servfail": 0,
                "nxdomain": 0,
                "noerror": 0,
                "source": "unavailable",
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
    """Discover Unbound instances from systemd."""
    result = run_command(
        "systemctl", ["list-units", "--type=service", "--state=running", "--no-pager", "--plain"],
        timeout=10,
    )
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                instances.append({"name": name})
    return instances or [{"name": "unbound"}]
