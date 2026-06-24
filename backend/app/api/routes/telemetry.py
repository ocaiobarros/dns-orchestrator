"""
DNS Control — Telemetry Routes
Serves collector JSON output to the frontend.
"""

import json
import os
import logging
import shutil
import subprocess
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from app.api.deps import get_current_user, require_admin
from app.models.user import User
from app.services import tsdb_proxy_service
from app.core.database import get_db
from sqlalchemy.orm import Session
from app.services import upstream_silence_service as upstream_silence
from app.models.operational import OperationalEvent

router = APIRouter()
logger = logging.getLogger("dns-control.telemetry")

TELEMETRY_DIR = Path(os.environ.get("COLLECTOR_OUTPUT_DIR", "/var/lib/dns-control/telemetry"))
RANGE_MINUTES = {"1h": 60, "6h": 360, "12h": 720, "24h": 1440, "48h": 2880, "72h": 4320}


def _read_telemetry(filename: str = "latest.json") -> dict:
    """Read collector output JSON."""
    path = TELEMETRY_DIR / filename
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {
            "health": {"collector": "not_running", "last_update": None},
            "error": "Collector output not found. Is dns-control-collector.timer enabled?",
        }
    except json.JSONDecodeError as e:
        return {
            "health": {"collector": "error", "last_update": None},
            "error": f"Collector output corrupted: {e}",
        }


@router.get("/latest")
def telemetry_latest(_: User = Depends(get_current_user)):
    """Get latest collector telemetry snapshot."""
    return _read_telemetry("latest.json")


@router.get("/simple")
def telemetry_simple(_: User = Depends(get_current_user)):
    """Get recursive-simple mode telemetry."""
    return _read_telemetry("recursive-simple.json")


@router.get("/interception")
def telemetry_interception(_: User = Depends(get_current_user)):
    """Get recursive-interception mode telemetry."""
    return _read_telemetry("recursive-interception.json")


@router.get("/history")
def telemetry_history(_: User = Depends(get_current_user)):
    """Get metrics time-series history (circular buffer from collector)."""
    path = TELEMETRY_DIR / "history.json"
    try:
        with open(path) as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        return []
    except FileNotFoundError:
        return []
    except json.JSONDecodeError:
        return []


@router.get("/status")
def telemetry_status(_: User = Depends(get_current_user)):
    """Quick status check of collector health."""
    data = _read_telemetry("latest.json")
    health = data.get("health", {})

    # Check file age
    import time
    latest_path = TELEMETRY_DIR / "latest.json"
    file_age_seconds = None
    try:
        stat = latest_path.stat()
        file_age_seconds = int(time.time() - stat.st_mtime)
    except (FileNotFoundError, OSError):
        pass

    return {
        "collector_status": health.get("collector", "unknown"),
        "last_update": health.get("last_update"),
        "collection_duration_ms": health.get("collection_duration_ms"),
        "file_age_seconds": file_age_seconds,
        "stale": file_age_seconds is not None and file_age_seconds > 60,
        "mode": data.get("mode", "unknown"),
        "error": data.get("error"),
    }


# ──────────────────────────────────────────────────────────────────────
# AnaBlock observability — surfaces the 3 required metrics:
#   anablock_last_update_timestamp
#   anablock_domains_loaded_count
#   anablock_last_status (OK/FAIL)
# Source: /var/lib/dns-control/anablock-status.json (written by gen-anablock.sh)
# ──────────────────────────────────────────────────────────────────────

ANABLOCK_STATUS_FILE = Path("/var/lib/dns-control/anablock-status.json")
ANABLOCK_CONF_FILE = Path("/etc/unbound/anablock.conf")


