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


def _make_client(role: str):
    """TestClient mounting only the telemetry router with RBAC overrides
    (mirrors test_policy_plane.py pattern; avoids dealing with sessions)."""
    from fastapi import FastAPI, HTTPException
    from fastapi.testclient import TestClient
    from app.api.routes import telemetry as telemetry_route
    from app.api.deps import get_current_user, require_admin
    from app.core.database import get_db, SessionLocal
    import app.models.user as user_mod

    app2 = FastAPI()
    app2.include_router(telemetry_route.router, prefix="/api/telemetry")

    fake_user = user_mod.User(
        id=f"user-{role}", username=f"{role}_user",
        password_hash="x", role=role, is_active=True,
    )

    def _cur():
        return fake_user

    def _admin():
        if role != "admin":
            raise HTTPException(status_code=403, detail="forbidden")
        return fake_user

    def _db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app2.dependency_overrides[get_current_user] = _cur
    app2.dependency_overrides[require_admin] = _admin
    app2.dependency_overrides[get_db] = _db
    return TestClient(app2)


class EndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        UpstreamSilenceDetector.instance().stop()
        UpstreamSilenceDetector.instance().reset_for_test()
        db = SessionLocal()
        try:
            uss.set_enabled(db, False)
        finally:
            db.close()

    def test_viewer_can_read_snapshot(self):
        client = _make_client("viewer")
        r = client.get("/api/telemetry/upstreams")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertIn("collector_status", body)
        self.assertEqual(body["collector_status"], "disabled")
        self.assertEqual(body["items"], [])

    def test_viewer_cannot_toggle(self):
        client = _make_client("viewer")
        r = client.post("/api/telemetry/upstreams/toggle?enabled=true")
        self.assertIn(r.status_code, (401, 403))
        snap = UpstreamSilenceDetector.instance().snapshot()
        self.assertEqual(snap["collector_status"], "disabled")

    def test_admin_toggle_off_keeps_disabled(self):
        client = _make_client("admin")
        r = client.post("/api/telemetry/upstreams/toggle?enabled=false")
        self.assertEqual(r.status_code, 200, r.text)
        snap = UpstreamSilenceDetector.instance().snapshot()
        self.assertEqual(snap["collector_status"], "disabled")
        self.assertFalse(snap["running"])

    def test_admin_toggle_on_when_binary_missing_is_degraded(self):
        """Honest degradation: binary missing ⇒ status='degraded' + last_error,
        nunca fingir sucesso. Não derruba o restante da telemetria."""
        client = _make_client("admin")
        with patch("app.services.upstream_silence_service.shutil.which", return_value=None):
            r = client.post("/api/telemetry/upstreams/toggle?enabled=true")
            self.assertEqual(r.status_code, 200, r.text)
            body = r.json()
            self.assertTrue(body["enabled"])
            result = body["result"]
            self.assertEqual(result["status"], "degraded")
            self.assertIsNotNone(result["last_error"])
            r2 = client.get("/api/telemetry/status")
            self.assertEqual(r2.status_code, 200)
        client.post("/api/telemetry/upstreams/toggle?enabled=false")

    def test_no_generators_invoked_by_toggle(self):
        """GUARD: o toggle é puramente observacional — nenhum generator
        de nftables/unbound pode ser chamado."""
        client = _make_client("admin")
        called = []
        from app.generators import nftables_generator, unbound_generator, ip_blocking_generator
        with patch.object(nftables_generator, "generate_nftables_config", side_effect=lambda *a, **k: called.append("nft") or ""), \
             patch.object(unbound_generator, "generate_unbound_configs", side_effect=lambda *a, **k: called.append("unb") or {}), \
             patch.object(ip_blocking_generator, "generate_ip_blocking_configs", side_effect=lambda *a, **k: called.append("ipb") or {}):
            client.post("/api/telemetry/upstreams/toggle?enabled=false")
            client.get("/api/telemetry/upstreams")
        self.assertEqual(called, [], f"generators must NOT be invoked: {called}")


