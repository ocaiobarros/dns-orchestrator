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


if __name__ == "__main__":
    unittest.main()
