"""
DNS Control — Diagnostics Service
System status, health checks, service management.
"""

import platform
from app.executors.command_runner import run_command


def get_dashboard_summary() -> dict:
    # Collect live data from system commands
    services = get_services_status()
    active = sum(1 for s in services if s["active"])
    sys_info = _get_system_info()
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
        # System info fields
        "hostname": sys_info["hostname"],
        "os": sys_info["os"],
        "kernel": sys_info["kernel"],
        "unbound_version": sys_info["unbound_version"],
        "frr_version": sys_info["frr_version"],
        "nftables_version": sys_info["nftables_version"],
        "primary_interface": sys_info["primary_interface"],
        "vip_anycast": sys_info["vip_anycast"],
        "config_version": sys_info["config_version"],
        "last_apply_at": sys_info["last_apply_at"],
    }


def _get_system_info() -> dict:
    """Collect real system info from the machine."""
    hostname = platform.node() or "unknown"
    kernel = platform.release() or "unknown"

    # OS from /etc/os-release
    os_name = "unknown"
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    os_name = line.split("=", 1)[1].strip().strip('"')
                    break
    except FileNotFoundError:
        pass

    # Unbound version
    r = run_command("unbound", ["-V"], timeout=5)
    unbound_version = ""
    if r["exit_code"] == 0:
        first_line = r["stdout"].split("\n")[0]
        unbound_version = first_line.strip()
    else:
        # Try unbound-control
        r2 = run_command("unbound-control", ["status"], timeout=5)
        if r2["exit_code"] == 0:
            for line in r2["stdout"].split("\n"):
                if "version" in line.lower():
                    unbound_version = line.strip()
                    break

    # FRR version
    r = run_command("vtysh", ["-c", "show version"], timeout=5)
    frr_version = ""
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            if "FRRouting" in line or "frr" in line.lower():
                frr_version = line.strip()
                break

    # nftables version
    r = run_command("nft", ["--version"], timeout=5)
    nftables_version = r["stdout"].strip().split("\n")[0] if r["exit_code"] == 0 else ""

    # Primary interface (default route)
    primary_interface = ""
    r = run_command("ip", ["route", "show", "default"], timeout=5)
    if r["exit_code"] == 0 and "dev" in r["stdout"]:
        parts = r["stdout"].split()
        try:
            idx = parts.index("dev")
            primary_interface = parts[idx + 1]
        except (ValueError, IndexError):
            pass

    # VIP anycast — look for anycast/loopback secondary IPs
    vip_anycast = ""
    r = run_command("ip", ["-j", "addr", "show", "lo"], timeout=5)
    if r["exit_code"] == 0:
        import json
        try:
            lo_data = json.loads(r["stdout"])
            for iface in lo_data:
                for addr in iface.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local") != "127.0.0.1":
                        vip_anycast = addr["local"]
                        break
        except (json.JSONDecodeError, KeyError):
            pass

    # Config version — try to read from a version file
    config_version = ""
    for path in ["/etc/dns-control/version", "/opt/dns-control/VERSION", "/opt/dns-control/package.json"]:
        try:
            with open(path) as f:
                content = f.read().strip()
                if path.endswith("package.json"):
                    import json
                    config_version = json.loads(content).get("version", "")
                else:
                    config_version = content
                break
        except (FileNotFoundError, json.JSONDecodeError):
            continue

    # Last apply timestamp
    last_apply_at = None
    try:
        from app.core.database import get_db
        db = next(get_db())
        row = db.execute(
            "SELECT timestamp FROM apply_history ORDER BY timestamp DESC LIMIT 1"
        ).fetchone()
        if row:
            last_apply_at = row[0]
    except Exception:
        pass

    return {
        "hostname": hostname,
        "os": os_name,
        "kernel": kernel,
        "unbound_version": unbound_version,
        "frr_version": frr_version,
        "nftables_version": nftables_version,
        "primary_interface": primary_interface,
        "vip_anycast": vip_anycast,
        "config_version": config_version,
        "last_apply_at": last_apply_at,
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
            "status": "running" if active else "stopped",
            "enabled": True,
            "pid": None,
            "uptime": "",
            "memory": "",
            "cpu": "",
        })
    return results


# ... keep existing code
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