class ConfigEndpointTest(unittest.TestCase):
    """v1.1 — windows / cap / alert_threshold são autoritativos no backend."""

    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        UpstreamSilenceDetector.instance().reset_for_test()
        db = SessionLocal()
        try:
            # Clean previous settings rows so defaults are deterministic.
            from app.models.log_entry import Setting
            for k in (
                uss.SETTING_WINDOW_SHORT,
                uss.SETTING_WINDOW_LONG,
                uss.SETTING_SNAPSHOT_CAP,
                uss.SETTING_ALERT_THRESHOLD,
                uss.SETTING_ALERT_WINDOW,
            ):
                row = db.query(Setting).filter(Setting.key == k).first()
                if row:
                    db.delete(row)
            db.commit()
        finally:
            db.close()

    def test_viewer_can_read_config(self):
        client = _make_client("viewer")
        r = client.get("/api/telemetry/upstreams/config")
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(body["config"]["window_short"], uss.DEFAULT_WINDOW_SHORT)
        self.assertEqual(body["bounds"]["window_seconds"]["max"], uss.MAX_WINDOW)

    def test_viewer_cannot_patch_config(self):
        client = _make_client("viewer")
        r = client.patch("/api/telemetry/upstreams/config", json={"window_short": 120})
        self.assertIn(r.status_code, (401, 403))

    def test_admin_patch_clamps_out_of_range(self):
        client = _make_client("admin")
        r = client.patch("/api/telemetry/upstreams/config", json={
            "window_short": 999999,   # clamps to MAX_WINDOW
            "window_long": 10,        # clamps to MIN_WINDOW
            "snapshot_cap": -1,       # clamps to MIN_CAP
            "alert_threshold": 0,     # clamps to MIN_THRESHOLD
            "alert_window": "bogus",  # falls back to 'short'
        })
        self.assertEqual(r.status_code, 200, r.text)
        cfg = r.json()["config"]
        # short>long after clamp ⇒ swapped to keep short<=long.
        self.assertEqual(cfg["window_short"], uss.MIN_WINDOW)
        self.assertEqual(cfg["window_long"], uss.MAX_WINDOW)
        self.assertEqual(cfg["snapshot_cap"], uss.MIN_CAP)
        self.assertEqual(cfg["alert_threshold"], uss.MIN_THRESHOLD)
        self.assertEqual(cfg["alert_window"], "short")
        # Live detector reflects new config without restart.
        live = UpstreamSilenceDetector.instance().get_config()
        self.assertEqual(live["snapshot_cap"], uss.MIN_CAP)

    def test_admin_patch_rejects_non_numeric(self):
        client = _make_client("admin")
        r = client.patch("/api/telemetry/upstreams/config", json={"window_short": "abc"})
        self.assertEqual(r.status_code, 400, r.text)

    def test_config_round_trip_persists(self):
        client = _make_client("admin")
        r = client.patch("/api/telemetry/upstreams/config", json={
            "window_short": 120, "window_long": 600,
            "snapshot_cap": 50, "alert_threshold": 3, "alert_window": "long",
        })
        self.assertEqual(r.status_code, 200, r.text)
        r2 = client.get("/api/telemetry/upstreams/config")
        cfg = r2.json()["config"]
        self.assertEqual(cfg["window_short"], 120)
        self.assertEqual(cfg["alert_window"], "long")


