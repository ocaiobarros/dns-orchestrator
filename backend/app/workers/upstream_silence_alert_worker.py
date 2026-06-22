"""
DNS Control — Upstream Silence Alert Worker

Evaluates the detector's silent-IP aggregate against the configured
threshold/window every poll, and emits ``telemetry.upstream_silence.alert``
EXACTLY ONCE per below→above transition (debounce). Mirrors the dedup
pattern used by ``anablock_status_worker._check_stale``.

The worker never reads ``conntrack`` directly — the detector singleton
owns the subprocess. The worker only consumes the detector's transition
state and writes one OperationalEvent per rising edge.
"""

from __future__ import annotations

import json
import logging

from app.core.database import SessionLocal
from app.models.operational import OperationalEvent
from app.services.upstream_silence_service import UpstreamSilenceDetector

logger = logging.getLogger("dns-control.upstream_silence_alert_worker")


def upstream_silence_alert_job(*, session_factory=SessionLocal) -> dict:
    """Background job. Idempotente."""
    detector = UpstreamSilenceDetector.instance()
    transition = detector.consume_alert_transition()
    if transition is None:
        return {"emitted": 0}
    db = session_factory()
    try:
        msg = (
            f"Upstream silence: {transition['count']} IPs mudos na janela "
            f"{transition['window']} ({transition['window_seconds']}s) "
            f"≥ limiar {transition['threshold']}"
        )
        db.add(OperationalEvent(
            event_type="telemetry.upstream_silence.alert",
            severity="warning",
            instance_id=None,
            message=msg,
            details_json=json.dumps({
                "window": transition["window"],
                "window_seconds": transition["window_seconds"],
                "threshold": transition["threshold"],
                "count": transition["count"],
                "actor": "system",
            }, sort_keys=True),
        ))
        db.commit()
        return {"emitted": 1, **transition}
    except Exception as e:  # pragma: no cover — defensive
        logger.exception("upstream_silence_alert_job failed: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
        return {"emitted": 0, "error": str(e)}
    finally:
        db.close()
