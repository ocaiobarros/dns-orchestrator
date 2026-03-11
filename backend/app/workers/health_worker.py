"""
DNS Control v2 — Health Worker
Periodically checks all DNS instances and updates their health state.
"""

import logging
from app.core.database import SessionLocal
from app.models.operational import DnsInstance
from app.services.health_service import run_health_checks_for_instance

logger = logging.getLogger("dns-control.worker.health")


def health_check_job():
    """Run health checks for all enabled instances. Called every 10 seconds."""
    db = SessionLocal()
    try:
        instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
        if not instances:
            return

        for instance in instances:
            try:
                run_health_checks_for_instance(db, instance)
            except Exception as e:
                logger.exception(f"Health check failed for {instance.instance_name}: {e}")
                db.rollback()

    except Exception as e:
        logger.exception(f"Health worker error: {e}")
    finally:
        db.close()