class AlertDebounceTest(unittest.TestCase):
    """v1.1 — transição abaixo→acima emite UM evento; permanecer acima não
    emite novo evento; cair e voltar a subir emite outro."""

    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        UpstreamSilenceDetector.instance().reset_for_test()
        # Threshold baixo para o teste.
        UpstreamSilenceDetector.instance().apply_config({
            "window_short": 300, "window_long": 900,
            "snapshot_cap": 200, "alert_threshold": 2, "alert_window": "short",
        })

    def _ingest_unique_ips(self, n: int):
        det = UpstreamSilenceDetector.instance()
        now = time.time()
        for i in range(n):
            line = (
                f"[DESTROY] udp 17 30 src=10.0.0.1 dst=192.0.2.{i+1} "
                f"sport=33000 dport=53 [UNREPLIED] src=192.0.2.{i+1} "
                f"dst=10.0.0.1 sport=53 dport=33000"
            )
            det.ingest_for_test(line, ts=now)

    def test_rise_emits_once_then_steady_state_silent(self):
        det = UpstreamSilenceDetector.instance()
        self._ingest_unique_ips(3)  # 3 ≥ 2 → above
        t1 = det.consume_alert_transition()
        self.assertIsNotNone(t1)
        self.assertEqual(t1["direction"], "rise")
        # Repeated polls while still above: no further transition.
        self.assertIsNone(det.consume_alert_transition())
        self.assertIsNone(det.consume_alert_transition())

    def test_rearm_after_drop_then_rise_again(self):
        det = UpstreamSilenceDetector.instance()
        self._ingest_unique_ips(3)
        self.assertIsNotNone(det.consume_alert_transition())  # first rise
        # Drop below by resetting aggregates.
        det.reset_for_test()
        det.apply_config({
            "window_short": 300, "window_long": 900,
            "snapshot_cap": 200, "alert_threshold": 2, "alert_window": "short",
        })
        # Falling edge is observed (debounce reset), no event emitted.
        self.assertIsNone(det.consume_alert_transition())
        # New rise → new event.
        self._ingest_unique_ips(2)
        t2 = det.consume_alert_transition()
        self.assertIsNotNone(t2)
        self.assertEqual(t2["direction"], "rise")


class WorkerEmitTest(unittest.TestCase):
    """Worker emite 1 OperationalEvent por transição."""

    @classmethod
    def setUpClass(cls):
        init_db()

    def setUp(self):
        UpstreamSilenceDetector.instance().reset_for_test()
        UpstreamSilenceDetector.instance().apply_config({
            "window_short": 300, "window_long": 900,
            "snapshot_cap": 200, "alert_threshold": 2, "alert_window": "short",
        })

    def test_worker_persists_single_event_on_rise(self):
        from app.workers.upstream_silence_alert_worker import upstream_silence_alert_job
        det = UpstreamSilenceDetector.instance()
        now = time.time()
        for i in range(3):
            det.ingest_for_test(
                f"[DESTROY] udp 17 30 src=10.0.0.1 dst=198.51.100.{i+1} "
                f"sport=33000 dport=53 [UNREPLIED]", ts=now,
            )
        db = SessionLocal()
        try:
            from app.models.operational import OperationalEvent
            before = db.query(OperationalEvent).filter_by(
                event_type="telemetry.upstream_silence.alert"
            ).count()
        finally:
            db.close()
        r1 = upstream_silence_alert_job()
        self.assertEqual(r1.get("emitted"), 1)
        # Re-run while still above the threshold → no new event.
        r2 = upstream_silence_alert_job()
        self.assertEqual(r2.get("emitted"), 0)
        db = SessionLocal()
        try:
            from app.models.operational import OperationalEvent
            after = db.query(OperationalEvent).filter_by(
                event_type="telemetry.upstream_silence.alert"
            ).count()
        finally:
            db.close()
        self.assertEqual(after - before, 1)


if __name__ == "__main__":
    unittest.main()


