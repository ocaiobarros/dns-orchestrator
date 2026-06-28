"""Tests for upstream_probe_service state cache + worker integration."""

from __future__ import annotations

import time
from unittest.mock import patch

from app.services import upstream_probe_service as ups
from app.workers import upstream_probe_worker as worker


def _probe(ip, alive=True, pop="gru17", rtt=18.5, egress=None):
    return ups.UpstreamProbeResult(
        ip=ip, alive=alive, rtt_ms=rtt, pop_code=pop,
        pop_raw=pop, pop_method="CH TXT id.server",
        egress_ip=egress,
    )


def setup_function(_):
    ups.reset_state_for_tests()


def test_run_probe_cycle_populates_state_and_snapshot():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1", "8.8.8.8"]), \
         patch.object(ups, "probe_upstream", side_effect=lambda ip, with_path=False: _probe(
             ip, pop="gru17" if ip == "1.1.1.1" else "lhr01",
             rtt=18.0 if ip == "1.1.1.1" else 120.0,
             egress="45.232.215.0" if ip == "8.8.8.8" else None,
         )):
        ups.run_probe_cycle()

    snap = ups.get_state_snapshot()
    by_ip = {u["ip"]: u for u in snap["upstreams"]}
    assert by_ip["1.1.1.1"]["alive"] is True
    assert by_ip["1.1.1.1"]["current_pop"] == "gru17"
    assert by_ip["1.1.1.1"]["status"] == "current"
    assert len(by_ip["1.1.1.1"]["history"]) == 1
    assert by_ip["8.8.8.8"]["current_pop"] == "lhr01"
    assert snap["egress"] and snap["egress"]["ip"] == "45.232.215.0"


def test_pop_change_pushes_history():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gru17")):
            ups.run_probe_cycle()
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gig01")):
            ups.run_probe_cycle()

    snap = ups.get_state_snapshot()
    entry = snap["upstreams"][0]
    assert entry["current_pop"] == "gig01"
    pops = [h["pop_code"] for h in entry["history"]]
    assert pops == ["gru17", "gig01"]


def test_alive_to_dead_transition_sets_down_since_and_status():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gru17")):
            ups.run_probe_cycle()
        # Now upstream goes silent
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", alive=False, pop=None, rtt=None)):
            ups.run_probe_cycle()

    snap = ups.get_state_snapshot()
    entry = snap["upstreams"][0]
    assert entry["alive"] is False
    assert entry["status"] == "down"
    assert entry["down_since_ts"] is not None
    assert entry["down_for_s"] is not None and entry["down_for_s"] >= 0
    # Current PoP is preserved while down so the UI can show "last known".
    assert entry["current_pop"] == "gru17"


def test_dead_then_alive_clears_down_since():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", alive=False, pop=None, rtt=None)):
            ups.run_probe_cycle()
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gru17")):
            ups.run_probe_cycle()

    entry = ups.get_state_snapshot()["upstreams"][0]
    assert entry["alive"] is True
    assert entry["down_since_ts"] is None
    assert entry["status"] == "current"


def test_retire_after_long_silence():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", alive=False, pop=None, rtt=None)):
            ups.run_probe_cycle()
    # Backdate down_since beyond the retire window
    with ups._STATE_LOCK:
        ups._STATE["1.1.1.1"]["down_since_ts"] = time.time() - (ups._DOWN_RETIRE_AFTER_S + 10)

    snap = ups.get_state_snapshot()
    assert snap["upstreams"] == []  # retired entries hidden by default
    snap_full = ups.get_state_snapshot(include_retired=True)
    assert snap_full["upstreams"][0]["status"] == "retired"


def test_worker_job_runs_cycle():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]), \
         patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1")):
        worker.upstream_probe_job()
    snap = ups.get_state_snapshot()
    assert snap["upstreams"] and snap["upstreams"][0]["ip"] == "1.1.1.1"


def test_history_capped_at_max():
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        for i in range(ups._HISTORY_MAX + 5):
            with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop=f"pop{i:02d}")):
                ups.run_probe_cycle()
    entry = ups.get_state_snapshot()["upstreams"][0]
    assert len(entry["history"]) == ups._HISTORY_MAX
    assert entry["current_pop"].startswith("pop")
