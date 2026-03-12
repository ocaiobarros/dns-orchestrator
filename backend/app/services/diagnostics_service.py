"""
DNS Control — Diagnostics Service
System status, health checks, service management.
All collection is best-effort: no single failure crashes the endpoint.
"""

import json
import platform
import logging
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.diagnostics")


def _safe_read_file(path: str, default: str = "") -> str:
    """Read a text file, returning default on any failure."""
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except (FileNotFoundError, PermissionError, OSError, IOError):
        return default


def _safe_run(executable: str, args: list[str], timeout: int = 5) -> dict:
    """Run a command, returning a safe default on any failure."""
    try:
        return run_command(executable, args, timeout=timeout)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def get_dashboard_summary() -> dict:
    """Collect live data — best effort, never raises."""
    try:
        services = get_services_status()
    except Exception:
        services = []

    active = sum(1 for s in services if s.get("active"))

    try:
        sys_info = _get_system_info()
    except Exception as e:
        logger.exception(f"_get_system_info failed: {e}")
        sys_info = {
            "hostname": "", "os": "", "kernel": "",
            "unbound_version": "", "frr_version": "", "nftables_version": "",
            "primary_interface": "", "vip_anycast": "",
            "config_version": "", "last_apply_at": None,
        }

    return {
        "total_queries": 0,
        "cache_hit_ratio": 0.0,
        "active_services": active,
        "total_services": len(services),
        "ospf_neighbors_up": 0,
        "ospf_neighbors_total": 0,
        "nat_active_connections": 0,
        "uptime": _get_uptime(),
        "unbound_instances": sum(1 for s in services if "unbound" in s.get("name", "")),
        "alerts": [],
        "hostname": sys_info.get("hostname", ""),
        "os": sys_info.get("os", ""),
        "kernel": sys_info.get("kernel", ""),
        "unbound_version": sys_info.get("unbound_version", ""),
        "frr_version": sys_info.get("frr_version", ""),
        "nftables_version": sys_info.get("nftables_version", ""),
        "primary_interface": sys_info.get("primary_interface", ""),
        "vip_anycast": sys_info.get("vip_anycast", ""),
        "config_version": sys_info.get("config_version", ""),
        "last_apply_at": sys_info.get("last_apply_at") or "",
    }


def _get_system_info() -> dict:
    """Collect real system info — each field independently, never crashes."""
    hostname = ""
    kernel = ""
    os_name = ""
    unbound_version = ""
    frr_version = ""
    nftables_version = ""
    primary_interface = ""
    vip_anycast = ""
    config_version = ""
    last_apply_at = None

    # Hostname & kernel
    try:
        hostname = platform.node() or ""
        kernel = platform.release() or ""
    except Exception:
        pass

    # OS from /etc/os-release
    try:
        content = _safe_read_file("/etc/os-release")
        for line in content.split("\n"):
            if line.startswith("PRETTY_NAME="):
                os_name = line.split("=", 1)[1].strip().strip('"')
                break
    except Exception:
        pass

    # Unbound version
    try:
        r = _safe_run("unbound", ["-V"], timeout=5)
        if r["exit_code"] == 0:
            first_line = r["stdout"].split("\n")[0]
            unbound_version = first_line.strip()
        else:
            r2 = _safe_run("unbound-control", ["status"], timeout=5)
            if r2["exit_code"] == 0:
                for line in r2["stdout"].split("\n"):
                    if "version" in line.lower():
                        unbound_version = line.strip()
                        break
    except Exception:
        pass

    # FRR version
    try:
        r = _safe_run("vtysh", ["-c", "show version"], timeout=5)
        if r["exit_code"] == 0:
            for line in r["stdout"].split("\n"):
                if "FRRouting" in line or "frr" in line.lower():
                    frr_version = line.strip()
                    break
    except Exception:
        pass

    # nftables version
    try:
        r = _safe_run("nft", ["--version"], timeout=5)
        if r["exit_code"] == 0:
            nftables_version = r["stdout"].strip().split("\n")[0]
    except Exception:
        pass

    # Primary interface (default route)
    try:
        r = _safe_run("ip", ["route", "show", "default"], timeout=5)
        if r["exit_code"] == 0 and "dev" in r["stdout"]:
            parts = r["stdout"].split()
            idx = parts.index("dev")
            primary_interface = parts[idx + 1]
    except Exception:
        pass

    # VIP anycast — look for anycast/loopback secondary IPs
    try:
        r = _safe_run("ip", ["-j", "addr", "show", "lo"], timeout=5)
        if r["exit_code"] == 0 and r["stdout"].strip():
            lo_data = json.loads(r["stdout"])
            for iface in lo_data:
                for addr in iface.get("addr_info", []):
                    if addr.get("family") == "inet" and addr.get("local") != "127.0.0.1":
                        vip_anycast = addr["local"]
                        break
    except Exception:
        pass

    # Config version — try to read from a version file
    for path in ["/etc/dns-control/version", "/opt/dns-control/VERSION", "/opt/dns-control/package.json"]:
        try:
            content = _safe_read_file(path)
            if not content:
                continue
            if path.endswith("package.json"):
                config_version = json.loads(content).get("version", "")
            else:
                config_version = content
            if config_version:
                break
        except Exception:
            continue

    # Last apply timestamp
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
        try:
            result = _safe_run("systemctl", ["is-active", name], timeout=5)
            active = result["stdout"].strip() == "active"
        except Exception:
            active = False
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


def get_service_detail(name: str) -> dict:
    result = _safe_run("systemctl", ["status", name], timeout=10)
    return {
        "name": name,
        "status_output": result["stdout"],
        "active": result["exit_code"] == 0,
    }


def restart_service(name: str) -> dict:
    allowed = ["unbound", "frr", "nftables"]
    if name not in allowed and not name.startswith("unbound"):
        return {"success": False, "error": "Serviço não permitido"}
    result = _safe_run("systemctl", ["restart", name], timeout=30)
    return {"success": result["exit_code"] == 0, "output": result["stdout"], "stderr": result["stderr"]}


def get_network_interfaces() -> list[dict]:
    result = _safe_run("ip", ["-j", "addr", "show"], timeout=10)
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
    except (json.JSONDecodeError, KeyError, StopIteration):
        return []


def get_routes() -> list[dict]:
    result = _safe_run("ip", ["-j", "route", "show"], timeout=10)
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
        r = _safe_run("ping", ["-c", "1", "-W", "2", target], timeout=5)
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
        r = _safe_run(cmd[0], cmd[1:], timeout=10)
        results.append({
            "check": name,
            "status": "ok" if r["exit_code"] == 0 else "fail",
            "message": r["stdout"][:300] if r["exit_code"] == 0 else r["stderr"][:300],
            "duration_ms": r["duration_ms"],
        })
    return results


def _get_uptime() -> str:
    try:
        result = _safe_run("uptime", ["-p"], timeout=5)
        return result["stdout"].strip() if result["exit_code"] == 0 else "unknown"
    except Exception:
        return "unknown"