@router.get("/anablock")
def telemetry_anablock(_: User = Depends(get_current_user)):
    """Return AnaBlock sync metrics for the dashboard."""
    import time

    response = {
        "enabled": Path("/etc/unbound/gen-anablock.sh").exists(),
        "anablock_last_update_timestamp": None,
        "anablock_last_update_iso": None,
        "anablock_domains_loaded_count": 0,
        "anablock_last_status": "UNKNOWN",
        "message": "",
        "mode": None,
        "api_url": None,
        "stale": False,
        "age_seconds": None,
        "conf_present": ANABLOCK_CONF_FILE.exists(),
        "last_md5": None,
        "last_md5_short": None,
        "last_version_applied": None,
        "sync_interval_hours": None,
    }

    if not ANABLOCK_STATUS_FILE.exists():
        response["message"] = (
            "Sem dados de execução. Aguardando primeira execução do timer "
            "anablock-update.timer ou execução manual de /etc/unbound/gen-anablock.sh."
        )
        return response

    try:
        with open(ANABLOCK_STATUS_FILE) as f:
            status = json.load(f)
        ts = status.get("last_update_timestamp")
        last_md5 = status.get("last_md5") or None
        sync_hours = status.get("sync_interval_hours")
        response.update({
            "anablock_last_update_timestamp": ts,
            "anablock_last_update_iso": status.get("last_update_iso"),
            "anablock_domains_loaded_count": int(status.get("domains_loaded_count") or 0),
            "anablock_last_status": str(status.get("last_status") or "UNKNOWN").upper(),
            "message": status.get("message", ""),
            "mode": status.get("mode"),
            "api_url": status.get("api_url"),
            "last_md5": last_md5,
            "last_md5_short": last_md5[:8] if last_md5 else None,
            "last_version_applied": status.get("last_version_applied") or None,
            "sync_interval_hours": int(sync_hours) if isinstance(sync_hours, (int, float)) else None,
        })
        if ts:
            age = int(time.time() - int(ts))
            response["age_seconds"] = age
            # Stale = 2× cadência configurada (mínimo 12h). Reflete a postura
            # de degradação honesta: passou do dobro do esperado ⇒ alerta.
            base_h = response["sync_interval_hours"] or 6
            stale_threshold = max(12, base_h * 2) * 3600
            response["stale"] = age > stale_threshold
    except (json.JSONDecodeError, OSError, ValueError) as e:
        response["anablock_last_status"] = "FAIL"
        response["message"] = f"Status corrompido: {e}"

    return response


# ──────────────────────────────────────────────────────────────────────
# Recollect endpoint — observation/observed mode helper.
# Re-runs the collector synchronously and (optionally) restarts the
# collector service so the next timer cycle starts fresh.
# ──────────────────────────────────────────────────────────────────────

COLLECTOR_SCRIPT_CANDIDATES = [
    Path("/opt/dns-control/collector/collector.py"),
    Path("/opt/dns-control/backend/collector/collector.py"),
    Path(__file__).resolve().parents[3] / "collector" / "collector.py",
]


def _find_collector_script() -> Path | None:
    for p in COLLECTOR_SCRIPT_CANDIDATES:
        try:
            if p.exists():
                return p
        except OSError:
            continue
    return None


