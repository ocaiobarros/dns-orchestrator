"""
DNS Control v2 — Health Worker
Periodically checks all DNS instances and updates their health state.
In observed mode, auto-syncs dns_instances from runtime before each cycle.
"""

import logging
from app.core.database import SessionLocal
from app.models.operational import DnsInstance, InstanceState, OperationalEvent
from app.services.health_service import run_health_checks_for_instance

logger = logging.getLogger("dns-control.worker.health")

_run_counter = 0
_HEARTBEAT_INTERVAL = 30  # Every 30 runs (~5 min at 10s interval)
_SYNC_INTERVAL = 6        # Every 6 runs (~60s at 10s interval) for observed mode


def health_check_job():
    """Run health checks for all enabled instances. Called every 10 seconds."""
    global _run_counter
    _run_counter += 1

    db = SessionLocal()
    try:
        # In observed mode, periodically sync instances from runtime
        if _run_counter % _SYNC_INTERVAL == 0:
            try:
                from app.services.service_mode import get_service_mode, MODE_OBSERVED
                mode = get_service_mode(db)
                if mode == MODE_OBSERVED:
                    from app.services.runtime_inventory_service import sync_instances_to_db
                    result = sync_instances_to_db(db)
                    if result["created"] > 0:
                        logger.info(f"Observed mode: auto-discovered {result['created']} new instance(s)")
            except Exception as e:
                logger.debug(f"Instance sync failed: {e}")

        instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
        if not instances:
            return

        for instance in instances:
            try:
                run_health_checks_for_instance(db, instance)
            except Exception as e:
                logger.exception(f"Health check failed for {instance.instance_name}: {e}")
                db.rollback()

        # Emit periodic heartbeat event
        if _run_counter % _HEARTBEAT_INTERVAL == 0:
            healthy = 0
            degraded = 0
            failed = 0
            for inst in instances:
                st = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
                if st:
                    if st.current_status == "healthy":
                        healthy += 1
                    elif st.current_status == "degraded":
                        degraded += 1
                    else:
                        failed += 1
            severity = "info" if failed == 0 else "warning"
            ev = OperationalEvent(
                event_type="health_heartbeat",
                severity=severity,
                instance_id=None,
                message=f"Health heartbeat: {healthy} healthy, {degraded} degraded, {failed} failed ({len(instances)} total)",
            )
            db.add(ev)
            db.commit()

    except Exception as e:
        logger.exception(f"Health worker error: {e}")
    finally:
        db.close()
