"""
Ensure that in pure Interception mode (no explicit "Own VIP"), the persisted
deploy state derives `frontendDnsIp` from `interceptedVips[0]` instead of
leaving it blank and letting the UI fall back to anycast/egress.
"""
import json
import os
import tempfile
from unittest.mock import patch


def _save_and_read(payload: dict) -> dict:
    from app.services import deploy_service

    with tempfile.TemporaryDirectory() as td:
        state_file = os.path.join(td, "state.json")
        with patch.object(deploy_service, "DEPLOY_STATE_FILE", state_file), \
             patch.object(deploy_service, "BACKUP_ROOT", td), \
             patch.object(deploy_service, "get_deploy_state", return_value={"totalDeployments": 0}):
            deploy_service._save_deploy_state(
                deploy_id="t-001", operator="test", success=True,
                backup_id=None, payload=payload,
            )
            with open(state_file) as f:
                return json.load(f)


def test_pure_interception_derives_frontend_from_intercepted_vip():
    payload = {
        "operationMode": "interception",
        "frontendDnsIp": "",
        "interceptedVips": [
            {"vipIp": "4.2.2.5", "vipIpv6": "2620:119:35::35"},
        ],
    }
    state = _save_and_read(payload)
    assert state["frontendDnsIp"] == "4.2.2.5"
    assert state["frontendDnsIpv6"] == "2620:119:35::35"
    assert state["interceptedVips"] == ["4.2.2.5"]
    assert state["interceptedVipsIpv6"] == ["2620:119:35::35"]


def test_own_vip_takes_priority_over_intercepted():
    payload = {
        "operationMode": "interception",
        "frontendDnsIp": "172.250.40.3",
        "interceptedVips": [{"vipIp": "4.2.2.5"}],
    }
    state = _save_and_read(payload)
    assert state["frontendDnsIp"] == "172.250.40.3"
    assert state["interceptedVips"] == ["4.2.2.5"]


def test_simple_mode_without_intercepted_keeps_explicit_only():
    payload = {
        "operationMode": "simple",
        "frontendDnsIp": "172.250.40.3",
        "interceptedVips": [],
    }
    state = _save_and_read(payload)
    assert state["frontendDnsIp"] == "172.250.40.3"
    assert state["interceptedVips"] == []


def test_simple_mode_does_not_derive_from_intercepted():
    # Defensive: even if interceptedVips leaks into a simple-mode payload,
    # we don't promote it to Frontend DNS (different operational semantics).
    payload = {
        "operationMode": "simple",
        "frontendDnsIp": "",
        "interceptedVips": [{"vipIp": "4.2.2.5"}],
    }
    state = _save_and_read(payload)
    assert state["frontendDnsIp"] == ""
