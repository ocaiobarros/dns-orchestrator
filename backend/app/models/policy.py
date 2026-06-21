"""
DNS Control — Policy Plane (POL-1)

Foundation schema for the native policy plane, per
docs/design/2026-06_policy-plane-foundation.md §2.

Tables (purely additive — no existing table is altered):
  - policy_tenants
  - policy_views          (carries scope; MVP runs everything global = scope_view IS NULL)
  - policy_rules          (unifies block_name / override_data / allow_exception / feed_rule)
  - policy_feed_sources

Schema-level guard for the legal landmine
("allow_exception NEVER overrides judicial layer 100"):
  CHECK (layer IN (100, 200, 300, 400, 999))
  CHECK ((kind = 'allow_exception') = (layer = 400))
  CHECK (kind <> 'allow_exception' OR source <> 'anablock_mirror')

Cross-row check (no allow_exception with same target as an existing layer=100
rule) is enforced by `validate_allow_exception_target()` and will be wired into
future mutating routes (POL-3). POL-1 ships read-only endpoints only.
"""

import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column, String, Integer, Boolean, DateTime, Text,
    ForeignKey, CheckConstraint, UniqueConstraint, Index,
)
from sqlalchemy.orm import Session

from app.core.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# Allowed values (mirrored by FE types; see src/lib/types.ts PolicyRule)
POLICY_KINDS = ("block_name", "override_data", "allow_exception", "feed_rule")
POLICY_ACTIONS = (
    "always_nxdomain", "always_refuse", "always_transparent",
    "redirect_cname", "redirect_ip", "static_data", "noop",
)
POLICY_SOURCES = ("operator", "feed", "anablock_mirror")
POLICY_LAYERS = (100, 200, 300, 400, 999)
FEED_KINDS = ("domain_blocklist", "ip_blocklist", "reputation")
FEED_INTEGRITY = ("sha256_sidecar", "signed_manifest", "none")


class PolicyTenant(Base):
    __tablename__ = "policy_tenants"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)


class PolicyView(Base):
    __tablename__ = "policy_views"

    id = Column(String, primary_key=True, default=_uuid)
    tenant_id = Column(String, ForeignKey("policy_tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(100), nullable=False, unique=True)
    cidrs_json = Column(Text, nullable=False, default="[]")  # JSON list[str] of CIDRs
    is_default = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=_now)


class PolicyRule(Base):
    __tablename__ = "policy_rules"

    id = Column(String, primary_key=True, default=_uuid)
    # scope_view NULL = global (MVP). View-readiness baked in from day 1.
    scope_view = Column(String, ForeignKey("policy_views.id", ondelete="SET NULL"), nullable=True, index=True)
    kind = Column(String(32), nullable=False)
    target = Column(String(255), nullable=False)
    action = Column(String(32), nullable=False)
    payload_json = Column(Text, nullable=True)
    source = Column(String(32), nullable=False, default="operator")
    source_ref = Column(String(255), nullable=True)
    layer = Column(Integer, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    created_by = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)
    updated_at = Column(DateTime, nullable=False, default=_now, onupdate=_now)

    __table_args__ = (
        # Domain values
        CheckConstraint(
            "kind IN ('block_name','override_data','allow_exception','feed_rule')",
            name="ck_policy_rules_kind",
        ),
        CheckConstraint(
            "source IN ('operator','feed','anablock_mirror')",
            name="ck_policy_rules_source",
        ),
        CheckConstraint(
            "layer IN (100,200,300,400,999)",
            name="ck_policy_rules_layer",
        ),
        # Layer 400 is reserved for allow_exception, and vice-versa.
        CheckConstraint(
            "(kind = 'allow_exception') = (layer = 400)",
            name="ck_policy_rules_kind_layer_400",
        ),
        # Layer 100 is reserved for judicial-source rules (future POL-7 mirror).
        # Today, no row should be stored at layer 100 unless source='anablock_mirror'.
        CheckConstraint(
            "(layer = 100) = (source = 'anablock_mirror')",
            name="ck_policy_rules_layer_100_judicial",
        ),
        # An allow_exception can NEVER be a mirror of a judicial rule.
        CheckConstraint(
            "NOT (kind = 'allow_exception' AND source = 'anablock_mirror')",
            name="ck_policy_rules_allow_not_judicial",
        ),
        UniqueConstraint("scope_view", "kind", "target", "source", name="uq_policy_rules_scope_kind_target_source"),
        Index("ix_policy_rules_layer", "layer"),
        Index("ix_policy_rules_target", "target"),
        Index("ix_policy_rules_enabled", "enabled"),
    )


class PolicyFeedSource(Base):
    __tablename__ = "policy_feed_sources"

    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String(100), nullable=False, unique=True)
    kind = Column(String(32), nullable=False)
    url = Column(String(500), nullable=False)
    auth_header = Column(String(500), nullable=True)
    integrity = Column(String(32), nullable=False, default="sha256_sidecar")
    cadence_sec = Column(Integer, nullable=False, default=3600)
    enabled = Column(Boolean, nullable=False, default=True)
    is_judicial = Column(Boolean, nullable=False, default=False)
    last_version = Column(String(120), nullable=True)
    last_status = Column(String(32), nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_now)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('domain_blocklist','ip_blocklist','reputation')",
            name="ck_policy_feed_kind",
        ),
        CheckConstraint(
            "integrity IN ('sha256_sidecar','signed_manifest','none')",
            name="ck_policy_feed_integrity",
        ),
    )


# ---------------------------------------------------------------------------
# Cross-row validator — the "allowlist NEVER overrides judicial" rule.
# Will be invoked by mutating routes (POL-3). Read-only POL-1 just exposes it.
# ---------------------------------------------------------------------------

class PolicyValidationError(ValueError):
    """Raised when a policy rule violates the precedence contract."""


def validate_allow_exception_target(db: Session, target: str, scope_view: str | None) -> None:
    """
    Reject any allow_exception (layer=400) whose target matches an active
    judicial rule (layer=100) in the same scope. Sub-domain coverage is
    enforced by lowercasing + suffix match against existing judicial targets.
    """
    norm = (target or "").strip().lower().rstrip(".")
    if not norm:
        raise PolicyValidationError("target is required")

    q = db.query(PolicyRule).filter(
        PolicyRule.layer == 100,
        PolicyRule.enabled.is_(True),
        PolicyRule.scope_view.is_(None) if scope_view is None else PolicyRule.scope_view == scope_view,
    )
    for jud in q.all():
        jt = (jud.target or "").strip().lower().rstrip(".")
        if not jt:
            continue
        if norm == jt or norm.endswith("." + jt):
            raise PolicyValidationError(
                f"allow_exception '{target}' is covered by judicial rule '{jud.target}' (layer 100) — "
                "judicial blocks are non-overridable"
            )
