"""
DNS Control — Policy Plane (POL-1) read-only API.

All endpoints are GET and viewer-accessible (observability). NO mutating
endpoints in POL-1; CRUD lands in POL-2/POL-3 (admin-only).
"""

import json
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user
from app.models.user import User
from app.models.policy import PolicyRule, PolicyView, PolicyFeedSource, PolicyTenant

router = APIRouter()


def _rule_to_dict(r: PolicyRule) -> dict:
    return {
        "id": r.id,
        "scope_view": r.scope_view,
        "kind": r.kind,
        "target": r.target,
        "action": r.action,
        "payload": json.loads(r.payload_json) if r.payload_json else None,
        "source": r.source,
        "source_ref": r.source_ref,
        "layer": r.layer,
        "enabled": bool(r.enabled),
        "created_by": r.created_by,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _view_to_dict(v: PolicyView) -> dict:
    try:
        cidrs = json.loads(v.cidrs_json or "[]")
    except Exception:
        cidrs = []
    return {
        "id": v.id,
        "tenant_id": v.tenant_id,
        "name": v.name,
        "cidrs": cidrs,
        "is_default": bool(v.is_default),
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


def _feed_to_dict(f: PolicyFeedSource) -> dict:
    # SECURITY: `auth_header` is a feed credential (Bearer/Basic token) and
    # MUST NEVER be serialized to viewer-accessible read endpoints. We expose
    # only `has_auth: bool` so the UI can show "auth configured" without
    # leaking the value. Any future field added here MUST be reviewed for
    # secret-leak risk; the redaction is asserted by test_policy_plane.py.
    return {
        "id": f.id,
        "name": f.name,
        "kind": f.kind,
        "url": f.url,
        "has_auth": bool(f.auth_header),  # presence flag, NEVER the value
        "integrity": f.integrity,
        "cadence_sec": f.cadence_sec,
        "enabled": bool(f.enabled),
        "is_judicial": bool(f.is_judicial),
        "last_version": f.last_version,
        "last_status": f.last_status,
        "last_sync_at": f.last_sync_at.isoformat() if f.last_sync_at else None,
        "created_at": f.created_at.isoformat() if f.created_at else None,
    }


@router.get("/rules")
def list_rules(
    layer: int | None = Query(None, description="Filter by layer (100/200/300/400/999)"),
    scope_view: str | None = Query(None, description="View id; 'global' for NULL scope"),
    enabled_only: bool = Query(False),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = db.query(PolicyRule)
    if layer is not None:
        q = q.filter(PolicyRule.layer == layer)
    if scope_view == "global":
        q = q.filter(PolicyRule.scope_view.is_(None))
    elif scope_view:
        q = q.filter(PolicyRule.scope_view == scope_view)
    if enabled_only:
        q = q.filter(PolicyRule.enabled.is_(True))
    rows = q.order_by(PolicyRule.layer.asc(), PolicyRule.target.asc()).limit(limit).all()
    return {"items": [_rule_to_dict(r) for r in rows], "total": len(rows)}


@router.get("/views")
def list_views(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(PolicyView).order_by(PolicyView.name.asc()).all()
    return {"items": [_view_to_dict(v) for v in rows], "total": len(rows)}


@router.get("/tenants")
def list_tenants(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(PolicyTenant).order_by(PolicyTenant.name.asc()).all()
    return {
        "items": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in rows
        ],
        "total": len(rows),
    }


@router.get("/feed-sources")
def list_feed_sources(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rows = db.query(PolicyFeedSource).order_by(PolicyFeedSource.name.asc()).all()
    return {"items": [_feed_to_dict(f) for f in rows], "total": len(rows)}


@router.get("/summary")
def policy_summary(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    rules = db.query(PolicyRule).all()
    by_layer: dict[int, int] = {}
    by_scope = {"global": 0, "view": 0}
    enabled = 0
    for r in rules:
        by_layer[r.layer] = by_layer.get(r.layer, 0) + 1
        if r.scope_view is None:
            by_scope["global"] += 1
        else:
            by_scope["view"] += 1
        if r.enabled:
            enabled += 1
    return {
        "total_rules": len(rules),
        "enabled_rules": enabled,
        "by_layer": by_layer,
        "by_scope": by_scope,
        "tenants": db.query(PolicyTenant).count(),
        "views": db.query(PolicyView).count(),
        "feed_sources": db.query(PolicyFeedSource).count(),
        "layers_legend": {
            "100": "AnaBlock judicial (não-sobreponível)",
            "200": "Bloqueio nativo do operador",
            "300": "Feeds de reputação",
            "400": "Allowlist / exceção (não sobrepõe layer 100)",
            "999": "Resolução padrão",
        },
    }