@router.post("/recollect")
def telemetry_recollect(_: User = Depends(require_admin)):
    """Re-run collector synchronously and restart its systemd service.

    Used by the Observation Mode panel to refresh top domains/clients
    and re-validate the log parser after fixing host configuration.
    """
    started = time.time()
    steps: list[dict] = []

    script = _find_collector_script()
    if not script:
        return {
            "success": False,
            "error": "collector.py not found in expected paths",
            "candidates": [str(p) for p in COLLECTOR_SCRIPT_CANDIDATES],
        }

    python_bin = shutil.which("python3") or "/usr/bin/python3"
    try:
        proc = subprocess.run(
            [python_bin, str(script)],
            capture_output=True,
            text=True,
            timeout=45,
            env={**os.environ},
        )
        steps.append({
            "step": "run_collector",
            "code": proc.returncode,
            "stdout_tail": (proc.stdout or "")[-500:],
            "stderr_tail": (proc.stderr or "")[-500:],
        })
    except subprocess.TimeoutExpired:
        steps.append({"step": "run_collector", "code": -1, "error": "timeout"})

    # Best-effort restart (non-fatal — service may not exist in dev hosts)
    try:
        rc = subprocess.run(
            ["sudo", "-n", "systemctl", "restart", "dns-control-collector.service"],
            capture_output=True, text=True, timeout=15,
        )
        steps.append({
            "step": "restart_service",
            "code": rc.returncode,
            "stderr_tail": (rc.stderr or "")[-300:],
        })
    except Exception as e:
        steps.append({"step": "restart_service", "code": -1, "error": str(e)[:200]})

    latest = _read_telemetry("latest.json")
    return {
        "success": True,
        "duration_ms": int((time.time() - started) * 1000),
        "steps": steps,
        "telemetry_mode": latest.get("telemetry_mode"),
        "queries_parsed": latest.get("query_analytics", {}).get("queries_parsed", 0),
        "log_source": latest.get("query_analytics", {}).get("log_source", "none"),
        "top_domains_count": len(latest.get("top_domains", [])),
        "top_clients_count": len(latest.get("top_clients", [])),
    }


# ──────────────────────────────────────────────────────────────────────
# Log validation endpoint — exposes per-instance log discovery so the
# operator can confirm which logfile/parser is feeding the dashboard.
# ──────────────────────────────────────────────────────────────────────

@router.get("/log-validation")
def telemetry_log_validation(_: User = Depends(get_current_user)):
    """Return per-instance log file detection + active parser source."""
    data = _read_telemetry("latest.json")
    detection = data.get("log_detection", {}) or {}
    analytics = data.get("query_analytics", {}) or {}

    log_source_raw = analytics.get("log_source", "none") or "none"
    if log_source_raw.startswith("logfile:"):
        active_parser = "logfile"
        active_path = log_source_raw.split(":", 1)[1]
    elif log_source_raw == "journalctl":
        active_parser = "journalctl"
        active_path = "systemd-journal"
    else:
        active_parser = "none"
        active_path = ""

    instances = []
    for d in detection.get("details", []):
        instances.append({
            "instance": d.get("instance"),
            "log_queries": d.get("log_queries", False),
            "use_syslog": d.get("use_syslog", False),
            "logfile": d.get("logfile") or "",
            "expected_parser": (
                "logfile" if d.get("logfile") else
                "journalctl" if d.get("use_syslog") else
                "none"
            ),
        })

    return {
        "telemetry_mode": detection.get("telemetry_mode", "unknown"),
        "active_parser": active_parser,
        "active_path": active_path,
        "queries_parsed_last_cycle": analytics.get("queries_parsed", 0),
        "domains_available": analytics.get("domains_available", False),
        "clients_available": analytics.get("clients_available", False),
        "log_files_discovered": detection.get("log_files", []),
        "log_queries_configured": detection.get("log_queries_configured", False),
        "use_syslog": detection.get("use_syslog", False),
        "journal_entries_found": detection.get("journal_entries_found", False),
        "instances": instances,
        "diag": analytics.get("diag", {}),
    }


# ──────────────────────────────────────────────────────────────────────
# Recent queries — exposes the collector's recent_queries buffer with
# basic filtering for the observation page.
#
# The collector emits a small "last cycle" buffer; we honestly apply the
# requested `range` window against the items' HH:MM:SS timestamps (today
# UTC) and report `partial: true` whenever the buffer does NOT cover the
# whole requested window — never fake coverage.
# ──────────────────────────────────────────────────────────────────────

