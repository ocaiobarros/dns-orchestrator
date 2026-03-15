"""
DNS Control — Prometheus Metrics Endpoint
Exposes dns_qps, dns_cache_hit, dns_latency in Prometheus text format.
"""

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.executors.command_runner import run_command

router = APIRouter()

METRICS_HELP = """# HELP dns_control_up Whether the DNS Control API is up (1 = up).
# TYPE dns_control_up gauge
# HELP dns_queries_total Total number of DNS queries served.
# TYPE dns_queries_total counter
# HELP dns_cache_hits_total Total cache hits.
# TYPE dns_cache_hits_total counter
# HELP dns_cache_misses_total Total cache misses.
# TYPE dns_cache_misses_total counter
# HELP dns_cache_hit_ratio Cache hit ratio (0-1).
# TYPE dns_cache_hit_ratio gauge
# HELP dns_latency_avg_seconds Average query latency in seconds.
# TYPE dns_latency_avg_seconds gauge
# HELP dns_queries_per_second Current queries per second.
# TYPE dns_queries_per_second gauge
# HELP dns_servfail_total Total SERVFAIL responses.
# TYPE dns_servfail_total counter
# HELP dns_nxdomain_total Total NXDOMAIN responses.
# TYPE dns_nxdomain_total counter
# HELP dns_instance_up Whether an Unbound instance is responding (1 = up).
# TYPE dns_instance_up gauge
# HELP dns_instance_latency_seconds Health check latency per instance.
# TYPE dns_instance_latency_seconds gauge
"""


@router.get("", response_class=PlainTextResponse)
def prometheus_metrics():
    """
    Prometheus-compatible /metrics endpoint.
    Scrapes unbound-control stats_noreset for each discovered instance.
    No authentication required (standard for Prometheus scraping).
    """
    lines = [METRICS_HELP.strip(), "", "dns_control_up 1"]

    # Discover instances
    instances = _discover_unbound_instances()

    for inst_name, ctrl_port in instances:
        stats = _scrape_unbound_stats(inst_name, ctrl_port)
        if stats:
            total_q = stats.get("total.num.queries", 0)
            cache_hits = stats.get("total.num.cachehits", 0)
            cache_miss = stats.get("total.num.cachemiss", 0)
            recursion_avg = stats.get("total.recursion.time.avg", 0)
            servfail = stats.get("num.answer.rcode.SERVFAIL", 0)
            nxdomain = stats.get("num.answer.rcode.NXDOMAIN", 0)

            hit_ratio = cache_hits / total_q if total_q > 0 else 0

            labels = f'instance="{inst_name}"'
            lines.append(f'dns_queries_total{{{labels}}} {total_q}')
            lines.append(f'dns_cache_hits_total{{{labels}}} {cache_hits}')
            lines.append(f'dns_cache_misses_total{{{labels}}} {cache_miss}')
            lines.append(f'dns_cache_hit_ratio{{{labels}}} {hit_ratio:.4f}')
            lines.append(f'dns_latency_avg_seconds{{{labels}}} {recursion_avg}')
            lines.append(f'dns_servfail_total{{{labels}}} {servfail}')
            lines.append(f'dns_nxdomain_total{{{labels}}} {nxdomain}')
            lines.append(f'dns_instance_up{{{labels}}} 1')
        else:
            labels = f'instance="{inst_name}"'
            lines.append(f'dns_instance_up{{{labels}}} 0')

    lines.append("")
    return "\n".join(lines)


def _discover_unbound_instances() -> list[tuple[str, int]]:
    """Discover running Unbound instances. Returns [(name, control_port)]."""
    result = run_command(
        "systemctl", ["list-units", "--type=service", "--state=running", "--no-pager", "--plain"],
        timeout=10,
    )
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                ctrl_port = _get_control_port(name)
                instances.append((name, ctrl_port))

    if not instances:
        instances = [("unbound", 8953)]

    return instances


def _get_control_port(instance_name: str) -> int:
    """Extract control-port from unbound config. Default 8953."""
    result = run_command("cat", [f"/etc/unbound/{instance_name}.conf"], timeout=5)
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "control-port:" in line:
                try:
                    return int(line.split(":")[1].strip())
                except (ValueError, IndexError):
                    pass
    return 8953


def _scrape_unbound_stats(instance_name: str, ctrl_port: int) -> dict | None:
    """Run unbound-control stats_noreset and parse key=value output."""
    result = run_command(
        "unbound-control",
        ["-c", f"/etc/unbound/{instance_name}.conf", "stats_noreset"],
        timeout=10,
    )
    if result["exit_code"] != 0:
        return None

    stats = {}
    for line in result["stdout"].split("\n"):
        if "=" in line:
            key, val = line.split("=", 1)
            key = key.strip()
            try:
                stats[key] = float(val.strip())
            except ValueError:
                stats[key] = val.strip()
    return stats if stats else None
