"""Egress geoIP service (read-only).

Resolves the REAL physical location of the user's own egress IPs (e.g.
``45.232.215.16``) via a public geoIP HTTP API. Used by the upstream-probe
snapshot so the map plots the origin at the user's actual location instead
of the median of remote PoPs.

Strict rules:
- Only the user's OWN egress IPs are resolved (public infra). Client IPs
  are NEVER geolocated here.
- Read-only: no writes to disk, config, or production state.
- Cached aggressively (egress geo is effectively static).
- Failures are swallowed; the worker keeps running.

Default provider is ip-api.com (free tier: 45 req/min, HTTP-only on the
free endpoint). Configurable via the ``DNS_CONTROL_GEOIP_URL`` env var,
which must contain ``{ip}`` as the placeholder.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# 24h: geo of our own infra IPs barely changes.
_CACHE_TTL_S = 24 * 60 * 60
# Negative cache (failures, 429) — short so we recover quickly.
_NEG_CACHE_TTL_S = 5 * 60
_HTTP_TIMEOUT_S = 3.0

# ip-api.com free endpoint. Cached + low call rate keeps us well under
# the 45 req/min budget for a handful of egress IPs.
_DEFAULT_URL = "http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,lat,lon,isp,as,query"


def _provider_url() -> str:
    return os.environ.get("DNS_CONTROL_GEOIP_URL", _DEFAULT_URL)


_CACHE_LOCK = threading.Lock()
# ip -> (expires_at_ts, value_or_None)
_CACHE: dict[str, tuple[float, dict[str, Any] | None]] = {}


def _cache_get(ip: str) -> tuple[bool, dict[str, Any] | None]:
    """Return (hit, value). hit=True even for cached negatives (value=None)."""
    now = time.time()
    with _CACHE_LOCK:
        entry = _CACHE.get(ip)
        if entry and entry[0] > now:
            return True, entry[1]
        if entry:
            _CACHE.pop(ip, None)
    return False, None


def _cache_put(ip: str, value: dict[str, Any] | None) -> None:
    ttl = _CACHE_TTL_S if value else _NEG_CACHE_TTL_S
    with _CACHE_LOCK:
        _CACHE[ip] = (time.time() + ttl, value)


def reset_cache_for_tests() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()


def _parse_ip_api(payload: dict[str, Any], ip: str) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    if payload.get("status") and payload.get("status") != "success":
        return None
    lat = payload.get("lat")
    lng = payload.get("lon")
    if lat is None or lng is None:
        return None
    return {
        "ip": ip,
        "city": payload.get("city") or None,
        "region": payload.get("regionName") or None,
        "country": payload.get("country") or None,
        "lat": float(lat),
        "lng": float(lng),
        "isp": payload.get("isp") or None,
        "asn": payload.get("as") or None,
    }


def resolve_egress_geo(ip: str | None) -> dict[str, Any] | None:
    """Resolve geoIP for one egress IP. Cached. Never raises."""
    if not ip:
        return None
    hit, cached = _cache_get(ip)
    if hit:
        return cached

    url = _provider_url().format(ip=ip)
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S) as client:
            resp = client.get(url)
        if resp.status_code == 429:
            logger.warning("geoIP rate-limited for %s (HTTP 429)", ip)
            _cache_put(ip, None)
            return None
        if resp.status_code >= 400:
            logger.debug("geoIP HTTP %s for %s", resp.status_code, ip)
            _cache_put(ip, None)
            return None
        data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.debug("geoIP request failed for %s: %s", ip, exc)
        _cache_put(ip, None)
        return None

    parsed = _parse_ip_api(data, ip)
    _cache_put(ip, parsed)
    return parsed
