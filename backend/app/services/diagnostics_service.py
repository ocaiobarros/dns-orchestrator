"""
DNS Control — Diagnostics Service
System status, health checks, service management.
"""

from app.executors.command_runner import run_command


def get_dashboard_summary() -> dict:
    # Collect live data from system commands
    services = get_services_status()
    active = sum(1 for s in services if s["active"])
    return {
        "total_queries": 0,
        "cache_hit_ratio": 0.0,
        "active_services": active,
        "total_services": len(services),
        "ospf_neighbors_up": 0,
        "ospf_neighbors_total": 0,
        "nat_active_connections": 0,
        "uptime": _get_uptime(),
        "unbound_instances": sum(1 for s in services if "unbound" in s["name"]),
        "alerts": [],
    }


def get_services_status() -> list[dict]:
    service_names = ["unbound", "frr", "nftables", "systemd-resolved"]
    results = []
    for name in service_names:
        result = run_command("systemctl", ["is-active", name], timeout=5)
        active = result["stdout"].strip() == "active"
        results.append({
            "name": name,
            "display_name": name.capitalize(),
            "active": active,
            "enabled": True,
            "pid": None,
            "uptime": "",
            "memory": "",
            "cpu": "",
        })
    return results


def get_service_detail(name: str) -> dict:
    result = run_command("systemctl", ["status", name], timeout=10)
    return {
        "name": name,
        "status_output": result["stdout"],
        "active": result["exit_code"] == 0,
    }


def restart_service(name: str) -> dict:
    allowed = ["unbound", "frr", "nftables"]
    if name not in allowed and not name.startswith("unbound"):
        return {"success": False, "error": "Serviço não permitido"}
    result = run_command("systemctl", ["restart", name], timeout=30)
    return {"success": result["exit_code"] == 0, "output": result["stdout"], "stderr": result["stderr"]}


def get_network_interfaces() -> list[dict]:
    result = run_command("ip", ["-j", "addr", "show"], timeout=10)
    # Parse JSON output from ip command
    import json
    try:
        interfaces = json.loads(result["stdout"])
        return [
            {
                "name": iface.get("ifname", ""),
                "status": iface.get("operstate", "UNKNOWN"),
                "ipv4": next((a["local"] + "/" + str(a["prefixlen"]) for a in iface.get("addr_info", []) if a["family"] == "inet"), ""),
                "ipv6": next((a["local"] for a in iface.get("addr_info", []) if a["family"] == "inet6" and not a["local"].startswith("fe80")), ""),
                "mac": iface.get("address", ""),
                "mtu": iface.get("mtu", 1500),
            }
            for iface in interfaces
        ]
    except (json.JSONDecodeError, KeyError):
        return []


def get_routes() -> list[dict]:
    result = run_command("ip", ["-j", "route", "show"], timeout=10)
    import json
    try:
        routes = json.loads(result["stdout"])
        return [
            {
                "destination": r.get("dst", "default"),
                "gateway": r.get("gateway", ""),
                "interface": r.get("dev", ""),
                "protocol": r.get("protocol", ""),
                "metric": r.get("metric", 0),
            }
            for r in routes
        ]
    except (json.JSONDecodeError, KeyError):
        return []


def check_reachability() -> list[dict]:
    targets = ["8.8.8.8", "1.1.1.1", "127.0.0.1"]
    results = []
    for target in targets:
        r = run_command("ping", ["-c", "1", "-W", "2", target], timeout=5)
        results.append({
            "target": target,
            "reachable": r["exit_code"] == 0,
            "latency_ms": 0,
            "output": r["stdout"][:200],
        })
    return results


def run_health_check() -> list[dict]:
    checks = [
        ("DNS resolution", ["dig", "@127.0.0.1", "google.com", "+short", "+time=2"]),
        ("FRR running", ["systemctl", "is-active", "frr"]),
        ("nftables loaded", ["nft", "list", "tables"]),
        ("System memory", ["free", "-m"]),
    ]
    results = []
    for name, cmd in checks:
        r = run_command(cmd[0], cmd[1:], timeout=10)
        results.append({
            "check": name,
            "status": "ok" if r["exit_code"] == 0 else "fail",
            "message": r["stdout"][:300] if r["exit_code"] == 0 else r["stderr"][:300],
            "duration_ms": r["duration_ms"],
        })
    return results


def _get_uptime() -> str:
    result = run_command("uptime", ["-p"], timeout=5)
    return result["stdout"].strip() if result["exit_code"] == 0 else "unknown"
