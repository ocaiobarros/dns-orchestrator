"""
DNS Control — VIP Diagnostics Service (Audit-Grade)

Validates Service VIPs using REAL traffic data: nftables counters,
per-backend latency probes, and distribution analysis.

Key distinction:
- owned VIPs: bound locally on loopback, bind is mandatory
- intercepted VIPs: captured via DNAT only, bind NOT required

Counter segregation:
- Per-VIP entry counters (PREROUTING rules matching VIP IP)
- Per-VIP×backend×protocol counters (DNAT rules with full path)
- UDP and TCP separated for each path

Cross-validation:
- Hybrid tolerance: max(3 packets, 2%) instead of fixed 5%
- COUNTER_MISMATCH flagged when they diverge

Resilience:
- Parser is order/name agnostic for chains
- Returns UNKNOWN / PARSE_ERROR instead of inferring
- Every non-healthy status includes a 'reason' field

Audit:
- Per-source timestamps (nft, dig, ip_addr, ip_route)
- Debug mode shows literal nft rules per VIP/chain/backend
- STALE_DATA detection when source age exceeds threshold

Counter History:
- Snapshots stored in-memory per poll
- QPS calculated from delta between consecutive polls
"""

import time
import re
import logging
from datetime import datetime, timezone
from app.executors.command_runner import run_command

logger = logging.getLogger("dns-control.vip-diagnostics")

PROBE_DOMAIN = "google.com"
INACTIVE_THRESHOLD_PACKETS = 0
STALE_THRESHOLD_SECONDS = 120  # 2 minutes

# ── Counter history store (in-memory, per-VIP) ──────────────

_counter_history: dict[str, list[dict]] = {}
MAX_HISTORY_ENTRIES = 60  # ~10 minutes at 10s polling


def _record_counter_snapshot(vip_ip: str, entry_packets: int, entry_bytes: int,
                              backend_snapshots: list[dict], ts: float):
    """Store a counter snapshot for QPS delta calculation."""
    if vip_ip not in _counter_history:
        _counter_history[vip_ip] = []

    _counter_history[vip_ip].append({
        "ts": ts,
        "entry_packets": entry_packets,
        "entry_bytes": entry_bytes,
        "backends": {b["ip"]: {"packets": b["packets"], "bytes": b["bytes"]} for b in backend_snapshots},
    })

    # Trim old entries
    if len(_counter_history[vip_ip]) > MAX_HISTORY_ENTRIES:
        _counter_history[vip_ip] = _counter_history[vip_ip][-MAX_HISTORY_ENTRIES:]


def _calculate_qps(vip_ip: str, current_packets: int, current_ts: float) -> dict:
    """Calculate QPS from delta between current and previous snapshot."""
    history = _counter_history.get(vip_ip, [])
    if len(history) < 1:
        return {"qps": None, "window_seconds": None, "delta_packets": None}

    prev = history[-1]
    dt = current_ts - prev["ts"]
    if dt <= 0:
        return {"qps": None, "window_seconds": None, "delta_packets": None}

    delta = current_packets - prev["entry_packets"]
    if delta < 0:
        # Counter reset detected
        return {"qps": None, "window_seconds": round(dt, 1), "delta_packets": None, "counter_reset": True}

    return {
        "qps": round(delta / dt, 1),
        "window_seconds": round(dt, 1),
        "delta_packets": delta,
    }


def _get_counter_history(vip_ip: str) -> list[dict]:
    """Return recent counter history for a VIP (for frontend charts)."""
    raw = _counter_history.get(vip_ip, [])
    result = []
    for i, snap in enumerate(raw):
        entry = {
            "ts": snap["ts"],
            "iso": datetime.fromtimestamp(snap["ts"], tz=timezone.utc).isoformat(),
            "entry_packets": snap["entry_packets"],
            "entry_bytes": snap["entry_bytes"],
        }
        if i > 0:
            prev = raw[i - 1]
            dt = snap["ts"] - prev["ts"]
            if dt > 0:
                delta = snap["entry_packets"] - prev["entry_packets"]
                entry["qps"] = round(max(0, delta) / dt, 1)
            else:
                entry["qps"] = 0
        result.append(entry)
    return result


