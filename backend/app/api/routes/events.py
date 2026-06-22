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


# POL-5 — categorias da trilha de auditoria de política.
# Mapeia um "category" amigável (mutation / apply / judicial_rejected) para os
# event_type emitidos pelo backend. Mantemos a lista explícita para evitar que
# eventos não-política vazem para a aba quando alguém adicionar um event_type
# novo no futuro.
_POLICY_EVENT_TYPES_BY_CATEGORY = {
    "mutation": (
        "policy.rule.created",
        "policy.rule.updated",
        "policy.rule.deleted",
    ),
    "apply": (
        "policy.applied",
        "policy.apply_failed",
    ),
    "judicial_rejected": (
        "policy.allow_exception.rejected",
    ),
}


@router.get("")
def list_events(
    severity: str | None = Query(None),
    event_type: str | None = Query(None),
    event_type_prefix: str | None = Query(None, description="Filtra por prefixo (ex.: 'policy.')"),
    instance_id: str | None = Query(None),
    since: str | None = Query(None, description="ISO datetime; eventos a partir de"),
    until: str | None = Query(None, description="ISO datetime; eventos até"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return get_events(
        db,
        severity=severity,
        event_type=event_type,
        event_type_prefix=event_type_prefix,
        instance_id=instance_id,
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )


@router.get("/policy")
def list_policy_events(
    category: str | None = Query(
        None,
        description="mutation | apply | judicial_rejected (default: todos os policy.*)",
    ),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),  # POL-5: viewer-ok (auditoria é transparência).
):
    """POL-5 — Trilha de auditoria de política, read-only.

    Filtra a tabela `events` aos event_type de política emitidos pelo plano POL
    (rule.created/updated/deleted, applied/apply_failed, allow_exception.rejected).
    Sem mutação, sem impacto na resolução — só lê.
    """
    if category is not None and category not in _POLICY_EVENT_TYPES_BY_CATEGORY:
        raise HTTPException(
            400,
            f"category inválida — use uma de: {sorted(_POLICY_EVENT_TYPES_BY_CATEGORY)}",
        )

    if category:
        types = _POLICY_EVENT_TYPES_BY_CATEGORY[category]
        q = db.query(OperationalEvent).filter(OperationalEvent.event_type.in_(types))
        # Reusamos `get_events` apenas quando não há filtro `in_` — aqui aplicamos
        # since/until inline para manter um único caminho de query.
        from app.services.event_service import _parse_dt  # local: evita re-export.
        dt_since = _parse_dt(since)
        if dt_since is not None:
            q = q.filter(OperationalEvent.created_at >= dt_since)
        dt_until = _parse_dt(until)
        if dt_until is not None:
            q = q.filter(OperationalEvent.created_at <= dt_until)
        q = q.order_by(OperationalEvent.created_at.desc())
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

    # Sem categoria: tudo que começa com "policy.".
    return get_events(
        db,
        event_type_prefix="policy.",
        since=since,
        until=until,
        limit=limit,
        offset=offset,
    )


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
