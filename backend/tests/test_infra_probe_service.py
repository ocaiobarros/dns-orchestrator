"""Tests for infra_probe_service — parses real dump_infra sample, classifies
providers, dedupes by IP, and tolerates per-instance failures.
"""

from unittest.mock import patch

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