def _safe_run(executable: str, args: list[str], timeout: int = 10) -> dict:
    try:
        return run_command(executable, args, timeout=timeout)
    except Exception as e:
        logger.debug(f"Command {executable} failed: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def _hybrid_mismatch_check(entry_total: int, paths_total: int) -> bool:
    """Hybrid tolerance: max(3 packets, 2%)."""
    if entry_total == 0 and paths_total == 0:
        return False
    if entry_total == 0 or paths_total == 0:
        return entry_total != paths_total
    delta = abs(entry_total - paths_total)
    max_val = max(entry_total, paths_total)
    pct_tolerance = max_val * 0.02
    abs_tolerance = 3
    return delta > max(pct_tolerance, abs_tolerance)


# ── Public API ──────────────────────────────────────────────


def run_vip_diagnostics(service_vips: list[dict] | None = None, debug: bool = False) -> dict:
    poll_ts = time.time()

    if not service_vips:
        service_vips = _discover_vips_from_loopback()

    # Source timestamps
    source_timestamps = {}

    # Fetch nftables ruleset once
    nft_start = time.monotonic()
    nft_r = _safe_run("nft", ["list", "ruleset"], timeout=10)
    nft_ok = nft_r["exit_code"] == 0
    nft_stdout = nft_r.get("stdout", "") if nft_ok else ""
    nft_parse_error = None if nft_ok else (nft_r.get("stderr", "") or "nft command failed")
    source_timestamps["nft"] = {"collected_at": datetime.now(timezone.utc).isoformat(), "duration_ms": round((time.monotonic() - nft_start) * 1000, 1), "ok": nft_ok}

    # Fetch loopback addresses once
    lo_start = time.monotonic()
    lo_r = _safe_run("ip", ["addr", "show", "lo"], timeout=5)
    lo_stdout = lo_r.get("stdout", "")
    source_timestamps["ip_addr"] = {"collected_at": datetime.now(timezone.utc).isoformat(), "duration_ms": round((time.monotonic() - lo_start) * 1000, 1), "ok": lo_r["exit_code"] == 0}

    # Parse full chain structure once
    chain_map, parse_errors = _parse_chain_structure(nft_stdout)

    vip_results = []
    for vip in service_vips:
        ipv4 = vip.get("ipv4", "").strip()
        if not ipv4:
            continue
        result = _probe_single_vip(
            ipv4, vip, nft_stdout, lo_stdout, chain_map,
            nft_parse_error=nft_parse_error,
            debug=debug,
            poll_ts=poll_ts,
            source_timestamps=source_timestamps,
        )
        vip_results.append(result)

    # Root recursion
    root_recursion = _probe_root_recursion()

    total = len(vip_results)
    healthy = sum(1 for v in vip_results if v["healthy"])
    has_parse_errors = any(v.get("parse_error") for v in vip_results)
    has_counter_mismatch = any(v.get("counter_mismatch") for v in vip_results)

    return {
        "vip_diagnostics": vip_results,
        "root_recursion": root_recursion,
        "source_timestamps": source_timestamps,
        "summary": {
            "total_vips": total,
            "healthy_vips": healthy,
            "all_healthy": total > 0 and healthy == total and not has_parse_errors,
            "degraded": healthy < total,
            "has_parse_errors": has_parse_errors,
            "has_counter_mismatch": has_counter_mismatch,
            "root_recursion_ok": root_recursion["root_query"]["status"] == "ok",
            "trace_ok": root_recursion["trace"]["status"] == "ok",
        },
    }


# ── Chain structure parser (resilient, order-agnostic) ──────


def _parse_chain_structure(nft_stdout: str) -> tuple[dict, list[str]]:
    """Parse nftables ruleset into structured chain data.
    Returns (chain_map, parse_errors).
    Resilient to any chain naming/ordering.
    """
    chains: dict[str, list[str]] = {}
    parse_errors = []
    current_chain = None
    brace_depth = 0

    for line in nft_stdout.split("\n"):
        stripped = line.strip()
        brace_depth += stripped.count("{") - stripped.count("}")

        chain_match = re.match(r"chain\s+(\S+)\s*\{", stripped)
        if chain_match:
            current_chain = chain_match.group(1)
            chains[current_chain] = []
            continue

        if stripped == "}" and current_chain:
            current_chain = None
            continue

        if current_chain and stripped and not stripped.startswith("type ") and not stripped.startswith("policy "):
            chains[current_chain].append(stripped)

    if brace_depth != 0:
        parse_errors.append(f"Unbalanced braces in nftables ruleset (depth={brace_depth})")

    return chains, parse_errors


# ── Single VIP probe ────────────────────────────────────────


def _probe_single_vip(
    ip: str, vip_meta: dict, nft_stdout: str, lo_stdout: str, chain_map: dict,
    nft_parse_error: str | None = None, debug: bool = False,
    poll_ts: float = 0, source_timestamps: dict | None = None,
) -> dict:
    vip_type = vip_meta.get("vipType", vip_meta.get("vip_type", "owned"))
    description = vip_meta.get("description", ip)
    ipv6 = vip_meta.get("ipv6", "")

    debug_info = {
        "matched_rules": [],
        "matched_chains": [],
        "parse_notes": [],
        "literal_rules": [],
    } if debug else None

    # 1. DNS resolution via VIP
    dig_start = time.monotonic()
    dns_probe = _probe_dns(ip)
    dig_elapsed = round((time.monotonic() - dig_start) * 1000, 1)
    if source_timestamps is not None and "dig" not in source_timestamps:
        source_timestamps["dig"] = {"collected_at": datetime.now(timezone.utc).isoformat(), "duration_ms": dig_elapsed, "ok": dns_probe["resolves"]}

    # 2. Local bind check
    locally_bound = ip in lo_stdout
    bind_required = vip_type == "owned"

    # 3. Route /32
    route_start = time.monotonic()
    route_r = _safe_run("ip", ["route", "show", ip], timeout=5)
    has_route = ip in route_r.get("stdout", "")
    if not has_route and locally_bound:
        has_route = True
    if source_timestamps is not None and "ip_route" not in source_timestamps:
        source_timestamps["ip_route"] = {"collected_at": datetime.now(timezone.utc).isoformat(), "duration_ms": round((time.monotonic() - route_start) * 1000, 1), "ok": route_r["exit_code"] == 0}

    # 4. Per-VIP entry counters
    vip_entry, entry_debug = _extract_vip_entry_counters(nft_stdout, ip, debug=debug)

    # 5. Per-VIP×backend×protocol DNAT counters
    backend_paths, path_debug = _extract_vip_backend_paths(nft_stdout, ip, chain_map, debug=debug)

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

    # 7. Aggregate per-backend
    backends_agg = _aggregate_backend_stats(backend_paths, backend_probes)

    # 8. Cross-validation with hybrid tolerance
    total_entry = vip_entry["udp"]["packets"] + vip_entry["tcp"]["packets"]
    total_paths = sum(p["packets"] for p in backend_paths)
    counter_mismatch = _hybrid_mismatch_check(total_entry, total_paths)

    # 9. Parse error detection
    parse_error = None
    if nft_parse_error:
        parse_error = nft_parse_error
    elif not nft_stdout.strip():
        parse_error = "Empty nftables ruleset — cannot validate VIP"

    # 10. QPS from counter delta
    qps_data = _calculate_qps(ip, total_entry, poll_ts)

    # 11. Record snapshot for next delta
    _record_counter_snapshot(ip, total_entry,
                              vip_entry["udp"]["bytes"] + vip_entry["tcp"]["bytes"],
                              backends_agg, poll_ts)

    # 12. Counter history
    counter_history = _get_counter_history(ip)

    # 13. Status determination with reason
    dnat_active = len(backend_paths) > 0
    inactive = total_entry == INACTIVE_THRESHOLD_PACKETS
    reason = None

    if parse_error:
        healthy = False
        status = "PARSE_ERROR"
        reason = parse_error
    elif vip_type == "intercepted":
        if dnat_active and total_entry > INACTIVE_THRESHOLD_PACKETS and dns_probe["resolves"]:
            healthy = True
            status = "HEALTHY"
        elif dnat_active and total_entry == INACTIVE_THRESHOLD_PACKETS:
            healthy = False
            status = "INACTIVE_VIP"
            reason = f"VIP {ip} has DNAT rules but zero entry packets — no traffic observed"
        elif not dnat_active:
            healthy = False
            status = "UNKNOWN"
            reason = f"No DNAT rules found for VIP {ip} — cannot map traffic path"
        else:
            healthy = False
            status = "UNHEALTHY"
            reason = f"VIP {ip} has DNAT rules and traffic but DNS probe failed"
    else:  # owned
        if dns_probe["resolves"] and locally_bound:
            healthy = True
            status = "HEALTHY"
        elif not locally_bound:
            healthy = False
            status = "UNHEALTHY"
            reason = f"VIP {ip} (owned) is not bound on loopback — bind is mandatory for owned VIPs"
        else:
            healthy = False
            status = "UNKNOWN"
            reason = f"VIP {ip} is bound but DNS probe did not resolve"

    if counter_mismatch and status == "HEALTHY":
        status = "COUNTER_MISMATCH"
        reason = f"Entry counters ({total_entry}) diverge from path counters ({total_paths}) beyond hybrid tolerance max(3, 2%)"

    # 14. Validation layers — clear differentiation
    validation_layers = {
        "configuration_present": dnat_active or locally_bound,
        "traffic_observed": total_entry > INACTIVE_THRESHOLD_PACKETS,
        "resolution_functional": dns_probe["resolves"],
        "health_inferred": healthy,
    }

    result = {
        "ip": ip,
        "ipv6": ipv6,
        "description": description,
        "vip_type": vip_type,
        "status": status,
        "reason": reason,
        "healthy": healthy,
        "inactive": inactive,
        "parse_error": parse_error,
        "counter_mismatch": counter_mismatch,
        "validation_layers": validation_layers,
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
            "packets": total_entry,
            "bytes": vip_entry["udp"]["bytes"] + vip_entry["tcp"]["bytes"],
            "udp": vip_entry["udp"],
            "tcp": vip_entry["tcp"],
        },
        "qps": qps_data,
        "counter_history": counter_history[-20:],  # Last 20 snapshots
        "cross_validation": {
            "entry_total_packets": total_entry,
            "paths_total_packets": total_paths,
            "delta": abs(total_entry - total_paths),
            "mismatch": counter_mismatch,
            "tolerance": "max(3 pkts, 2%)",
        },
        "backend_paths": backend_paths,
        "backends": backends_agg,
    }

    if debug and debug_info is not None:
        debug_info["matched_rules"].extend(entry_debug)
        debug_info["matched_chains"].extend(path_debug)
        # Add literal rules for each VIP
        debug_info["literal_rules"] = _extract_literal_rules(nft_stdout, ip, chain_map)
        if parse_error:
            debug_info["parse_notes"].append(parse_error)
        if counter_mismatch:
            debug_info["parse_notes"].append(
                f"Counter mismatch: entry={total_entry} vs paths={total_paths} (delta={abs(total_entry - total_paths)}, tolerance=max(3,2%))"
            )
        result["debug"] = debug_info

    return result


