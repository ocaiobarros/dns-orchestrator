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

    # Parse DNAT backends with inline counters from the ruleset
    backends = _parse_dnat_backends(result["stdout"]) if ruleset_loaded else []

    # Parse entry counters from PREROUTING chain
    entry_counters = _parse_entry_counters(result["stdout"]) if ruleset_loaded else []

    return {
        "ruleset_loaded": ruleset_loaded,
        "counters": backends,
        "backends": backends,
        "entry_counters": entry_counters,
        "status": "active" if ruleset_loaded else "no_ruleset",
    }


def _parse_dnat_backends(ruleset: str) -> list[dict]:
    """
    Extract DNAT backends with inline counter values from the ruleset.
    Matches lines like:
      tcp dport 53 counter packets 123 bytes 45678 dnat to 100.127.255.101:53
      udp dport 53 counter packets 456 bytes 78901 dnat to 100.127.255.101:53
    """
    backends: dict[str, dict] = {}
    current_chain = ""

    for line in ruleset.split("\n"):
        stripped = line.strip()

        # Track current chain name
        chain_match = re.match(r'chain\s+(\S+)\s*\{', stripped)
        if chain_match:
            current_chain = chain_match.group(1)
            continue

        # Match DNAT rules with inline counters
        dnat_match = re.search(
            r'(tcp|udp)\s+dport\s+(\d+)\s+counter\s+packets\s+(\d+)\s+bytes\s+(\d+)\s+dnat\s+to\s+(\S+)',
            stripped,
        )
        if dnat_match:
            proto = dnat_match.group(1)
            port = int(dnat_match.group(2))
            packets = int(dnat_match.group(3))
            bytes_val = int(dnat_match.group(4))
            target = dnat_match.group(5)
            backend_ip = target.split(":")[0]

            if backend_ip not in backends:
                backends[backend_ip] = {
                    "backend": backend_ip,
                    "name": backend_ip,
                    "chain": current_chain,
                    "packets": 0,
                    "bytes": 0,
                    "tcp_packets": 0,
                    "udp_packets": 0,
                    "tcp_bytes": 0,
                    "udp_bytes": 0,
                    "port": port,
                    "target": target,
                }

            entry = backends[backend_ip]
            entry["packets"] += packets
            entry["bytes"] += bytes_val
            if proto == "tcp":
                entry["tcp_packets"] += packets
                entry["tcp_bytes"] += bytes_val
            else:
                entry["udp_packets"] += packets
                entry["udp_bytes"] += bytes_val

    return list(backends.values())


def _parse_entry_counters(ruleset: str) -> list[dict]:
    """Parse PREROUTING entry counters for VIP traffic measurement."""
    entries = []
    in_prerouting = False

    for line in ruleset.split("\n"):
        stripped = line.strip()
        if "chain PREROUTING" in stripped:
            in_prerouting = True
            continue
        if in_prerouting and stripped == "}":
            in_prerouting = False
            continue
        if in_prerouting:
            m = re.search(
                r'ip\s+daddr\s+\{([^}]+)\}\s+(tcp|udp)\s+dport\s+(\d+)\s+counter\s+packets\s+(\d+)\s+bytes\s+(\d+)',
                stripped,
            )
            if m:
                vips = [v.strip() for v in m.group(1).split(",")]
                entries.append({
                    "vips": vips,
                    "protocol": m.group(2),
                    "port": int(m.group(3)),
                    "packets": int(m.group(4)),
                    "bytes": int(m.group(5)),
                })

    return entries


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