class LocalOrOwnFilterTest(unittest.TestCase):
    """Filtra IPs locais/privados/CGNAT/link-local + denylist do host
    (egress/listeners/VIPs). IP público real continua passando."""

    def setUp(self):
        UpstreamSilenceDetector.instance().reset_for_test()

    def test_static_ranges_are_local(self):
        for ip in (
            "127.0.0.1", "10.0.0.5", "172.16.5.5", "192.168.1.1",
            "169.254.1.1", "100.126.0.10",  # CGNAT (listener interno)
            "::1", "fe80::1", "fc00::1", "fd12::1",
        ):
            self.assertTrue(uss.is_local_or_own(ip), f"{ip} deveria ser local")

    def test_public_ips_pass(self):
        for ip in ("8.8.8.8", "1.1.1.1", "45.232.215.18",
                   "2001:4860:4860::8888"):
            self.assertFalse(uss.is_local_or_own(ip), f"{ip} é público")

    def test_denylist_blocks_own_egress_and_vip(self):
        own = {"45.232.215.18", "4.2.2.5", "2620:119:35::35"}
        self.assertTrue(uss.is_local_or_own("45.232.215.18", own))
        self.assertTrue(uss.is_local_or_own("4.2.2.5", own))
        self.assertTrue(uss.is_local_or_own("2620:119:35::35", own))
        # Sibling IP de outra instância NÃO deve passar quando na denylist.
        self.assertTrue(uss.is_local_or_own("45.232.215.17", own | {"45.232.215.17"}))
        # IP público fora da denylist continua passando.
        self.assertFalse(uss.is_local_or_own("8.8.8.8", own))

    def test_invalid_ip_is_rejected(self):
        self.assertTrue(uss.is_local_or_own(""))
        self.assertTrue(uss.is_local_or_own("not-an-ip"))

    def test_collect_own_ips_from_payload(self):
        payload = {
            "hostIp": "203.0.113.10",
            "instances": [
                {"name": "u1", "exitIp": "45.232.215.17", "bindIp": "100.126.0.1",
                 "exitIpv6": "2001:db8:cafe::17"},
                {"name": "u2", "egressIpv4": "45.232.215.18/32"},
            ],
            "interceptedVips": [
                {"vipIp": "4.2.2.5", "vipIpv6": "2620:119:35::35"},
            ],
            "serviceVips": [{"ipv4": "192.0.2.50"}],
        }
        own = uss.collect_own_ips_from_payload(payload)
        for expected in ("203.0.113.10", "45.232.215.17", "45.232.215.18",
                         "100.126.0.1", "2001:db8:cafe::17",
                         "4.2.2.5", "2620:119:35::35", "192.0.2.50"):
            self.assertIn(expected, own, f"falta {expected} na denylist")

    def test_detector_drops_own_egress_event(self):
        det = UpstreamSilenceDetector.instance()
        det.set_own_ips({"45.232.215.18"})
        # Egress próprio: NÃO deve agregar.
        line_own = (
            "[DESTROY] udp 17 30 src=10.0.0.1 dst=45.232.215.18 "
            "sport=33000 dport=53 [UNREPLIED]"
        )
        self.assertFalse(det.ingest_for_test(line_own))
        # Público mudo: ainda agrega.
        line_pub = (
            "[DESTROY] udp 17 30 src=10.0.0.1 dst=8.8.8.8 "
            "sport=33000 dport=53 [UNREPLIED]"
        )
        self.assertTrue(det.ingest_for_test(line_pub))
        snap = det.snapshot()
        self.assertEqual(snap["unique_ips"], 1)
        self.assertEqual(snap["items"][0]["ip"], "8.8.8.8")
        self.assertEqual(snap["own_ips_count"], 1)

    def test_detector_drops_private_and_cgnat_without_denylist(self):
        det = UpstreamSilenceDetector.instance()
        # Sem denylist do host (degradação): ranges estáticos ainda filtram.
        for dst in ("100.126.0.10", "10.0.0.5", "192.168.1.1"):
            line = (
                f"[DESTROY] udp 17 30 src=10.0.0.1 dst={dst} "
                f"sport=33000 dport=53 [UNREPLIED]"
            )
            self.assertFalse(det.ingest_for_test(line), f"{dst} deveria ser dropado")
        self.assertEqual(det.snapshot()["unique_ips"], 0)


if __name__ == "__main__":  # pragma: no cover
    unittest.main()
