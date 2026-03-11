"""
DNS Control v2 — Actions API Routes
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.services.event_service import get_actions
from app.services.decision_service import manual_remove_backend, manual_restore_backend
from app.core.logging import log_event

router = APIRouter()


@router.get("")
def list_actions(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return get_actions(db)


@router.post("/remove-backend/{instance_id}")
def remove_backend(instance_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = manual_remove_backend(db, instance_id)
    if not result["success"]:
        raise HTTPException(400, result["error"])
    log_event(db, "system", "warning", f"Backend {result['instance']} manually removed by {user.username}")
    return result


@router.post("/restore-backend/{instance_id}")
def restore_backend(instance_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    result = manual_restore_backend(db, instance_id)
    if not result["success"]:
        raise HTTPException(400, result["error"])
    log_event(db, "system", "info", f"Backend {result['instance']} manually restored by {user.username}")
    return result