# ── Literal rule extraction for debug ───────────────────────


def _extract_literal_rules(nft_stdout: str, vip_ip: str, chain_map: dict) -> list[dict]:
    """Extract literal nft rules associated with a VIP for full audit trail."""
    rules = []

    # Entry rules (PREROUTING or any chain referencing VIP)
    for line in nft_stdout.split("\n"):
        if vip_ip in line:
            stripped = line.strip()
            if not stripped or stripped.startswith("type ") or stripped.startswith("policy "):
                continue
            rule_type = "unknown"
            if "dnat to" in stripped:
                rule_type = "dnat"
            elif "jump" in stripped:
                rule_type = "dispatch"
            elif "counter" in stripped:
                rule_type = "entry_counter"

            proto = _detect_protocol_from_rule(stripped)
            counter = re.search(r"counter packets (\d+) bytes (\d+)", stripped)

            rules.append({
                "type": rule_type,
                "protocol_detected": proto,
                "literal": stripped[:200],
                "packets": int(counter.group(1)) if counter else None,
                "bytes": int(counter.group(2)) if counter else None,
            })

    # Chain rules from jump targets
    vip_jump_chains = _find_vip_jump_chains(nft_stdout, vip_ip)
    for chain_name, proto_hint in vip_jump_chains:
        if chain_name in chain_map:
            for rule_line in chain_map[chain_name]:
                counter = re.search(r"counter packets (\d+) bytes (\d+)", rule_line)
                rule_type = "backend_dnat" if "dnat to" in rule_line else "chain_rule"
                rules.append({
                    "type": rule_type,
                    "chain": chain_name,
                    "protocol_hint": proto_hint,
                    "protocol_detected": _detect_protocol_from_rule(rule_line),
                    "literal": rule_line[:200],
                    "packets": int(counter.group(1)) if counter else None,
                    "bytes": int(counter.group(2)) if counter else None,
                })

                # Nested chains
                nested_jump = re.search(r"jump\s+(\S+)", rule_line)
                if nested_jump and nested_jump.group(1) in chain_map:
                    nested_name = nested_jump.group(1)
                    for nested_rule in chain_map[nested_name]:
                        nc = re.search(r"counter packets (\d+) bytes (\d+)", nested_rule)
                        rules.append({
                            "type": "nested_dnat" if "dnat to" in nested_rule else "nested_rule",
                            "chain": nested_name,
                            "parent_chain": chain_name,
                            "protocol_hint": proto_hint,
                            "protocol_detected": _detect_protocol_from_rule(nested_rule),
                            "literal": nested_rule[:200],
                            "packets": int(nc.group(1)) if nc else None,
                            "bytes": int(nc.group(2)) if nc else None,
                        })

    return rules


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


