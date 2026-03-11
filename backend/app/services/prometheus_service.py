"""
DNS Control v2.1 — Prometheus Export Service
Generates Prometheus text format with enhanced metrics including cooldown and event counts.
"""

from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timezone

from app.models.operational import (
    DnsInstance, InstanceState, MetricSample, OperationalEvent, OperationalAction,
)


PROM_HELP = """# HELP dns_control_up DNS Control API is up
# TYPE dns_control_up gauge
# HELP dns_instance_health Instance health (1=healthy, 0.5=degraded, 0=failed)
# TYPE dns_instance_health gauge
# HELP dns_backend_in_rotation Whether backend is in DNAT rotation
# TYPE dns_backend_in_rotation gauge
# HELP dns_healthcheck_consecutive_failures Consecutive health check failures
# TYPE dns_healthcheck_consecutive_failures gauge
# HELP dns_instance_consecutive_successes Consecutive health check successes
# TYPE dns_instance_consecutive_successes gauge
# HELP dns_instance_cooldown_seconds Seconds remaining in cooldown
# TYPE dns_instance_cooldown_seconds gauge
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
# HELP dns_events_total Total operational events by severity
# TYPE dns_events_total counter
# HELP dns_reconciliation_actions_total Total reconciliation actions by type
# TYPE dns_reconciliation_actions_total counter
"""


def generate_prometheus_output(db: Session) -> str:
    lines = [PROM_HELP.strip(), "", "dns_control_up 1"]
    now = datetime.now(timezone.utc)

    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    active_count = 0
    failed_count = 0
    in_rotation_count = 0

    for inst in instances:
        labels = f'instance="{inst.instance_name}",bind_ip="{inst.bind_ip}"'
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()

        if state:
            health_val = {"healthy": 1, "degraded": 0.5, "failed": 0, "withdrawn": 0}.get(state.current_status, 0)
            lines.append(f"dns_instance_health{{{labels}}} {health_val}")
            lines.append(f"dns_backend_in_rotation{{{labels}}} {1 if state.in_rotation else 0}")
            lines.append(f"dns_healthcheck_consecutive_failures{{{labels}}} {state.consecutive_failures}")
            lines.append(f"dns_instance_consecutive_successes{{{labels}}} {state.consecutive_successes}")

            # Cooldown
            cooldown_remaining = 0
            if state.cooldown_until:
                remaining = (state.cooldown_until - now).total_seconds()
                cooldown_remaining = max(0, remaining)
            lines.append(f"dns_instance_cooldown_seconds{{{labels}}} {cooldown_remaining:.0f}")

            if state.current_status in ("healthy", "degraded"):
                active_count += 1
            else:
                failed_count += 1
            if state.in_rotation:
                in_rotation_count += 1
        else:
            lines.append(f"dns_instance_health{{{labels}}} 1")
            lines.append(f"dns_backend_in_rotation{{{labels}}} 1")
            lines.append(f"dns_instance_cooldown_seconds{{{labels}}} 0")
            active_count += 1
            in_rotation_count += 1

        _append_latest_metrics(db, inst, labels, lines)

    lines.append(f"dns_active_instances {active_count}")
    lines.append(f"dns_failed_instances {failed_count}")
    lines.append(f"dns_nftables_backend_count {in_rotation_count}")

    # Event counts by severity
    for severity in ("info", "warning", "critical"):
        count = db.query(func.count(OperationalEvent.id)).filter(
            OperationalEvent.severity == severity
        ).scalar() or 0
        lines.append(f'dns_events_total{{severity="{severity}"}} {count}')

    # Reconciliation action counts
    for action_type in ("remove_backend", "restore_backend"):
        count = db.query(func.count(OperationalAction.id)).filter(
            OperationalAction.action_type == action_type
        ).scalar() or 0
        lines.append(f'dns_reconciliation_actions_total{{action="{action_type}"}} {count}')

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