def _parse_recent_query_epoch(item: dict, now_epoch: int) -> int | None:
    """Best-effort parse of the collector's HH:MM:SS `time` field to today's epoch.

    Falls back to None when the field is missing/unparseable. Items in the
    future relative to `now_epoch` are clamped to `now_epoch` (clock skew).
    """
    raw = str(item.get("time") or "").strip()
    if not raw or raw == "??:??:??":
        return None
    try:
        from datetime import datetime, timezone
        h, m, s = (int(x) for x in raw.split(":")[:3])
    except (ValueError, TypeError):
        return None
    now_dt = datetime.fromtimestamp(now_epoch, tz=timezone.utc)
    candidate = now_dt.replace(hour=h, minute=m, second=s, microsecond=0)
    ts = int(candidate.timestamp())
    # If the parsed time is later than now (e.g. local-tz log), assume it
    # crossed midnight and belongs to the previous day.
    if ts > now_epoch + 60:
        ts -= 86400
    return ts


@router.get("/recent-queries")
def telemetry_recent_queries(
    instance: str | None = None,
    qtype: str | None = None,
    range: str | None = None,
    limit: int = 200,
    _: User = Depends(get_current_user),
):
    """Return the most recent DNS queries collected by the telemetry agent.

    Applies the requested `range` window honestly: items whose parseable
    HH:MM:SS timestamp falls outside `now - window` are dropped, and the
    response exposes `requested_window_seconds`, `buffer_span_seconds`
    and `partial` so the UI never confuses "buffer too short" with
    "no activity".
    """
    logger.info("Recent queries request: instance=%s qtype=%s range=%s limit=%s", instance, qtype, range, limit)
    data = _read_telemetry("latest.json")
    queries = data.get("recent_queries", []) or []

    if instance:
        # recent_queries don't carry instance attribution today — keep filter
        # available for forward compatibility (collector enhancement).
        queries = [q for q in queries if (q.get("instance") or "").lower() == instance.lower()]
    if qtype:
        queries = [q for q in queries if (q.get("type") or "").upper() == qtype.upper()]

    # Apply requested range window against parsed timestamps.
    now_epoch = int(time.time())
    range_key = range if range in RANGE_MINUTES else None
    requested_window_seconds = RANGE_MINUTES[range_key] * 60 if range_key else None

    parsed: list[tuple[int | None, dict]] = [
        (_parse_recent_query_epoch(q, now_epoch), q) for q in queries
    ]
    timestamped = [(ts, q) for ts, q in parsed if ts is not None]

    if requested_window_seconds is not None and timestamped:
        cutoff = now_epoch - requested_window_seconds
        timestamped = [(ts, q) for ts, q in timestamped if ts >= cutoff]
        queries = [q for ts, q in timestamped] + [q for ts, q in parsed if ts is None]
    elif requested_window_seconds is not None:
        # No parseable timestamps at all — keep items but report no coverage.
        queries = [q for _ts, q in parsed]

    # Coverage diagnostics — derived from items we actually kept.
    kept_ts = [ts for ts, _q in timestamped]
    buffer_span_seconds = (max(kept_ts) - min(kept_ts)) if len(kept_ts) >= 2 else 0
    partial = bool(
        requested_window_seconds is not None
        and (not kept_ts or buffer_span_seconds < requested_window_seconds)
    )

    queries = queries[-max(1, min(limit, 1000)) :]
    return {
        "items": list(reversed(queries)),
        "count": len(queries),
        "telemetry_mode": data.get("telemetry_mode"),
        "log_source": data.get("query_analytics", {}).get("log_source"),
        "available_types": sorted({q.get("type", "?") for q in data.get("recent_queries", []) if q.get("type")}),
        "available_instances": [i.get("name") for i in data.get("backends", []) if i.get("name")],
        "range": range_key,
        "requested_window_seconds": requested_window_seconds,
        "buffer_span_seconds": buffer_span_seconds,
        "partial": partial,
    }



