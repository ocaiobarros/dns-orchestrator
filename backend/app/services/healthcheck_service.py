"""
DNS Control — Instance Health Check Service
Multi-instance aware: discovers unbound01/unbound02 and checks each
at all their bind IPs.
"""

import time
import logging
import glob
import os
import re
from typing import Any

# Strict pattern for real Unbound instance configs (unboundNN.conf).
# Excludes auxiliary include files such as unbound-block-domains.conf,
# unbound.conf (package default), etc.
_INSTANCE_NAME_RE = re.compile(r"^unbound\d+$")

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
        "probe_method": "direct_dig",
    }

    if not healthy:
        logger.warning(f"Health check FAILED for {name}@{bind_ip}:{port} — {result['stderr'][:200]}")
    else:
        logger.debug(f"Health check OK for {name}@{bind_ip}:{port} — {elapsed_ms}ms")

    return status


def _check_port_bound(bind_ip: str, port: int = 53) -> tuple[bool, int]:
    """Verify the listener socket is bound on bind_ip:port using ss.

    Returns (is_bound, elapsed_ms). Used in modes where direct DNS probe is not
    representative of the operational path (Simple mode: traffic flows through
    the Frontend DNS / DNAT, ACL may refuse direct loopback queries).
    """
    start = time.monotonic()
    result = run_command("ss", ["-lntup"], timeout=5)
    elapsed_ms = int((time.monotonic() - start) * 1000)
    out = result.get("stdout") or ""
    bound = (bind_ip in out) and (f":{port}" in out)
    return bound, elapsed_ms


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for item in items:
        value = str(item).strip()
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _extract_root_forward_addresses(config_text: str) -> list[str]:
    """Extract forward-addr values from the root forward-zone only."""
    forwards: list[str] = []
    in_forward_zone = False
    current_zone: str | None = None

    for raw_line in config_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line == "forward-zone:":
            in_forward_zone = True
            current_zone = None
            continue
        if in_forward_zone and line.endswith(":") and line != "forward-zone:":
            in_forward_zone = False
            current_zone = None
            continue
        if not in_forward_zone:
            continue
        if line.startswith("name:"):
            current_zone = line.split(":", 1)[1].strip().strip('"')
            continue
        if current_zone == "." and line.startswith("forward-addr:"):
            forwards.append(line.split(":", 1)[1].strip())

    return _dedupe_preserve_order(forwards)


def discover_root_forward_addresses(config_glob: str = "/etc/unbound/unbound*.conf") -> list[str]:
    """Read deployed Unbound instance configs and return real root forwarders.

    This keeps dashboard topology accurate even for deploy-state files created
    before forwardAddrs were persisted there.
    """
    forwards: list[str] = []
    for config_path in sorted(glob.glob(config_glob)):
        name = os.path.splitext(os.path.basename(config_path))[0]
        if not _INSTANCE_NAME_RE.match(name):
            continue
        try:
            with open(config_path, encoding="utf-8") as fp:
                forwards.extend(_extract_root_forward_addresses(fp.read()))
        except OSError:
            continue
    return _dedupe_preserve_order(forwards)


def resolve_forward_addresses_from_state(state: dict[str, Any]) -> list[str]:
    raw_forwards = (
        state.get("forwardAddrs")
        or state.get("forward_addresses")
        or (state.get("_wizardConfig") or {}).get("forwardAddrs")
        or []
    )
    if isinstance(raw_forwards, list):
        forwards = _dedupe_preserve_order([str(x).strip() for x in raw_forwards])
    else:
        forwards = []
    return forwards or discover_root_forward_addresses()


def check_instance_health_via_frontend(
    bind_ip: str,
    port: int = 53,
    name: str = "",
    frontend_ip: str | None = None,
    frontend_healthy: bool | None = None,
    frontend_latency_ms: int | None = None,
) -> dict[str, Any]:
    """Health probe for Simple mode.

    The Unbound backends (e.g. 100.127.255.x bound on lo0) only receive traffic
    routed via the Frontend DNS through nftables DNAT, and their ACL typically
    refuses direct queries from arbitrary sources. Probing them directly with
    `dig` produces false negatives (REFUSED / timeout). Instead, validate:
      1. The listener socket is bound (ss).
      2. The Frontend DNS responds (probed once, shared across instances).
    """
    bound, elapsed_ms = _check_port_bound(bind_ip, port)
    healthy = bool(bound and (frontend_healthy if frontend_healthy is not None else True))
    latency = frontend_latency_ms if frontend_latency_ms is not None else elapsed_ms

    error: str | None = None
    if not bound:
        error = f"Listener {bind_ip}:{port} not bound"
    elif frontend_healthy is False:
        error = f"Frontend DNS {frontend_ip or '?'} not responding"

    return {
        "instance": name or bind_ip,
        "bind_ip": bind_ip,
        "port": port,
        "healthy": healthy,
        "resolved_ip": "",
        "latency_ms": latency,
        "probe_domain": PROBE_DOMAIN,
        "error": error,
        "timestamp": time.time(),
        "probe_method": "frontend_dns" if frontend_ip else "listener_only",
        "frontend_ip": frontend_ip,
    }


def check_all_instances(
    instances: list[dict] | None = None,
    *,
    operation_mode: str | None = None,
    frontend_ip: str | None = None,
) -> dict[str, Any]:
    if instances is None:
        instances = _discover_instances()

    is_simple = (operation_mode or "").lower() in ("simple", "recursivo_simples", "recursivo simples")

    # In Simple mode, probe the Frontend DNS once and reuse across instances.
    fe_healthy: bool | None = None
    fe_latency: int | None = None
    if is_simple and frontend_ip:
        fe_probe = check_instance_health(bind_ip=frontend_ip, name="frontend-dns")
        fe_healthy = bool(fe_probe.get("healthy"))
        fe_latency = int(fe_probe.get("latency_ms") or 0)

    results = []
    for inst in instances:
        bind_ips = inst.get("bind_ips", [])
        if not bind_ips:
            bind_ips = [inst.get("bind_ip", inst.get("bindIp", "127.0.0.1"))]

        for ip in bind_ips:
            if is_simple:
                r = check_instance_health_via_frontend(
                    bind_ip=ip,
                    port=inst.get("port", 53),
                    name=inst.get("name", ""),
                    frontend_ip=frontend_ip,
                    frontend_healthy=fe_healthy,
                    frontend_latency_ms=fe_latency,
                )
            else:
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
        "operation_mode": (operation_mode or "").lower() or None,
        "frontend_ip": frontend_ip,
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
                if not _INSTANCE_NAME_RE.match(name):
                    continue
                bind_ips = _get_bind_ips_from_config(name)
                instances.append({"name": name, "bind_ips": bind_ips, "port": 53})

    if not instances:
        for config_path in sorted(glob.glob("/etc/unbound/unbound*.conf")):
            name = os.path.splitext(os.path.basename(config_path))[0]
            if not _INSTANCE_NAME_RE.match(name):
                continue
            instances.append({"name": name, "bind_ips": _get_bind_ips_from_config(name), "port": 53})

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
