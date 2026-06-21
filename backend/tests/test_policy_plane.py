"""
DNS Control — Policy Plane (POL-1) tests.

Covers:
  1. Migration applies and creates the 4 tables (additive).
  2. CHECK constraints reject invalid kind/source/layer.
  3. CHECK constraint enforces "layer 100 ⇔ source='anablock_mirror'".
  4. CHECK constraint enforces "kind='allow_exception' ⇔ layer=400" and
     forbids allow_exception with judicial source.
  5. validate_allow_exception_target() rejects allow_exception that targets
     a domain (or sub-domain) already blocked at layer 100.
  6. Logical rollback (down_pol_1_*) drops the tables and clears the version.
  7. GET endpoints behave correctly empty / with seed.
"""

import os
import json
import tempfile
import unittest
import uuid

os.environ.setdefault("DNS_CONTROL_DB_PATH", tempfile.mktemp(suffix=".sqlite"))

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.db.migrations import (
    _migration_pol_1_policy_plane_foundation,
    down_pol_1_policy_plane_foundation,
)
import app.models.user  # noqa: F401  (FK target)
import app.models.policy  # noqa: F401  (register on Base.metadata)
from app.models.policy import (
    PolicyRule, PolicyTenant, PolicyView, PolicyFeedSource,
    PolicyValidationError, validate_allow_exception_target,
)