@router.get("/query-rankings")
def telemetry_query_rankings(
    range: str | None = None,
    limit: int = 30,
    _: User = Depends(get_current_user),
):
    """Return Top Domains/Clients aggregated by the collector for the selected interval."""
    range_key = range if range in RANGE_MINUTES else "6h"
    data = _read_telemetry("latest.json")
    domains_by_range = data.get("top_domains_by_range", {}) or {}
    clients_by_range = data.get("top_clients_by_range", {}) or {}
    types_by_range = data.get("top_query_types_by_range", {}) or {}
    bounded = max(1, min(limit, 30))

    return {
        "range": range_key,
        "window_minutes": RANGE_MINUTES[range_key],
        "top_domains": (domains_by_range.get(range_key) or data.get("top_domains", []) or [])[:bounded],
        "top_clients": (clients_by_range.get(range_key) or data.get("top_clients", []) or [])[:bounded],
        "top_query_types": (types_by_range.get(range_key) or data.get("top_query_types", []) or [])[:bounded],
        "telemetry_mode": data.get("telemetry_mode"),
        "log_source": data.get("query_analytics", {}).get("log_source"),
        "queries_parsed_last_cycle": data.get("query_analytics", {}).get("queries_parsed", 0),
    }


# ──────────────────────────────────────────────────────────────────────
# Long-window history via external TSDB (GATE-RETENÇÃO opção c).
#
# READ-ONLY observability — no require_admin. The client picks `metric`
# from a FIXED allowlist and `window` from a fixed set; the server
# constructs the PromQL. Raw PromQL is never accepted. TSDB URL + auth
# come ONLY from server settings; the auth header never leaks back to
# the client. See backend/app/services/tsdb_proxy_service.py.
# ──────────────────────────────────────────────────────────────────────


@router.get("/range")
def telemetry_range(
    metric: str = Query(..., description="Allowlisted metric key or 'dns_chart_bundle'"),
    window: str = Query(..., pattern="^(1h|6h|12h|24h|48h|72h)$"),
    instance: str | None = Query(None, max_length=64),
    _: User = Depends(get_current_user),
):
    """Serve long-window telemetry from the external TSDB.

    Returns the same envelope shape as /api/dns/metrics:
        {rows, source, source_available, degraded, reason?, ...}

    Honest degradation:
      - URL not configured → source='none', source_available=False,
        degraded=True, reason='não configurado'.
      - TSDB unreachable/error → degraded=True, reason='indisponível'.
      - Empty result → rows=[], reason='sem dados na janela'.
    Never returns synthetic zeros.
    """
    if metric not in tsdb_proxy_service.ALLOWED_METRICS:
        raise HTTPException(status_code=400, detail=f"metric not allowed: {metric}")
    if metric == tsdb_proxy_service.COMPOSITE_BUNDLE:
        return tsdb_proxy_service.query_dns_chart_bundle(window, instance)
    return tsdb_proxy_service.query_metric(metric, window, instance)


# ──────────────────────────────────────────────────────────────────────
# Upstream Silence Detector — v1 (conntrack [UNREPLIED] quick-win)
#
# Opt-in admin-only. OFF por padrão. Endpoint de leitura espelha o padrão
# /anablock: viewer-ok, read-only, devolve `collector_status` para que a
# UI pinte degradação honesta em vez de "0 falhas" fabricado.
#
# ZERO regra nftables, ZERO geração — só LEITURA de conntrack.
# Ver docs/audits/2026-06_dns-upstream-failure-detection-foundation.md.
# ──────────────────────────────────────────────────────────────────────


@router.get("/upstreams")
def telemetry_upstreams(_: User = Depends(get_current_user)):
    """Snapshot de IPs autoritativos sem resposta (janela 5/15 min).

    Quando o detector está OFF (toggle admin), responde com
    `collector_status='disabled'` e lista vazia. A UI distingue
    isso de "0 falhas observadas".
    """
    detector = upstream_silence.UpstreamSilenceDetector.instance()
    payload = detector.snapshot()
    return payload