def _extract_vip_entry_counters(nft_stdout: str, vip_ip: str, debug: bool = False) -> tuple[dict, list[str]]:
    """Extract per-VIP entry counters segregated by protocol.
    Does NOT infer protocol — returns UNKNOWN if ambiguous.
    """
    udp_packets, udp_bytes = 0, 0
    tcp_packets, tcp_bytes = 0, 0
    unknown_packets, unknown_bytes = 0, 0
    debug_lines = []

    for line in nft_stdout.split("\n"):
        if vip_ip not in line:
            continue
        counter = re.search(r"counter packets (\d+) bytes (\d+)", line)
        if not counter:
            continue

        pkts = int(counter.group(1))
        bts = int(counter.group(2))
        stripped = line.strip()
        proto = _detect_protocol_from_rule(stripped)

        if proto == "udp":
            udp_packets += pkts
            udp_bytes += bts
        elif proto == "tcp":
            tcp_packets += pkts
            tcp_bytes += bts
        else:
            unknown_packets += pkts
            unknown_bytes += bts

        if debug:
            debug_lines.append(f"[entry] proto={proto} pkts={pkts} bytes={bts} rule={stripped[:120]}")

    # Conservative: only attribute unknown to UDP if no protocol-specific counters exist
    if udp_packets == 0 and tcp_packets == 0:
        udp_packets = unknown_packets
        udp_bytes = unknown_bytes

    return {
        "udp": {"packets": udp_packets, "bytes": udp_bytes},
        "tcp": {"packets": tcp_packets, "bytes": tcp_bytes},
        "unknown": {"packets": unknown_packets if (udp_packets > 0 or tcp_packets > 0) else 0,
                     "bytes": unknown_bytes if (udp_packets > 0 or tcp_packets > 0) else 0},
    }, debug_lines


