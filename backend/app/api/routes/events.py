"""
DNS Control v2 — Events API Routes
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.operational import OperationalEvent
from app.services.event_service import get_events, get_actions

router = APIRouter()


@router.get("")
def list_events(
    severity: str | None = Query(None),
    event_type: str | None = Query(None),
    instance_id: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_events(db, severity=severity, event_type=event_type, instance_id=instance_id, limit=limit, offset=offset)


@router.get("/{event_id}")
def get_event(event_id: str, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    ev = db.query(OperationalEvent).filter(OperationalEvent.id == event_id).first()
    if not ev:
        raise HTTPException(404, "Event not found")
    return {
        "id": ev.id,
        "event_type": ev.event_type,
        "severity": ev.severity,
        "instance_id": ev.instance_id,
        "message": ev.message,
        "details_json": ev.details_json,
        "created_at": ev.created_at.isoformat(),
    }
