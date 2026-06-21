"""
DNS Control — TSDB Proxy (PromQL query_range against external Prometheus/VictoriaMetrics).

Implements GATE-RETENÇÃO opção (c): long-window history is served by an
EXTERNAL TSDB that already scrapes /api/prometheus. The local circular
buffer (history.json, ~50min) is intentionally NOT extended.

Security contract (NON-NEGOTIABLE):
  * The client picks `metric` from a FIXED allowlist and `window` from a
    fixed set. The server constructs the PromQL string. Raw PromQL from
    clients is never accepted (anti-injection).
  * TSDB base URL, optional Authorization header and host label come
    ONLY from server-side settings (anti-SSRF). The auth header is never
    echoed back to the client.

Envelope returned to callers mirrors /api/dns/metrics:
    {rows, source, source_available, degraded, reason?, ...}
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("dns-control.tsdb-proxy")

# Fixed window allowlist — mirrors the DnsPage <Select> options.
WINDOW_SECONDS: dict[str, int] = {
    "1h": 3600,
    "6h": 6 * 3600,
    "12h": 12 * 3600,
    "24h": 24 * 3600,
    "48h": 48 * 3600,
    "72h": 72 * 3600,
}

# PromQL allowlist. `${HOST}` / `${INSTANCE}` placeholders are replaced
# by safe label selectors built server-side (no client-controlled labels).
# `$step` is replaced by the adaptive step expression (e.g. "1m").
METRIC_QUERIES: dict[str, str] = {
    "qps": "sum by (instance) (rate(dns_queries_total{${HOST}${INSTANCE}}[$step]))",
    "cache_hit_percent": "avg by (instance) (dns_cache_hit_percent{${HOST}${INSTANCE}})",
    "cache_hit_ratio": "avg by (instance) (dns_cache_hit_ratio{${HOST}${INSTANCE}})",
    "latency_ms": "avg by (instance) (dns_latency_ms{${HOST}${INSTANCE}})",
    "errors_rate": (
        "sum by (instance) ("
        "rate(dns_servfail_total{${HOST}${INSTANCE}}[$step]) + "
        "rate(dns_nxdomain_total{${HOST}${INSTANCE}}[$step])"
        ")"
    ),
    "health": "min by (instance) (dns_instance_health{${HOST}${INSTANCE}})",
    "in_rotation": "min by (instance) (dns_backend_in_rotation{${HOST}${INSTANCE}})",
    "cooldown_seconds": "max by (instance) (dns_instance_cooldown_seconds{${HOST}${INSTANCE}})",
    "events_rate": "sum by (severity) (rate(dns_events_total{${HOST}}[$step]))",
    "reconcile_rate": "sum by (action) (rate(dns_reconciliation_actions_total{${HOST}}[$step]))",
}

# Composite key used by the chart bundle endpoint. Each row joins the
# per-metric series by timestamp.
COMPOSITE_BUNDLE = "dns_chart_bundle"
BUNDLE_METRICS = ("qps", "latency_ms", "cache_hit_ratio", "errors_rate")

ALLOWED_METRICS = set(METRIC_QUERIES.keys()) | {COMPOSITE_BUNDLE}


# ── Label sanitization ────────────────────────────────────────────────
# PromQL labels must match [A-Za-z_][A-Za-z0-9_]*; values are forced
# through a quoted-string with backslash/quote escaping. Anything that
# doesn't survive this is dropped — never interpolated raw.

_LABEL_NAME_OK = lambda s: bool(s) and s.replace("_", "a").isalnum() and not s[0].isdigit()

def _escape_label_value(v: str) -> str:
    return v.replace("\\", "\\\\").replace('"', '\\"')


def _build_label_selectors(host_label: str, host_value: str, instance: str | None) -> tuple[str, str]:
    host_sel = ""
    if host_label and host_value and _LABEL_NAME_OK(host_label):
        host_sel = f'{host_label}="{_escape_label_value(host_value)}"'
    instance_sel = ""
    if instance:
        instance_sel = f',instance="{_escape_label_value(instance)}"'
        if not host_sel:
            instance_sel = f'instance="{_escape_label_value(instance)}"'
    return host_sel, instance_sel


# ── Adaptive step ─────────────────────────────────────────────────────
# Target ~300-500 points per window so 72h doesn't explode. Floor at 10s.

def compute_step_seconds(window_seconds: int) -> int:
    step = max(10, window_seconds // 400)
    # Snap to a friendly value to keep PromQL output stable.
    for cand in (10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600):
        if step <= cand:
            return cand
    return 3600


def _step_to_prom(step_seconds: int) -> str:
    if step_seconds % 3600 == 0:
        return f"{step_seconds // 3600}h"
    if step_seconds % 60 == 0:
        return f"{step_seconds // 60}m"
    return f"{step_seconds}s"


# ── Settings access ───────────────────────────────────────────────────

def get_tsdb_settings() -> dict[str, str]:
    """Return current TSDB config from environment. Never read by clients."""
    return {
        "url": (os.environ.get("DNS_CONTROL_PROMETHEUS_QUERY_URL") or "").strip().rstrip("/"),
        "auth_header": os.environ.get("DNS_CONTROL_PROMETHEUS_QUERY_AUTH_HEADER", "").strip(),
        "host_label": (os.environ.get("DNS_CONTROL_PROMETHEUS_HOST_LABEL") or "").strip(),
        "host_value": (os.environ.get("DNS_CONTROL_PROMETHEUS_HOST_VALUE") or "").strip(),
    }


# ── Query construction & execution ────────────────────────────────────

def _build_promql(metric_key: str, host_sel: str, instance_sel: str, step_seconds: int) -> str:
    template = METRIC_QUERIES[metric_key]
    return (template
            .replace("${HOST}", host_sel)
            .replace("${INSTANCE}", instance_sel)
            .replace("$step", _step_to_prom(step_seconds)))


def _empty_envelope(reason: str, *, configured: bool, error: str | None = None) -> dict[str, Any]:
    return {
        "rows": [],
        "source": "tsdb" if configured else "none",
        "source_available": False,
        "degraded": True,
        "reason": reason,
        "error": error,
    }


def _run_query_range(promql: str, start: int, end: int, step_seconds: int) -> dict[str, Any]:
    cfg = get_tsdb_settings()
    if not cfg["url"]:
        return _empty_envelope("não configurado", configured=False)
    headers: dict[str, str] = {}
    if cfg["auth_header"]:
        headers["Authorization"] = cfg["auth_header"]
    params = {
        "query": promql,
        "start": str(start),
        "end": str(end),
        "step": str(step_seconds),
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(f"{cfg['url']}/api/v1/query_range", params=params, headers=headers)
        if resp.status_code >= 400:
            logger.warning("TSDB query failed: status=%s body=%s", resp.status_code, resp.text[:200])
            return _empty_envelope("indisponível", configured=True,
                                   error=f"upstream_status_{resp.status_code}")
        body = resp.json()
    except (httpx.RequestError, ValueError) as exc:
        logger.warning("TSDB unreachable: %s", exc)
        return _empty_envelope("indisponível", configured=True, error="upstream_unreachable")

    if body.get("status") != "success":
        return _empty_envelope("indisponível", configured=True,
                               error=str(body.get("errorType") or "upstream_error"))
    return {"raw": body.get("data", {}), "promql": promql}


def query_metric(metric: str, window: str, instance: str | None, *,
                 now_epoch: int | None = None) -> dict[str, Any]:
    """Execute one allowlisted PromQL query_range and return the envelope."""
    import time as _time
    if metric not in METRIC_QUERIES:
        raise ValueError(f"metric not allowed: {metric}")
    if window not in WINDOW_SECONDS:
        raise ValueError(f"window not allowed: {window}")
    cfg = get_tsdb_settings()
    end = int(now_epoch if now_epoch is not None else _time.time())
    window_s = WINDOW_SECONDS[window]
    start = end - window_s
    step_s = compute_step_seconds(window_s)
    host_sel, instance_sel = _build_label_selectors(cfg["host_label"], cfg["host_value"], instance)
    promql = _build_promql(metric, host_sel, instance_sel, step_s)
    base = {
        "metric": metric, "window": window,
        "range_seconds": window_s, "step_seconds": step_s,
    }
    result = _run_query_range(promql, start, end, step_s)
    if "rows" in result:  # empty envelope already
        return {**base, **result}
    rows: list[dict[str, Any]] = []
    for series in result["raw"].get("result", []):
        labels = series.get("metric", {}) or {}
        for ts, val in series.get("values", []) or []:
            try:
                rows.append({
                    "ts": int(float(ts)),
                    "value": float(val),
                    "labels": labels,
                })
            except (TypeError, ValueError):
                continue
    return {
        **base,
        "rows": rows,
        "source": "tsdb",
        "source_available": True,
        "degraded": False,
        "reason": "ok" if rows else "sem dados na janela",
    }


def query_dns_chart_bundle(window: str, instance: str | None, *,
                           now_epoch: int | None = None) -> dict[str, Any]:
    """Composite query — joins BUNDLE_METRICS by timestamp into rows shaped
    like /api/dns/metrics output so the existing chart consumer works."""
    base_envelope = {"metric": COMPOSITE_BUNDLE, "window": window}
    if window not in WINDOW_SECONDS:
        raise ValueError(f"window not allowed: {window}")
    sub: dict[str, dict[str, Any]] = {}
    for m in BUNDLE_METRICS:
        sub[m] = query_metric(m, window, instance, now_epoch=now_epoch)
    # If TSDB not configured / unreachable, propagate honestly.
    first = sub[BUNDLE_METRICS[0]]
    if not first.get("source_available", False):
        return {**base_envelope,
                "range_seconds": WINDOW_SECONDS[window],
                "step_seconds": compute_step_seconds(WINDOW_SECONDS[window]),
                "rows": [],
                "source": first.get("source", "none"),
                "source_available": False,
                "degraded": True,
                "reason": first.get("reason", "indisponível"),
                "error": first.get("error")}
    # Merge by ts → one row per timestamp with multiple metric fields.
    buckets: dict[int, dict[str, Any]] = {}
    for m, env in sub.items():
        for r in env.get("rows", []):
            ts = r["ts"]
            slot = buckets.setdefault(ts, {"epoch": ts})
            if m == "qps":
                slot["qps"] = r["value"]
            elif m == "latency_ms":
                slot["latency_ms"] = r["value"]
            elif m == "cache_hit_ratio":
                # Chart expects 0-100 (P1-04); TSDB stores 0-1 → scale.
                slot["cache_hit_ratio"] = r["value"] * 100.0
            elif m == "errors_rate":
                # Split into servfail+nxdomain not possible from sum;
                # report combined into `servfail` so the Errors chart shows it.
                slot["servfail"] = r["value"]
                slot["nxdomain"] = 0
    rows = []
    from datetime import datetime, timezone
    for ts in sorted(buckets):
        row = buckets[ts]
        row["timestamp_utc"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")
        rows.append(row)
    return {
        **base_envelope,
        "range_seconds": WINDOW_SECONDS[window],
        "step_seconds": compute_step_seconds(WINDOW_SECONDS[window]),
        "rows": rows,
        "source": "tsdb",
        "source_available": bool(rows),
        "degraded": not bool(rows),
        "reason": "ok" if rows else "sem dados na janela",
    }
