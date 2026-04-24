"""
DNS Control v2 — Health API Routes
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.operational import DnsInstance
from app.services.health_service import (
    get_all_instance_states, get_recent_health_checks,
    run_health_checks_for_instance,
)

logger = logging.getLogger("dns-control.health-v2")
router = APIRouter()


@router.get("/instances")
def list_instance_health(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Return per-instance state. Never raises 500: on engine failure returns empty list with error flag."""
    try:
        return get_all_instance_states(db)
    except Exception as e:
        logger.exception("get_all_instance_states failed; returning empty list")
        return JSONResponse(
            status_code=200,
            content=[],
            headers={"X-Engine-Error": str(e)[:120]},
        )


@router.get("/instances/{instance_id}")
def get_instance_health(instance_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    instance = db.query(DnsInstance).filter(DnsInstance.id == instance_id).first()
    if not instance:
        raise HTTPException(404, "Instance not found")
    states = get_all_instance_states(db)
    for s in states:
        if s["id"] == instance_id:
            return s
    raise HTTPException(404, "State not found")


@router.get("/checks")
def list_health_checks(
    instance_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_recent_health_checks(db, instance_id=instance_id, limit=limit)


@router.post("/run/{instance_id}")
def run_health_check_now(instance_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    instance = db.query(DnsInstance).filter(DnsInstance.id == instance_id).first()
    if not instance:
        raise HTTPException(404, "Instance not found")
    result = run_health_checks_for_instance(db, instance)
    return result
