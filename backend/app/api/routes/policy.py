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


# ===========================================================================
# POL-3a — allow_exception CRUD (kind=allow_exception, layer=400, source=operator)
# Admin-only. Audited. NO policy.d generation / NO impact on resolution
# (that's POL-3b). Judicial precedence enforcement on creation: if a
# judicial rule (layer=100) covers the target by equality OR suffix, the
# request is REJECTED and the attempt is recorded as
# policy.allow_exception.rejected for compliance traceability.
#
# HONEST LIMITATION (must be documented in code AND UI):
# This validator only catches collisions with judicial rules KNOWN IN THE
# DB (layer 100). Today there is no anablock_mirror, so judicial domains
# downloaded at runtime into /etc/unbound/anablock.conf are NOT in the DB
# — the validator cannot see them. The DEFINITIVE protection at resolution
# time is the include order (anablock.conf included AFTER policy.d, so
# Unbound's last-wins gives judicial precedence). Until POL-4 lands the
# mirror, the DB validator is best-effort first-line; include-order is
# the always-on backstop. Do NOT advertise "operator cannot allowlist
# judicial" without this caveat.
# ===========================================================================

class CreateAllowExceptionRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=253, description="FQDN to whitelist")
    note: str | None = Field(None, max_length=500, description="Optional human note for audit")
    enabled: bool = True
    scope_view: str | None = Field(None, description="View id; null = global (MVP default)")


class UpdateAllowExceptionRequest(BaseModel):
    enabled: bool | None = None
    note: str | None = None


def _ensure_operator_allow_exception(rule: PolicyRule) -> None:
    """Reject mutations on anything other than operator-owned allow_exception."""
    if rule.layer != 400 or rule.kind != "allow_exception" or rule.source != "operator":
        raise HTTPException(
            status_code=403,
            detail="Esta rota só edita allow_exception do operador (layer=400, kind=allow_exception).",
        )


def _find_judicial_collision(db: Session, target: str, scope_view: str | None) -> PolicyRule | None:
    """Return the first enabled layer-100 rule that covers `target` (equal or suffix), else None."""
    norm = _normalize_target(target)
    q = db.query(PolicyRule).filter(
        PolicyRule.layer == 100,
        PolicyRule.enabled.is_(True),
    )
    q = q.filter(PolicyRule.scope_view.is_(None)) if scope_view is None \
        else q.filter(PolicyRule.scope_view == scope_view)
    for jud in q.all():
        jt = _normalize_target(jud.target or "")
        if not jt:
            continue
        if norm == jt or norm.endswith("." + jt):
            return jud
    return None


def _emit_rejected_allow_exception(
    db: Session, actor: User, target: str, scope_view: str | None, judicial: PolicyRule
) -> None:
    """Compliance audit: 'tentou furar ordem judicial'."""
    db.add(OperationalEvent(
        event_type="policy.allow_exception.rejected",
        severity="warning",
        instance_id=None,
        message=(
            f"allow_exception target='{target}' rejeitada — coberta por judicial "
            f"'{judicial.target}' (layer 100) — actor={actor.username}"
        ),
        details_json=json.dumps({
            "actor_id": actor.id,
            "actor_username": actor.username,
            "attempted_target": target,
            "scope_view": scope_view,
            "judicial_rule_id": judicial.id,
            "judicial_target": judicial.target,
            "reason": "judicial_precedence",
        }, sort_keys=True),
    ))
    # Commit immediately so the rejection trail survives even if the request
    # raises further — auditing the attempt is the whole point of this event.
    db.commit()


