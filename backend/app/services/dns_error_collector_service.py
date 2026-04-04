"""
DNS Control — DNS Error Collector Service (Phase 1: MVP)
Parses Unbound logs from journalctl to detect SERVFAIL, NXDOMAIN, timeouts.
Aggregates by domain, client IP, and instance.
Falls back to unbound-control stats when logs are unavailable.
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

# Unbound log patterns for error responses
# Format: "info: <client>#<port> <domain> <qtype> <qclass>"
# Reply format: "info: reply <domain> <qtype> <qclass> to <client>"
# SERVFAIL: "info: <ip> <domain> A IN SERVFAIL"
# Or from reply lines: "reply <domain> ... rcode SERVFAIL"
_RE_REPLY = re.compile(
    r'info:\s+reply\s+(\S+)\s+(\S+)\s+\S+\s+(?:to\s+)?(\S+)'
)
_RE_SERVFAIL = re.compile(
    r'(?:SERVFAIL|servfail)'
)
_RE_NXDOMAIN = re.compile(
    r'(?:NXDOMAIN|nxdomain)'
)
_RE_ERROR_REPLY = re.compile(
    r'info:\s+(\S+?)(?:#\d+)?\s+(\S+)\s+(\S+)\s+\S+\s*(SERVFAIL|NXDOMAIN|REFUSED)?'
)
# Unbound verbose query log: "info: <client> <domain> <qtype> <class>"
_RE_QUERY = re.compile(
    r'info:\s+(\S+?)(?:#\d+)?\s+(\S+)\s+([A-Z0-9]+)\s+([A-Z]+)'
)
# Validation error lines
_RE_VALIDATION_FAIL = re.compile(
    r'info:\s+validation failure\s+<(\S+)\s+(\S+)\s+\S+>'
)


def collect_dns_errors_from_logs(
    instances: list[dict] | None = None,
    since_seconds: int = 60,
) -> dict:
    """
    Parse journalctl for DNS error events.
    Returns structured error data for API consumption and DB persistence.
    """
    if instances is None:
        instances = _discover_unbound_instances()

    unit_args = []
    for inst in instances:
        name = inst.get("name", "")
        svc = name if name.endswith(".service") else f"{name}.service"
        unit_args.extend(["-u", svc])

    if not unit_args:
        unit_args = ["-u", "unbound01.service", "-u", "unbound02.service"]

    # Try journalctl with sudo
    code, stdout, stderr = run_command(
        "journalctl",
        ["--no-pager", *unit_args, "--since", f"{since_seconds} seconds ago", "-o", "short-iso", "-n", "10000"],
        timeout=15,
        use_privilege=True,
    )

    if code != 0 or not stdout.strip():
        # Fallback: without sudo
        code, stdout, stderr = run_command(
            "journalctl",
            ["--no-pager", *unit_args, "--since", f"{since_seconds} seconds ago", "-o", "short-iso", "-n", "10000"],
            timeout=15,
        )

    errors: list[dict] = []
    error_domains: Counter = Counter()
    error_clients: Counter = Counter()
    error_instances: Counter = Counter()
    rcode_counts: Counter = Counter()
    total_lines = 0

    if stdout:
        for line in stdout.split("\n"):
            total_lines += 1
            if "info:" not in line:
                continue

            # Detect instance from line
            inst_name = _extract_instance_from_line(line, instances)

            # Check for SERVFAIL
            if _RE_SERVFAIL.search(line):
                evt = _parse_error_line(line, "SERVFAIL", inst_name)
                if evt:
                    errors.append(evt)
                    rcode_counts["SERVFAIL"] += 1
                    error_domains[evt["qname"]] += 1
                    error_clients[evt["client_ip"]] += 1
                    if inst_name:
                        error_instances[inst_name] += 1
                continue

            # Check for NXDOMAIN
            if _RE_NXDOMAIN.search(line):
                evt = _parse_error_line(line, "NXDOMAIN", inst_name)
                if evt:
                    errors.append(evt)
                    rcode_counts["NXDOMAIN"] += 1
                    error_domains[evt["qname"]] += 1
                    error_clients[evt["client_ip"]] += 1
                    if inst_name:
                        error_instances[inst_name] += 1
                continue

            # Check for REFUSED
            if "REFUSED" in line or "refused" in line:
                evt = _parse_error_line(line, "REFUSED", inst_name)
                if evt:
                    errors.append(evt)
                    rcode_counts["REFUSED"] += 1
                    error_domains[evt["qname"]] += 1
                    error_clients[evt["client_ip"]] += 1

            # Check for validation failure (BOGUS → treated as SERVFAIL)
            vm = _RE_VALIDATION_FAIL.search(line)
            if vm:
                domain = vm.group(1).rstrip(".")
                errors.append({
                    "qname": domain,
                    "qtype": vm.group(2),
                    "client_ip": "unknown",
                    "rcode": "SERVFAIL",
                    "status": "servfail",
                    "instance_name": inst_name,
                    "source": "logs",
                    "confidence": 0.8,
                })
                rcode_counts["SERVFAIL"] += 1
                error_domains[domain] += 1

    return {
        "errors": errors[-500:],  # Cap at 500 most recent
        "rcode_counts": dict(rcode_counts),
        "top_error_domains": [{"domain": d, "count": c} for d, c in error_domains.most_common(20)],
        "top_error_clients": [{"ip": ip, "count": c} for ip, c in error_clients.most_common(20)],
        "top_error_instances": [{"instance": i, "count": c} for i, c in error_instances.most_common(10)],
        "total_errors": len(errors),
        "total_lines_scanned": total_lines,
        "source": "journalctl",
        "since_seconds": since_seconds,
    }


def _parse_error_line(line: str, rcode: str, instance_name: str | None) -> dict | None:
    """Extract client/domain from an error log line."""
    m = _RE_QUERY.search(line)
    if m:
        client_ip = m.group(1).split("#")[0]
        qname = m.group(2).rstrip(".")
        qtype = m.group(3)
        return {
            "qname": qname,
            "qtype": qtype,
            "client_ip": client_ip,
            "rcode": rcode,
            "status": rcode.lower(),
            "instance_name": instance_name,
            "source": "logs",
            "confidence": 0.9,
        }
    # Fallback: try to extract domain at least
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
    """Try to identify which unbound instance produced this log line."""
    for inst in instances:
        name = inst.get("name", "")
        if name and name in line:
            return name
    return None


def _discover_unbound_instances() -> list[dict]:
    """Discover instances from systemd."""
    result = run_command(
        "systemctl",
        ["list-units", "--all", "--type=service", "--no-pager", "--plain"],
        timeout=10,
        use_privilege=True,
    )
    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "").lstrip("●").strip()
                if name == "unbound":
                    continue
                instances.append({"name": name})
    return instances or [{"name": "unbound01"}, {"name": "unbound02"}]


def get_dns_error_stats_from_unbound(instances: list[dict] | None = None) -> dict:
    """
    Fallback: get aggregate error counts from unbound-control stats.
    Lower fidelity than log parsing but always available.
    """
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
        "fidelity": "aggregate",  # No per-domain/client breakdown
        "top_error_domains": [],
        "top_error_clients": [],
        "top_error_instances": [],
    }


def persist_dns_errors(db: Session, errors: list[dict]):
    """Persist collected DNS error events to the database."""
    now = datetime.now(timezone.utc)
    bucket = now.replace(second=0, microsecond=0)

    for err in errors[:200]:  # Cap batch size
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

    db.commit()


def get_dns_error_summary(db: Session, minutes: int = 60) -> dict:
    """Query persisted DNS events for dashboard summary."""
    from sqlalchemy import func

    since = datetime.now(timezone.utc) - timedelta(minutes=minutes)

    # Rcode counts
    rcode_rows = (
        db.query(DnsEvent.rcode, func.count(DnsEvent.id))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok")
        .group_by(DnsEvent.rcode)
        .all()
    )
    rcode_counts = {r: c for r, c in rcode_rows}

    # Top failing domains
    top_domains = (
        db.query(DnsEvent.qname, func.count(DnsEvent.id).label("cnt"))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok")
        .group_by(DnsEvent.qname)
        .order_by(func.count(DnsEvent.id).desc())
        .limit(20)
        .all()
    )

    # Top failing clients
    top_clients = (
        db.query(DnsEvent.client_ip, func.count(DnsEvent.id).label("cnt"))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok")
        .group_by(DnsEvent.client_ip)
        .order_by(func.count(DnsEvent.id).desc())
        .limit(20)
        .all()
    )

    # Top failing instances
    top_instances = (
        db.query(DnsEvent.instance_name, func.count(DnsEvent.id).label("cnt"))
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok", DnsEvent.instance_name.isnot(None))
        .group_by(DnsEvent.instance_name)
        .order_by(func.count(DnsEvent.id).desc())
        .limit(10)
        .all()
    )

    # Error rate per minute (last 60 minutes)
    timeline = (
        db.query(
            func.strftime("%Y-%m-%dT%H:%M:00", DnsEvent.timestamp).label("bucket"),
            func.count(DnsEvent.id).label("cnt"),
        )
        .filter(DnsEvent.timestamp >= since, DnsEvent.status != "ok")
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )

    total_errors = sum(rcode_counts.values())

    return {
        "rcode_counts": rcode_counts,
        "total_errors": total_errors,
        "top_error_domains": [{"domain": d, "count": c} for d, c in top_domains],
        "top_error_clients": [{"ip": ip, "count": c} for ip, c in top_clients],
        "top_error_instances": [{"instance": i, "count": c} for i, c in top_instances],
        "error_timeline": [{"bucket": b, "count": c} for b, c in timeline],
        "period_minutes": minutes,
        "source": "database",
    }


def cleanup_old_events(db: Session, retention_hours: int = 24):
    """Remove DNS events older than retention period."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=retention_hours)
    deleted = db.query(DnsEvent).filter(DnsEvent.timestamp < cutoff).delete()
    db.commit()
    if deleted > 0:
        logger.info(f"Cleaned up {deleted} DNS events older than {retention_hours}h")
