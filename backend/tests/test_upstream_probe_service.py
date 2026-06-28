"""Tests for upstream_probe_service (read-only, mocked subprocess)."""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from app.services import upstream_probe_service as ups


def _make_completed(stdout: str = "", returncode: int = 0, stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_probe_pop_cloudflare_id_server():
    def fake_run(cmd, **kwargs):
        if "id.server" in cmd:
            return _make_completed(stdout='"gru17"\n')
        return _make_completed(returncode=1)

    with patch.object(ups.shutil, "which", return_value="/usr/bin/dig"), \
         patch.object(ups.subprocess, "run", side_effect=fake_run):
        out = ups.probe_pop("1.1.1.1")
    assert out["pop_code"] == "gru17"
    assert out["raw"] == "gru17"
    assert "id.server" in out["method"]


def test_probe_pop_google_myaddr():
    def fake_run(cmd, **kwargs):
        if "id.server" in cmd or "hostname.bind" in cmd:
            return _make_completed(returncode=1)
        if "o-o.myaddr.l.google.com" in cmd:
            return _make_completed(
                stdout='"45.232.215.0"\n"edns0-client-subnet 45.232.215.0/24"\n'
            )
        return _make_completed(returncode=1)

    with patch.object(ups.shutil, "which", return_value="/usr/bin/dig"), \
         patch.object(ups.subprocess, "run", side_effect=fake_run):
        out = ups.probe_pop("8.8.8.8")
    assert out["egress_ip"] == "45.232.215.0"
    assert out["ecs"] and "45.232.215.0/24" in out["ecs"]
    assert "myaddr" in out["method"]


def test_probe_latency_ping_avg():
    ping_out = (
        "PING 1.1.1.1 (1.1.1.1) 56 data bytes\n"
        "rtt min/avg/max/mdev = 18.123/18.812/19.500/0.512 ms\n"
    )

    def fake_which(name):
        return f"/usr/bin/{name}"

    with patch.object(ups.shutil, "which", side_effect=fake_which), \
         patch.object(ups.subprocess, "run", return_value=_make_completed(stdout=ping_out)):
        alive, rtt = ups.probe_latency("1.1.1.1")
    assert alive is True
    assert rtt and 18 < rtt < 19


def test_probe_upstream_full_flow_alive():
    def fake_which(name):
        return f"/usr/bin/{name}"

    def fake_run(cmd, **kwargs):
        if cmd[0] == "ping":
            return _make_completed(
                stdout="rtt min/avg/max/mdev = 15.1/15.7/16.0/0.2 ms\n"
            )
        if cmd[0] == "dig" and "id.server" in cmd:
            return _make_completed(stdout='"gru17"\n')
        return _make_completed(returncode=1)

    with patch.object(ups.shutil, "which", side_effect=fake_which), \
         patch.object(ups.subprocess, "run", side_effect=fake_run):
        r = ups.probe_upstream("1.1.1.1")
    assert r.alive is True
    assert r.rtt_ms and 15 < r.rtt_ms < 16
    assert r.pop_code == "gru17"
    d = r.to_dict()
    assert d["ip"] == "1.1.1.1" and d["alive"] is True


def test_probe_upstream_dead_when_everything_fails():
    with patch.object(ups.shutil, "which", return_value=None):
        r = ups.probe_upstream("203.0.113.1")
    assert r.alive is False
    assert r.rtt_ms is None
    assert r.pop_code is None


def test_probe_all_uses_state_forwarders():
    state = {"forwardAddrs": ["1.1.1.1", "8.8.8.8"]}
    with patch.object(ups, "probe_upstream") as m:
        m.side_effect = lambda ip, with_path=False: ups.UpstreamProbeResult(ip=ip, alive=True, rtt_ms=10.0)
        results = ups.probe_all(state=state)
    assert [r["ip"] for r in results] == ["1.1.1.1", "8.8.8.8"]
    assert all(r["alive"] for r in results)


def test_probe_pop_timeout_is_swallowed():
    def fake_run(cmd, timeout=None, **kwargs):
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=timeout or 1)

    with patch.object(ups.shutil, "which", return_value="/usr/bin/dig"), \
         patch.object(ups.subprocess, "run", side_effect=fake_run):
        out = ups.probe_pop("192.0.2.1")
    assert out["pop_code"] is None
    assert out["egress_ip"] is None
