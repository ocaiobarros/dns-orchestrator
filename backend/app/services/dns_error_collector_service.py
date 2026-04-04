"""
DNS Control — DNS Error Collector Service (Phase 2: stats_delta)
Multi-strategy DNS error collection:
  1. dnstap (highest fidelity) — not yet integrated here
  2. journalctl log parsing
  3. unbound-control stats_noreset delta (works without logs/dnstap)

Falls back automatically through strategies.
"""

import json
import logging
import re
from collections import Counter
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from app.executors.command_runner import run_command
from app.models.dns_events import DnsEvent, DnsErrorAggregate

logger = logging.getLogger("dns-control.dns-error-collector")

# ── In-memory delta cache for stats_delta strategy ──────────
# Maps instance_name -> {rcode -> last_seen_value}
_stats_delta_cache: dict[str, dict[str, int]] = {}

# ── Regex patterns for log parsing ──────────────────────────
_RE_SERVFAIL = re.compile(r'(?:SERVFAIL|servfail)')
_RE_NXDOMAIN = re.compile(r'(?:NXDOMAIN|nxdomain)')
_RE_QUERY = re.compile(
    r'info:\s+(\S+?)(?:#\d+)?\s+(\S+)\s+([A-Z0-9]+)\s+([A-Z]+)'
)
_RE_VALIDATION_FAIL = re.compile(
    r'info:\s+validation failure\s+<(\S+)\s+(\S+)\s+\S+>'
)

# Rcodes we track via stats_delta
TRACKED_RCODES = ["NXDOMAIN", "SERVFAIL", "REFUSED"]


# ════════════════════════════════════════════════════════════
# Strategy 1: journalctl log parsing
# ════════════════════════════════════════════════════════════

def collect_dns_errors_from_logs(
    instances: list[dict] | None = None,
    since_seconds: int = 60,
) -> dict:
    """Parse journalctl for DNS error events."""
    if instances is None:
        instances = _discover_unbound_instances()

    unit_args = []
    for inst in instances:
        name = inst.get("name", "")
        svc = name if name.endswith(".service") else f"{name}.service"
        unit_args.extend(["-u", svc])

    if not unit_args:
        unit_args = ["-u", "unbound01.service", "-u", "unbound02.service"]

    # Try with sudo, then without
    result = run_command(
        "journalctl",
        ["--no-pager", *unit_args, "--since", f"{since_seconds} seconds ago", "-o", "short-iso", "-n", "10000"],
        timeout=15,
        use_privilege=True,
    )

    if result["exit_code"] != 0 or not result["stdout"].strip():
        result = run_command(
            "journalctl",
            ["--no-pager", *unit_args, "--since", f"{since_seconds} seconds ago", "-o", "short-iso", "-n", "10000"],
            timeout=15,
        )

    errors: list[dict] = []
    rcode_counts: Counter = Counter()
    error_domains: Counter = Counter()
    error_clients: Counter = Counter()
    error_instances: Counter = Counter()
    total_lines = 0

    stdout = result.get("stdout", "")
    if stdout:
        for line in stdout.split("\n"):
            total_lines += 1
            if "info:" not in line:
                continue

            inst_name = _extract_instance_from_line(line, instances)

            for rcode, regex in [("SERVFAIL", _RE_SERVFAIL), ("NXDOMAIN", _RE_NXDOMAIN)]:
                if regex.search(line):
                    evt = _parse_error_line(line, rcode, inst_name)
                    if evt:
                        errors.append(evt)
                        rcode_counts[rcode] += 1
                        error_domains[evt["qname"]] += 1
                        error_clients[evt["client_ip"]] += 1
                        if inst_name:
                            error_instances[inst_name] += 1
                    break

            if "REFUSED" in line or "refused" in line:
                evt = _parse_error_line(line, "REFUSED", inst_name)
                if evt:
                    errors.append(evt)
                    rcode_counts["REFUSED"] += 1
                    error_domains[evt["qname"]] += 1
                    error_clients[evt["client_ip"]] += 1

            vm = _RE_VALIDATION_FAIL.search(line)
            if vm:
                domain = vm.group(1).rstrip(".")
                errors.append({
                    "qname": domain, "qtype": vm.group(2),
                    "client_ip": "unknown", "rcode": "SERVFAIL",
                    "status": "servfail", "instance_name": inst_name,
                    "source": "logs", "confidence": 0.8,
                })
                rcode_counts["SERVFAIL"] += 1
                error_domains[domain] += 1

    return {
        "errors": errors[-500:],
        "rcode_counts": dict(rcode_counts),
        "top_error_domains": [{"domain": d, "count": c} for d, c in error_domains.most_common(20)],
        "top_error_clients": [{"ip": ip, "count": c} for ip, c in error_clients.most_common(20)],
        "top_error_instances": [{"instance": i, "count": c} for i, c in error_instances.most_common(10)],
        "total_errors": len(errors),
        "total_lines_scanned": total_lines,
        "source": "journalctl",
        "since_seconds": since_seconds,
    }


