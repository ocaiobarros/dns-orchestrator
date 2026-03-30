"""
DNS Control v2.1 — Health Service
Multi-check health validation with quorum logic and configurable thresholds.
"""

import json
import time
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from app.executors.command_runner import run_command
from app.models.operational import DnsInstance, HealthCheck, InstanceState, OperationalEvent
from app.services.settings_service import get_health_settings

logger = logging.getLogger("dns-control.health")

PROBE_DOMAIN = "google.com"


def run_health_checks_for_instance(db: Session, instance: DnsInstance) -> dict:
    """Run all health check types for a single instance (quorum health check)."""
    settings = get_health_settings(db)
    results = {}

    # 1. systemd check
    results["systemd"] = _check_systemd(instance.instance_name)

    # 2. port check
    results["port"] = _check_port(instance.bind_ip, instance.bind_port)

    # 3. functional dig check
    results["dig"] = _check_dig(instance.bind_ip, instance.bind_port, settings)

    # 4. unbound-control status (optional, non-fatal)
    results["unbound_stats"] = _check_unbound_control(instance.instance_name)

    # Quorum health classification
    overall = _classify_health(results, settings)

    # Persist health check records
    for check_type, result in results.items():
        hc = HealthCheck(
            instance_id=instance.id,
            check_type=check_type,
            status=result["status"],
            latency_ms=result.get("latency_ms"),
            error_message=result.get("error"),
            details_json=json.dumps(result.get("details", {})),
        )
        db.add(hc)

    # Update instance state with thresholds from settings
    _update_instance_state(db, instance, overall, settings)

    db.commit()
    return {"instance": instance.instance_name, "overall": overall, "checks": results}


def _classify_health(results: dict, settings: dict) -> str:
    """
    Quorum health classification:
    - Healthy: process OK, port bound, dig OK
    - Degraded: process OK, port OK, dig latency > threshold
    - Failed: dig timeout, process inactive, or port not listening
    """
    systemd_ok = results["systemd"]["status"] == "ok"
    port_ok = results["port"]["status"] == "ok"
    dig_ok = results["dig"]["status"] == "ok"
    dig_latency = results["dig"].get("latency_ms", 0)
    latency_warn = settings.get("latency_warn_ms", 50)

    if not systemd_ok or not port_ok:
        return "failed"

    if not dig_ok:
        return "failed"

    if dig_latency > latency_warn:
        return "degraded"

    return "ok"


def _check_systemd(instance_name: str) -> dict:
    start = time.monotonic()
    result = run_command("systemctl", ["is-active", instance_name], timeout=5)
    elapsed = int((time.monotonic() - start) * 1000)
    active = result["stdout"].strip() == "active"
    return {
        "status": "ok" if active else "failed",
        "latency_ms": elapsed,
        "error": None if active else f"Service {instance_name} not active: {result['stdout'].strip()}",
        "details": {"raw": result["stdout"].strip()},
    }


def _check_port(bind_ip: str, port: int) -> dict:
    start = time.monotonic()
    result = run_command("ss", ["-lunp"], timeout=5)
    elapsed = int((time.monotonic() - start) * 1000)
    target = f"{bind_ip}:{port}"
    found = target in result["stdout"] or f":{port}" in result["stdout"]
    return {
        "status": "ok" if found else "failed",
        "latency_ms": elapsed,
        "error": None if found else f"Port {port} not bound on {bind_ip}",
        "details": {"target": target, "found": found},
    }


