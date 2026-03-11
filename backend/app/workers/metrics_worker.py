"""
DNS Control v2 — Metrics Worker
Periodically collects DNS statistics from unbound-control.
"""

import logging
from app.core.database import SessionLocal
from app.models.operational import DnsInstance
from app.services.metrics_collector_service import collect_instance_metrics

logger = logging.getLogger("dns-control.worker.metrics")


def metrics_collection_job():
    """Collect metrics from all enabled instances. Called every 30 seconds."""
    db = SessionLocal()
    try:
        instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
        if not instances:
            return

        for instance in instances:
            try:
                collect_instance_metrics(db, instance)
            except Exception as e:
                logger.exception(f"Metrics collection failed for {instance.instance_name}: {e}")
                db.rollback()

    except Exception as e:
        logger.exception(f"Metrics worker error: {e}")
    finally:
        db.close()