# ════════════════════════════════════════════════════════════
# Strategy 2: unbound-control stats_noreset DELTA
# ════════════════════════════════════════════════════════════

def collect_dns_errors_from_stats_delta(
    instances: list[dict] | None = None,
) -> dict:
    """
    Collect DNS errors by computing delta of unbound-control stats_noreset counters.
    Works WITHOUT logs or dnstap. Produces synthetic events with source=stats_delta.
    """
    global _stats_delta_cache

    if instances is None:
        instances = _discover_unbound_instances()

    errors: list[dict] = []
    rcode_counts: Counter = Counter()
    error_instances: Counter = Counter()
    instances_checked = 0
    instances_failed = 0

    for inst in instances:
        name = inst.get("name", "unbound")
        ctrl_ip = inst.get("control_interface", "127.0.0.1")
        ctrl_port = inst.get("control_port", 8953)
        config_path = f"/etc/unbound/{name}.conf"

        result = run_command(
            "unbound-control",
            ["-s", f"{ctrl_ip}@{ctrl_port}", "-c", config_path, "stats_noreset"],
            timeout=10,
            use_privilege=True,
        )

        if result["exit_code"] != 0:
            instances_failed += 1
            logger.debug(f"stats_delta: failed for {name}: {result.get('stderr', '')[:100]}")
            continue

        instances_checked += 1
        current_values: dict[str, int] = {}

        for line in result["stdout"].split("\n"):
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            for rcode in TRACKED_RCODES:
                if k == f"num.answer.rcode.{rcode}":
                    try:
                        current_values[rcode] = int(float(v.strip()))
                    except ValueError:
                        pass

        # Compute deltas against cache
        prev = _stats_delta_cache.get(name, {})
        for rcode in TRACKED_RCODES:
            cur = current_values.get(rcode, 0)
            last = prev.get(rcode, 0)

            # First run: seed cache, no delta
            if rcode not in prev:
                continue

            delta = cur - last
            if delta < 0:
                # Counter reset (unbound restarted)
                delta = cur

            if delta > 0:
                rcode_counts[rcode] += delta
                error_instances[name] += delta
                # Create synthetic events (one per delta unit, capped)
                for _ in range(min(delta, 50)):
                    errors.append({
                        "qname": "unknown",
                        "qtype": "A",
                        "client_ip": "unknown",
                        "rcode": rcode,
                        "status": rcode.lower(),
                        "instance_name": name,
                        "source": "stats_delta",
                        "confidence": 0.5,
                    })

        # Update cache
        _stats_delta_cache[name] = current_values

    return {
        "errors": errors[-200:],
        "rcode_counts": dict(rcode_counts),
        "top_error_domains": [],
        "top_error_clients": [],
        "top_error_instances": [{"instance": i, "count": c} for i, c in error_instances.most_common(10)],
        "total_errors": len(errors),
        "source": "stats_delta",
        "fidelity": "counters_only",
        "instances_checked": instances_checked,
        "instances_failed": instances_failed,
    }


# ════════════════════════════════════════════════════════════
# Strategy 3: unbound-control aggregate (absolute, no delta)
# ════════════════════════════════════════════════════════════

def get_dns_error_stats_from_unbound(instances: list[dict] | None = None) -> dict:
    """Fallback: absolute aggregate error counts from unbound-control."""
    if instances is None:
        instances = _discover_unbound_instances()

    totals = {"SERVFAIL": 0, "NXDOMAIN": 0, "REFUSED": 0, "NOERROR": 0}

    for inst in instances:
        name = inst.get("name", "unbound")
        ctrl_ip = inst.get("control_interface", "127.0.0.1")
        ctrl_port = inst.get("control_port", 8953)
        config_path = f"/etc/unbound/{name}.conf"

        result = run_command(
            "unbound-control",
            ["-s", f"{ctrl_ip}@{ctrl_port}", "-c", config_path, "stats_noreset"],
            timeout=10,
            use_privilege=True,
        )

        if result["exit_code"] == 0:
            for line in result["stdout"].split("\n"):
                if "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                try:
                    val = int(float(v.strip()))
                except ValueError:
                    continue
                if k == "num.answer.rcode.SERVFAIL":
                    totals["SERVFAIL"] += val
                elif k == "num.answer.rcode.NXDOMAIN":
                    totals["NXDOMAIN"] += val
                elif k == "num.answer.rcode.REFUSED":
                    totals["REFUSED"] += val
                elif k == "num.answer.rcode.NOERROR":
                    totals["NOERROR"] += val

    total_errors = totals["SERVFAIL"] + totals["NXDOMAIN"] + totals["REFUSED"]
    total_all = total_errors + totals["NOERROR"]
    error_rate = round(total_errors / total_all * 100, 2) if total_all > 0 else 0.0

    return {
        "rcode_counts": totals,
        "total_errors": total_errors,
        "total_queries": total_all,
        "error_rate_pct": error_rate,
        "source": "unbound-control",
        "fidelity": "aggregate",
        "top_error_domains": [],
        "top_error_clients": [],
        "top_error_instances": [],
    }