def _make_engine():
    eng = create_engine("sqlite:///:memory:", future=True)

    @event.listens_for(eng, "connect")
    def _pragma(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    Base.metadata.create_all(eng)
    return eng


class MigrationTest(unittest.TestCase):
    def test_creates_four_tables(self):
        eng = _make_engine()
        raw = eng.raw_connection()
        try:
            _migration_pol_1_policy_plane_foundation(raw)
            raw.commit()
        finally:
            raw.close()
        tables = set(inspect(eng).get_table_names())
        for t in ("policy_tenants", "policy_views", "policy_rules", "policy_feed_sources"):
            self.assertIn(t, tables, f"missing table {t}")

    def test_logical_rollback(self):
        eng = _make_engine()
        raw = eng.raw_connection()
        try:
            cur = raw.cursor()
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            cur.execute("INSERT INTO schema_migrations VALUES('pol_1_policy_plane_foundation', '2026-06-21')")
            _migration_pol_1_policy_plane_foundation(raw)
            raw.commit()
            down_pol_1_policy_plane_foundation(raw)
            raw.commit()
        finally:
            raw.close()
        tables = set(inspect(eng).get_table_names())
        for t in ("policy_tenants", "policy_views", "policy_rules", "policy_feed_sources"):
            self.assertNotIn(t, tables)


class ConstraintsTest(unittest.TestCase):
    def setUp(self):
        self.eng = _make_engine()
        self.Session = sessionmaker(bind=self.eng)

    def _new_rule(self, **kw):
        defaults = dict(
            id=str(uuid.uuid4()),
            kind="block_name", target="ads.example.com",
            action="always_nxdomain", source="operator", layer=200,
        )
        defaults.update(kw)
        return PolicyRule(**defaults)

    def test_valid_operator_block(self):
        s = self.Session()
        s.add(self._new_rule())
        s.commit()
        self.assertEqual(s.query(PolicyRule).count(), 1)

    def test_invalid_layer_rejected(self):
        s = self.Session()
        s.add(self._new_rule(layer=42))
        with self.assertRaises(Exception):
            s.commit()

    def test_allow_exception_must_be_layer_400(self):
        s = self.Session()
        s.add(self._new_rule(kind="allow_exception", layer=200, action="always_transparent"))
        with self.assertRaises(Exception):
            s.commit()

    def test_layer_400_must_be_allow_exception(self):
        s = self.Session()
        s.add(self._new_rule(kind="block_name", layer=400))
        with self.assertRaises(Exception):
            s.commit()

    def test_layer_100_requires_judicial_source(self):
        s = self.Session()
        s.add(self._new_rule(kind="block_name", layer=100, source="operator"))
        with self.assertRaises(Exception):
            s.commit()

    def test_allow_exception_cannot_be_judicial_mirror(self):
        s = self.Session()
        # would also fail layer constraint, so isolate: layer=400 + judicial source
        s.add(self._new_rule(kind="allow_exception", layer=400, source="anablock_mirror", action="always_transparent"))
        with self.assertRaises(Exception):
            s.commit()


class CrossRowValidatorTest(unittest.TestCase):
    def setUp(self):
        self.eng = _make_engine()
        self.Session = sessionmaker(bind=self.eng)

    def test_rejects_exception_over_judicial(self):
        s = self.Session()
        s.add(PolicyRule(
            id=str(uuid.uuid4()), kind="block_name", target="judicial.example.com",
            action="always_nxdomain", source="anablock_mirror", layer=100,
        ))
        s.commit()
        with self.assertRaises(PolicyValidationError):
            validate_allow_exception_target(s, "judicial.example.com", None)
        # Sub-domain coverage too
        with self.assertRaises(PolicyValidationError):
            validate_allow_exception_target(s, "sub.judicial.example.com", None)

    def test_accepts_exception_over_non_judicial(self):
        s = self.Session()
        s.add(PolicyRule(
            id=str(uuid.uuid4()), kind="block_name", target="ads.example.com",
            action="always_nxdomain", source="operator", layer=200,
        ))
        s.commit()
        # Should not raise — operator block (layer 200) IS overridable
        validate_allow_exception_target(s, "ads.example.com", None)


class ReadEndpointsTest(unittest.TestCase):
    """Smoke test the route functions directly (bypasses HTTP/auth wiring)."""

    def setUp(self):
        self.eng = _make_engine()
        self.Session = sessionmaker(bind=self.eng)
        from app.api.routes import policy as policy_route
        self.routes = policy_route

    def test_summary_empty(self):
        s = self.Session()
        out = self.routes.policy_summary(db=s, _=None)
        self.assertEqual(out["total_rules"], 0)
        self.assertEqual(out["by_scope"], {"global": 0, "view": 0})
        self.assertIn("100", out["layers_legend"])

    def test_list_rules_with_seed(self):
        s = self.Session()
        s.add(PolicyRule(
            id=str(uuid.uuid4()), kind="block_name", target="ads.example.com",
            action="always_nxdomain", source="operator", layer=200,
        ))
        s.commit()
        out = self.routes.list_rules(layer=None, scope_view=None, enabled_only=False, limit=100, db=s, _=None)
        self.assertEqual(out["total"], 1)
        self.assertEqual(out["items"][0]["layer"], 200)
        # Filter by layer
        empty = self.routes.list_rules(layer=300, scope_view=None, enabled_only=False, limit=100, db=s, _=None)
        self.assertEqual(empty["total"], 0)
        # scope='global'
        glob = self.routes.list_rules(layer=None, scope_view="global", enabled_only=False, limit=100, db=s, _=None)
        self.assertEqual(glob["total"], 1)

    def test_feed_sources_never_leak_auth_header(self):
        """SECURITY: auth_header is a feed credential and MUST NEVER appear
        in viewer-accessible read endpoints. Only has_auth (bool) is exposed."""
        from app.models.policy import PolicyFeedSource
        s = self.Session()
        secret = "Bearer super-secret-token-do-not-leak"
        s.add(PolicyFeedSource(
            id=str(uuid.uuid4()), name="spamhaus_drop", kind="domain_blocklist",
            url="https://example.com/drop", auth_header=secret,
            integrity="sha256_sidecar", cadence_sec=3600, enabled=True,
        ))
        s.add(PolicyFeedSource(
            id=str(uuid.uuid4()), name="public_feed", kind="domain_blocklist",
            url="https://example.com/public", auth_header=None,
            integrity="sha256_sidecar", cadence_sec=3600, enabled=True,
        ))
        s.commit()
        out = self.routes.list_feed_sources(db=s, _=None)
        self.assertEqual(out["total"], 2)
        payload_json = repr(out)
        # The secret string must NOT appear anywhere in the payload
        self.assertNotIn(secret, payload_json)
        self.assertNotIn("super-secret-token-do-not-leak", payload_json)
        for item in out["items"]:
            self.assertNotIn("auth_header", item, "auth_header key must be redacted")
            self.assertIn("has_auth", item, "has_auth presence flag must be exposed")
        by_name = {i["name"]: i for i in out["items"]}
        self.assertTrue(by_name["spamhaus_drop"]["has_auth"])
        self.assertFalse(by_name["public_feed"]["has_auth"])


# ===========================================================================
# POL-2a — Operator block CRUD tests (HTTP-level via TestClient + RBAC + audit)
# ===========================================================================

class OperatorBlockCrudTest(unittest.TestCase):
    """
    Exercises POL-2a mutators end-to-end through FastAPI: schema constraints,
    RBAC (viewer 403), audit emission (operational_events), and confirms
    that no Unbound config generator was invoked.
    """

    @classmethod
    def setUpClass(cls):
        # Use the existing app engine (already bound at module import time via
        # DNS_CONTROL_DB_PATH set at the top of this file). Just ensure all
        # model tables exist on it.
        import app.core.database as _dbmod
        import app.models.user  # noqa: F401
        import app.models.operational  # noqa: F401
        import app.models.policy  # noqa: F401
        _dbmod.Base.metadata.create_all(bind=_dbmod.engine)
        cls._dbmod = _dbmod
        # Persist the fake users referenced by created_by FK
        from app.models.user import User
        s = _dbmod.SessionLocal()
        try:
            for role in ("admin", "viewer"):
                uid = f"user-{role}"
                if not s.query(User).filter(User.id == uid).first():
                    s.add(User(id=uid, username=f"{role}_user", password_hash="x", role=role, is_active=True))
            s.commit()
        finally:
            s.close()

    def _client_for(self, role: str):
        """Build a TestClient with get_current_user / require_admin overridden."""
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from app.api.routes import policy as policy_route
        from app.api.deps import get_current_user, require_admin
        import app.models.user as user_mod

        app = FastAPI()
        app.include_router(policy_route.router, prefix="/api/policy")

        fake_user = user_mod.User(
            id=f"user-{role}", username=f"{role}_user",
            password_hash="x", role=role, is_active=True,
        )

        def _cur():
            return fake_user

        def _admin():
            if role != "admin":
                from fastapi import HTTPException
                raise HTTPException(status_code=403, detail="forbidden")
            return fake_user

        app.dependency_overrides[get_current_user] = _cur
        app.dependency_overrides[require_admin] = _admin
        # Use the same engine/session as the app
        from app.core.database import get_db, SessionLocal
        def _db():
            s = SessionLocal()
            try:
                yield s
            finally:
                s.close()
        app.dependency_overrides[get_db] = _db
        return TestClient(app)

    def _clear_rules(self):
        from app.models.policy import PolicyRule
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            s.query(PolicyRule).delete()
            s.query(OperationalEvent).delete()
            s.commit()
        finally:
            s.close()

    def test_admin_create_then_patch_then_delete_emits_audit(self):
        self._clear_rules()
        client = self._client_for("admin")
        # CREATE
        r = client.post("/api/policy/rules/block", json={"target": "ads.example.com"})
        self.assertEqual(r.status_code, 201, r.text)
        rule = r.json()
        self.assertEqual(rule["layer"], 200)
        self.assertEqual(rule["kind"], "block_name")
        self.assertEqual(rule["source"], "operator")
        self.assertEqual(rule["target"], "ads.example.com")
        self.assertTrue(rule["enabled"])
        # PATCH disable + change action
        r2 = client.patch(f"/api/policy/rules/{rule['id']}", json={"enabled": False, "action": "always_refuse"})
        self.assertEqual(r2.status_code, 200, r2.text)
        self.assertFalse(r2.json()["enabled"])
        self.assertEqual(r2.json()["action"], "always_refuse")
        # DELETE
        r3 = client.delete(f"/api/policy/rules/{rule['id']}")
        self.assertEqual(r3.status_code, 204)
        # Audit: 3 events emitted in order
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            evs = s.query(OperationalEvent).order_by(OperationalEvent.created_at.asc()).all()
            types = [e.event_type for e in evs]
            self.assertEqual(types, ["policy.rule.created", "policy.rule.updated", "policy.rule.deleted"])
            for e in evs:
                self.assertIn("admin_user", e.message)
                payload = json.loads(e.details_json)
                self.assertEqual(payload["actor_username"], "admin_user")
                self.assertEqual(payload["target"], "ads.example.com")
                self.assertEqual(payload["layer"], 200)
                self.assertEqual(payload["scope_view"], None)
        finally:
            s.close()

    def test_viewer_mutations_are_forbidden(self):
        self._clear_rules()
        client = self._client_for("viewer")
        r = client.post("/api/policy/rules/block", json={"target": "ads.example.com"})
        self.assertEqual(r.status_code, 403)
        # Even read still works (viewer can GET)
        r2 = client.get("/api/policy/rules")
        self.assertEqual(r2.status_code, 200)
        # And no event was emitted
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            self.assertEqual(s.query(OperationalEvent).count(), 0)
        finally:
            s.close()

    def test_invalid_action_rejected(self):
        self._clear_rules()
        client = self._client_for("admin")
        r = client.post("/api/policy/rules/block", json={"target": "x.com", "action": "redirect_ip"})
        self.assertEqual(r.status_code, 422)

    def test_duplicate_target_rejected_with_409(self):
        self._clear_rules()
        client = self._client_for("admin")
        r1 = client.post("/api/policy/rules/block", json={"target": "dup.com"})
        self.assertEqual(r1.status_code, 201)
        r2 = client.post("/api/policy/rules/block", json={"target": "dup.com"})
        self.assertEqual(r2.status_code, 409)

    def test_patch_refuses_non_operator_rule(self):
        """Mutations must NOT touch judicial / feed rules — POL-2a scope."""
        self._clear_rules()
        s = self._dbmod.SessionLocal()
        try:
            from app.models.policy import PolicyRule
            jud = PolicyRule(
                id="jud-1", kind="block_name", target="court.example.com",
                action="always_nxdomain", source="anablock_mirror", layer=100,
            )
            s.add(jud)
            s.commit()
        finally:
            s.close()
        client = self._client_for("admin")
        r = client.patch("/api/policy/rules/jud-1", json={"enabled": False})
        self.assertEqual(r.status_code, 403)
        r2 = client.delete("/api/policy/rules/jud-1")
        self.assertEqual(r2.status_code, 403)

    def test_create_does_not_invoke_unbound_generator(self):
        """Mutations on rules must NOT trigger config generation.

        NOTE: POL-2b adds /policy/preview and /policy/apply endpoints which
        DO invoke the policy.d generator. The original POL-2a invariant
        ("no generator import in the policy module") is intentionally
        relaxed — what we still guarantee here is that the CRUD mutators
        themselves never reach into the unbound generator.
        """
        self._clear_rules()
        import app.generators.unbound_generator as ug
        called = {"n": 0}
        orig = ug.generate_unbound_files if hasattr(ug, "generate_unbound_files") else None
        # generate_unbound_configs is the public entrypoint
        from unittest.mock import patch
        with patch("app.services.config_service.generate_unbound_configs") as m:
            client = self._client_for("admin")
            r = client.post("/api/policy/rules/block", json={"target": "nogen.example.com"})
            self.assertEqual(r.status_code, 201)
            self.assertEqual(m.call_count, 0, "CRUD must not invoke unbound generator")


# ===========================================================================
# POL-2b — Generator + apply pipeline tests
# ===========================================================================

class PolicyDGeneratorTest(unittest.TestCase):
    """Pure-function generator: judicial precedence, determinism."""

    def test_emits_local_zones_for_enabled_operator_rules(self):
        from app.generators.policy_d_generator import generate_policy_d_files, POLICY_D_PATH
        rules = [
            {"target": "ads.example.com", "action": "always_nxdomain", "enabled": True, "scope_view": None},
            {"target": "tracking.example.net", "action": "always_refuse", "enabled": True, "scope_view": None},
            {"target": "disabled.example.org", "action": "always_nxdomain", "enabled": False, "scope_view": None},
        ]
        files, omitted = generate_policy_d_files(rules, judicial_targets=[])
        self.assertEqual(len(files), 1)
        f = files[0]
        self.assertEqual(f["path"], POLICY_D_PATH)
        self.assertIn('local-zone: "ads.example.com" always_nxdomain', f["content"])
        self.assertIn('local-zone: "tracking.example.net" always_refuse', f["content"])
        self.assertNotIn("disabled.example.org", f["content"])
        self.assertEqual(omitted, [])

    def test_deterministic_output_independent_of_input_order(self):
        from app.generators.policy_d_generator import generate_policy_d_files
        a = [
            {"target": "b.com", "action": "always_nxdomain", "enabled": True, "scope_view": None},
            {"target": "a.com", "action": "always_nxdomain", "enabled": True, "scope_view": None},
        ]
        b = list(reversed(a))
        fa, _ = generate_policy_d_files(a, [])
        fb, _ = generate_policy_d_files(b, [])
        self.assertEqual(fa[0]["content"], fb[0]["content"])

    def test_judicial_target_drops_operator_with_same_name(self):
        from app.generators.policy_d_generator import generate_policy_d_files
        rules = [{"target": "court.example.com", "action": "always_refuse",
                  "enabled": True, "scope_view": None}]
        files, omitted = generate_policy_d_files(rules, judicial_targets=["court.example.com"])
        self.assertNotIn("court.example.com", files[0]["content"])
        self.assertEqual(omitted[0]["reason"], "judicial_precedence")
        self.assertEqual(omitted[0]["judicial_match"], "court.example.com")

    def test_judicial_ancestor_drops_operator_subdomain(self):
        from app.generators.policy_d_generator import generate_policy_d_files
        rules = [{"target": "sub.court.example.com", "action": "always_nxdomain",
                  "enabled": True, "scope_view": None}]
        files, omitted = generate_policy_d_files(rules, judicial_targets=["court.example.com"])
        self.assertNotIn("sub.court.example.com", files[0]["content"])
        self.assertEqual(omitted[0]["reason"], "judicial_precedence")
        self.assertEqual(omitted[0]["judicial_match"], "court.example.com")

    def test_empty_rule_set_still_emits_placeholder_file(self):
        from app.generators.policy_d_generator import generate_policy_d_files
        files, _ = generate_policy_d_files([], [])
        self.assertEqual(len(files), 1)
        self.assertIn("no enabled operator block rules", files[0]["content"])


class UnboundIncludeOrderTest(unittest.TestCase):
    """Defense (b): include order must put anablock.conf LAST."""

    def test_policy_d_included_before_anablock(self):
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        with open(os.path.join(repo_root, "backend/app/generators/unbound_generator.py")) as fh:
            src = fh.read()
        i_policy = src.find("policy.d/*.conf")
        i_anablock = src.find("include: /etc/unbound/anablock.conf")
        self.assertGreater(i_policy, 0)
        self.assertGreater(i_anablock, i_policy,
            "anablock.conf include MUST appear AFTER policy.d include "
            "to preserve judicial precedence under Unbound's last-wins")

    def test_frontend_generator_mirrors_include_order(self):
        """FE↔BE parity for the include order."""
        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        with open(os.path.join(repo_root, "src/lib/config-generator.ts")) as fh:
            src = fh.read()
        i_policy = src.find("policy.d/*.conf")
        i_anablock = src.find("anablock.conf")
        self.assertGreater(i_policy, 0)
        self.assertGreater(i_anablock, i_policy)


class ConfigServiceMergesPolicyArtifacts(unittest.TestCase):
    """generate_preview must append payload['_policyArtifacts'] additively."""

    def test_policy_artifacts_appear_in_preview(self):
        from app.services.config_service import generate_preview
        payload = {
            "operationMode": "simple",
            "_policyArtifacts": [{
                "path": "/etc/unbound/policy.d/200-operator-blocks.conf",
                "content": "# test\n",
                "permissions": "0644", "owner": "root:unbound",
            }],
        }
        files = generate_preview(payload)
        paths = [f["path"] for f in files]
        self.assertIn("/etc/unbound/policy.d/200-operator-blocks.conf", paths)


class PolicyApplyRouteTest(OperatorBlockCrudTest):
    """End-to-end policy apply: RBAC, audit, judicial precedence at the API."""

    def _seed_profile(self) -> str:
        from app.models.config_profile import ConfigProfile
        s = self._dbmod.SessionLocal()
        try:
            p = ConfigProfile(name="t", payload_json=json.dumps({"operationMode": "simple"}))
            s.add(p); s.commit(); s.refresh(p)
            return p.id
        finally:
            s.close()

    def test_preview_omits_judicial_collisions(self):
        self._clear_rules()
        s = self._dbmod.SessionLocal()
        try:
            s.add(PolicyRule(id="jud-a", kind="block_name", target="banned.example.com",
                             action="always_nxdomain", source="anablock_mirror", layer=100, enabled=True))
            s.add(PolicyRule(id="op-a", kind="block_name", target="banned.example.com",
                             action="always_refuse", source="operator", layer=200, enabled=True))
            s.add(PolicyRule(id="op-b", kind="block_name", target="ads.example.com",
                             action="always_nxdomain", source="operator", layer=200, enabled=True))
            s.commit()
        finally:
            s.close()
        client = self._client_for("admin")
        r = client.get("/api/policy/preview")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        content = body["files"][0]["content"]
        self.assertIn("ads.example.com", content)
        self.assertNotIn("banned.example.com", content,
            "judicial-covered operator rule must NOT appear in policy.d")
        self.assertEqual(len(body["omitted"]), 1)
        self.assertEqual(body["omitted"][0]["reason"], "judicial_precedence")

    def test_viewer_apply_is_forbidden(self):
        self._clear_rules()
        client = self._client_for("viewer")
        r = client.post("/api/policy/apply", json={"profile_id": "irrelevant"})
        self.assertEqual(r.status_code, 403)

    def test_apply_uses_existing_deploy_pipeline(self):
        self._clear_rules()
        s = self._dbmod.SessionLocal()
        try:
            s.add(PolicyRule(id="op-x", kind="block_name", target="x.example.com",
                             action="always_nxdomain", source="operator", layer=200, enabled=True))
            s.commit()
        finally:
            s.close()
        pid = self._seed_profile()

        from unittest.mock import patch
        captured = {}
        def fake_deploy(payload, scope, dry_run, operator):
            captured["payload"] = payload
            captured["scope"] = scope
            return {"success": True, "steps": [{"name": "unbound-checkconf", "status": "success"}]}

        client = self._client_for("admin")
        with patch("app.api.routes.policy.execute_deploy", side_effect=fake_deploy), \
             patch("app.api.routes.policy.require_managed_mode", return_value=None):
            r = client.post("/api/policy/apply", json={"profile_id": pid, "dry_run": True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["status"], "success")
        self.assertEqual(captured["scope"], "dns")
        artifacts = captured["payload"].get("_policyArtifacts")
        self.assertTrue(artifacts and any(
            a["path"].endswith("200-operator-blocks.conf") for a in artifacts
        ))
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            evs = s.query(OperationalEvent).filter(
                OperationalEvent.event_type == "policy.applied"
            ).all()
            self.assertGreaterEqual(len(evs), 1)
        finally:
            s.close()

    def test_apply_failure_records_apply_failed(self):
        self._clear_rules()
        pid = self._seed_profile()
        from unittest.mock import patch
        def fake_deploy(payload, scope, dry_run, operator):
            return {"success": False, "error": "unbound-checkconf failed", "steps": []}
        client = self._client_for("admin")
        with patch("app.api.routes.policy.execute_deploy", side_effect=fake_deploy), \
             patch("app.api.routes.policy.require_managed_mode", return_value=None):
            r = client.post("/api/policy/apply", json={"profile_id": pid})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "failed")
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            evs = s.query(OperationalEvent).filter(
                OperationalEvent.event_type == "policy.apply_failed"
            ).all()
            self.assertGreaterEqual(len(evs), 1)
        finally:
            s.close()


# ===========================================================================
# POL-3a — allow_exception CRUD + judicial rejection audit
# ===========================================================================

class AllowExceptionCrudTest(OperatorBlockCrudTest):
    """allow_exception CRUD, judicial enforcement + audited rejection."""

    def _seed_judicial(self, target: str = "court.example.com") -> str:
        from app.models.policy import PolicyRule
        s = self._dbmod.SessionLocal()
        try:
            rid = f"jud-{uuid.uuid4().hex[:8]}"
            s.add(PolicyRule(id=rid, kind="block_name", target=target,
                             action="always_nxdomain", source="anablock_mirror",
                             layer=100, enabled=True))
            s.commit()
            return rid
        finally:
            s.close()

    def test_admin_creates_valid_allow_exception_and_audit(self):
        self._clear_rules()
        client = self._client_for("admin")
        r = client.post("/api/policy/rules/allow",
                        json={"target": "parceiro.example.com", "note": "ticket-42"})
        self.assertEqual(r.status_code, 201, r.text)
        rule = r.json()
        self.assertEqual(rule["layer"], 400)
        self.assertEqual(rule["kind"], "allow_exception")
        self.assertEqual(rule["source"], "operator")
        self.assertEqual(rule["action"], "allow")
        self.assertEqual(rule["payload"], {"note": "ticket-42"})
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            evs = s.query(OperationalEvent).order_by(OperationalEvent.created_at.asc()).all()
            self.assertEqual([e.event_type for e in evs], ["policy.rule.created"])
            self.assertEqual(json.loads(evs[0].details_json)["target"], "parceiro.example.com")
        finally:
            s.close()

    def test_create_rejected_when_target_matches_judicial_and_is_audited(self):
        self._clear_rules()
        jud_id = self._seed_judicial("court.example.com")
        client = self._client_for("admin")
        r = client.post("/api/policy/rules/allow",
                        json={"target": "court.example.com"})
        self.assertEqual(r.status_code, 409, r.text)
        # Rule must NOT be persisted
        from app.models.policy import PolicyRule
        s = self._dbmod.SessionLocal()
        try:
            self.assertEqual(
                s.query(PolicyRule).filter(PolicyRule.kind == "allow_exception").count(), 0
            )
            from app.models.operational import OperationalEvent
            evs = s.query(OperationalEvent).filter(
                OperationalEvent.event_type == "policy.allow_exception.rejected"
            ).all()
            self.assertEqual(len(evs), 1)
            payload = json.loads(evs[0].details_json)
            self.assertEqual(payload["judicial_rule_id"], jud_id)
            self.assertEqual(payload["judicial_target"], "court.example.com")
            self.assertEqual(payload["attempted_target"], "court.example.com")
            self.assertEqual(payload["reason"], "judicial_precedence")
        finally:
            s.close()

    def test_create_rejected_when_target_is_subdomain_of_judicial(self):
        self._clear_rules()
        self._seed_judicial("court.example.com")
        client = self._client_for("admin")
        r = client.post("/api/policy/rules/allow",
                        json={"target": "sub.court.example.com"})
        self.assertEqual(r.status_code, 409, r.text)
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            evs = s.query(OperationalEvent).filter(
                OperationalEvent.event_type == "policy.allow_exception.rejected"
            ).all()
            self.assertEqual(len(evs), 1)
            payload = json.loads(evs[0].details_json)
            self.assertEqual(payload["attempted_target"], "sub.court.example.com")
            self.assertEqual(payload["judicial_target"], "court.example.com")
        finally:
            s.close()

    def test_viewer_cannot_create_allow_exception(self):
        self._clear_rules()
        client = self._client_for("viewer")
        r = client.post("/api/policy/rules/allow", json={"target": "ok.example.com"})
        self.assertEqual(r.status_code, 403)

    def test_endpoint_refuses_to_mutate_non_allow_exception_rule(self):
        """PATCH/DELETE /rules/allow/{id} cannot touch judicial/feed/block rules."""
        self._clear_rules()
        jud_id = self._seed_judicial("court.example.com")
        client = self._client_for("admin")
        r = client.patch(f"/api/policy/rules/allow/{jud_id}", json={"enabled": False})
        self.assertEqual(r.status_code, 403)
        r2 = client.delete(f"/api/policy/rules/allow/{jud_id}")
        self.assertEqual(r2.status_code, 403)

    def test_patch_and_delete_allow_exception_emit_audit(self):
        self._clear_rules()
        client = self._client_for("admin")
        cr = client.post("/api/policy/rules/allow", json={"target": "ok.example.com"})
        self.assertEqual(cr.status_code, 201)
        rid = cr.json()["id"]
        pr = client.patch(f"/api/policy/rules/allow/{rid}",
                          json={"enabled": False, "note": "paused"})
        self.assertEqual(pr.status_code, 200)
        self.assertFalse(pr.json()["enabled"])
        dr = client.delete(f"/api/policy/rules/allow/{rid}")
        self.assertEqual(dr.status_code, 204)
        from app.models.operational import OperationalEvent
        s = self._dbmod.SessionLocal()
        try:
            types = [e.event_type for e in s.query(OperationalEvent).order_by(
                OperationalEvent.created_at.asc()).all()]
            self.assertEqual(types, ["policy.rule.created", "policy.rule.updated", "policy.rule.deleted"])
        finally:
            s.close()

    def test_duplicate_allow_exception_rejected(self):
        self._clear_rules()
        client = self._client_for("admin")
        r1 = client.post("/api/policy/rules/allow", json={"target": "dup.example.com"})
        self.assertEqual(r1.status_code, 201)
        r2 = client.post("/api/policy/rules/allow", json={"target": "dup.example.com"})
        self.assertEqual(r2.status_code, 409)

    def test_create_does_not_invoke_unbound_generator(self):
        """POL-3a: zero impact on resolution — no generator on the hot path."""
        self._clear_rules()
        from unittest.mock import patch
        with patch("app.services.config_service.generate_unbound_configs") as m:
            client = self._client_for("admin")
            r = client.post("/api/policy/rules/allow", json={"target": "nogen.example.com"})
            self.assertEqual(r.status_code, 201)
            self.assertEqual(m.call_count, 0)


if __name__ == "__main__":
    unittest.main()
