"""
Upstream Silence Detector — tests (v1, conntrack [UNREPLIED] quick-win).

Cover:
  - Parser: linhas IPv4/IPv6 com [UNREPLIED] são extraídas; linha replied
    é detectada (replied=True) e ignorada na agregação; linhas sem
    dport=53 / sem proto udp são rejeitadas.
  - Agregação por IP com sliding window (5/15 min).
  - Toggle OFF → status='disabled', subprocesso não inicia, endpoint
    devolve coleção vazia + disabled.
  - Binário conntrack ausente → status='degraded' com last_error não-nulo
    (sem derrubar a telemetria).
  - Snapshot inclui collector_status (viewer-ok).
  - GUARD: nenhum gerador é invocado pela rota de toggle (mirror do
    test_no_config_generation pattern usado em test_policy_plane.py).
  - RBAC: GET /telemetry/upstreams é viewer-ok; POST toggle exige admin.
"""

import os
import time
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.core.database import SessionLocal, init_db
from app.models.user import User
from app.models.log_entry import Setting
from app.services import upstream_silence_service as uss
from app.services.upstream_silence_service import (
    UpstreamSilenceDetector,
    parse_conntrack_event_line,
)


# Real conntrack -E -o extended output samples (kernel-formatted).
LINE_V4_UNREPLIED = (
    "[DESTROY] udp      17 30 src=10.0.0.1 dst=8.8.8.8 sport=33445 "
    "dport=53 [UNREPLIED] src=8.8.8.8 dst=10.0.0.1 sport=53 dport=33445"
)
LINE_V6_UNREPLIED = (
    "[DESTROY] udp      17 30 src=2001:db8::1 dst=2001:4860:4860::8888 "
    "sport=44556 dport=53 [UNREPLIED] src=2001:4860:4860::8888 "
    "dst=2001:db8::1 sport=53 dport=44556"
)
LINE_V4_REPLIED = (
    "[DESTROY] udp      17 0 src=10.0.0.1 dst=1.1.1.1 sport=12345 "
    "dport=53 src=1.1.1.1 dst=10.0.0.1 sport=53 dport=12345"
)
LINE_TCP = (
    "[DESTROY] tcp      6 src=10.0.0.1 dst=8.8.8.8 sport=12345 dport=53 "
    "[UNREPLIED] src=8.8.8.8 dst=10.0.0.1 sport=53 dport=12345"
)
LINE_NOT_DNS = (
    "[DESTROY] udp      17 src=10.0.0.1 dst=8.8.8.8 sport=12345 dport=443 "
    "[UNREPLIED]"
)


class ParserTest(unittest.TestCase):
    def test_ipv4_unreplied(self):
        ev = parse_conntrack_event_line(LINE_V4_UNREPLIED)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["ip"], "8.8.8.8")
        self.assertEqual(ev["family"], "ipv4")
        self.assertFalse(ev["replied"])

    def test_ipv6_unreplied(self):
        ev = parse_conntrack_event_line(LINE_V6_UNREPLIED)
        self.assertIsNotNone(ev)
        self.assertEqual(ev["ip"], "2001:4860:4860::8888")
        self.assertEqual(ev["family"], "ipv6")
        self.assertFalse(ev["replied"])

    def test_replied_is_detected(self):
        ev = parse_conntrack_event_line(LINE_V4_REPLIED)
        self.assertIsNotNone(ev)
        self.assertTrue(ev["replied"])

    def test_tcp_is_ignored(self):
        # We listen only on udp; the supervisor passes --proto udp to
        # conntrack, but be defensive at the parser layer too.
        self.assertIsNone(parse_conntrack_event_line(LINE_TCP))

    def test_non_dns_port_ignored(self):
        self.assertIsNone(parse_conntrack_event_line(LINE_NOT_DNS))

    def test_empty_and_garbage(self):
        self.assertIsNone(parse_conntrack_event_line(""))
        self.assertIsNone(parse_conntrack_event_line("hello world"))


class AggregationTest(unittest.TestCase):
    def setUp(self):
        UpstreamSilenceDetector.instance().reset_for_test()

    def test_sliding_window_counts(self):
        det = UpstreamSilenceDetector.instance()
        now = time.time()
        # 3 events at "now", 2 events 6min ago, 1 event 20min ago.
        for _ in range(3):
            det.ingest_for_test(LINE_V4_UNREPLIED, ts=now)
        for _ in range(2):
            det.ingest_for_test(LINE_V4_UNREPLIED, ts=now - 6 * 60)
        det.ingest_for_test(LINE_V4_UNREPLIED, ts=now - 20 * 60)
        snap = det.snapshot()
        # 20-min-old event must be pruned (RETENTION_SECONDS=15min).
        items = snap["items"]
        self.assertEqual(len(items), 1)
        row = items[0]
        self.assertEqual(row["ip"], "8.8.8.8")
        self.assertEqual(row["count_5min"], 3)
        self.assertEqual(row["count_15min"], 5)

    def test_replied_does_not_count(self):
        det = UpstreamSilenceDetector.instance()
        self.assertFalse(det.ingest_for_test(LINE_V4_REPLIED))
        self.assertEqual(det.snapshot()["unique_ips"], 0)


