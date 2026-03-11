"""
DNS Control v2 — Reconciliation Worker
Detects failed instances and manages DNAT backend rotation.
"""

import logging
from app.core.database import SessionLocal
from app.services.decision_service import reconcile

logger = logging.getLogger("dns-control.worker.reconciliation")


def reconciliation_job():
    """Reconcile DNAT rotation based on instance health. Called every 10 seconds."""
    db = SessionLocal()
    try:
        reconcile(db)
    except Exception as e:
        logger.exception(f"Reconciliation worker error: {e}")
        db.rollback()
    finally:
        db.close()
