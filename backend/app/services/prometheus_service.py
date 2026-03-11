"""
DNS Control v2 — Prometheus Export Service
Generates Prometheus text format from latest metrics and health state.
"""

from sqlalchemy.orm import Session
from app.models.operational import DnsInstance, InstanceState, MetricSample
from sqlalchemy import func


PROM_HELP = """# HELP dns_control_up DNS Control API is up
# TYPE dns_control_up gauge
# HELP dns_instance_health Instance health (1=healthy, 0.5=degraded, 0=failed)
# TYPE dns_instance_health gauge
# HELP dns_backend_in_rotation Whether backend is in DNAT rotation
# TYPE dns_backend_in_rotation gauge
# HELP dns_healthcheck_consecutive_failures Consecutive health check failures
# TYPE dns_healthcheck_consecutive_failures gauge
# HELP dns_queries_total Total queries served
# TYPE dns_queries_total counter
# HELP dns_cache_hit_ratio Cache hit ratio (0-1)
# TYPE dns_cache_hit_ratio gauge
# HELP dns_cache_hits Total cache hits
# TYPE dns_cache_hits counter
# HELP dns_cache_misses Total cache misses
# TYPE dns_cache_misses counter
# HELP dns_latency_ms Average recursion latency in milliseconds
# TYPE dns_latency_ms gauge
# HELP dns_servfail_total Total SERVFAIL responses
# TYPE dns_servfail_total counter
# HELP dns_nxdomain_total Total NXDOMAIN responses
# TYPE dns_nxdomain_total counter
# HELP dns_active_instances Number of healthy instances
# TYPE dns_active_instances gauge
# HELP dns_failed_instances Number of failed instances
# TYPE dns_failed_instances gauge
# HELP dns_nftables_backend_count Number of backends in DNAT rotation
# TYPE dns_nftables_backend_count gauge
"""


def generate_prometheus_output(db: Session) -> str:
    lines = [PROM_HELP.strip(), "", "dns_control_up 1"]

    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    active_count = 0
    failed_count = 0
    in_rotation_count = 0

    for inst in instances:
        labels = f'instance="{inst.instance_name}",bind_ip="{inst.bind_ip}"'
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()

        # Health status
        if state:
            health_val = {"healthy": 1, "degraded": 0.5, "failed": 0, "withdrawn": 0}.get(state.current_status, 0)
            lines.append(f"dns_instance_health{{{labels}}} {health_val}")
            lines.append(f"dns_backend_in_rotation{{{labels}}} {1 if state.in_rotation else 0}")
            lines.append(f"dns_healthcheck_consecutive_failures{{{labels}}} {state.consecutive_failures}")

            if state.current_status in ("healthy", "degraded"):
                active_count += 1
            else:
                failed_count += 1
            if state.in_rotation:
                in_rotation_count += 1
        else:
            lines.append(f"dns_instance_health{{{labels}}} 1")
            lines.append(f"dns_backend_in_rotation{{{labels}}} 1")
            active_count += 1
            in_rotation_count += 1

        # Latest metrics for this instance
        _append_latest_metrics(db, inst, labels, lines)

    lines.append(f"dns_active_instances {active_count}")
    lines.append(f"dns_failed_instances {failed_count}")
    lines.append(f"dns_nftables_backend_count {in_rotation_count}")
    lines.append("")

    return "\n".join(lines)


def _append_latest_metrics(db: Session, instance: DnsInstance, labels: str, lines: list[str]):
    """Append latest metric samples for an instance."""
    metric_names = [
        "dns_queries_total", "dns_cache_hit_ratio", "dns_cache_hits",
        "dns_cache_misses", "dns_latency_ms", "dns_servfail_total", "dns_nxdomain_total",
    ]

    for name in metric_names:
        sample = db.query(MetricSample).filter(
            MetricSample.instance_id == instance.id,
            MetricSample.metric_name == name,
        ).order_by(MetricSample.collected_at.desc()).first()

        if sample:
            val = f"{sample.metric_value:.4f}" if "ratio" in name else f"{sample.metric_value}"
            lines.append(f"{name}{{{labels}}} {val}")
