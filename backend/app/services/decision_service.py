"""
DNS Control v2.1 — Decision / Reconciliation Service
Anti-flap cooldown, safe backend rotation with structured logging.
"""

import json
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from app.models.operational import DnsInstance, InstanceState, OperationalAction, OperationalEvent
from app.executors.command_runner import run_command
from app.services.settings_service import get_health_settings

logger = logging.getLogger("dns-control.reconciliation")


def reconcile(db: Session) -> dict:
    """
    Main reconciliation loop with anti-flap cooldown:
    1. Find failed instances still in rotation → remove
    2. Find recovered instances out of rotation → restore (if cooldown elapsed)
    Returns summary of actions taken.
    """
    settings = get_health_settings(db)
    cooldown_seconds = settings.get("cooldown_seconds", 120)
    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    now = datetime.now(timezone.utc)

    summary = {
        "instances_checked": 0,
        "instances_failed": 0,
        "backends_removed": 0,
        "backends_restored": 0,
    }

    for inst in instances:
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
        if not state:
            continue

        summary["instances_checked"] += 1

        if state.current_status == "failed" and state.in_rotation:
            _remove_backend(db, inst, state)
            summary["instances_failed"] += 1
            summary["backends_removed"] += 1

        elif state.current_status == "healthy" and not state.in_rotation:
            # Anti-flap: check cooldown
            if state.cooldown_until and now < state.cooldown_until:
                remaining = (state.cooldown_until - now).total_seconds()
                logger.info(
                    f"Cooldown active for {inst.instance_name}: {remaining:.0f}s remaining"
                )
                continue
            _restore_backend(db, inst, state)
            summary["backends_restored"] += 1

        if state.current_status == "failed":
            summary["instances_failed"] += 1

    db.commit()
    return summary


def _remove_backend(db: Session, instance: DnsInstance, state: InstanceState):
    """Remove a failed backend from nftables DNAT."""
    now = datetime.now(timezone.utc)
    logger.warning(f"Removing failed backend {instance.instance_name} ({instance.bind_ip}) from DNAT")

    action = OperationalAction(
        action_type="remove_backend",
        target_type="instance",
        target_id=instance.id,
        status="running",
        trigger_source="health_engine",
    )
    db.add(action)
    db.flush()

    # Get current nftables ruleset to find and remove the backend
    result = run_command("nft", ["list", "ruleset"], timeout=10)
    if result["exit_code"] != 0:
        action.status = "failed"
        action.stderr_log = result["stderr"]
        action.exit_code = result["exit_code"]
        action.finished_at = now
        return

    delete_result = run_command(
        "nft",
        ["delete", "element", "ip", "nat", "dns_backends", f"{{ {instance.bind_ip} }}"],
        timeout=10,
    )

    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.reason = f"Removed from DNAT: {state.consecutive_failures} consecutive failures"

    action.status = "success" if delete_result["exit_code"] == 0 else "failed"
    action.stdout_log = delete_result["stdout"]
    action.stderr_log = delete_result["stderr"]
    action.exit_code = delete_result["exit_code"]
    action.finished_at = now

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {instance.instance_name} ({instance.bind_ip}) removed from DNAT rotation",
                {"action_source": "reconciliation_engine", "reason": "health check failure",
                 "consecutive_failures": state.consecutive_failures})


def _restore_backend(db: Session, instance: DnsInstance, state: InstanceState):
    """Restore a recovered backend to nftables DNAT (after cooldown)."""
    now = datetime.now(timezone.utc)
    logger.info(f"Restoring recovered backend {instance.instance_name} ({instance.bind_ip}) to DNAT")

    action = OperationalAction(
        action_type="restore_backend",
        target_type="instance",
        target_id=instance.id,
        status="running",
        trigger_source="health_engine",
    )
    db.add(action)
    db.flush()

    restore_result = run_command(
        "nft",
        ["add", "element", "ip", "nat", "dns_backends", f"{{ {instance.bind_ip} }}"],
        timeout=10,
    )

    state.in_rotation = True
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.cooldown_until = None  # Clear cooldown
    state.reason = "Restored to DNAT after recovery (cooldown elapsed)"

    action.status = "success" if restore_result["exit_code"] == 0 else "failed"
    action.stdout_log = restore_result["stdout"]
    action.stderr_log = restore_result["stderr"]
    action.exit_code = restore_result["exit_code"]
    action.finished_at = now

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {instance.instance_name} ({instance.bind_ip}) restored to DNAT rotation",
                {"action_source": "reconciliation_engine", "reason": "recovery confirmed after cooldown"})


def manual_remove_backend(db: Session, instance_id: str) -> dict:
    """Manually remove a backend from rotation."""
    instance = db.query(DnsInstance).filter(DnsInstance.id == instance_id).first()
    if not instance:
        return {"success": False, "error": "Instance not found"}

    state = db.query(InstanceState).filter(InstanceState.instance_id == instance.id).first()
    if not state:
        return {"success": False, "error": "No state record"}

    if not state.in_rotation:
        return {"success": False, "error": "Already out of rotation"}

    now = datetime.now(timezone.utc)
    action = OperationalAction(
        action_type="remove_backend", target_type="instance", target_id=instance.id,
        status="success", trigger_source="manual",
        finished_at=now,
    )
    db.add(action)

    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.reason = "Manually removed from rotation"

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {instance.instance_name} manually removed from DNAT",
                {"action_source": "manual"})

    db.commit()
    return {"success": True, "instance": instance.instance_name}


def manual_restore_backend(db: Session, instance_id: str) -> dict:
    """Manually restore a backend to rotation."""
    instance = db.query(DnsInstance).filter(DnsInstance.id == instance_id).first()
    if not instance:
        return {"success": False, "error": "Instance not found"}

    state = db.query(InstanceState).filter(InstanceState.instance_id == instance.id).first()
    if not state:
        return {"success": False, "error": "No state record"}

    if state.in_rotation:
        return {"success": False, "error": "Already in rotation"}

    now = datetime.now(timezone.utc)
    action = OperationalAction(
        action_type="restore_backend", target_type="instance", target_id=instance.id,
        status="success", trigger_source="manual",
        finished_at=now,
    )
    db.add(action)

    state.in_rotation = True
    state.current_status = "healthy"
    state.consecutive_failures = 0
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.cooldown_until = None
    state.reason = "Manually restored to rotation"

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {instance.instance_name} manually restored to DNAT",
                {"action_source": "manual"})

    db.commit()
    return {"success": True, "instance": instance.instance_name}


def set_cooldown(db: Session, instance_id: str, cooldown_seconds: int):
    """Set cooldown on an instance after recovery transition."""
    state = db.query(InstanceState).filter(InstanceState.instance_id == instance_id).first()
    if state:
        state.cooldown_until = datetime.now(timezone.utc) + timedelta(seconds=cooldown_seconds)


def _emit_event(db: Session, event_type: str, severity: str, instance_id: str, message: str, details: dict | None = None):
    ev = OperationalEvent(
        event_type=event_type,
        severity=severity,
        instance_id=instance_id,
        message=message,
        details_json=json.dumps(details) if details else None,
    )
    db.add(ev)
    logger.info(f"Event [{severity}] {event_type}: {message}")
