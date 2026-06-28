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
- HARD rate cap well below provider limit (ip-api.com free = 45/min): we
  budget ``_MAX_CALLS_PER_MIN`` (default 10) HTTP calls per rolling 60s
  across ALL geoIP lookups (egress + parents), thread-safe.
- On HTTP 429 / repeated network failures, enter a growing cooldown
  (60s → 120s → 300s → 900s) during which NO HTTP call is made and we
  serve the last-known-good value (stale-while-revalidate).
- TTL positive = 6h: geo of our own infra IPs is effectively static.
  When TTL expires but the limiter has no token (or we are in cooldown),
  we return the stale value instead of None — never make things worse.

Default provider is ip-api.com (free tier: 45 req/min, HTTP-only on the
free endpoint). Configurable via the ``DNS_CONTROL_GEOIP_URL`` env var,
which must contain ``{ip}`` as the placeholder.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import deque
from typing import Any

import httpx

logger = logging.getLogger(__name__)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


# Positive TTL: re-probe every 6h. Geo of our public infra IPs barely changes.
_CACHE_TTL_S = _env_int("DNS_CONTROL_GEOIP_TTL_S", 6 * 60 * 60)
# Negative cache (failures) — short so we recover quickly once provider is back.
_NEG_CACHE_TTL_S = 5 * 60
_HTTP_TIMEOUT_S = 3.0

# HARD cap on HTTP calls per rolling 60s. Provider allows 45/min; we use a
# very wide safety margin (~4.5x) and never block the worker — over-budget
# lookups simply serve cache / stale / None and retry next cycle.
_MAX_CALLS_PER_MIN = _env_int("DNS_CONTROL_GEOIP_MAX_PER_MIN", 10)
_RATE_WINDOW_S = 60.0

# Cooldown ladder on 429: 60s → 120s → 300s → 900s (cap).
_COOLDOWN_LADDER_S = (60, 120, 300, 900)

# ip-api.com free endpoint.
_DEFAULT_URL = "http://ip-api.com/json/{ip}?fields=status,message,country,regionName,city,lat,lon,isp,as,query"


def _provider_url() -> str:
    return os.environ.get("DNS_CONTROL_GEOIP_URL", _DEFAULT_URL)


# ── shared state ───────────────────────────────────────────────────────
_LOCK = threading.Lock()
# ip -> (expires_at_ts, value_or_None, resolved_at_ts)
_CACHE: dict[str, tuple[float, dict[str, Any] | None, float]] = {}
# rolling window of recent HTTP call timestamps
_CALL_TIMES: deque[float] = deque()
# global cooldown state
_cooldown_until: float = 0.0
_cooldown_step: int = 0  # index into _COOLDOWN_LADDER_S; -1 = none


def reset_cache_for_tests() -> None:
    global _cooldown_until, _cooldown_step
    with _LOCK:
        _CACHE.clear()
        _CALL_TIMES.clear()
        _cooldown_until = 0.0
        _cooldown_step = 0


def _now() -> float:
    return time.time()


def _trim_window(now: float) -> None:
    cutoff = now - _RATE_WINDOW_S
    while _CALL_TIMES and _CALL_TIMES[0] < cutoff:
        _CALL_TIMES.popleft()


def _try_acquire_token(now: float) -> bool:
    """Reserve one slot in the rolling-60s budget. Caller must hold _LOCK."""
    _trim_window(now)
    if len(_CALL_TIMES) >= _MAX_CALLS_PER_MIN:
        return False
    _CALL_TIMES.append(now)
    return True


def _release_token(now: float) -> None:
    """Roll back a reserved token if the HTTP call did not actually happen."""
    try:
        _CALL_TIMES.remove(now)
    except ValueError:
        pass


def _enter_cooldown(reason: str) -> None:
    global _cooldown_until, _cooldown_step
    step = min(_cooldown_step, len(_COOLDOWN_LADDER_S) - 1)
    secs = _COOLDOWN_LADDER_S[step]
    _cooldown_until = _now() + secs
    _cooldown_step = min(_cooldown_step + 1, len(_COOLDOWN_LADDER_S) - 1)
    logger.warning("geoIP cooldown engaged for %ss (reason=%s)", secs, reason)


