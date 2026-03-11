"""
DNS Control v2 — Event Service
Query and manage operational events.
"""

from sqlalchemy.orm import Session
from app.models.operational import OperationalEvent, OperationalAction


def get_events(
    db: Session,
    severity: str | None = None,
    event_type: str | None = None,
    instance_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    q = db.query(OperationalEvent).order_by(OperationalEvent.created_at.desc())
    if severity:
        q = q.filter(OperationalEvent.severity == severity)
    if event_type:
        q = q.filter(OperationalEvent.event_type == event_type)
    if instance_id:
        q = q.filter(OperationalEvent.instance_id == instance_id)

    total = q.count()
    events = q.offset(offset).limit(limit).all()

    return {
        "items": [
            {
                "id": e.id,
                "event_type": e.event_type,
                "severity": e.severity,
                "instance_id": e.instance_id,
                "message": e.message,
                "details_json": e.details_json,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ],
        "total": total,
    }


def get_actions(db: Session, limit: int = 50) -> list[dict]:
    actions = db.query(OperationalAction).order_by(OperationalAction.created_at.desc()).limit(limit).all()
    return [
        {
            "id": a.id,
            "action_type": a.action_type,
            "target_type": a.target_type,
            "target_id": a.target_id,
            "status": a.status,
            "exit_code": a.exit_code,
            "trigger_source": a.trigger_source,
            "stdout_log": a.stdout_log,
            "stderr_log": a.stderr_log,
            "created_at": a.created_at.isoformat(),
            "finished_at": a.finished_at.isoformat() if a.finished_at else None,
        }
        for a in actions
    ]
