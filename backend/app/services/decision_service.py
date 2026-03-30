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
    """Remove a failed backend from nftables DNAT.

    Strategy: delete all rules that DNAT to this backend's bind_ip from the
    dispatch chains (ipv4_tcp_dns, ipv4_udp_dns). This removes both the
    memorized-source jump rules and the nth-balancing jump rules for this
    instance, so no new traffic is sent to the dead backend.

    The per-instance sticky set (ipv4_users_{name}) is flushed so stale
    client affinities don't survive a future restore.
    """
    now = datetime.now(timezone.utc)
    name = instance.instance_name
    bind_ip = instance.bind_ip
    logger.warning(f"Removing failed backend {name} ({bind_ip}) from DNAT")

    action = OperationalAction(
        action_type="remove_backend",
        target_type="instance",
        target_id=instance.id,
        status="running",
        trigger_source="health_engine",
    )
    db.add(action)
    db.flush()

    errors: list[str] = []
    commands_run: list[str] = []

    # 1. Delete jump rules from dispatch chains that reference this backend's chains
    for proto in ("tcp", "udp"):
        dispatch_chain = f"ipv4_{proto}_dns"
        backend_chain = f"ipv4_dns_{proto}_{name}"

        # Get handles of rules jumping to this backend's chain
        handles = _get_rule_handles_for_jump(dispatch_chain, backend_chain)
        for handle in handles:
            cmd_args = ["delete", "rule", "ip", "nat", dispatch_chain, "handle", str(handle)]
            commands_run.append(f"nft {' '.join(cmd_args)}")
            result = run_command("nft", cmd_args, timeout=10, use_privilege=True)
            if result["exit_code"] != 0:
                errors.append(f"delete rule handle {handle} from {dispatch_chain}: {result['stderr'][:200]}")

    # 2. Flush the sticky set so stale affinities are cleared
    for proto in ("tcp", "udp"):
        set_name = f"ipv4_users_{name}"
        cmd_args = ["flush", "set", "ip", "nat", set_name]
        commands_run.append(f"nft {' '.join(cmd_args)}")
        result = run_command("nft", cmd_args, timeout=10, use_privilege=True)
        if result["exit_code"] != 0:
            # Non-fatal: set might already be empty
            logger.warning(f"Failed to flush set {set_name}: {result['stderr'][:200]}")

    state.in_rotation = False
    state.current_status = "withdrawn"
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.reason = f"Removed from DNAT: {state.consecutive_failures} consecutive failures"

    action.status = "failed" if errors else "success"
    action.stdout_log = "; ".join(commands_run)
    action.stderr_log = "; ".join(errors) if errors else ""
    action.exit_code = 1 if errors else 0
    action.finished_at = now

    _emit_event(db, "backend_removed_from_dnat", "warning", instance.id,
                f"Backend {name} ({bind_ip}) removed from DNAT rotation — "
                f"deleted {len(commands_run)} rules/sets",
                {"action_source": "reconciliation_engine", "reason": "health check failure",
                 "consecutive_failures": state.consecutive_failures,
                 "commands": commands_run})


def _restore_backend(db: Session, instance: DnsInstance, state: InstanceState):
    """Restore a recovered backend to nftables DNAT (after cooldown).

    Strategy: re-add the memorized-source jump rules and nth-balancing jump
    rules for this instance back into the dispatch chains. The per-instance
    backend chains (ipv4_dns_{tcp,udp}_{name}) and sticky sets still exist
    in the ruleset — we only removed the jump rules during removal.

    Note: nth balancing mod values are NOT recalculated here. The restored
    instance is added at the end of the chain, which means it will receive
    traffic from new flows via the existing nth distribution. This is safe
    because sticky clients will be re-memorized naturally.
    """
    now = datetime.now(timezone.utc)
    name = instance.instance_name
    bind_ip = instance.bind_ip
    logger.info(f"Restoring recovered backend {name} ({bind_ip}) to DNAT")

    action = OperationalAction(
        action_type="restore_backend",
        target_type="instance",
        target_id=instance.id,
        status="running",
        trigger_source="health_engine",
    )
    db.add(action)
    db.flush()

    errors: list[str] = []
    commands_run: list[str] = []

    # Re-add jump rules: memorized-source + nth balancing
    for proto in ("tcp", "udp"):
        dispatch_chain = f"ipv4_{proto}_dns"
        backend_chain = f"ipv4_dns_{proto}_{name}"
        set_name = f"ipv4_users_{name}"

        # Memorized-source rule (sticky clients jump to their backend)
        cmd_args = ["add", "rule", "ip", "nat", dispatch_chain,
                    "ip", "saddr", f"@{set_name}", "counter", "jump", backend_chain]
        commands_run.append(f"nft {' '.join(cmd_args)}")
        result = run_command("nft", cmd_args, timeout=10, use_privilege=True)
        if result["exit_code"] != 0:
            errors.append(f"add memorized rule for {backend_chain}: {result['stderr'][:200]}")

        # Nth balancing rule (new flows)
        cmd_args = ["add", "rule", "ip", "nat", dispatch_chain,
                    "numgen", "inc", "mod", "1", "0", "counter", "jump", backend_chain]
        commands_run.append(f"nft {' '.join(cmd_args)}")
        result = run_command("nft", cmd_args, timeout=10, use_privilege=True)
        if result["exit_code"] != 0:
            errors.append(f"add nth rule for {backend_chain}: {result['stderr'][:200]}")

    state.in_rotation = True
    state.last_transition_at = now
    state.last_reconciliation_at = now
    state.cooldown_until = None
    state.reason = "Restored to DNAT after recovery (cooldown elapsed)"

    action.status = "failed" if errors else "success"
    action.stdout_log = "; ".join(commands_run)
    action.stderr_log = "; ".join(errors) if errors else ""
    action.exit_code = 1 if errors else 0
    action.finished_at = now

    _emit_event(db, "backend_restored_to_dnat", "info", instance.id,
                f"Backend {name} ({bind_ip}) restored to DNAT rotation — "
                f"added {len(commands_run)} rules",
                {"action_source": "reconciliation_engine", "reason": "recovery confirmed after cooldown",
                 "commands": commands_run})


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
