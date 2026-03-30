"""
DNS Control v2.1 — Decision / Reconciliation Service
Anti-flap cooldown, safe backend rotation via atomic nftables batch rebuild.

KEY DESIGN: No nft parsing, no handle tracking. Reconciliation works by:
1. Reading active backends from dns_instances (source of truth)
2. Atomically rebuilding dispatch chains via `nft -f <batch>`
3. Backend chains, sets, and DNAT rules remain FIXED — only dispatch membership changes
"""

import json
import logging
import os
import tempfile
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

    # Collect state changes needed
    removals: list[tuple[DnsInstance, InstanceState]] = []
    restorations: list[tuple[DnsInstance, InstanceState]] = []

    for inst in instances:
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
        if not state:
            continue

        summary["instances_checked"] += 1

        if state.current_status == "failed" and state.in_rotation:
            removals.append((inst, state))
            summary["instances_failed"] += 1

        elif state.current_status == "healthy" and not state.in_rotation:
            if state.cooldown_until and now < state.cooldown_until:
                remaining = (state.cooldown_until - now).total_seconds()
                logger.info(f"Cooldown active for {inst.instance_name}: {remaining:.0f}s remaining")
                continue
            restorations.append((inst, state))

        if state.current_status == "failed" and not state.in_rotation:
            summary["instances_failed"] += 1

    # Apply state changes and rebuild dispatch chains atomically
    if removals or restorations:
        for inst, state in removals:
            _mark_removed(db, inst, state)
            summary["backends_removed"] += 1

        for inst, state in restorations:
            _mark_restored(db, inst, state)
            summary["backends_restored"] += 1

        # Atomic rebuild of dispatch chains with only active backends
        active_backends = _get_active_backends(db, instances)
        rebuild_result = _rebuild_dispatch_chains(active_backends)

        if not rebuild_result["success"]:
            logger.error(f"Dispatch chain rebuild failed: {rebuild_result['error']}")
            # Log but don't rollback DB state — the chains may be partially updated

        # Flush sticky sets for removed backends
        for inst, state in removals:
            _flush_sticky_sets(inst.instance_name)

    db.commit()
    return summary


def _mark_removed(db: Session, instance: DnsInstance, state: InstanceState):
    """Update DB state for a removed backend (no nft operations here)."""
    now = datetime.now(timezone.utc)
    name = instance.instance_name

    action = OperationalAction(
        action_type="remove_backend",
        target_type="instance",
        target_id=instance.id,
        status="success",
        trigger_source="health_engine",
        finished_at=now,
    )
    db.add(action)

    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.reason = f"Removed from DNAT: {state.consecutive_failures} consecutive failures"

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {name} ({instance.bind_ip}) removed from DNAT rotation",
                {"action_source": "reconciliation_engine",
                 "reason": "health check failure",
                 "consecutive_failures": state.consecutive_failures})


def _mark_restored(db: Session, instance: DnsInstance, state: InstanceState):
    """Update DB state for a restored backend (no nft operations here)."""
    now = datetime.now(timezone.utc)
    name = instance.instance_name

    action = OperationalAction(
        action_type="restore_backend",
        target_type="instance",
        target_id=instance.id,
        status="success",
        trigger_source="health_engine",
        finished_at=now,
    )
    db.add(action)

    state.in_rotation = True
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.cooldown_until = None
    state.reason = "Restored to DNAT after recovery (cooldown elapsed)"

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {name} ({instance.bind_ip}) restored to DNAT rotation",
                {"action_source": "reconciliation_engine",
                 "reason": "recovery confirmed after cooldown"})


def _get_active_backends(db: Session, all_instances: list[DnsInstance]) -> list[dict]:
    """Get list of backends currently in rotation."""
    active = []
    for inst in all_instances:
        state = db.query(InstanceState).filter(InstanceState.instance_id == inst.id).first()
        if state and state.in_rotation:
            active.append({
                "name": inst.instance_name,
                "bind_ip": inst.bind_ip,
            })
    return active