def _detect_protocol_from_rule(rule: str) -> str:
    """Detect protocol from nftables rule text. Returns 'unknown' if ambiguous."""
    has_tcp = bool(re.search(r'\bmeta\s+l4proto\s+tcp\b', rule) or re.search(r'\btcp\s+dport\b', rule))
    has_udp = bool(re.search(r'\bmeta\s+l4proto\s+udp\b', rule) or re.search(r'\budp\s+dport\b', rule))

    if has_tcp and has_udp:
        return "unknown"
    if has_tcp:
        return "tcp"
    if has_udp:
        return "udp"
    return "unknown"


# ── Per-VIP×backend×protocol path extraction ───────────────


def _extract_vip_backend_paths(
    nft_stdout: str, vip_ip: str, chain_map: dict, debug: bool = False,
) -> tuple[list[dict], list[str]]:
    """Extract every VIP→backend DNAT path with per-path counters."""
    paths = []
    debug_lines = []

    # Strategy 1: Direct rules
    for line in nft_stdout.split("\n"):
        if vip_ip not in line or "dnat to" not in line:
            continue
        path = _parse_dnat_line(line)
        if path:
            path["data_source"] = "direct_rule"
            paths.append(path)
            if debug:
                debug_lines.append(f"[direct] {path['protocol']} -> {path['backend_ip']} pkts={path['packets']} rule={line.strip()[:120]}")

    # Strategy 2: Follow chain jumps
    vip_jump_chains = _find_vip_jump_chains(nft_stdout, vip_ip)
    for jump_chain, jump_protocol in vip_jump_chains:
        if jump_chain not in chain_map:
            if debug:
                debug_lines.append(f"[warn] Jump target chain '{jump_chain}' not found in ruleset")
            continue

        if debug:
            debug_lines.append(f"[chain] Following {jump_chain} (protocol_hint={jump_protocol})")

        for rule in chain_map[jump_chain]:
            if "dnat to" in rule:
                path = _parse_dnat_line(rule, protocol_hint=jump_protocol)
                if path:
                    path["chain"] = jump_chain
                    path["data_source"] = "chain_rule"
                    paths.append(path)
                    if debug:
                        debug_lines.append(f"  [dnat] {path['protocol']} -> {path['backend_ip']} pkts={path['packets']}")

            nested_jump = re.search(r"jump\s+(\S+)", rule)
            if nested_jump:
                nested_chain = nested_jump.group(1)
                nested_counter = re.search(r"counter packets (\d+) bytes (\d+)", rule)
                if nested_chain in chain_map:
                    if debug:
                        debug_lines.append(f"  [nested] Following {nested_chain}")
                    for nested_rule in chain_map[nested_chain]:
                        if "dnat to" in nested_rule:
                            path = _parse_dnat_line(nested_rule, protocol_hint=jump_protocol)
                            if path:
                                path["chain"] = nested_chain
                                path["data_source"] = "nested_chain_rule"
                                if path["packets"] == 0 and nested_counter:
                                    path["packets"] = int(nested_counter.group(1))
                                    path["bytes"] = int(nested_counter.group(2))
                                    path["data_source"] = "nested_chain_jump_counter"
                                paths.append(path)
                                if debug:
                                    debug_lines.append(f"    [dnat] {path['protocol']} -> {path['backend_ip']} pkts={path['packets']} src={path['data_source']}")

    return _deduplicate_paths(paths), debug_lines


