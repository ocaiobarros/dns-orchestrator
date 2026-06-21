"""
DNS Control — Policy Plane API.

POL-1: read-only GETs (viewer-accessible).
POL-2a: operator block CRUD (layer=200, kind=block_name, source=operator),
        admin-only, audited via OperationalEvent. NO policy.d generation,
        NO Unbound include, NO apply — rules exist in DB only.

Mutations in POL-2a are restricted to operator block rules. Judicial (layer
100), feeds (layer 300), allow_exception (layer 400) are out of scope here.
"""

import json
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.api.deps import get_current_user, require_admin
from app.models.user import User
from app.models.policy import PolicyRule, PolicyView, PolicyFeedSource, PolicyTenant
from app.models.operational import OperationalEvent

router = APIRouter()


# Audit helper — emits an operational_event for every policy mutation.
# Reuses the existing events mechanism (no new subsystem; see DESIGN §7).
def _emit_policy_event(db: Session, event_type: str, actor: User, rule: PolicyRule, extra: dict | None = None) -> None:
    payload = {
        "rule_id": rule.id,
        "kind": rule.kind,
        "target": rule.target,
        "action": rule.action,
        "layer": rule.layer,
        "scope_view": rule.scope_view,
        "source": rule.source,
        "enabled": bool(rule.enabled),
        "actor_id": actor.id,
        "actor_username": actor.username,
    }
    if extra:
        payload["change"] = extra
    db.add(OperationalEvent(
        event_type=event_type,
        severity="info",
        instance_id=None,
        message=(
            f"policy[{rule.layer}] {event_type.split('.')[-1]} target='{rule.target}' "
            f"action='{rule.action}' scope={rule.scope_view or 'global'} by {actor.username}"
        ),
        details_json=json.dumps(payload, sort_keys=True),
    ))


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


# ===========================================================================
# POL-2a — Operator block CRUD (kind=block_name, layer=200, source=operator)
# Admin-only. Audited. NO policy.d generation, NO Unbound include, NO apply.
# ===========================================================================

# Allow-listed actions for operator block rules (NXDOMAIN / REFUSED only —
# redirect_* will land in POL-2b together with payload validation).
_OPERATOR_BLOCK_ACTIONS = {"always_nxdomain", "always_refuse"}


class CreateBlockRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=253, description="FQDN to block")
    action: str = Field("always_nxdomain", description="always_nxdomain | always_refuse")
    enabled: bool = True
    scope_view: str | None = Field(None, description="View id; null = global (MVP default)")


class UpdateBlockRequest(BaseModel):
    enabled: bool | None = None
    action: str | None = None


def _normalize_target(t: str) -> str:
    return (t or "").strip().lower().rstrip(".")


def _ensure_operator_block(rule: PolicyRule) -> None:
    """Reject mutations on anything other than operator block (POL-2a scope)."""
    if rule.layer != 200 or rule.kind != "block_name" or rule.source != "operator":
        raise HTTPException(
            status_code=403,
            detail="Esta rota só edita regras de bloqueio do operador (layer=200, kind=block_name).",
        )


@router.post("/rules/block", status_code=201)
def create_block_rule(
    body: CreateBlockRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    target = _normalize_target(body.target)
    if not target:
        raise HTTPException(422, "target é obrigatório")
    if body.action not in _OPERATOR_BLOCK_ACTIONS:
        raise HTTPException(422, f"action inválida; permitidas: {sorted(_OPERATOR_BLOCK_ACTIONS)}")
    if body.scope_view is not None:
        # Multi-view não está ativo no MVP (POL-6). Recusamos por segurança.
        if not db.query(PolicyView).filter(PolicyView.id == body.scope_view).first():
            raise HTTPException(422, "scope_view desconhecido")

    # Explicit duplicate check — SQLite treats NULL scope_view as distinct in
    # UNIQUE, so the schema-level UQ does not fire on global rules. Belt-and-
    # suspenders: check then INSERT.
    dup_q = db.query(PolicyRule).filter(
        PolicyRule.kind == "block_name",
        PolicyRule.source == "operator",
        PolicyRule.target == target,
    )
    dup_q = dup_q.filter(PolicyRule.scope_view.is_(None)) if body.scope_view is None \
        else dup_q.filter(PolicyRule.scope_view == body.scope_view)
    if dup_q.first():
        raise HTTPException(409, "Regra já existe para este alvo neste escopo")

    rule = PolicyRule(
        scope_view=body.scope_view,
        kind="block_name",
        target=target,
        action=body.action,
        source="operator",
        layer=200,
        enabled=bool(body.enabled),
        created_by=user.id,
    )
    db.add(rule)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        msg = str(getattr(exc, "orig", exc))
        if "uq_policy_rules" in msg or "UNIQUE" in msg.upper():
            raise HTTPException(409, "Regra já existe para este alvo neste escopo")
        raise HTTPException(422, f"Violação de constraint: {msg}")
    _emit_policy_event(db, "policy.rule.created", user, rule)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.patch("/rules/{rule_id}")
def update_block_rule(
    rule_id: str,
    body: UpdateBlockRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rule = db.query(PolicyRule).filter(PolicyRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Regra não encontrada")
    _ensure_operator_block(rule)

    change: dict = {}
    if body.enabled is not None and bool(body.enabled) != bool(rule.enabled):
        change["enabled"] = {"from": bool(rule.enabled), "to": bool(body.enabled)}
        rule.enabled = bool(body.enabled)
    if body.action is not None and body.action != rule.action:
        if body.action not in _OPERATOR_BLOCK_ACTIONS:
            raise HTTPException(422, f"action inválida; permitidas: {sorted(_OPERATOR_BLOCK_ACTIONS)}")
        change["action"] = {"from": rule.action, "to": body.action}
        rule.action = body.action

    if not change:
        return _rule_to_dict(rule)  # idempotent no-op, no audit noise

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(422, f"Violação de constraint: {exc.orig}")
    _emit_policy_event(db, "policy.rule.updated", user, rule, extra=change)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_block_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rule = db.query(PolicyRule).filter(PolicyRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Regra não encontrada")
    _ensure_operator_block(rule)
    _emit_policy_event(db, "policy.rule.deleted", user, rule)
    db.delete(rule)
    db.commit()
    return None