def _seed_admin_and_viewer(db) -> tuple[str, str]:
    """Create one admin + one viewer if missing. Returns usernames."""
    from app.core.security import hash_password
    import uuid
    admin = db.query(User).filter(User.username == "uss_admin").first()
    if not admin:
        admin = User(
            id=str(uuid.uuid4()),
            username="uss_admin",
            password_hash=hash_password("x"),
            role="admin",
            status="active",
            must_change_password=False,
        )
        db.add(admin)
    viewer = db.query(User).filter(User.username == "uss_viewer").first()
    if not viewer:
        viewer = User(
            id=str(uuid.uuid4()),
            username="uss_viewer",
            password_hash=hash_password("x"),
            role="viewer",
            status="active",
            must_change_password=False,
        )
        db.add(viewer)
    db.commit()
    return admin.username, viewer.username


def _login(client: TestClient, username: str) -> None:
    """Helper: directly mint a session by hitting the login endpoint."""
    r = client.post("/api/auth/login", json={"username": username, "password": "x"})
    assert r.status_code == 200, r.text


class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        cls.client = TestClient(app)
        db = SessionLocal()
        try:
            _seed_admin_and_viewer(db)
            # Reset toggle to OFF for a clean slate.
            uss.set_enabled(db, False)
        finally:
            db.close()
        UpstreamSilenceDetector.instance().reset_for_test()

    def setUp(self):
        # Each test starts with detector reset + toggle off.
        UpstreamSilenceDetector.instance().stop()
        UpstreamSilenceDetector.instance().reset_for_test()
        db = SessionLocal()
        try:
            uss.set_enabled(db, False)
        finally:
            db.close()
        self.client.cookies.clear()

    def test_viewer_can_read_snapshot(self):
        _login(self.client, "uss_viewer")
        r = self.client.get("/api/telemetry/upstreams")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("collector_status", body)
        self.assertEqual(body["collector_status"], "disabled")
        self.assertEqual(body["items"], [])

    def test_viewer_cannot_toggle(self):
        _login(self.client, "uss_viewer")
        r = self.client.post("/api/telemetry/upstreams/toggle?enabled=true")
        self.assertIn(r.status_code, (401, 403))
        # And nothing was started.
        snap = UpstreamSilenceDetector.instance().snapshot()
        self.assertEqual(snap["collector_status"], "disabled")

    def test_admin_toggle_off_keeps_disabled(self):
        _login(self.client, "uss_admin")
        r = self.client.post("/api/telemetry/upstreams/toggle?enabled=false")
        self.assertEqual(r.status_code, 200, r.text)
        snap = UpstreamSilenceDetector.instance().snapshot()
        self.assertEqual(snap["collector_status"], "disabled")
        self.assertFalse(snap["running"])

    def test_admin_toggle_on_when_binary_missing_is_degraded(self):
        """Honest degradation: binary missing ⇒ status='degraded' + last_error,
        nunca fingir sucesso. Não derruba o restante da telemetria."""
        _login(self.client, "uss_admin")
        # Force the "no binary" branch even if the test host happens to
        # have conntrack installed.
        with patch("app.services.upstream_silence_service.shutil.which", return_value=None):
            r = self.client.post("/api/telemetry/upstreams/toggle?enabled=true")
            self.assertEqual(r.status_code, 200, r.text)
            body = r.json()
            self.assertTrue(body["enabled"])
            # Status comes back degraded.
            result = body["result"]
            self.assertEqual(result["status"], "degraded")
            self.assertIsNotNone(result["last_error"])
            # Other telemetry endpoints still respond.
            r2 = self.client.get("/api/telemetry/status")
            self.assertEqual(r2.status_code, 200)
        # Cleanup
        self.client.post("/api/telemetry/upstreams/toggle?enabled=false")

    def test_no_generators_invoked_by_toggle(self):
        """GUARD: o toggle é puramente observacional — nenhum generator
        de nftables/unbound pode ser chamado (postura POL-2b/3b)."""
        _login(self.client, "uss_admin")
        called = []
        # Sentinel: monkeypatch the top-level generator entrypoints; if any
        # is invoked synchronously during toggle, the test fails.
        from app.generators import nftables_generator, unbound_generator, ip_blocking_generator
        with patch.object(nftables_generator, "generate_nftables_config", side_effect=lambda *a, **k: called.append("nft") or ""), \
             patch.object(unbound_generator, "generate_unbound_configs", side_effect=lambda *a, **k: called.append("unb") or {}), \
             patch.object(ip_blocking_generator, "generate_ip_blocking_files", side_effect=lambda *a, **k: called.append("ipb") or {}):
            self.client.post("/api/telemetry/upstreams/toggle?enabled=false")
            self.client.get("/api/telemetry/upstreams")
        self.assertEqual(called, [], f"generators must NOT be invoked: {called}")


if __name__ == "__main__":
    unittest.main()
