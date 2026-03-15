"""
DNS Control v2 — Metrics Collection Service
Collects real-time stats from unbound-control and stores as time-series samples.
"""

import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.executors.command_runner import run_command
from app.models.operational import DnsInstance, MetricSample

logger = logging.getLogger("dns-control.metrics-collector")

UNBOUND_METRICS_MAP = {
    "total.num.queries": "dns_queries_total",
    "total.num.cachehits": "dns_cache_hits",
    "total.num.cachemiss": "dns_cache_misses",
    "total.recursion.time.avg": "dns_recursion_avg_sec",
    "num.answer.rcode.SERVFAIL": "dns_servfail_total",
    "num.answer.rcode.NXDOMAIN": "dns_nxdomain_total",
    "num.answer.rcode.NOERROR": "dns_noerror_total",
    "total.num.queries_ip_ratelimited": "dns_ratelimited_total",
    "mem.cache.rrset": "dns_cache_rrset_bytes",
    "mem.cache.message": "dns_cache_msg_bytes",
}


def collect_instance_metrics(db: Session, instance: DnsInstance) -> dict:
    """Scrape unbound-control stats_noreset and store samples."""
    config_path = f"/etc/unbound/{instance.instance_name}.conf"
    result = run_command("unbound-control", ["-c", config_path, "stats_noreset"], timeout=10)

    if result["exit_code"] != 0:
        logger.warning(f"Failed to collect metrics for {instance.instance_name}: {result['stderr'][:200]}")
        return {"instance": instance.instance_name, "success": False, "error": result["stderr"][:200]}

    raw_stats = _parse_stats(result["stdout"])
    now = datetime.now(timezone.utc)
    samples = []

    for raw_key, metric_name in UNBOUND_METRICS_MAP.items():
        if raw_key in raw_stats:
            sample = MetricSample(
                instance_id=instance.id,
                metric_name=metric_name,
                metric_value=float(raw_stats[raw_key]),
                collected_at=now,
            )
            db.add(sample)
            samples.append({"metric": metric_name, "value": float(raw_stats[raw_key])})

    # Compute derived metrics
    total_q = float(raw_stats.get("total.num.queries", 0))
    cache_hits = float(raw_stats.get("total.num.cachehits", 0))
    if total_q > 0:
        hit_ratio = cache_hits / total_q
        db.add(MetricSample(instance_id=instance.id, metric_name="dns_cache_hit_ratio", metric_value=hit_ratio, collected_at=now))
        samples.append({"metric": "dns_cache_hit_ratio", "value": hit_ratio})

    recursion_avg = float(raw_stats.get("total.recursion.time.avg", 0))
    db.add(MetricSample(instance_id=instance.id, metric_name="dns_latency_ms", metric_value=recursion_avg * 1000, collected_at=now))

    db.commit()
    return {"instance": instance.instance_name, "success": True, "samples": len(samples)}


def get_latest_metrics(db: Session, instance_id: str | None = None) -> list[dict]:
    """Get latest metric values per instance per metric name."""
    from sqlalchemy import func

    # Subquery for max collected_at per instance+metric
    subq = db.query(
        MetricSample.instance_id,
        MetricSample.metric_name,
        func.max(MetricSample.collected_at).label("max_at"),
    ).group_by(MetricSample.instance_id, MetricSample.metric_name)

    if instance_id:
        subq = subq.filter(MetricSample.instance_id == instance_id)

    subq = subq.subquery()

    latest = db.query(MetricSample).join(
        subq,
        (MetricSample.instance_id == subq.c.instance_id)
        & (MetricSample.metric_name == subq.c.metric_name)
        & (MetricSample.collected_at == subq.c.max_at),
    ).all()

    results = []
    for s in latest:
        inst = db.query(DnsInstance).filter(DnsInstance.id == s.instance_id).first()
        results.append({
            "instance_id": s.instance_id,
            "instance_name": inst.instance_name if inst else "unknown",
            "metric_name": s.metric_name,
            "metric_value": s.metric_value,
            "collected_at": s.collected_at.isoformat(),
        })
    return results


def get_metric_history(db: Session, instance_id: str, metric_name: str, limit: int = 100) -> list[dict]:
    """Get historical samples for a specific metric."""
    samples = db.query(MetricSample).filter(
        MetricSample.instance_id == instance_id,
        MetricSample.metric_name == metric_name,
    ).order_by(MetricSample.collected_at.desc()).limit(limit).all()

    return [
        {"value": s.metric_value, "collected_at": s.collected_at.isoformat()}
        for s in reversed(samples)
    ]


def _parse_stats(raw: str) -> dict:
    stats = {}
    for line in raw.split("\n"):
        if "=" in line:
            key, val = line.split("=", 1)
            try:
                stats[key.strip()] = float(val.strip())
            except ValueError:
                stats[key.strip()] = val.strip()
    return stats
