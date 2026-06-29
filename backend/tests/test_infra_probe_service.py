"""Tests for infra_probe_service — parses real dump_infra sample, classifies
providers, dedupes by IP, and tolerates per-instance failures.
"""

import sys
import types
from unittest.mock import patch


# Install a stub for egress_geo_service before infra_probe_service imports it
# inline (the real module pulls in httpx, which isn't installed in CI).
def _install_geo_stub(resolver):
    mod = types.ModuleType("app.services.egress_geo_service")
    mod.resolve_egress_geo = resolver  # type: ignore[attr-defined]
    sys.modules["app.services.egress_geo_service"] = mod


from app.services import infra_probe_service as svc


# Trimmed but real-shaped sample from `unbound-control dump_infra` (vdns-02).
SAMPLE_INSTANCE_1 = """\
2.16.166.130 e8960.b.akamaiedge.net. ttl 855 ping 71 var 5 rtt 91 rto 91 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
108.162.198.254 static.licdn.com.cdn.cloudflare.net. ttl 900 ping 12 var 2 rtt 22 rto 22 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
198.51.44.69 edge-web-gue1.dual-gslb.spotify.com. ttl 800 ping 95 var 7 rtt 115 rto 115 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
200.219.148.10 br. ttl 3600 ping 168 var 12 rtt 192 rto 192 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
192.5.5.241 . ttl 86400 ping 130 var 4 rtt 150 rto 150 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
205.251.193.50 awsdns-58.org. ttl 3600 ping 80 var 5 rtt 100 rto 100 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
"""

# Second instance has overlap on Akamai IP with a smaller rtt (dedupe must keep it).
SAMPLE_INSTANCE_2 = """\
2.16.166.130 e8960.b.akamaiedge.net. ttl 855 ping 40 var 5 rtt 55 rto 55 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
142.250.79.78 google.com. ttl 300 ping 18 var 2 rtt 30 rto 30 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 lame 0 dnssec_lame 0 reclame 0
"""


def test_parse_dump_infra_extracts_core_fields():
    rows = svc.parse_dump_infra(SAMPLE_INSTANCE_1)
    assert len(rows) == 6
    akamai = next(r for r in rows if r["ip"] == "2.16.166.130")
    assert akamai["zone"] == "e8960.b.akamaiedge.net"
    assert akamai["rtt_ms"] == 91
    assert akamai["family"] == "ipv4"
    assert akamai["lame"] is False


def test_classify_provider_matrix():
    assert svc.classify_provider("2.16.166.130", "e8960.b.akamaiedge.net") == "Akamai"
    assert svc.classify_provider("108.162.198.254", "static.licdn.com.cdn.cloudflare.net") == "Cloudflare"
    assert svc.classify_provider("198.51.44.69", "edge-web-gue1.dual-gslb.spotify.com") == "Spotify"
    assert svc.classify_provider("200.219.148.10", "br.") == "TLD"
    assert svc.classify_provider("192.5.5.241", ".") == "Root"
    assert svc.classify_provider("205.251.193.50", "awsdns-58.org") == "AWS"
    # IP-range fallback when zone is opaque
    assert svc.classify_provider("104.16.1.2", "opaque.example") == "Cloudflare"
    assert svc.classify_provider("203.0.113.10", "unknown.example") == "Other"


def test_get_infra_entries_dedupes_and_classifies(monkeypatch):
    calls = []

    def fake_run(socket, conf, timeout=6):
        calls.append(socket)
        if socket.endswith("11@8953"):
            return SAMPLE_INSTANCE_1
        if socket.endswith("12@8953"):
            return SAMPLE_INSTANCE_2
        # Simulate an instance with a dead socket — best-effort: empty.
        return ""

    monkeypatch.setattr(svc, "_run_dump_infra", fake_run)
    entries = svc.get_infra_entries()

    # All 4 instances queried (even when some return empty).
    assert len(calls) == 4

    by_ip = {e["ip"]: e for e in entries}
    # Dedup by IP — only one Akamai row, and it keeps the smaller rtt (55 from instance 2).
    assert by_ip["2.16.166.130"]["rtt_ms"] == 55
    assert by_ip["2.16.166.130"]["provider"] == "Akamai"
    assert by_ip["192.5.5.241"]["provider"] == "Root"
    assert by_ip["200.219.148.10"]["provider"] == "TLD"
    assert by_ip["205.251.193.50"]["provider"] == "AWS"
    assert by_ip["142.250.79.78"]["provider"] == "Google"

    # Providers represented: at least Akamai, Cloudflare, Spotify, TLD, Root, AWS, Google.
    providers = {e["provider"] for e in entries}
    assert {"Akamai", "Cloudflare", "Spotify", "TLD", "Root", "AWS", "Google"} <= providers


