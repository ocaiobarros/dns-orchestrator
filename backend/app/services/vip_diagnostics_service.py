"""
DNS Control — VIP Diagnostics Service (Traffic-Based Validation)

Validates Service VIPs using REAL traffic data: nftables counters,
per-backend latency probes, and distribution analysis.

Key distinction:
- owned VIPs: bound locally on loopback, bind is mandatory
- intercepted VIPs: captured via DNAT only, bind NOT required

Counter segregation:
- Per-VIP entry counters (PREROUTING rules matching VIP IP)
- Per-VIP×backend×protocol counters (DNAT rules with full path)
- UDP and TCP separated for each path
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

    # Parse full chain structure once for VIP→backend mapping
    chain_map = _parse_chain_structure(nft_stdout)

    vip_results = []
    for vip in service_vips:
        ipv4 = vip.get("ipv4", "").strip()
        if not ipv4:
            continue
        result = _probe_single_vip(ipv4, vip, nft_stdout, lo_stdout, chain_map)
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


# ── Chain structure parser ──────────────────────────────────


def _parse_chain_structure(nft_stdout: str) -> dict:
    """Parse nftables ruleset into structured chain data.

    Returns dict mapping chain_name -> list of rules with parsed fields.
    This allows us to follow VIP -> jump chain -> DNAT backend paths.
    """
    chains = {}
    current_chain = None

    for line in nft_stdout.split("\n"):
        stripped = line.strip()

        # Detect chain start
        chain_match = re.match(r"chain\s+(\S+)\s*\{", stripped)
        if chain_match:
            current_chain = chain_match.group(1)
            chains[current_chain] = []
            continue

        if stripped == "}":
            current_chain = None
            continue

        if current_chain and stripped and not stripped.startswith("type ") and not stripped.startswith("policy "):
            chains[current_chain].append(stripped)

    return chains


# ── Single VIP probe ────────────────────────────────────────


def _probe_single_vip(ip: str, vip_meta: dict, nft_stdout: str, lo_stdout: str, chain_map: dict) -> dict:
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

    # 4. Per-VIP entry counters (segregated from PREROUTING)
    vip_entry = _extract_vip_entry_counters(nft_stdout, ip)

    # 5. Per-VIP×backend×protocol DNAT counters
    backend_paths = _extract_vip_backend_paths(nft_stdout, ip, chain_map)

    # 6. Per-backend latency probes
    backend_ips_seen = set()
    backend_probes = []
    for path in backend_paths:
        bip = path["backend_ip"]
        if bip not in backend_ips_seen:
            backend_ips_seen.add(bip)
            probe = _probe_dns(bip)
            backend_probes.append({
                "ip": bip,
                "resolves": probe["resolves"],
                "latency_ms": probe["latency_ms"],
                "resolved_ip": probe["resolved_ip"],
            })

    # 7. Aggregate per-backend totals and per-protocol breakdown
    backends_agg = _aggregate_backend_stats(backend_paths, backend_probes)

    # 8. Health logic
    dnat_active = len(backend_paths) > 0
    total_vip_packets = vip_entry["udp"]["packets"] + vip_entry["tcp"]["packets"]

    if vip_type == "intercepted":
        healthy = dns_probe["resolves"] and dnat_active and total_vip_packets > INACTIVE_THRESHOLD_PACKETS
    else:
        healthy = dns_probe["resolves"] and locally_bound

    inactive = total_vip_packets == INACTIVE_THRESHOLD_PACKETS

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
            "active": dnat_active,
            "rule_count": len(backend_paths),
        },
        "entry_counters": vip_entry,
        "traffic": {
            "packets": total_vip_packets,
            "bytes": vip_entry["udp"]["bytes"] + vip_entry["tcp"]["bytes"],
            "udp": vip_entry["udp"],
            "tcp": vip_entry["tcp"],
        },
        "backend_paths": backend_paths,
        "backends": backends_agg,
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


# ── nftables per-VIP entry counters ────────────────────────


def _extract_vip_entry_counters(nft_stdout: str, vip_ip: str) -> dict:
    """Extract per-VIP entry counters segregated by protocol.

    Looks for PREROUTING/prerouting rules that match the VIP IP
    and contain protocol indicators (udp/tcp).
    """
    udp_packets, udp_bytes = 0, 0
    tcp_packets, tcp_bytes = 0, 0
    other_packets, other_bytes = 0, 0

    for line in nft_stdout.split("\n"):
        if vip_ip not in line:
            continue
        counter = re.search(r"counter packets (\d+) bytes (\d+)", line)
        if not counter:
            continue

        pkts = int(counter.group(1))
        bts = int(counter.group(2))

        # Determine protocol from rule context
        if "udp" in line.lower() or "dport 53" in line:
            if "tcp" in line.lower():
                tcp_packets += pkts
                tcp_bytes += bts
            else:
                udp_packets += pkts
                udp_bytes += bts
        elif "tcp" in line.lower():
            tcp_packets += pkts
            tcp_bytes += bts
        else:
            # Generic counter (no protocol specified) — split evenly as estimate
            other_packets += pkts
            other_bytes += bts

    # If we only have "other" (no protocol-specific), attribute to UDP (DNS default)
    if udp_packets == 0 and tcp_packets == 0:
        udp_packets = other_packets
        udp_bytes = other_bytes
    else:
        udp_packets += other_packets // 2
        udp_bytes += other_bytes // 2
        tcp_packets += other_packets - other_packets // 2
        tcp_bytes += other_bytes - other_bytes // 2

    return {
        "udp": {"packets": udp_packets, "bytes": udp_bytes},
        "tcp": {"packets": tcp_packets, "bytes": tcp_bytes},
    }


# ── Per-VIP×backend×protocol path extraction ───────────────


def _extract_vip_backend_paths(nft_stdout: str, vip_ip: str, chain_map: dict) -> list[dict]:
    """Extract every VIP→backend DNAT path with per-path counters, segregated by protocol.

    Follows the nftables chain jump structure:
    PREROUTING → protocol dispatch chain → per-backend chain → dnat rule

    Returns list of { backend_ip, protocol, packets, bytes, chain }
    """
    paths = []

    # Strategy 1: Direct rules containing VIP IP and dnat
    for line in nft_stdout.split("\n"):
        if vip_ip not in line or "dnat to" not in line:
            continue
        path = _parse_dnat_line(line)
        if path:
            paths.append(path)

    # Strategy 2: Follow chain jumps from VIP rules
    vip_jump_chains = _find_vip_jump_chains(nft_stdout, vip_ip)
    for jump_chain, protocol in vip_jump_chains:
        if jump_chain not in chain_map:
            continue
        # Look for dnat rules or further jumps in this chain
        for rule in chain_map[jump_chain]:
            if "dnat to" in rule:
                path = _parse_dnat_line(rule, override_protocol=protocol)
                if path:
                    path["chain"] = jump_chain
                    paths.append(path)
            # Follow nested jumps (per-backend chains)
            nested_jump = re.search(r"jump\s+(\S+)", rule)
            if nested_jump:
                nested_chain = nested_jump.group(1)
                nested_counter = re.search(r"counter packets (\d+) bytes (\d+)", rule)
                if nested_chain in chain_map:
                    for nested_rule in chain_map[nested_chain]:
                        if "dnat to" in nested_rule:
                            path = _parse_dnat_line(nested_rule, override_protocol=protocol)
                            if path:
                                path["chain"] = nested_chain
                                # Use the jump rule's counter if the dnat rule has no counter
                                if path["packets"] == 0 and nested_counter:
                                    path["packets"] = int(nested_counter.group(1))
                                    path["bytes"] = int(nested_counter.group(2))
                                paths.append(path)

    # Deduplicate: merge by (backend_ip, protocol)
    return _deduplicate_paths(paths)


def _parse_dnat_line(line: str, override_protocol: str | None = None) -> dict | None:
    """Parse a single nftables line containing 'dnat to' into a path dict."""
    dnat_match = re.search(r"dnat to (\d+\.\d+\.\d+\.\d+)(?::(\d+))?", line)
    if not dnat_match:
        return None

    backend_ip = dnat_match.group(1)
    backend_port = int(dnat_match.group(2)) if dnat_match.group(2) else 53

    counter = re.search(r"counter packets (\d+) bytes (\d+)", line)
    packets = int(counter.group(1)) if counter else 0
    bytes_count = int(counter.group(2)) if counter else 0

    # Determine protocol
    protocol = override_protocol
    if not protocol:
        if "meta l4proto tcp" in line or "tcp dport" in line:
            protocol = "tcp"
        elif "meta l4proto udp" in line or "udp dport" in line:
            protocol = "udp"
        else:
            protocol = "udp"  # DNS default

    return {
        "backend_ip": backend_ip,
        "backend_port": backend_port,
        "protocol": protocol,
        "packets": packets,
        "bytes": bytes_count,
        "chain": "",
    }


def _find_vip_jump_chains(nft_stdout: str, vip_ip: str) -> list[tuple[str, str]]:
    """Find chains that VIP rules jump to, with protocol context."""
    results = []
    for line in nft_stdout.split("\n"):
        if vip_ip not in line:
            continue
        jump_match = re.search(r"jump\s+(\S+)", line)
        if not jump_match:
            continue
        chain_name = jump_match.group(1)
        # Infer protocol from chain name or rule
        if "tcp" in chain_name.lower() or "tcp" in line.lower():
            protocol = "tcp"
        elif "udp" in chain_name.lower() or "udp" in line.lower():
            protocol = "udp"
        else:
            protocol = "udp"
        results.append((chain_name, protocol))
    return results


def _deduplicate_paths(paths: list[dict]) -> list[dict]:
    """Merge paths with same (backend_ip, protocol), summing counters."""
    merged = {}
    for p in paths:
        key = (p["backend_ip"], p["protocol"])
        if key in merged:
            merged[key]["packets"] += p["packets"]
            merged[key]["bytes"] += p["bytes"]
        else:
            merged[key] = dict(p)
    return list(merged.values())


# ── Backend aggregation ─────────────────────────────────────


def _aggregate_backend_stats(backend_paths: list[dict], backend_probes: list[dict]) -> list[dict]:
    """Aggregate per-backend stats from paths + probes.

    Returns list with per-backend totals, per-protocol breakdown, and health info.
    """
    # Group paths by backend_ip
    by_backend = {}
    for p in backend_paths:
        bip = p["backend_ip"]
        if bip not in by_backend:
            by_backend[bip] = {"udp": {"packets": 0, "bytes": 0}, "tcp": {"packets": 0, "bytes": 0}}
        proto = p["protocol"]
        if proto in by_backend[bip]:
            by_backend[bip][proto]["packets"] += p["packets"]
            by_backend[bip][proto]["bytes"] += p["bytes"]

    total_packets = sum(
        v["udp"]["packets"] + v["tcp"]["packets"] for v in by_backend.values()
    )

    results = []
    for probe in backend_probes:
        bip = probe["ip"]
        proto_data = by_backend.get(bip, {"udp": {"packets": 0, "bytes": 0}, "tcp": {"packets": 0, "bytes": 0}})
        total_bk = proto_data["udp"]["packets"] + proto_data["tcp"]["packets"]
        total_bk_bytes = proto_data["udp"]["bytes"] + proto_data["tcp"]["bytes"]

        results.append({
            "ip": bip,
            "packets": total_bk,
            "bytes": total_bk_bytes,
            "udp": proto_data["udp"],
            "tcp": proto_data["tcp"],
            "resolves": probe["resolves"],
            "latency_ms": probe["latency_ms"],
            "resolved_ip": probe["resolved_ip"],
            "dead": total_bk == 0 and not probe["resolves"],
            "never_selected": total_bk == 0 and probe["resolves"],
            "traffic_pct": round((total_bk / total_packets * 100) if total_packets > 0 else 0, 1),
        })

    return results


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