def _rebuild_dispatch_chains(active_backends: list[dict]) -> dict:
    """
    Atomically rebuild dispatch chains with only active backends.
    Uses `nft -f <batch>` for atomic execution — no parsing, no handles.

    The batch:
    1. Flushes ipv4_tcp_dns and ipv4_udp_dns dispatch chains
    2. Re-adds memorized-source rules for active backends only
    3. Re-adds nth balancing rules with correct mod values

    Backend chains, sticky sets, and DNAT rules remain UNTOUCHED.
    """
    if not active_backends:
        logger.warning("No active backends — dispatch chains will be empty (all traffic dropped)")

    batch_lines = []
    num_active = len(active_backends)

    for proto in ("tcp", "udp"):
        dispatch = f"ipv4_{proto}_dns"
        batch_lines.append(f"flush chain ip nat {dispatch}")

        # Memorized-source rules (sticky clients)
        for backend in active_backends:
            name = backend["name"]
            subchain = f"ipv4_dns_{proto}_{name}"
            subusers = f"ipv4_users_{name}"
            batch_lines.append(
                f"add rule ip nat {dispatch} ip saddr @{subusers} counter jump {subchain}"
            )

        # Nth balancing rules (new flows) — decreasing mod
        rand_num = num_active
        for backend in active_backends:
            name = backend["name"]
            subchain = f"ipv4_dns_{proto}_{name}"
            batch_lines.append(
                f"add rule ip nat {dispatch} numgen inc mod {rand_num} 0 counter jump {subchain}"
            )
            rand_num -= 1

    batch_content = "\n".join(batch_lines) + "\n"

    # Write batch to temp file and execute atomically
    try:
        fd, batch_path = tempfile.mkstemp(prefix="dns-control-dispatch-", suffix=".nft")
        with os.fdopen(fd, "w") as f:
            f.write(batch_content)

        result = run_command("nft", ["-f", batch_path], timeout=10, use_privilege=True)

        try:
            os.unlink(batch_path)
        except Exception:
            pass

        if result["exit_code"] != 0:
            logger.error(f"nft batch rebuild failed: {result['stderr'][:500]}")
            return {"success": False, "error": result["stderr"][:500], "batch": batch_content}

        logger.info(
            f"Dispatch chains rebuilt atomically: {num_active} active backends, "
            f"{len(batch_lines)} rules"
        )
        return {"success": True, "active_count": num_active, "rules_applied": len(batch_lines)}

    except Exception as e:
        logger.exception(f"Failed to rebuild dispatch chains: {e}")
        return {"success": False, "error": str(e)}


def _flush_sticky_sets(instance_name: str):
    """Flush sticky sets for a removed backend so stale affinities are cleared."""
    set_name = f"ipv4_users_{instance_name}"
    result = run_command("nft", ["flush", "set", "ip", "nat", set_name], timeout=10, use_privilege=True)
    if result["exit_code"] != 0:
        logger.warning(f"Failed to flush set {set_name}: {result['stderr'][:200]}")
    else:
        logger.info(f"Flushed sticky set {set_name}")


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
    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.reason = "Manually removed from rotation"

    action = OperationalAction(
        action_type="remove_backend", target_type="instance", target_id=instance.id,
        status="running", trigger_source="manual",
    )
    db.add(action)
    db.flush()

    # Rebuild dispatch chains without this backend
    all_instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    active_backends = _get_active_backends(db, all_instances)
    rebuild = _rebuild_dispatch_chains(active_backends)
    _flush_sticky_sets(instance.instance_name)

    action.status = "success" if rebuild["success"] else "failed"
    action.finished_at = now
    action.stdout_log = json.dumps(rebuild)

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {instance.instance_name} manually removed from DNAT",
                {"action_source": "manual", "rebuild": rebuild})

    db.commit()
    return {"success": rebuild["success"], "instance": instance.instance_name}


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
    state.in_rotation = True
    state.current_status = "healthy"
    state.consecutive_failures = 0
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.cooldown_until = None
    state.reason = "Manually restored to rotation"

    action = OperationalAction(
        action_type="restore_backend", target_type="instance", target_id=instance.id,
        status="running", trigger_source="manual",
    )
    db.add(action)
    db.flush()

    # Rebuild dispatch chains with this backend included
    all_instances = db.query(DnsInstance).filter(DnsInstance.is_enabled == True).all()
    active_backends = _get_active_backends(db, all_instances)
    rebuild = _rebuild_dispatch_chains(active_backends)

    action.status = "success" if rebuild["success"] else "failed"
    action.finished_at = now
    action.stdout_log = json.dumps(rebuild)

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {instance.instance_name} manually restored to DNAT",
                {"action_source": "manual", "rebuild": rebuild})

    db.commit()
    return {"success": rebuild["success"], "instance": instance.instance_name}


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