def _exit_cooldown_on_success() -> None:
    global _cooldown_until, _cooldown_step
    if _cooldown_step or _cooldown_until:
        logger.info("geoIP cooldown cleared (success)")
    _cooldown_until = 0.0
    _cooldown_step = 0


def _parse_ip_api(payload: dict[str, Any], ip: str, resolved_at: float) -> dict[str, Any] | None:
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
        "resolved_at": resolved_at,
    }


def _cache_lookup(ip: str, now: float) -> tuple[dict[str, Any] | None, bool, bool]:
    """Return (value, fresh, has_entry).
    - fresh=True  → entry is within TTL; serve as-is.
    - fresh=False, has_entry=True → stale; may be served if we can't refresh.
    - has_entry=False → nothing known.
    """
    entry = _CACHE.get(ip)
    if not entry:
        return None, False, False
    expires_at, value, _resolved_at = entry
    if expires_at > now:
        return value, True, True
    return value, False, True


def resolve_egress_geo(ip: str | None) -> dict[str, Any] | None:
    """Resolve geoIP for one egress IP.

    Cached. Rate-limited (never exceeds ``_MAX_CALLS_PER_MIN`` HTTP calls
    per rolling 60s). On provider throttle/error, enters cooldown and serves
    the last-known-good value (stale-while-revalidate). Never raises.
    """
    if not ip:
        return None

    now = _now()

    # ── decide under lock: serve cache, or reserve a token ──
    with _LOCK:
        value, fresh, has_entry = _cache_lookup(ip, now)
        if fresh:
            return value

        # No fresh entry: would normally hit HTTP. Two reasons to skip:
        # (a) global cooldown active, (b) per-minute budget exhausted.
        if now < _cooldown_until:
            # Serve stale if we have it; otherwise None.
            return value if has_entry else None
        if not _try_acquire_token(now):
            # Over budget: serve stale or None; retry next cycle.
            return value if has_entry else None
        token_ts = now  # remember to release on no-op paths

    # ── HTTP call OUTSIDE the lock ──
    url = _provider_url().format(ip=ip)
    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT_S) as client:
            resp = client.get(url)
    except httpx.HTTPError as exc:
        logger.debug("geoIP request failed for %s: %s", ip, exc)
        with _LOCK:
            # network failure counts toward budget (we tried); negative-cache
            # only if we have nothing better.
            if not has_entry:
                _CACHE[ip] = (now + _NEG_CACHE_TTL_S, None, now)
            # gentle backoff on repeated failures
            _enter_cooldown("network-error")
        return value if has_entry else None

    if resp.status_code == 429:
        logger.warning("geoIP rate-limited for %s (HTTP 429)", ip)
        with _LOCK:
            _enter_cooldown("http-429")
            # Do NOT overwrite a good cached value with None on 429.
            if not has_entry:
                _CACHE[ip] = (now + _NEG_CACHE_TTL_S, None, now)
        return value if has_entry else None

    if resp.status_code >= 400:
        logger.debug("geoIP HTTP %s for %s", resp.status_code, ip)
        with _LOCK:
            if not has_entry:
                _CACHE[ip] = (now + _NEG_CACHE_TTL_S, None, now)
        return value if has_entry else None

    try:
        data = resp.json()
    except ValueError:
        with _LOCK:
            if not has_entry:
                _CACHE[ip] = (now + _NEG_CACHE_TTL_S, None, now)
        return value if has_entry else None

    parsed = _parse_ip_api(data, ip, resolved_at=now)
    with _LOCK:
        if parsed is not None:
            _CACHE[ip] = (now + _CACHE_TTL_S, parsed, now)
            _exit_cooldown_on_success()
        else:
            # API said "fail" / malformed — don't clobber a good prior value.
            if not has_entry:
                _CACHE[ip] = (now + _NEG_CACHE_TTL_S, None, now)
    return parsed if parsed is not None else (value if has_entry else None)
