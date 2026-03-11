"""
DNS Control — Logs Routes
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.log_entry import LogEntry

router = APIRouter()


@router.get("")
def list_logs(
    source: str | None = None,
    level: str | None = None,
    search: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = db.query(LogEntry)
    if source:
        query = query.filter(LogEntry.source == source)
    if level:
        query = query.filter(LogEntry.level == level)
    if search:
        query = query.filter(LogEntry.message.ilike(f"%{search}%"))

    total = query.count()
    items = query.order_by(LogEntry.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": [
            {
                "id": e.id, "source": e.source, "level": e.level,
                "message": e.message, "context_json": e.context_json,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in items
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total,
    }


@router.get("/export")
def export_logs(source: str | None = None, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    query = db.query(LogEntry)
    if source:
        query = query.filter(LogEntry.source == source)
    items = query.order_by(LogEntry.created_at.desc()).limit(10000).all()
    lines = [f"{e.created_at} [{e.level}] [{e.source}] {e.message}" for e in items]
    return {"content": "\n".join(lines), "count": len(lines)}
