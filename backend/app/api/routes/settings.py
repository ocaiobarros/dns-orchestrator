"""
DNS Control — Settings Routes
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.log_entry import Setting
from app.schemas.common import UpdateSettingsRequest

router = APIRouter()


@router.get("")
def get_settings(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    items = db.query(Setting).all()
    return {s.key: s.value for s in items}


@router.patch("")
def update_settings(body: UpdateSettingsRequest, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    for key, value in body.settings.items():
        existing = db.query(Setting).filter(Setting.key == key).first()
        if existing:
            existing.value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()
    return {"success": True}
