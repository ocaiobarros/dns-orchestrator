"""
DNS Control v2 — Reconciliation Worker
Detects failed instances and manages DNAT backend rotation.
Uses deploy lock to prevent conflicts with deploy/rollback operations.
"""

import logging
from app.core.database import SessionLocal
from app.services.decision_service import reconcile
from app.services.deploy_lock import deploy_lock

logger = logging.getLogger("dns-control.worker.reconciliation")


def reconciliation_job():
    """Reconcile DNAT rotation based on instance health. Called every 10 seconds."""
    try:
        with deploy_lock("reconciliation", timeout=5):
            db = SessionLocal()
            try:
                reconcile(db)
            except Exception as e:
                logger.exception(f"Reconciliation worker error: {e}")
                db.rollback()
            finally:
                db.close()
    except RuntimeError:
        # Lock held by deploy/rollback — skip this cycle silently
        logger.debug("Reconciliation skipped — deploy lock held by another operation")
