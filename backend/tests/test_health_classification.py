"""Tests for liveness-first health classification (iterative-aware).

A slow external recursion (dig) must NEVER mark a live unbound as "failed".
Only systemd-inactive, port-not-bound, or unbound-control-not-responding
qualify as "failed".
"""

from app.services.health_service import _classify_health


SETTINGS = {"latency_warn_ms": 50}


def _r(systemd="ok", port="ok", dig="ok", dig_ms=10, control="ok"):
    return {
        "systemd": {"status": systemd},
        "port": {"status": port},
        "dig": {"status": dig, "latency_ms": dig_ms},
        "unbound_stats": {"status": control},
    }


def test_all_ok():
    assert _classify_health(_r(), SETTINGS) == "ok"


def test_dig_timeout_alive_is_degraded_not_failed():
    # Iterative mode: cache-miss to roots can exceed probe timeout while
    # the resolver is perfectly healthy. Must NOT be "failed".
    assert _classify_health(_r(dig="failed", dig_ms=5000), SETTINGS) == "degraded"


def test_dig_slow_alive_is_degraded():
    assert _classify_health(_r(dig_ms=500), SETTINGS) == "degraded"


def test_systemd_down_is_failed():
    assert _classify_health(_r(systemd="failed"), SETTINGS) == "failed"


def test_port_not_bound_is_failed():
    assert _classify_health(_r(port="failed"), SETTINGS) == "failed"


def test_control_not_responding_is_failed():
    assert _classify_health(_r(control="degraded"), SETTINGS) == "failed"