# ════════════════════════════════════════════════════════════
# Multi-strategy pipeline (used by worker)
# ════════════════════════════════════════════════════════════

def collect_dns_errors_multi_strategy(since_seconds: int = 65) -> dict:
    """
    Try strategies in order:
      1. journalctl logs (highest detail)
      2. stats_delta (works without logs)
    Returns whichever produces events first.
    """
    instances = _discover_unbound_instances()

    # Strategy 1: journalctl
    log_result = collect_dns_errors_from_logs(instances=instances, since_seconds=since_seconds)
    if log_result.get("total_errors", 0) > 0:
        logger.debug(f"Log strategy produced {log_result['total_errors']} errors")
        return log_result

    # Strategy 2: stats_delta
    delta_result = collect_dns_errors_from_stats_delta(instances=instances)
    if delta_result.get("total_errors", 0) > 0:
        logger.debug(f"Stats delta strategy produced {delta_result['total_errors']} errors")
        return delta_result

    # No errors found by any strategy — still seed the delta cache
    if not _stats_delta_cache:
        collect_dns_errors_from_stats_delta(instances=instances)

    return {
        "errors": [],
        "rcode_counts": {},
        "total_errors": 0,
        "source": log_result.get("source", "none"),
        "top_error_domains": [],
        "top_error_clients": [],
        "top_error_instances": [],
    }


# ════════════════════════════════════════════════════════════
# Persistence
# ════════════════════════════════════════════════════════════

def persist_dns_errors(db: Session, errors: list[dict]):
    """Persist collected DNS error events to the database."""
    now = datetime.now(timezone.utc)
    bucket = now.replace(second=0, microsecond=0)

    for err in errors[:200]:
        evt = DnsEvent(
            timestamp=now,
            client_ip=err.get("client_ip", "unknown"),
            qname=err.get("qname", "unknown"),
            qtype=err.get("qtype", "A"),
            rcode=err.get("rcode", "UNKNOWN"),
            status=err.get("status", "unknown"),
            latency_ms=err.get("latency_ms"),
            vip=err.get("vip"),
            backend_ip=err.get("backend_ip"),
            instance_name=err.get("instance_name"),
            source=err.get("source", "logs"),
            confidence=err.get("confidence", 1.0),
        )
        db.add(evt)

    # Update aggregates
    rcode_counts: Counter = Counter()
    for err in errors[:200]:
        rcode_counts[err.get("rcode", "UNKNOWN")] += 1

    for rcode, count in rcode_counts.items():
        existing = db.query(DnsErrorAggregate).filter(
            DnsErrorAggregate.bucket == bucket,
            DnsErrorAggregate.rcode == rcode,
        ).first()
        if existing:
            existing.count += count
        else:
            db.add(DnsErrorAggregate(
                bucket=bucket,
                rcode=rcode,
                count=count,
            ))

    db.commit()


