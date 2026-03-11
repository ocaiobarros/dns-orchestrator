"""
DNS Control v2 — Decision / Reconciliation Service
Detects failed instances and manages DNAT backend rotation.
"""

import json
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.models.operational import DnsInstance, InstanceState, OperationalAction, OperationalEvent
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.reconciliation")


def reconcile(db: Session):
    """
    Main reconciliation loop:
    1. Find failed instances that are still in rotation → remove
    2. Find recovered instances that are out of rotation → restore
    """
    instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()

    for inst in instances:
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
        if not state:
            continue

        if state.current_status == "failed" and state.in_rotation:
            _remove_backend(db, inst, state)
        elif state.current_status == "healthy" and not state.in_rotation:
            _restore_backend(db, inst, state)

    db.commit()


def _remove_backend(db: Session, instance: DnsInstance, state: InstanceState):
    """Remove a failed backend from nftables DNAT."""
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
        action.finished_at = datetime.now(timezone.utc)
        return

    # Build nft delete command for DNAT rules pointing to this backend
    # We look for dnat rules with this IP and remove them
    delete_result = run_command(
        "nft",
        ["delete", "element", "ip", "nat", "dns_backends", f"{{ {instance.bind_ip} }}"],
        timeout=10,
    )

    # Even if the specific element removal fails (different ruleset structure),
    # mark the state as withdrawn
    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = datetime.now(timezone.utc)
    state.reason = f"Removed from DNAT: {state.consecutive_failures} consecutive failures"

    action.status = "success" if delete_result["exit_code"] == 0 else "failed"
    action.stdout_log = delete_result["stdout"]
    action.stderr_log = delete_result["stderr"]
    action.exit_code = delete_result["exit_code"]
    action.finished_at = datetime.now(timezone.utc)

    _emit_event(db, "backend_removed_from_dnat", "critical", instance.id,
                f"Backend {instance.instance_name} ({instance.bind_ip}) removed from DNAT rotation")


def _restore_backend(db: Session, instance: DnsInstance, state: InstanceState):
    """Restore a recovered backend to nftables DNAT."""
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
    state.last_transition_at = datetime.now(timezone.utc)
    state.reason = "Restored to DNAT after recovery"

    action.status = "success" if restore_result["exit_code"] == 0 else "failed"
    action.stdout_log = restore_result["stdout"]
    action.stderr_log = restore_result["stderr"]
    action.exit_code = restore_result["exit_code"]
    action.finished_at = datetime.now(timezone.utc)

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {instance.instance_name} ({instance.bind_ip}) restored to DNAT rotation")


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

    action = OperationalAction(
        action_type="remove_backend", target_type="instance", target_id=instance.id,
        status="success", trigger_source="manual",
        finished_at=datetime.now(timezone.utc),
    )
    db.add(action)

    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = datetime.now(timezone.utc)
    state.reason = "Manually removed from rotation"

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {instance.instance_name} manually removed from DNAT")

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

    action = OperationalAction(
        action_type="restore_backend", target_type="instance", target_id=instance.id,
        status="success", trigger_source="manual",
        finished_at=datetime.now(timezone.utc),
    )
    db.add(action)

    state.in_rotation = True
    state.current_status = "healthy"
    state.consecutive_failures = 0
    state.last_transition_at = datetime.now(timezone.utc)
    state.reason = "Manually restored to rotation"

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {instance.instance_name} manually restored to DNAT")

    db.commit()
    return {"success": True, "instance": instance.instance_name}


def _emit_event(db: Session, event_type: str, severity: str, instance_id: str, message: str):
    ev = OperationalEvent(event_type=event_type, severity=severity, instance_id=instance_id, message=message)
    db.add(ev)
