"""
DNS Control — Policy Plane service (POL-2b).

Bridges the DB-stored policy rules to the pure generator
(`policy_d_generator`) and offers two narrow capabilities used by the
policy.py route:

  * collect_policy_artifacts(db) — build the file dicts that must be merged
    into a deploy payload so the existing pipeline (config_service →
    deploy_service: staging → unbound-checkconf → swap → reload → rollback)
    writes them atomically.
  * inject_policy_artifacts(payload, db) — attach those file dicts to the
    payload under `_policyArtifacts`, where config_service.generate_preview
    picks them up additively. Keeps generators DB-free and the deploy
    contract unchanged.

There is NO new pipeline. The "apply policy" endpoint simply calls
execute_deploy() with scope='dns' on the operator's chosen profile after
injecting the policy artifacts. unbound-checkconf failure → rollback,
exactly like any other config change.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.generators.policy_d_generator import generate_policy_d_files
from app.models.policy import PolicyRule


def _collect_rules(db: Session) -> tuple[list[dict], list[str]]:
    operator_rows = db.query(PolicyRule).filter(
        PolicyRule.kind == "block_name",
        PolicyRule.source == "operator",
        PolicyRule.layer == 200,
        PolicyRule.enabled.is_(True),
    ).all()
    judicial_rows = db.query(PolicyRule).filter(
        PolicyRule.layer == 100,
        PolicyRule.enabled.is_(True),
    ).all()
    operator = [{
        "id": r.id,
        "target": r.target,
        "action": r.action,
        "enabled": bool(r.enabled),
        "scope_view": r.scope_view,
    } for r in operator_rows]
    judicial = [r.target for r in judicial_rows]
    return operator, judicial


def collect_policy_artifacts(db: Session) -> tuple[list[dict], list[dict]]:
    """Return (files, omitted) — files for the deploy payload + audit trail."""
    operator, judicial = _collect_rules(db)
    return generate_policy_d_files(operator, judicial)


def inject_policy_artifacts(payload: dict[str, Any], db: Session) -> list[dict]:
    """Mutates `payload` adding `_policyArtifacts`; returns omitted entries."""
    files, omitted = collect_policy_artifacts(db)
    payload["_policyArtifacts"] = files
    return omitted