@router.post("/rules/allow", status_code=201)
def create_allow_exception(
    body: CreateAllowExceptionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    target = _normalize_target(body.target)
    if not target:
        raise HTTPException(422, "target é obrigatório")
    if body.scope_view is not None:
        if not db.query(PolicyView).filter(PolicyView.id == body.scope_view).first():
            raise HTTPException(422, "scope_view desconhecido")

    # Judicial precedence — first-line enforcement (DB-known judicial only).
    # The runtime-synced anablock.conf set is the backstop via include-order.
    jud = _find_judicial_collision(db, target, body.scope_view)
    if jud is not None:
        _emit_rejected_allow_exception(db, user, target, body.scope_view, jud)
        raise HTTPException(
            status_code=409,
            detail=(
                f"allow_exception '{target}' colide com regra judicial "
                f"'{jud.target}' (layer 100). Judicial não é sobreponível."
            ),
        )

    # Duplicate guard (NULL scope_view → SQLite UQ won't fire; pre-check).
    dup_q = db.query(PolicyRule).filter(
        PolicyRule.kind == "allow_exception",
        PolicyRule.source == "operator",
        PolicyRule.target == target,
    )
    dup_q = dup_q.filter(PolicyRule.scope_view.is_(None)) if body.scope_view is None \
        else dup_q.filter(PolicyRule.scope_view == body.scope_view)
    if dup_q.first():
        raise HTTPException(409, "allow_exception já existe para este alvo neste escopo")

    payload_json = json.dumps({"note": body.note}, sort_keys=True) if body.note else None
    rule = PolicyRule(
        scope_view=body.scope_view,
        kind="allow_exception",
        target=target,
        action="allow",
        payload_json=payload_json,
        source="operator",
        layer=400,
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
            raise HTTPException(409, "allow_exception já existe para este alvo neste escopo")
        raise HTTPException(422, f"Violação de constraint: {msg}")
    _emit_policy_event(db, "policy.rule.created", user, rule)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.patch("/rules/allow/{rule_id}")
def update_allow_exception(
    rule_id: str,
    body: UpdateAllowExceptionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rule = db.query(PolicyRule).filter(PolicyRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Regra não encontrada")
    _ensure_operator_allow_exception(rule)

    change: dict = {}
    if body.enabled is not None and bool(body.enabled) != bool(rule.enabled):
        change["enabled"] = {"from": bool(rule.enabled), "to": bool(body.enabled)}
        rule.enabled = bool(body.enabled)
    if body.note is not None:
        new_payload = json.dumps({"note": body.note}, sort_keys=True) if body.note else None
        if new_payload != rule.payload_json:
            change["note"] = {"from": rule.payload_json, "to": new_payload}
            rule.payload_json = new_payload

    if not change:
        return _rule_to_dict(rule)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(422, f"Violação de constraint: {exc.orig}")
    _emit_policy_event(db, "policy.rule.updated", user, rule, extra=change)
    db.commit()
    db.refresh(rule)
    return _rule_to_dict(rule)


@router.delete("/rules/allow/{rule_id}", status_code=204)
def delete_allow_exception(
    rule_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    rule = db.query(PolicyRule).filter(PolicyRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Regra não encontrada")
    _ensure_operator_allow_exception(rule)
    _emit_policy_event(db, "policy.rule.deleted", user, rule)
    db.delete(rule)
    db.commit()
    return None





# ===========================================================================
# POL-2b — Policy plane apply
#
# Materializes layer-200 (operator) blocks into /etc/unbound/policy.d/ and
# pushes the change through the EXISTING deploy pipeline (no new pipeline,
# no new install path). The pipeline already runs unbound-checkconf on
# staged files; failure aborts the swap and rolls back automatically.
#
# Judicial precedence is guaranteed by TWO independent mechanisms (see
# policy_d_generator docstring): (a) generation-time dedup against DB layer
# 100, and (b) Unbound's last-wins local-zone resolution combined with the
# include order policy.d/* → anablock.conf in unbound_generator.py.
# ===========================================================================

from app.models.config_profile import ConfigProfile
import app.models.config_revision  # noqa: F401 — register FK target for ApplyJob
from app.models.apply_job import ApplyJob
from app.services.policy_service import collect_policy_artifacts
from app.services.deploy_service import execute_deploy
from app.services.service_mode import require_managed_mode
from datetime import datetime, timezone


class PolicyApplyRequest(BaseModel):
    profile_id: str = Field(..., description="ConfigProfile to apply against")
    dry_run: bool = Field(False, description="Preview-only — checkconf without swap")


@router.get("/preview")
def policy_preview(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """Generated policy.d content + judicial omissions, no disk writes."""
    files, omitted = collect_policy_artifacts(db)
    return {
        "files": files,
        "omitted": omitted,
        "judicial_precedence_note": (
            "Operator rules whose target equals or is a sub-domain of a "
            "layer-100 (judicial) rule are dropped at generation. "
            "Independently, anablock.conf is included AFTER policy.d so "
            "Unbound's last-wins resolves duplicates in judicial's favor."
        ),
    }


@router.post("/apply")
def policy_apply(
    body: PolicyApplyRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """
    Apply via existing deploy pipeline (staging → checkconf → swap → reload).
    On checkconf failure, deploy_service performs rollback automatically.
    """
    require_managed_mode(db)
    profile = db.query(ConfigProfile).filter(ConfigProfile.id == body.profile_id).first()
    if not profile:
        raise HTTPException(404, "Perfil não encontrado")

    payload = json.loads(profile.payload_json)
    files, omitted = collect_policy_artifacts(db)
    # Additive merge — generators stay DB-free; deploy pipeline unchanged.
    payload["_policyArtifacts"] = files

    job = ApplyJob(
        profile_id=profile.id,
        job_type="policy" if not body.dry_run else "policy-dry-run",
        status="running",
        started_at=datetime.now(timezone.utc),
        created_by=user.username,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    result = execute_deploy(payload, scope="dns", dry_run=body.dry_run, operator=user.username)

    job.status = "success" if result.get("success") else "failed"
    job.finished_at = datetime.now(timezone.utc)
    job.stdout_log = result.get("stdout", "") or ""
    job.stderr_log = result.get("stderr", "") or ""
    job.exit_code = result.get("exit_code", 0) or 0
    db.commit()

    # Audit the apply itself (separate from per-rule mutation events).
    db.add(OperationalEvent(
        event_type="policy.applied" if result.get("success") else "policy.apply_failed",
        severity="info" if result.get("success") else "warning",
        instance_id=None,
        message=(
            f"policy apply scope=dns dry_run={body.dry_run} "
            f"status={job.status} omitted_judicial={len(omitted)} by {user.username}"
        ),
        details_json=json.dumps({
            "job_id": job.id,
            "profile_id": profile.id,
            "dry_run": body.dry_run,
            "omitted": omitted,
            "actor_username": user.username,
        }, sort_keys=True),
    ))
    db.commit()

    return {
        "id": job.id,
        "status": job.status,
        "job_type": job.job_type,
        "dry_run": body.dry_run,
        "omitted": omitted,
        "steps": result.get("steps", []),
        "error": result.get("error"),
        "started_at": job.started_at.isoformat(),
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }

