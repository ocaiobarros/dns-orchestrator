"""
DNS Control v2.1 — Actions API Routes
Includes manual reconciliation endpoint.
Implements no-op reconciliation throttling to reduce event noise.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.event_service import get_actions
from app.services.decision_service import manual_remove_backend, manual_restore_backend, reconcile
from app.services.health_service import run_health_checks_for_instance
from app.services.service_mode import require_managed_mode
from app.models.operational import DnsInstance
from app.core.logging import log_event

router = APIRouter()


@router.get("")
def list_actions(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return get_actions(db)


@router.post("/remove-backend/{instance_id}")
def remove_backend(instance_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_managed_mode(db)
    result = manual_remove_backend(db, instance_id)
    if not result["success"]:
        raise HTTPException(400, result["error"])
    log_event(db, "system", "warning", f"Backend {result['instance']} manually removed by {user.username}")
    return result


@router.post("/restore-backend/{instance_id}")
def restore_backend(instance_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_managed_mode(db)
    result = manual_restore_backend(db, instance_id)
    if not result["success"]:
        raise HTTPException(400, result["error"])
    log_event(db, "system", "info", f"Backend {result['instance']} manually restored by {user.username}")
    return result


@router.post("/reconcile-now")
def reconcile_now(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    require_managed_mode(db)
    """
    Manual reconciliation: run health checks immediately for all instances,
    then run the reconciliation engine.

    No-op reconciliations (checked=0, failed=0, removed=0, restored=0) are
    logged at DEBUG level only to avoid spamming the event feed.
    """
    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()

    # Run health checks for all instances
    for inst in instances:
        try:
            run_health_checks_for_instance(db, inst)
        except Exception:
            pass

    # Run reconciliation
    summary = reconcile(db)

    # Only log meaningful reconciliation events
    is_noop = (
        summary.get("instances_checked", 0) == 0
        and summary.get("instances_failed", 0) == 0
        and summary.get("backends_removed", 0) == 0
        and summary.get("backends_restored", 0) == 0
    )

    if is_noop:
        # No-op: don't spam the event log, use debug level
        import logging
        logging.getLogger("dns-control").debug(
            f"No-op reconciliation by {user.username} (no instances configured)"
        )
    else:
        # Meaningful reconciliation: log appropriately
        had_changes = summary.get("backends_removed", 0) > 0 or summary.get("backends_restored", 0) > 0
        level = "warning" if summary.get("instances_failed", 0) > 0 else "info"

        log_event(db, "system", level,
                  f"Manual reconciliation by {user.username}: "
                  f"checked={summary['instances_checked']}, failed={summary['instances_failed']}, "
                  f"removed={summary['backends_removed']}, restored={summary['backends_restored']}")

    return summary
