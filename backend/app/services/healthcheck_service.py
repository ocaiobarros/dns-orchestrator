"""
DNS Control — Instance Health Check Service
Multi-instance aware: discovers unbound01/unbound02 and checks each
at all their bind IPs.
"""

import time
import logging
from typing import Any

from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.healthcheck")

PROBE_DOMAIN = "google.com"
PROBE_TIMEOUT = 3


def check_instance_health(bind_ip: str, port: int = 53, name: str = "") -> dict[str, Any]:
    start = time.monotonic()
    result = run_command(
        "dig",
        [f"@{bind_ip}", "-p", str(port), PROBE_DOMAIN, "+short", f"+time={PROBE_TIMEOUT}", "+tries=1"],
        timeout=PROBE_TIMEOUT + 2,
    )
    elapsed_ms = int((time.monotonic() - start) * 1000)

    healthy = result["exit_code"] == 0 and len(result["stdout"].strip()) > 0
    resolved_ip = result["stdout"].strip().split("\n")[0] if healthy else ""

    status = {
        "instance": name or bind_ip,
        "bind_ip": bind_ip,
        "port": port,
        "healthy": healthy,
        "resolved_ip": resolved_ip,
        "latency_ms": elapsed_ms,
        "probe_domain": PROBE_DOMAIN,
        "error": result["stderr"].strip() if not healthy else None,
        "timestamp": time.time(),
    }

    if not healthy:
        logger.warning(f"Health check FAILED for {name}@{bind_ip}:{port} — {result['stderr'][:200]}")
    else:
        logger.debug(f"Health check OK for {name}@{bind_ip}:{port} — {elapsed_ms}ms")

    return status


def check_all_instances(instances: list[dict] | None = None) -> dict[str, Any]:
    if instances is None:
        instances = _discover_instances()

    results = []
    for inst in instances:
        bind_ips = inst.get("bind_ips", [])
        if not bind_ips:
            bind_ips = [inst.get("bind_ip", inst.get("bindIp", "127.0.0.1"))]

        for ip in bind_ips:
            r = check_instance_health(
                bind_ip=ip,
                port=inst.get("port", 53),
                name=inst.get("name", ""),
            )
            results.append(r)

    healthy_count = sum(1 for r in results if r["healthy"])
    total = len(results)

    return {
        "healthy": healthy_count,
        "total": total,
        "all_healthy": healthy_count == total,
        "degraded": 0 < healthy_count < total,
        "down": healthy_count == 0 and total > 0,
        "instances": results,
        "timestamp": time.time(),
    }


def check_vip_health(vip: str = "4.2.2.5", port: int = 53) -> dict[str, Any]:
    return check_instance_health(bind_ip=vip, port=port, name="VIP-Anycast")


def _discover_instances() -> list[dict]:
    """
    Discover running Unbound instances from systemd and parse their config files
    to find all bind IPs.
    """
    result = run_command(
        "systemctl", ["list-units", "--type=service", "--state=running", "--no-pager", "--plain"],
        timeout=10,
    )

    instances = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                if name == "unbound":
                    continue
                bind_ips = _get_bind_ips_from_config(name)
                instances.append({"name": name, "bind_ips": bind_ips, "port": 53})

    if not instances:
        instances = [
            {"name": "unbound01", "bind_ips": ["100.127.255.101", "191.243.128.205"], "port": 53},
            {"name": "unbound02", "bind_ips": ["100.127.255.102", "191.243.128.206"], "port": 53},
        ]

    return instances


def _get_bind_ips_from_config(instance_name: str) -> list[str]:
    """Extract ALL interface: directives from unbound config."""
    result = run_command(
        "cat", [f"/etc/unbound/{instance_name}.conf"],
        timeout=5,
    )
    ips = []
    if result["exit_code"] == 0:
        for line in result["stdout"].split("\n"):
            stripped = line.strip()
            if stripped.startswith("interface:") and not stripped.startswith("interface-automatic"):
                ip = stripped.split(":", 1)[1].strip()
                if ip and not ip.startswith("#"):
                    ips.append(ip)
    return ips if ips else ["127.0.0.1"]
