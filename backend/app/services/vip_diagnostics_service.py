"""
DNS Control — VIP Diagnostics Service (Traffic-Based Validation)

Validates Service VIPs using REAL traffic data: nftables counters,
per-backend latency probes, and distribution analysis.

Key distinction:
- owned VIPs: bound locally on loopback, bind is mandatory
- intercepted VIPs: captured via DNAT only, bind NOT required
"""

import time
import re
import logging
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.vip-diagnostics")

PROBE_DOMAIN = "google.com"
INACTIVE_THRESHOLD_PACKETS = 0


def _safe_run(executable: str, args: list[str], timeout: int = 10) -> dict:
    try:
        return run_command(executable, args, timeout=timeout)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


# ── Public API ──────────────────────────────────────────────


def run_vip_diagnostics(service_vips: list[dict] | None = None) -> dict:
    if not service_vips:
        service_vips = _discover_vips_from_loopback()

    # Fetch nftables ruleset once (expensive call)
    nft_r = _safe_run("nft", ["list", "ruleset"], timeout=10)
    nft_stdout = nft_r.get("stdout", "") if nft_r["exit_code"] == 0 else ""

    # Fetch loopback addresses once
    lo_r = _safe_run("ip", ["addr", "show", "lo"], timeout=5)
    lo_stdout = lo_r.get("stdout", "")

    vip_results = []
    for vip in service_vips:
        ipv4 = vip.get("ipv4", "").strip()
        if not ipv4:
            continue
        result = _probe_single_vip(ipv4, vip, nft_stdout, lo_stdout)
        vip_results.append(result)

    # Root recursion — validates resolver reaches global DNS hierarchy
    root_recursion = _probe_root_recursion()

    total = len(vip_results)
    healthy = sum(1 for v in vip_results if v["healthy"])

    return {
        "vip_diagnostics": vip_results,
        "root_recursion": root_recursion,
        "summary": {
            "total_vips": total,
            "healthy_vips": healthy,
            "all_healthy": total > 0 and healthy == total,
            "degraded": healthy < total,
            "root_recursion_ok": root_recursion["root_query"]["status"] == "ok",
            "trace_ok": root_recursion["trace"]["status"] == "ok",
        },
    }


# ── Single VIP probe ────────────────────────────────────────


def _probe_single_vip(ip: str, vip_meta: dict, nft_stdout: str, lo_stdout: str) -> dict:
    vip_type = vip_meta.get("vipType", vip_meta.get("vip_type", "owned"))
    description = vip_meta.get("description", ip)
    ipv6 = vip_meta.get("ipv6", "")

    # 1. DNS resolution via VIP
    dns_probe = _probe_dns(ip)

    # 2. Local bind check (only mandatory for owned)
    locally_bound = ip in lo_stdout
    bind_required = vip_type == "owned"

    # 3. Route /32
    route_r = _safe_run("ip", ["route", "show", ip], timeout=5)
    has_route = ip in route_r.get("stdout", "")
    if not has_route and locally_bound:
        has_route = True  # kernel auto-creates host route for addr on lo

    # 4. DNAT validation with REAL counters
    dnat_info = _extract_dnat_info(nft_stdout, ip)

    # 5. Per-backend probes (latency + resolution)
    backend_probes = []
    for backend in dnat_info["backends"]:
        probe = _probe_dns(backend["ip"])
        backend_probes.append({
            "ip": backend["ip"],
            "packets": backend["packets"],
            "bytes": backend["bytes"],
            "resolves": probe["resolves"],
            "latency_ms": probe["latency_ms"],
            "resolved_ip": probe["resolved_ip"],
            "dead": backend["packets"] == 0 and not probe["resolves"],
        })

    # 6. Traffic distribution
    total_packets = sum(b["packets"] for b in backend_probes)
    for bp in backend_probes:
        bp["traffic_pct"] = round(
            (bp["packets"] / total_packets * 100) if total_packets > 0 else 0, 1
        )

    # 7. VIP-level counters (prerouting rules)
    vip_counter = _extract_vip_counter(nft_stdout, ip)

    # Health logic:
    # - owned: must resolve + must be bound
    # - intercepted: must resolve + DNAT must have traffic
    if vip_type == "intercepted":
        healthy = dns_probe["resolves"] and dnat_info["active"] and vip_counter["packets"] > INACTIVE_THRESHOLD_PACKETS
    else:
        healthy = dns_probe["resolves"] and locally_bound

    inactive = vip_counter["packets"] == INACTIVE_THRESHOLD_PACKETS

    return {
        "ip": ip,
        "ipv6": ipv6,
        "description": description,
        "vip_type": vip_type,
        "healthy": healthy,
        "inactive": inactive,
        "dns_probe": dns_probe,
        "local_bind": {
            "bound": locally_bound,
            "required": bind_required,
            "interface": "lo" if locally_bound else None,
        },
        "route": {
            "present": has_route,
            "type": "host /32" if has_route else None,
        },
        "dnat": {
            "active": dnat_info["active"],
            "rule_count": dnat_info["rule_count"],
        },
        "traffic": {
            "packets": vip_counter["packets"],
            "bytes": vip_counter["bytes"],
        },
        "backends": backend_probes,
    }


# ── DNS probing ─────────────────────────────────────────────