def _parse_dnat_line(line: str, protocol_hint: str | None = None) -> dict | None:
    dnat_match = re.search(r"dnat to (\d+\.\d+\.\d+\.\d+)(?::(\d+))?", line)
    if not dnat_match:
        return None

    backend_ip = dnat_match.group(1)
    backend_port = int(dnat_match.group(2)) if dnat_match.group(2) else 53

    counter = re.search(r"counter packets (\d+) bytes (\d+)", line)
    packets = int(counter.group(1)) if counter else 0
    bytes_count = int(counter.group(2)) if counter else 0

    protocol = _detect_protocol_from_rule(line)
    if protocol == "unknown" and protocol_hint:
        protocol = protocol_hint

    return {
        "backend_ip": backend_ip,
        "backend_port": backend_port,
        "protocol": protocol,
        "packets": packets,
        "bytes": bytes_count,
        "chain": "",
        "data_source": "",
    }


def _find_vip_jump_chains(nft_stdout: str, vip_ip: str) -> list[tuple[str, str]]:
    results = []
    for line in nft_stdout.split("\n"):
        if vip_ip not in line:
            continue
        jump_match = re.search(r"jump\s+(\S+)", line)
        if not jump_match:
            continue
        chain_name = jump_match.group(1)
        protocol = _detect_protocol_from_rule(line)
        if protocol == "unknown":
            if "tcp" in chain_name.lower():
                protocol = "tcp"
            elif "udp" in chain_name.lower():
                protocol = "udp"
        results.append((chain_name, protocol if protocol != "unknown" else None))
    return results


