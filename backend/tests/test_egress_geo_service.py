"""Tests for egress_geo_service (read-only, mocked httpx)."""

from __future__ import annotations

import httpx
import pytest
from unittest.mock import patch, MagicMock

from app.services import egress_geo_service as geo


@pytest.fixture(autouse=True)
def _reset_cache():
    geo.reset_cache_for_tests()
    yield
    geo.reset_cache_for_tests()


def _mock_response(status_code=200, json_data=None):
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = json_data or {}
    return r


def test_resolve_egress_geo_success_parses_ip_api():
    payload = {
        "status": "success",
        "country": "Brazil", "regionName": "São Paulo", "city": "Campinas",
        "lat": -22.9, "lon": -47.06,
        "isp": "Example Telecom", "as": "AS65000 Example",
        "query": "45.232.215.16",
    }
    with patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = _mock_response(200, payload)
        out = geo.resolve_egress_geo("45.232.215.16")
    assert out is not None
    assert out["ip"] == "45.232.215.16"
    assert out["city"] == "Campinas"
    assert out["region"] == "São Paulo"
    assert out["country"] == "Brazil"
    assert out["lat"] == pytest.approx(-22.9)
    assert out["lng"] == pytest.approx(-47.06)
    assert out["isp"] == "Example Telecom"
    assert out["asn"] == "AS65000 Example"


def test_resolve_egress_geo_caches_second_call_does_not_hit_api():
    payload = {"status": "success", "lat": 1.0, "lon": 2.0, "city": "X"}
    with patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = _mock_response(200, payload)
        geo.resolve_egress_geo("45.232.215.16")
        geo.resolve_egress_geo("45.232.215.16")
        geo.resolve_egress_geo("45.232.215.16")
        # Only ONE network call despite three resolves.
        assert mock_client.return_value.__enter__.return_value.get.call_count == 1


def test_resolve_egress_geo_timeout_returns_none_and_negcaches():
    with patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.side_effect = httpx.TimeoutException("slow")
        out = geo.resolve_egress_geo("45.232.215.17")
        assert out is None
        # Negative cache: second call doesn't re-hit
        out2 = geo.resolve_egress_geo("45.232.215.17")
        assert out2 is None
        assert mock_client.return_value.__enter__.return_value.get.call_count == 1


def test_resolve_egress_geo_429_rate_limit_returns_none():
    with patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = _mock_response(429, {})
        out = geo.resolve_egress_geo("45.232.215.18")
    assert out is None


def test_resolve_egress_geo_api_status_fail_returns_none():
    payload = {"status": "fail", "message": "private range"}
    with patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = _mock_response(200, payload)
        out = geo.resolve_egress_geo("10.0.0.1")
    assert out is None


def test_resolve_egress_geo_none_input_returns_none():
    assert geo.resolve_egress_geo(None) is None
    assert geo.resolve_egress_geo("") is None


def test_snapshot_includes_egress_geo():
    from app.services import upstream_probe_service as ups

    ups.reset_state_for_tests()

    def _probe(ip):
        return ups.UpstreamProbeResult(
            ip=ip, alive=True, rtt_ms=18.0, pop_code="gru17", pop_raw="gru17",
            pop_method="CH TXT id.server", egress_ip="45.232.215.0",
            ecs="45.232.215.0/24",
        )

    payload = {
        "status": "success", "city": "Campinas", "regionName": "SP",
        "country": "Brazil", "lat": -22.9, "lon": -47.06,
        "isp": "Telecom", "as": "AS65000",
    }
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]), \
         patch.object(ups, "probe_upstream", side_effect=lambda ip, with_path=False: _probe(ip)), \
         patch.object(geo.httpx, "Client") as mock_client:
        mock_client.return_value.__enter__.return_value.get.return_value = _mock_response(200, payload)
        ups.run_probe_cycle()
        snap = ups.get_state_snapshot()

    assert snap["egress"] is not None
    assert snap["egress"]["ip"] == "45.232.215.0"
    assert snap["egress"]["ecs"] == "45.232.215.0/24"
    assert snap["egress"]["geo"] is not None
    assert snap["egress"]["geo"]["city"] == "Campinas"
    assert snap["egress"]["geo"]["lat"] == pytest.approx(-22.9)
    assert snap["egress"]["geo"]["lng"] == pytest.approx(-47.06)
