"""
DNS Control — History Routes
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.apply_job import ApplyJob

router = APIRouter()


@router.get("")
def list_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=5, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    total = db.query(ApplyJob).count()
    jobs = db.query(ApplyJob).order_by(ApplyJob.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "items": [
            {
                "id": j.id, "profile_id": j.profile_id, "job_type": j.job_type,
                "status": j.status, "exit_code": j.exit_code,
                "created_by": j.created_by,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "finished_at": j.finished_at.isoformat() if j.finished_at else None,
            }
            for j in jobs
        ],
        "total": total, "page": page, "page_size": page_size,
        "has_more": (page * page_size) < total,
    }