def get_dns_error_summary(db: Session, minutes: int = 60) -> dict:
    """Query persisted DNS events for dashboard summary."""
    from sqlalchemy import func

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    rcode_rows = (
        db.query(DnsEvent.rcode, func.count(DnsEvent.id))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok")
        .group_by(DnsEvent.rcode)
        .all()
    )
    rcode_counts = {r: c for r, c in rcode_rows}

    # Detect primary source
    source_row = (
        db.query(DnsEvent.source)
        .filter(DnsEvent.timestamp >= since)
        .order_by(DnsEvent.timestamp.desc())
        .first()
    )
    primary_source = source_row[0] if source_row else "database"

    top_domains = []
    top_clients = []
    # Only show domain/client detail if source is NOT stats_delta
    if primary_source != "stats_delta":
        top_domains = (
            db.query(DnsEvent.qname, func.count(DnsEvent.id).label("cnt"))
            .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok", DnsEvent.qname != "unknown")
            .group_by(DnsEvent.qname)
            .order_by(func.count(DnsEvent.id).desc())
            .limit(20)
            .all()
        )
        top_clients = (
            db.query(DnsEvent.client_ip, func.count(DnsEvent.id).label("cnt"))
            .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok", DnsEvent.client_ip != "unknown")
            .group_by(DnsEvent.client_ip)
            .order_by(func.count(DnsEvent.id).desc())
            .limit(20)
            .all()
        )

    top_instances = (
        db.query(DnsEvent.instance_name, func.count(DnsEvent.id).label("cnt"))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok", DnsEvent.instance_name.isnot(None))
        .group_by(DnsEvent.instance_name)
        .order_by(func.count(DnsEvent.id).desc())
        .limit(10)
        .all()
    )

    # Timeline from aggregates (uses bucket column)
    timeline = (
        db.query(DnsErrorAggregate.bucket, func.sum(DnsErrorAggregate.count))
        .filter(DnsErrorAggregate.bucket >= since)
        .group_by(DnsErrorAggregate.bucket)
        .order_by(DnsErrorAggregate.bucket)
        .all()
    )

    total_errors = sum(rcode_counts.values())

    return {
        "rcode_counts": rcode_counts,
        "total_errors": total_errors,
        "top_error_domains": [{"domain": d, "count": c} for d, c in top_domains],
        "top_error_clients": [{"ip": ip, "count": c} for ip, c in top_clients],
        "top_error_instances": [{"instance": i, "count": c} for i, c in top_instances],
        "error_timeline": [{"bucket": b.isoformat() if hasattr(b, 'isoformat') else str(b), "count": c} for b, c in timeline],
        "period_minutes": minutes,
        "source": primary_source,
        "fidelity": "counters_only" if primary_source == "stats_delta" else "full",
    }


def cleanup_old_events(db: Session, retention_hours: int = 24):
    """Remove DNS events older than retention period."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)
    deleted_events = db.query(DnsEvent).filter(DnsEvent.timestamp < cutoff).delete()
    deleted_aggs = db.query(DnsErrorAggregate).filter(DnsErrorAggregate.bucket < cutoff).delete()
    db.commit()
    if deleted_events > 0 or deleted_aggs > 0:
        logger.info(f"Cleaned up {deleted_events} events + {deleted_aggs} aggregates older than {retention_hours}h")


# ════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════

def _parse_error_line(line: str, rcode: str, instance_name: str | None) -> dict | None:
    m = _RE_QUERY.search(line)
    if m:
        return {
            "qname": m.group(2).rstrip("."),
            "qtype": m.group(3),
            "client_ip": m.group(1).split("#")[0],
            "rcode": rcode,
            "status": rcode.lower(),
            "instance_name": instance_name,
            "source": "logs",
            "confidence": 0.9,
        }
    parts = line.split("info:")
    if len(parts) > 1:
        tokens = parts[1].strip().split()
        if len(tokens) >= 2:
            return {
                "qname": tokens[1].rstrip(".") if len(tokens) > 1 else "unknown",
                "qtype": tokens[2] if len(tokens) > 2 else "A",
                "client_ip": tokens[0].split("#")[0] if tokens else "unknown",
                "rcode": rcode,
                "status": rcode.lower(),
                "instance_name": instance_name,
                "source": "logs",
                "confidence": 0.6,
            }
    return None


def _extract_instance_from_line(line: str, instances: list[dict]) -> str | None:
    for inst in instances:
        name = inst.get("name", "")
        if name and name in line:
            return name
    return None


def _discover_unbound_instances() -> list[dict]:
    """Discover unbound instances from systemd + parse config for control details."""
    result = run_command(
        "systemctl",
        ["list-units", "--all", "--type=service", "--no-pager", "--plain"],
        timeout=10,
    )
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line.lower() and ".service" in line:
                name = line.split()[0].replace(".service", "").lstrip("●").strip()
                if name == "unbound":
                    continue
                # Parse config to get control interface/port
                ctrl = _parse_control_config(name)
                instances.append({
                    "name": name,
                    "control_interface": ctrl["control_interface"],
                    "control_port": ctrl["control_port"],
                })

    if not instances:
        # Fallback: try common names
        for candidate in ["unbound01", "unbound02"]:
            ctrl = _parse_control_config(candidate)
            instances.append({
                "name": candidate,
                "control_interface": ctrl["control_interface"],
                "control_port": ctrl["control_port"],
            })

    return instances


def _parse_control_config(instance_name: str) -> dict:
    """Extract control-interface and control-port from unbound config."""
    config_path = f"/etc/unbound/{instance_name}.conf"
    result = run_command("cat", [config_path], timeout=5)

    ctrl = {"control_interface": "127.0.0.1", "control_port": 8953}
    if result["exit_code"] != 0:
        return ctrl

    for line in result["stdout"].split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        if stripped.startswith("control-interface:"):
            ctrl["control_interface"] = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("control-port:"):
            try:
                ctrl["control_port"] = int(stripped.split(":", 1)[1].strip())
            except ValueError:
                pass

    return ctrl
