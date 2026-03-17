"""
DNS Control — VIP Diagnostics Service
Probes Service VIPs (owned and intercepted) for resolution health,
backend routing, local bind verification, and route presence.

Intercepted VIPs (e.g. 4.2.2.5, 4.2.2.6) are third-party public IPs
that this infrastructure captures locally via DNAT + loopback binding.
They are NOT external probes — they are part of the local DNS service.
"""

import time
import re
import logging
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.vip-diagnostics")

PROBE_DOMAIN = "google.com"


def _safe_run(executable: str, args: list[str], timeout: int = 10) -> dict:
    try:
        return run_command(executable, args, timeout=timeout)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def run_vip_diagnostics(service_vips: list[dict] | None = None) -> dict:
    """Run comprehensive diagnostics on all service VIPs.

    Args:
        service_vips: List of VIP dicts with keys: ipv4, ipv6, description, vipType.
                      If None, attempts to discover VIPs from loopback.
    """
    if not service_vips:
        service_vips = _discover_vips_from_loopback()

    vip_results = []
    for vip in service_vips:
        ipv4 = vip.get("ipv4", "").strip()
        if not ipv4:
            continue
        result = _probe_single_vip(ipv4, vip)
        vip_results.append(result)

    all_healthy = all(v["healthy"] for v in vip_results) if vip_results else False
    any_degraded = any(not v["healthy"] for v in vip_results) if vip_results else False

    # Root recursion — validates the resolver can reach the global DNS hierarchy
    root_recursion = _probe_root_recursion()

    return {
        "vip_diagnostics": vip_results,
        "root_recursion": root_recursion,
        "summary": {
            "total_vips": len(vip_results),
            "healthy_vips": sum(1 for v in vip_results if v["healthy"]),
            "all_healthy": all_healthy,
            "degraded": any_degraded,
            "root_recursion_ok": root_recursion["root_query"]["status"] == "ok",
            "trace_ok": root_recursion["trace"]["status"] == "ok",
        },
    }


def _probe_single_vip(ip: str, vip_meta: dict) -> dict:
    """Probe a single VIP: DNS resolution, local bind, route, DNAT verification."""
    vip_type = vip_meta.get("vipType", vip_meta.get("vip_type", "owned"))
    description = vip_meta.get("description", ip)
    ipv6 = vip_meta.get("ipv6", "")

    # 1. DNS resolution via dig
    start = time.monotonic()
    dig_r = _safe_run("dig", [f"@{ip}", PROBE_DOMAIN, "+short", "+time=3", "+tries=1"], timeout=8)
    latency_ms = round((time.monotonic() - start) * 1000, 1)

    resolves = dig_r["exit_code"] == 0 and len(dig_r["stdout"].strip()) > 0
    resolved_ip = dig_r["stdout"].strip().split("\n")[0] if resolves else ""

    # 2. Check local bind (ip addr show lo | grep <ip>)
    bind_r = _safe_run("ip", ["addr", "show", "lo"], timeout=5)
    locally_bound = ip in bind_r.get("stdout", "")

    # 3. Check /32 route presence
    route_r = _safe_run("ip", ["route", "show", ip], timeout=5)
    has_route = ip in route_r.get("stdout", "")
    # Also check if it's on loopback (kernel route from addr add)
    if not has_route and locally_bound:
        has_route = True  # kernel auto-creates host route for addr on lo

    # 4. Check DNAT rule presence in nftables
    nft_r = _safe_run("nft", ["list", "ruleset"], timeout=10)
    nft_stdout = nft_r.get("stdout", "")
    in_dnat = ip in nft_stdout
    # Find which backend this VIP routes to
    backend_ip = _extract_dnat_backend(nft_stdout, ip)

    # 5. Traffic counters from nftables (packets matching this VIP)
    packet_count = _extract_vip_counter(nft_stdout, ip)

    healthy = resolves and locally_bound

    return {
        "ip": ip,
        "ipv6": ipv6,
        "description": description,
        "vip_type": vip_type,
        "healthy": healthy,
        "dns_probe": {
            "resolves": resolves,
            "resolved_ip": resolved_ip,
            "latency_ms": latency_ms,
            "error": dig_r["stderr"].strip()[:200] if not resolves else None,
        },
        "local_bind": {
            "bound": locally_bound,
            "interface": "lo" if locally_bound else None,
        },
        "route": {
            "present": has_route,
            "type": "host /32" if has_route else None,
        },
        "dnat": {
            "active": in_dnat,
            "backend_ip": backend_ip,
        },
        "traffic": {
            "packets": packet_count,
        },
    }