def test_per_instance_failure_does_not_break_aggregation(monkeypatch):
    def fake_run(socket, conf, timeout=6):
        if socket.endswith("11@8953"):
            return SAMPLE_INSTANCE_1
        raise RuntimeError("socket down")

    # _run_dump_infra wraps run_command in try/except, so we patch run_command itself
    # to exercise the real best-effort path.
    def fake_run_command(executable, args, timeout=5, use_privilege=False):
        socket = args[args.index("-s") + 1]
        if socket.endswith("11@8953"):
            return {"exit_code": 0, "stdout": SAMPLE_INSTANCE_1, "stderr": "", "duration_ms": 1}
        return {"exit_code": 1, "stdout": "", "stderr": "connect: connection refused", "duration_ms": 1}

    with patch("app.services.infra_probe_service.run_command", side_effect=fake_run_command):
        entries = svc.get_infra_entries()

    # Got entries from the one working instance — others didn't crash the call.
    assert len(entries) == 6
    assert any(e["provider"] == "Akamai" for e in entries)


# ── PROMPT 2: state, geo budget, snapshot ─────────────────────────────────

def _make_dump(n_cloudflare: int, n_other: int) -> str:
    """Synthesize a dump_infra block with n CF + n unknown rows."""
    lines = []
    for i in range(n_cloudflare):
        ip = f"104.16.{i // 256}.{i % 256}"
        lines.append(
            f"{ip} cdn{i}.example.cloudflare.net. ttl 900 ping 10 var 2 "
            f"rtt 22 rto 22 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 "
            f"lame 0 dnssec_lame 0 reclame 0"
        )
    for i in range(n_other):
        ip = f"203.0.113.{i}"
        lines.append(
            f"{ip} weird-zone-{i}.example. ttl 800 ping 200 var 12 "
            f"rtt 250 rto 250 tA 0 tAAAA 0 tother 0 ednsknown 1 edns 0 delay 0 "
            f"lame 0 dnssec_lame 0 reclame 0"
        )
    return "\n".join(lines)


def test_run_probe_cycle_respects_geo_topn_and_prioritizes_big_cdns(monkeypatch):
    svc.reset_state_for_tests()
    # 100 IPs total — well above the 8/cycle geo budget — split between a
    # big CDN (Cloudflare) and "Other". We expect only the top-N to be
    # geo-resolved, and they MUST be Cloudflare rows (big-CDN priority).
    monkeypatch.setattr(svc, "_run_dump_infra", lambda s, c, timeout=6: _make_dump(50, 50))

    geo_calls: list[str] = []

    def fake_geo(ip):
        geo_calls.append(ip)
        return {"ip": ip, "lat": 0.0, "lng": 0.0, "city": "X", "region": None,
                "country": "X", "isp": None, "asn": None}

    # Patch the service used inside infra_probe + the egress refresh import path.
    _install_geo_stub(fake_geo)
    # Skip egress refresh (dig not available in CI; just no-op).
    monkeypatch.setattr(svc, "_refresh_egress", lambda: None)

    n = svc.run_probe_cycle()
    assert n == 100

    # Hard rate cap respected — no more than _GEO_TOPN_PER_CYCLE HTTP calls.
    assert len(geo_calls) <= svc._GEO_TOPN_PER_CYCLE
    assert len(geo_calls) == svc._GEO_TOPN_PER_CYCLE  # we had plenty of candidates

    # Every IP that got geo'd was a Cloudflare IP (big-CDN priority kicked in).
    assert all(ip.startswith("104.16.") for ip in geo_calls)