def _probe_dns(target_ip: str) -> dict:
    start = time.monotonic()
    r = _safe_run("dig", [f"@{target_ip}", PROBE_DOMAIN, "+short", "+time=3", "+tries=1"], timeout=8)
    latency_ms = round((time.monotonic() - start) * 1000, 1)
    resolves = r["exit_code"] == 0 and len(r["stdout"].strip()) > 0
    resolved_ip = r["stdout"].strip().split("\n")[0] if resolves else ""
    return {
        "resolves": resolves,
        "resolved_ip": resolved_ip,
        "latency_ms": latency_ms,
        "error": r["stderr"].strip()[:200] if not resolves else None,
    }


# ── nftables analysis ───────────────────────────────────────


def _extract_dnat_info(nft_stdout: str, vip_ip: str) -> dict:
    """Extract DNAT backends and their real packet counters for a VIP."""
    backends = []
    rule_count = 0
    active = False

    for line in nft_stdout.split("\n"):
        if "dnat to" not in line:
            continue
        # Match rules that target this VIP or are in chains jumped to from VIP rules
        # Pattern: ... counter packets <N> bytes <N> dnat to <backend_ip>:<port>
        dnat_match = re.search(r"dnat to (\d+\.\d+\.\d+\.\d+)(?::(\d+))?", line)
        if not dnat_match:
            continue

        backend_ip = dnat_match.group(1)
        counter_match = re.search(r"counter packets (\d+) bytes (\d+)", line)
        packets = int(counter_match.group(1)) if counter_match else 0
        bytes_count = int(counter_match.group(2)) if counter_match else 0

        # Check if this dnat rule is reachable from VIP
        # (either VIP appears in same line, or it's in a chain that VIP jumps to)
        # For now, collect all dnat rules — the chain-based filtering is handled
        # by the modular nftables structure where chains are per-backend
        if vip_ip in line or _is_backend_for_vip(nft_stdout, vip_ip, backend_ip):
            # Deduplicate backends (TCP + UDP rules for same backend)
            existing = next((b for b in backends if b["ip"] == backend_ip), None)
            if existing:
                existing["packets"] += packets
                existing["bytes"] += bytes_count
                existing["rules"] += 1
            else:
                backends.append({
                    "ip": backend_ip,
                    "packets": packets,
                    "bytes": bytes_count,
                    "rules": 1,
                })
            rule_count += 1
            active = True

    return {
        "active": active,
        "rule_count": rule_count,
        "backends": backends,
    }


def _is_backend_for_vip(nft_stdout: str, vip_ip: str, backend_ip: str) -> bool:
    """Check if a backend IP is reachable from VIP dispatch chains.

    The modular nftables structure uses:
    - PREROUTING jumps to ipv4_tcp_dns / ipv4_udp_dns for VIP addresses
    - Those chains jump to per-backend chains (ipv4_dns_tcp_unboundNN)
    - Per-backend chains do the actual dnat
    """
    # If VIP is in the define set that feeds PREROUTING, all backends are reachable
    # Check if VIP appears in a define block
    if re.search(rf"define\s+\w+\s*=\s*\{{[^}}]*{re.escape(vip_ip)}[^}}]*\}}", nft_stdout, re.DOTALL):
        return True
    return False


def _extract_vip_counter(nft_stdout: str, vip_ip: str) -> dict:
    """Extract aggregate packet/byte counters for PREROUTING rules matching this VIP."""
    total_packets = 0
    total_bytes = 0
    for line in nft_stdout.split("\n"):
        if vip_ip not in line:
            continue
        match = re.search(r"counter packets (\d+) bytes (\d+)", line)
        if match:
            total_packets += int(match.group(1))
            total_bytes += int(match.group(2))
    return {"packets": total_packets, "bytes": total_bytes}


# ── VIP discovery ────────────────────────────────────────────


def _discover_vips_from_loopback() -> list[dict]:
    r = _safe_run("ip", ["-4", "addr", "show", "lo"], timeout=5)
    vips = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            match = re.search(r"inet (\d+\.\d+\.\d+\.\d+)/32", line)
            if match:
                ip = match.group(1)
                if ip.startswith("127."):
                    continue
                is_intercepted = _is_likely_intercepted(ip)
                vips.append({
                    "ipv4": ip,
                    "ipv6": "",
                    "description": f"{'Intercepted' if is_intercepted else 'Local'} VIP {ip}",
                    "vipType": "intercepted" if is_intercepted else "owned",
                })
    return vips


def _is_likely_intercepted(ip: str) -> bool:
    known_public_dns = {
        "4.2.2.5", "4.2.2.6", "4.2.2.1", "4.2.2.2",
        "8.8.8.8", "8.8.4.4", "1.1.1.1", "1.0.0.1",
        "9.9.9.9", "208.67.222.222", "208.67.220.220",
    }
    if ip in known_public_dns:
        return True
    parts = ip.split(".")
    first, second = int(parts[0]), int(parts[1])
    if first == 10:
        return False
    if first == 172 and 16 <= second <= 31:
        return False
    if first == 192 and second == 168:
        return False
    if first == 100 and 64 <= second <= 127:
        return False
    return True


# ── Root recursion ───────────────────────────────────────────


def _probe_root_recursion() -> dict:
    trace_start = time.monotonic()
    trace_r = _safe_run("dig", ["+trace", PROBE_DOMAIN], timeout=15)
    trace_elapsed = round((time.monotonic() - trace_start) * 1000, 1)
    trace_ok = trace_r["exit_code"] == 0 and "ANSWER SECTION" in trace_r["stdout"]
    trace_has_root = "root-servers.net" in trace_r["stdout"].lower() if trace_ok else False

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