def _extract_dnat_backend(nft_stdout: str, vip_ip: str) -> str | None:
    """Extract the DNAT target backend IP for a given VIP from nftables ruleset."""
    # Look for patterns like: ip daddr 4.2.2.5 ... dnat to 100.127.255.101:53
    # Or in define blocks: define DNS_ANYCAST_IPV4 = { 4.2.2.5, ... }
    # Then follow the chain to find dnat targets
    for line in nft_stdout.split("\n"):
        if "dnat to" in line and vip_ip in line:
            match = re.search(r"dnat to (\d+\.\d+\.\d+\.\d+)", line)
            if match:
                return match.group(1)
    # If VIP is in define set, backends are in the dispatch chains
    # Return None — means VIP uses balancing across multiple backends
    return None


def _extract_vip_counter(nft_stdout: str, vip_ip: str) -> int:
    """Extract packet counter for rules matching this VIP."""
    total = 0
    for line in nft_stdout.split("\n"):
        if vip_ip in line:
            match = re.search(r"counter packets (\d+)", line)
            if match:
                total += int(match.group(1))
    return total


def _discover_vips_from_loopback() -> list[dict]:
    """Discover VIPs from loopback addresses — fallback when no config is provided."""
    r = _safe_run("ip", ["-4", "addr", "show", "lo"], timeout=5)
    vips = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)/32", line)
            if match:
                ip = match.group(1)
                if ip.startswith("127."):
                    continue
                # Heuristic: public IPs that aren't RFC1918 or CGNAT are likely intercepted
                is_intercepted = _is_likely_intercepted(ip)
                vips.append({
                    "ipv4": ip,
                    "ipv6": "",
                    "description": f"{'Intercepted' if is_intercepted else 'Local'} VIP {ip}",
                    "vipType": "intercepted" if is_intercepted else "owned",
                })
    return vips


def _is_likely_intercepted(ip: str) -> bool:
    """Heuristic: well-known public DNS IPs are likely intercepted VIPs."""
    known_public_dns = {
        "4.2.2.5", "4.2.2.6", "4.2.2.1", "4.2.2.2",
        "8.8.8.8", "8.8.4.4",
        "1.1.1.1", "1.0.0.1",
        "9.9.9.9", "208.67.222.222", "208.67.220.220",
    }
    if ip in known_public_dns:
        return True
    # RFC1918 / CGNAT ranges are owned
    parts = ip.split(".")
    first = int(parts[0])
    second = int(parts[1])
    if first == 10:
        return False
    if first == 172 and 16 <= second <= 31:
        return False
    if first == 192 and second == 168:
        return False
    if first == 100 and 64 <= second <= 127:
        return False  # CGNAT
    # Public IPs on loopback are likely intercepted
    return True


def _probe_root_recursion() -> dict:
    """Test root recursion capability (validates the resolver reaches the Internet)."""
    # 1. Trace
    trace_start = time.monotonic()
    trace_r = _safe_run("dig", ["+trace", PROBE_DOMAIN], timeout=15)
    trace_elapsed = round((time.monotonic() - trace_start) * 1000, 1)

    trace_ok = trace_r["exit_code"] == 0 and "ANSWER SECTION" in trace_r["stdout"]
    trace_has_root = "root-servers.net" in trace_r["stdout"].lower() if trace_ok else False

    # 2. Root server direct query
    root_start = time.monotonic()
    root_r = _safe_run(
        "dig", ["@a.root-servers.net", ".", "NS", "+short", "+time=5", "+tries=1"],
        timeout=10,
    )
    root_elapsed = round((time.monotonic() - root_start) * 1000, 1)
    root_ok = root_r["exit_code"] == 0 and "root-servers.net" in root_r["stdout"].lower()

    return {
        "trace": {
            "status": "ok" if trace_ok else "failed",
            "latency_ms": trace_elapsed,
            "reached_root": trace_has_root,
            "output_lines": len(trace_r["stdout"].split("\n")) if trace_ok else 0,
            "error": trace_r["stderr"].strip()[:200] if not trace_ok else None,
        },
        "root_query": {
            "status": "ok" if root_ok else "failed",
            "target": "a.root-servers.net",
            "latency_ms": root_elapsed,
            "answer": root_r["stdout"].strip()[:500] if root_ok else "",
            "error": root_r["stderr"].strip()[:200] if not root_ok else None,
        },
    }
