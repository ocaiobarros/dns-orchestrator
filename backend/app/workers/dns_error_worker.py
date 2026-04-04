"""
DNS Control — DNS Error Collection Worker
Multi-strategy: journalctl → stats_delta → aggregate fallback.
Runs as part of the scheduler alongside health and metrics workers.
"""

import logging
from app.core.database import SessionLocal
from app.services.dns_error_collector_service import (
    collect_dns_errors_multi_strategy,
    persist_dns_errors,
    cleanup_old_events,
)

logger = logging.getLogger("dns-control.worker.dns-errors")

_collection_count = 0


def dns_error_collection_job():
    """Collect DNS errors every 60 seconds using multi-strategy pipeline."""
    global _collection_count
    db = SessionLocal()
    try:
        result = collect_dns_errors_multi_strategy(since_seconds=65)
        errors = result.get("errors", [])
        source = result.get("source", "none")

        if errors:
            persist_dns_errors(db, errors)
            logger.info(f"Persisted {len(errors)} DNS error events (source={source})")
        else:
            if _collection_count % 10 == 0:
                logger.debug(f"No DNS errors detected this cycle (source={source})")

        # Cleanup old events every 60 cycles (~1 hour)
        _collection_count += 1
        if _collection_count % 60 == 0:
            cleanup_old_events(db, retention_hours=24)

    except Exception as e:
        logger.exception(f"DNS error collection failed: {e}")
        db.rollback()
    finally:
        db.close()