@router.post("/upstreams/toggle")
def telemetry_upstreams_toggle(
    enabled: bool = Query(..., description="true = ativar coleta; false = desativar"),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Liga/desliga o detector (admin-only). Auditado em operational_events.

    OFF → subprocesso é terminado; nada é coletado; endpoint retorna
    `disabled`. ON → tenta iniciar o supervisor; se o binário `conntrack`
    estiver ausente, devolve `status='degraded'` com `last_error` —
    nunca finge sucesso.
    """
    upstream_silence.set_enabled(db, enabled)
    detector = upstream_silence.UpstreamSilenceDetector.instance()
    if enabled:
        # Refresh own-IP denylist from latest config so o detector ignore
        # nosso próprio egress/listeners/VIPs (falso-positivo conhecido).
        try:
            upstream_silence.hydrate_detector_own_ips(db)
        except Exception:  # noqa: BLE001
            logger.exception("hydrate_detector_own_ips failed; filtro degrada para ranges estáticos")
        result = detector.start()
    else:
        result = detector.stop()


    # Auditoria — reusa o pipeline existente de operational_events.
    try:
        ev = OperationalEvent(
            event_type="telemetry.upstream_silence.toggle",
            severity="info" if enabled else "warning",
            message=(
                f"Upstream silence detector {'ENABLED' if enabled else 'DISABLED'} "
                f"por admin '{user.username}'"
            ),
            details_json=json.dumps({
                "enabled": enabled,
                "actor": user.username,
                "status": result.get("collector_status") or result.get("status"),
                "last_error": result.get("last_error"),
            }),
        )
        db.add(ev)
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Failed to persist upstream_silence toggle event")

    return {
        "success": True,
        "enabled": enabled,
        "result": result,
    }


# ---------- Upstream silence config (windows / cap / alert threshold) ----------

@router.get("/upstreams/config")
def telemetry_upstreams_get_config(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Return current detector config (viewer-ok).

    Includes the backend-authoritative bounds so the UI can clamp at the
    edges for convenience — but the backend remains the source of truth.
    """
    cfg = upstream_silence.load_config_from_db(db)
    # Make sure the live detector matches what we just read (drift-proof).
    upstream_silence.UpstreamSilenceDetector.instance().apply_config(cfg)
    return {
        "config": cfg,
        "bounds": {
            "window_seconds": {
                "min": upstream_silence.MIN_WINDOW,
                "max": upstream_silence.MAX_WINDOW,
            },
            "snapshot_cap": {
                "min": upstream_silence.MIN_CAP,
                "max": upstream_silence.MAX_CAP,
            },
            "alert_threshold": {
                "min": upstream_silence.MIN_THRESHOLD,
                "max": upstream_silence.MAX_THRESHOLD,
            },
        },
        "defaults": {
            "window_short": upstream_silence.DEFAULT_WINDOW_SHORT,
            "window_long": upstream_silence.DEFAULT_WINDOW_LONG,
            "snapshot_cap": upstream_silence.DEFAULT_SNAPSHOT_CAP,
            "alert_threshold": upstream_silence.DEFAULT_ALERT_THRESHOLD,
            "alert_window": upstream_silence.DEFAULT_ALERT_WINDOW,
        },
    }


@router.patch("/upstreams/config")
def telemetry_upstreams_patch_config(
    body: dict,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Update detector config (admin-only). Backend validates/clamps.

    Applies live to the running detector (no restart required) and audits
    the change via operational_events. Returns the effective (post-clamp)
    config so the UI sees exactly what the backend persisted.
    """
    try:
        cfg = upstream_silence.validate_and_clamp_config(body or {})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    upstream_silence.save_config_to_db(db, cfg)
    upstream_silence.UpstreamSilenceDetector.instance().apply_config(cfg)

    try:
        db.add(OperationalEvent(
            event_type="telemetry.upstream_silence.config",
            severity="info",
            message=f"Upstream silence config atualizada por admin '{user.username}'",
            details_json=json.dumps({"actor": user.username, "config": cfg}, sort_keys=True),
        ))
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("Failed to persist upstream_silence config event")

    return {"success": True, "config": cfg}