def _check_dig(bind_ip: str, port: int, settings: dict) -> dict:
    dig_timeout_ms = settings.get("dig_timeout_ms", 2000)
    timeout_sec = max(1, dig_timeout_ms // 1000)

    start = time.monotonic()
    result = run_command(
        "dig", [f"@{bind_ip}", "-p", str(port), PROBE_DOMAIN, "+short", f"+time={timeout_sec}", "+tries=1"],
        timeout=timeout_sec + 2,
    )
    elapsed = int((time.monotonic() - start) * 1000)
    has_answer = result["exit_code"] == 0 and len(result["stdout"].strip()) > 0
    return {
        "status": "ok" if has_answer else "failed",
        "latency_ms": elapsed,
        "error": None if has_answer else (result["stderr"].strip() or "No response / timeout"),
        "details": {"resolved": result["stdout"].strip().split("\n")[0] if has_answer else ""},
    }


def _check_unbound_control(instance_name: str) -> dict:
    config_path = f"/etc/unbound/{instance_name}.conf"
    start = time.monotonic()
    result = run_command("unbound-control", ["-c", config_path, "status"], timeout=5)
    elapsed = int((time.monotonic() - start) * 1000)
    ok = result["exit_code"] == 0
    return {
        "status": "ok" if ok else "degraded",
        "latency_ms": elapsed,
        "error": None if ok else result["stderr"].strip()[:200],
        "details": {"running": "is running" in result["stdout"]},
    }


def _update_instance_state(db: Session, instance: DnsInstance, check_result: str, settings: dict):
    """Update instance_state based on health check result. Emit events on transition."""
    failure_threshold = settings.get("consecutive_failures", 3)
    recovery_threshold = settings.get("consecutive_successes", 3)

    state = db.query(InstanceState).filter(InstanceState.instance_id == instance.id).first()

    if not state:
        state = InstanceState(instance_id=instance.id, current_status="healthy", in_rotation=True)
        db.add(state)
        db.flush()

    now = datetime.now(timezone.utc)
    previous_status = state.current_status

    if check_result == "ok":
        state.consecutive_failures = 0
        state.consecutive_successes += 1
        state.last_success_at = now

        if state.consecutive_successes >= recovery_threshold and previous_status != "healthy":
            state.current_status = "healthy"
            state.last_transition_at = now
            state.reason = f"Recovery: passed {recovery_threshold} consecutive health checks"
            # v2.1: Set cooldown before restoration
            cooldown_seconds = settings.get("cooldown_seconds", 120)
            state.cooldown_until = now + timedelta(seconds=cooldown_seconds)
            _emit_event(db, "instance_recovered", "warning", instance.id,
                        f"{instance.instance_name} recovered after {recovery_threshold} successful checks (cooldown: {cooldown_seconds}s)")

    elif check_result == "degraded":
        state.current_status = "degraded"
        state.consecutive_successes = 0
        if previous_status != "degraded":
            state.last_transition_at = now
            state.reason = "Partial health check failure (high latency)"
            _emit_event(db, "instance_degraded", "warning", instance.id,
                        f"{instance.instance_name} is degraded (high latency)")

    else:  # failed
        state.consecutive_successes = 0
        state.consecutive_failures += 1
        state.last_failure_at = now

        if state.consecutive_failures >= failure_threshold and previous_status != "failed":
            state.current_status = "failed"
            state.last_transition_at = now
            state.reason = f"Failed {state.consecutive_failures} consecutive health checks"
            _emit_event(db, "instance_failed", "critical", instance.id,
                        f"{instance.instance_name} FAILED after {state.consecutive_failures} consecutive failures")


def _emit_event(db: Session, event_type: str, severity: str, instance_id: str, message: str):
    ev = OperationalEvent(
        event_type=event_type,
        severity=severity,
        instance_id=instance_id,
        message=message,
    )
    db.add(ev)
    logger.info(f"Event [{severity}] {event_type}: {message}")


def get_all_instance_states(db: Session) -> list[dict]:
    """Get current state of all instances with cooldown info."""
    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    now = datetime.now(timezone.utc)
    results = []
    for inst in instances:
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
        cooldown_remaining = 0
        if state and state.cooldown_until:
            remaining = (state.cooldown_until - now).total_seconds()
            cooldown_remaining = max(0, int(remaining))
        results.append({
            "id": inst.id,
            "instance_name": inst.instance_name,
            "bind_ip": inst.bind_ip,
            "bind_port": inst.bind_port,
            "outgoing_ip": inst.outgoing_ip,
            "control_port": inst.control_port,
            "current_status": state.current_status if state else "unknown",
            "in_rotation": state.in_rotation if state else True,
            "consecutive_failures": state.consecutive_failures if state else 0,
            "consecutive_successes": state.consecutive_successes if state else 0,
            "last_success_at": state.last_success_at.isoformat() if state and state.last_success_at else None,
            "last_failure_at": state.last_failure_at.isoformat() if state and state.last_failure_at else None,
            "last_transition_at": state.last_transition_at.isoformat() if state and state.last_transition_at else None,
            "reason": state.reason if state else None,
            "cooldown_remaining": cooldown_remaining,
            "last_reconciliation_at": state.last_reconciliation_at.isoformat() if state and state.last_reconciliation_at else None,
        })
    return results


def get_recent_health_checks(db: Session, instance_id: str | None = None, limit: int = 50) -> list[dict]:
    """Get recent health check records."""
    q = db.query(HealthCheck).order_by(HealthCheck.created_at.desc())
    if instance_id:
        q = q.filter(HealthCheck.instance_id == instance_id)
    checks = q.limit(limit).all()
    return [
        {
            "id": c.id,
            "instance_id": c.instance_id,
            "check_type": c.check_type,
            "status": c.status,
            "latency_ms": c.latency_ms,
            "error_message": c.error_message,
            "created_at": c.created_at.isoformat(),
        }
        for c in checks
    ]
