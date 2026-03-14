"""
DNS Control — Metrics Service
Collects DNS, NAT, and OSPF metrics from system commands.
Multi-instance aware: queries each unbound instance separately.
nftables: uses ruleset/counters, not service status.
"""

from app.executors.command_runner import run_command
from app.services.unbound_stats_service import get_instance_real_stats
import json
import re


def get_dns_metrics(hours: int = 6, instance: str | None = None) -> list[dict]:
    """Get per-instance DNS metrics from unbound-control."""
    stats = get_instance_real_stats()
    if instance:
        stats = [s for s in stats if s.get("instance") == instance]
    return stats


def get_dns_instances() -> list[dict]:
    """Get per-instance status with bind IPs and live stats."""
    from app.services.healthcheck_service import _discover_instances

    discovered = _discover_instances()
    stats = get_instance_real_stats()
    stats_map = {s["instance"]: s for s in stats}

    instances = []
    for inst in discovered:
        name = inst["name"]
        st = stats_map.get(name, {})
        bind_ips = inst.get("bind_ips", [])

        instances.append({
            "name": name,
            "bind_ips": bind_ips,
            "bind_ip": bind_ips[0] if bind_ips else "",
            "port": inst.get("port", 53),
            "status": "running" if st.get("source") == "live" else "stopped",
            "totalQueries": st.get("totalQueries", 0),
            "cacheHitRatio": st.get("cacheHitRatio", 0),
            "avgLatencyMs": st.get("avgLatencyMs", 0),
            "uptime": st.get("uptime", ""),
            "threads": st.get("threads", 0),
            "cacheHits": st.get("cacheHits", 0),
            "cacheMisses": st.get("cacheMisses", 0),
            "servfail": st.get("servfail", 0),
            "nxdomain": st.get("nxdomain", 0),
            "noerror": st.get("noerror", 0),
            "refused": st.get("refused", 0),
            "requestlistCurrent": st.get("requestlistCurrent", 0),
            "requestlistMax": st.get("requestlistMax", 0),
            "source": st.get("source", "unavailable"),
        })
    return instances


def get_top_domains(limit: int = 20) -> list[dict]:
    return []


def get_rcode_breakdown() -> dict:
    """Aggregate rcode breakdown from all instances."""
    stats = get_instance_real_stats()
    totals = {"NOERROR": 0, "NXDOMAIN": 0, "SERVFAIL": 0, "REFUSED": 0}
    for s in stats:
        totals["NOERROR"] += s.get("noerror", 0)
        totals["NXDOMAIN"] += s.get("nxdomain", 0)
        totals["SERVFAIL"] += s.get("servfail", 0)
        totals["REFUSED"] += s.get("refused", 0)
    return totals


def get_nat_summary() -> dict:
    """Get nftables state from ruleset and counters, not service."""
    result = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
    ruleset_loaded = result["exit_code"] == 0 and len(result["stdout"].strip()) > 0

    counters_result = run_command("nft", ["list", "counters"], timeout=10, use_privilege=True)
    counters = _parse_nft_counters(counters_result["stdout"]) if counters_result["exit_code"] == 0 else []

    # Parse DNAT rules from ruleset
    dnat_rules = _parse_dnat_rules(result["stdout"]) if ruleset_loaded else []

    return {
        "ruleset_loaded": ruleset_loaded,
        "counters": counters,
        "dnat_rules": dnat_rules,
        "status": "active" if ruleset_loaded else "no_ruleset",
    }


def _parse_dnat_rules(ruleset: str) -> list[dict]:
    """Extract DNAT rules from nft ruleset."""
    rules = []
    for line in ruleset.split("\n"):
        line_s = line.strip()
        if "dnat to" in line_s.lower() or "dnat" in line_s.lower():
            rules.append({"rule": line_s})
    return rules


def _parse_nft_counters(raw: str) -> list[dict]:
    counters = []
    current = None
    for line in raw.split("\n"):
        line = line.strip()
        m = re.match(r'counter\s+\w+\s+(\S+)\s+(\S+)\s*\{', line)
        if m:
            current = {"name": m.group(2), "chain": m.group(1), "packets": 0, "bytes": 0}
            continue
        if current:
            pm = re.search(r'packets\s+(\d+)', line)
            if pm:
                current["packets"] = int(pm.group(1))
            bm = re.search(r'bytes\s+(\d+)', line)
            if bm:
                current["bytes"] = int(bm.group(1))
            if "}" in line:
                counters.append(current)
                current = None
    return counters


def get_nat_backends() -> list[dict]:
    return []


def get_nat_sticky() -> list[dict]:
    return []


def get_nat_ruleset() -> dict:
    result = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
    return {"ruleset": result["stdout"], "loaded": result["exit_code"] == 0}


def get_ospf_summary() -> dict:
    result = run_command("vtysh", ["-c", "show ip ospf"], timeout=10, use_privilege=True)
    return {"output": result["stdout"], "active": result["exit_code"] == 0}


def get_ospf_neighbors() -> list[dict]:
    result = run_command("vtysh", ["-c", "show ip ospf neighbor"], timeout=10, use_privilege=True)
    return _parse_ospf_neighbors(result["stdout"])


def get_ospf_routes() -> list[dict]:
    result = run_command("vtysh", ["-c", "show ip ospf route"], timeout=10, use_privilege=True)
    return [{"raw": result["stdout"]}]


def get_ospf_running_config() -> dict:
    result = run_command("vtysh", ["-c", "show running-config"], timeout=10, use_privilege=True)
    return {"config": result["stdout"]}


def _parse_ospf_neighbors(raw: str) -> list[dict]:
    neighbors = []
    lines = raw.strip().split("\n")
    for line in lines[1:]:
        parts = line.split()
        if len(parts) >= 6:
            neighbors.append({
                "neighbor_id": parts[0],
                "address": parts[5] if len(parts) > 5 else "",
                "interface": parts[4] if len(parts) > 4 else "",
                "state": parts[3] if len(parts) > 3 else "",
                "dead_time": parts[2] if len(parts) > 2 else "",
                "area": parts[1] if len(parts) > 1 else "",
            })
    return neighbors
