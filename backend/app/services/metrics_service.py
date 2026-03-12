"""
DNS Control — Metrics Service
Collects DNS, NAT, and OSPF metrics from system commands.
"""

from app.executors.command_runner import run_command
import json
import re


def get_dns_metrics(hours: int = 6, instance: str | None = None) -> list[dict]:
    # Query unbound-control stats
    args = ["stats_noreset"]
    result = run_command("unbound-control", args, timeout=10)
    # Parse and return structured metrics
    return _parse_unbound_stats(result["stdout"])


def get_dns_instances() -> list[dict]:
    result = run_command("systemctl", ["list-units", "--type=service", "--no-pager", "--plain"], timeout=10)
    instances = []
    for line in result["stdout"].split("\n"):
        if "unbound" in line and ".service" in line:
            name = line.split()[0].replace(".service", "")
            active = "running" in line
            instances.append({
                "name": name, "bind_ip": "", "port": 53,
                "status": "running" if active else "stopped",
                "queries_total": 0, "cache_entries": 0, "uptime": "",
            })
    return instances


def get_top_domains(limit: int = 20) -> list[dict]:
    # Would parse unbound logs or extended stats
    return []


def get_rcode_breakdown() -> dict:
    return {"NOERROR": 0, "NXDOMAIN": 0, "SERVFAIL": 0, "REFUSED": 0}


def get_nat_summary() -> dict:
    result = run_command("nft", ["list", "counters"], timeout=10)
    counters = _parse_nft_counters(result["stdout"]) if result["exit_code"] == 0 else []
    return {"ruleset_loaded": result["exit_code"] == 0, "counters": counters}


def _parse_nft_counters(raw: str) -> list[dict]:
    """Parse nft list counters output into structured array."""
    counters = []
    current = None
    for line in raw.split("\n"):
        line = line.strip()
        # Match: counter <family> <table> <name> {
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
    result = run_command("nft", ["list", "ruleset"], timeout=10)
    return {"ruleset": result["stdout"]}


def get_ospf_summary() -> dict:
    result = run_command("vtysh", ["-c", "show ip ospf"], timeout=10)
    return {"output": result["stdout"], "active": result["exit_code"] == 0}


def get_ospf_neighbors() -> list[dict]:
    result = run_command("vtysh", ["-c", "show ip ospf neighbor"], timeout=10)
    return _parse_ospf_neighbors(result["stdout"])


def get_ospf_routes() -> list[dict]:
    result = run_command("vtysh", ["-c", "show ip ospf route"], timeout=10)
    return [{"raw": result["stdout"]}]


def get_ospf_running_config() -> dict:
    result = run_command("vtysh", ["-c", "show running-config"], timeout=10)
    return {"config": result["stdout"]}


def _parse_unbound_stats(raw: str) -> list[dict]:
    # Basic parser for unbound-control stats output
    metrics = {}
    for line in raw.split("\n"):
        if "=" in line:
            key, val = line.split("=", 1)
            metrics[key.strip()] = val.strip()
    return [metrics] if metrics else []


def _parse_ospf_neighbors(raw: str) -> list[dict]:
    neighbors = []
    lines = raw.strip().split("\n")
    for line in lines[1:]:  # skip header
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