def test_get_cdn_snapshot_orders_providers_by_count_and_aggregates(monkeypatch):
    svc.reset_state_for_tests()
    monkeypatch.setattr(svc, "_run_dump_infra", lambda s, c, timeout=6:
                        SAMPLE_INSTANCE_1 if s.endswith("11@8953") else SAMPLE_INSTANCE_2)
    _install_geo_stub(lambda ip: None)
    monkeypatch.setattr(svc, "_refresh_egress", lambda: None)
    svc.run_probe_cycle()

    snap = svc.get_cdn_snapshot()
    assert "ts" in snap and "providers" in snap
    providers = {p["provider"]: p for p in snap["providers"]}
    # All real providers from the sample show up.
    for p in ("Akamai", "Cloudflare", "Google", "AWS", "Spotify", "Root", "TLD"):
        assert p in providers, f"missing provider {p} in {list(providers)}"
    # Providers sorted by count desc.
    counts = [p["count"] for p in snap["providers"]]
    assert counts == sorted(counts, reverse=True)
    # Per-provider entries carry rtt + flags.
    cf = providers["Cloudflare"]["entries"][0]
    assert "rtt_ms" in cf and "zone" in cf and "lame" in cf and "dnssec_lame" in cf


# ── FIX-EGRESS-LABEL-MAP ──────────────────────────────────────────────────

def test_get_cdn_snapshot_exposes_real_egress_ips_from_dns_instances(monkeypatch):
    """Snapshot must surface DnsInstance.outgoing_ip as egress.ips and
    derive a block label, instead of leaving only the ECS '.0' as origin."""
    svc.reset_state_for_tests()
    monkeypatch.setattr(svc, "_run_dump_infra", lambda s, c, timeout=6:
                        SAMPLE_INSTANCE_1 if s.endswith("11@8953") else "")
    _install_geo_stub(lambda ip: None)
    monkeypatch.setattr(svc, "_refresh_egress", lambda: None)
    svc.run_probe_cycle()

    # Inject an ECS-derived egress (what the world sees, ends in .0)
    with svc._EGRESS_LOCK:
        svc._EGRESS.update({
            "ip": "45.232.215.0",
            "ecs": "45.232.215.0/24",
            "geo": {"ip": "45.232.215.0", "lat": -22.5, "lng": -55.7,
                    "city": "Ponta Porã", "region": None, "country": "BR",
                    "isp": None, "asn": None},
            "ts": 1.0,
        })

    # Stub app.core.database (real one needs sqlalchemy, not present in CI).
    class _FakeInst:
        def __init__(self, ip): self.outgoing_ip = ip
    class _FakeQuery:
        def all(self): return [_FakeInst("45.232.215.16"), _FakeInst("45.232.215.17"),
                               _FakeInst("45.232.215.18"), _FakeInst("45.232.215.19")]
    class _FakeDB:
        def query(self, _): return _FakeQuery()
        def close(self): pass
    dbmod = types.ModuleType("app.core.database")
    dbmod.SessionLocal = lambda: _FakeDB()  # type: ignore[attr-defined]
    sys.modules["app.core.database"] = dbmod
    opmod = types.ModuleType("app.models.operational")
    opmod.DnsInstance = object  # type: ignore[attr-defined]
    sys.modules["app.models.operational"] = opmod


    snap = svc.get_cdn_snapshot()
    eg = snap["egress"]
    assert eg is not None
    assert eg["ips"] == ["45.232.215.16", "45.232.215.17",
                        "45.232.215.18", "45.232.215.19"]
    assert eg["block"] == "45.232.215.0/24"
    assert eg["ecs"] == "45.232.215.0/24"
    # Legacy 'ip' must NOT be the misleading .0 — it's the first real egress.
    assert eg["ip"] == "45.232.215.16"
    assert eg["geo"]["city"] == "Ponta Porã"


def test_get_cdn_snapshot_falls_back_when_outgoing_ip_unavailable(monkeypatch):
    svc.reset_state_for_tests()
    monkeypatch.setattr(svc, "_run_dump_infra", lambda s, c, timeout=6: "")
    _install_geo_stub(lambda ip: None)
    monkeypatch.setattr(svc, "_refresh_egress", lambda: None)

    with svc._EGRESS_LOCK:
        svc._EGRESS.update({"ip": "203.0.113.5", "ecs": None, "geo": None, "ts": 1.0})

    # DB query raises — snapshot must still work.
    import app.core.database as dbmod
    def _boom(): raise RuntimeError("db down")
    monkeypatch.setattr(dbmod, "SessionLocal", _boom)

    snap = svc.get_cdn_snapshot()
    eg = snap["egress"]
    assert eg is not None
    assert eg["ip"] == "203.0.113.5"
    assert eg["ips"] == []