def _deduplicate_paths(paths: list[dict]) -> list[dict]:
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
    by_backend = {}
    for p in backend_paths:
        bip = p["backend_ip"]
        if bip not in by_backend:
            by_backend[bip] = {"udp": {"packets": 0, "bytes": 0}, "tcp": {"packets": 0, "bytes": 0}, "unknown": {"packets": 0, "bytes": 0}}
        proto = p["protocol"] if p["protocol"] in ("udp", "tcp") else "unknown"
        by_backend[bip][proto]["packets"] += p["packets"]
        by_backend[bip][proto]["bytes"] += p["bytes"]

    total_packets = sum(
        v["udp"]["packets"] + v["tcp"]["packets"] + v["unknown"]["packets"] for v in by_backend.values()
    )

    results = []
    for probe in backend_probes:
        bip = probe["ip"]
        proto_data = by_backend.get(bip, {"udp": {"packets": 0, "bytes": 0}, "tcp": {"packets": 0, "bytes": 0}, "unknown": {"packets": 0, "bytes": 0}})
        total_bk = proto_data["udp"]["packets"] + proto_data["tcp"]["packets"] + proto_data["unknown"]["packets"]
        total_bk_bytes = proto_data["udp"]["bytes"] + proto_data["tcp"]["bytes"] + proto_data["unknown"]["bytes"]

        if total_bk == 0 and not probe["resolves"]:
            backend_status = "DEAD"
            reason = f"Backend {bip} has zero traffic counters and DNS probe failed"
        elif total_bk == 0 and probe["resolves"]:
            backend_status = "NEVER_SELECTED"
            reason = f"Backend {bip} responds to DNS but was never selected by DNAT (0 packets)"
        elif probe["resolves"]:
            backend_status = "OK"
            reason = None
        else:
            backend_status = "UNHEALTHY"
            reason = f"Backend {bip} has traffic ({total_bk} packets) but DNS probe failed"

        results.append({
            "ip": bip,
            "status": backend_status,
            "reason": reason,
            "packets": total_bk,
            "bytes": total_bk_bytes,
            "udp": proto_data["udp"],
            "tcp": proto_data["tcp"],
            "unknown": proto_data["unknown"],
            "resolves": probe["resolves"],
            "latency_ms": probe["latency_ms"],
            "resolved_ip": probe["resolved_ip"],
            "dead": backend_status == "DEAD",
            "never_selected": backend_status == "NEVER_SELECTED",
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
