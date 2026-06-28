"""Tests for the IATA → city/lat/lng resolver and snapshot integration."""

from __future__ import annotations

from unittest.mock import patch

from app.services import upstream_probe_service as ups
from app.services.iata_geo import extract_iata, resolve_pop_geo


def test_extract_iata_basic():
    assert extract_iata("gru17") == "GRU"
    assert extract_iata("GIG01") == "GIG"
    assert extract_iata("lhr") == "LHR"
    assert extract_iata("CWB") == "CWB"


def test_extract_iata_invalid():
    assert extract_iata(None) is None
    assert extract_iata("") is None
    assert extract_iata("12abc") is None


def test_resolve_pop_geo_known():
    geo = resolve_pop_geo("gru17")
    assert geo and geo["iata"] == "GRU"
    assert geo["city"] == "São Paulo"
    assert geo["country"] == "BR"
    assert -24 < geo["lat"] < -23
    assert -47 < geo["lng"] < -46


def test_resolve_pop_geo_rio():
    geo = resolve_pop_geo("gig01")
    assert geo and geo["iata"] == "GIG"
    assert geo["city"] == "Rio de Janeiro"


def test_resolve_pop_geo_us_and_eu():
    assert resolve_pop_geo("mia")["city"] == "Miami"
    assert resolve_pop_geo("lhr03")["city"] == "London"
    assert resolve_pop_geo("FRA")["city"] == "Frankfurt"


def test_resolve_pop_geo_unknown_returns_none():
    assert resolve_pop_geo("xyz99") is None
    assert resolve_pop_geo(None) is None
    assert resolve_pop_geo("") is None


def _probe(ip, pop="gru17"):
    return ups.UpstreamProbeResult(
        ip=ip, alive=True, rtt_ms=18.0, pop_code=pop,
        pop_raw=pop, pop_method="CH TXT id.server",
    )


def test_snapshot_includes_current_geo_and_history_geo():
    ups.reset_state_for_tests()
    with patch.object(ups, "get_upstreams", return_value=["1.1.1.1"]):
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gru17")):
            ups.run_probe_cycle()
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="gig01")):
            ups.run_probe_cycle()
        with patch.object(ups, "probe_upstream", return_value=_probe("1.1.1.1", pop="xyz99")):
            ups.run_probe_cycle()

    entry = ups.get_state_snapshot()["upstreams"][0]
    assert entry["current_pop"] == "xyz99"
    # Unknown PoP → current_geo is None, but field is present
    assert entry["current_geo"] is None
    # History contains 3 entries, GRU and GIG resolved, XYZ not
    geos = [h["geo"] for h in entry["history"]]
    cities = [g["city"] if g else None for g in geos]
    assert cities == ["São Paulo", "Rio de Janeiro", None]
