"""Tests for liveness-first health classification (iterative-aware).

A slow external recursion (dig) is latency telemetry only: it must NEVER
change status for a live unbound. Only real liveness/control signals qualify
as status triggers.
"""

import sys, types
# Stub sqlalchemy to allow importing health_service in isolation.
for mod in ("sqlalchemy", "sqlalchemy.orm"):
    sys.modules.setdefault(mod, types.ModuleType(mod))
sys.modules["sqlalchemy.orm"].Session = object  # type: ignore[attr-defined]
# Stub app.models.operational and app.executors.command_runner deps.
for mod in (
    "app.executors", "app.executors.command_runner",
    "app.models", "app.models.operational",
    "app.services.settings_service",
):
    sys.modules.setdefault(mod, types.ModuleType(mod))
sys.modules["app.executors.command_runner"].run_command = lambda *a, **k: {}  # type: ignore
for name in ("DnsInstance", "HealthCheck", "InstanceState", "OperationalEvent"):
    setattr(sys.modules["app.models.operational"], name, object)
sys.modules["app.services.settings_service"].get_health_settings = lambda db: {}  # type: ignore

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


def test_dig_timeout_alive_is_ok_not_degraded():
    # Iterative mode: cache-miss to roots can exceed probe timeout while
    # the resolver is perfectly healthy. Dig remains telemetry only.
    assert _classify_health(_r(dig="failed", dig_ms=5000), SETTINGS) == "ok"


def test_dig_slow_alive_is_ok():
    assert _classify_health(_r(dig_ms=500), SETTINGS) == "ok"


def test_systemd_down_is_failed():
    assert _classify_health(_r(systemd="failed"), SETTINGS) == "failed"


def test_port_not_bound_is_failed():
    assert _classify_health(_r(port="failed"), SETTINGS) == "failed"


def test_control_error_is_degraded():
    assert _classify_health(_r(control="degraded"), SETTINGS) == "degraded"


def test_explicit_control_failed_is_failed():
    assert _classify_health(_r(control="failed"), SETTINGS) == "failed"
