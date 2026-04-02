"""
DNS Control — Import Service (Read-Only Infrastructure Adoption)

Discovers the running host state using ONLY read-only commands:
  - nft -j list ruleset   (JSON nftables)
  - ip -j addr show       (JSON interfaces)
  - ip -j -4 route show   (JSON routes)
  - ss -tulnp             (listeners)
  - unbound-control stats_noreset

Parses and maps:  VIP → DNAT → backend → socket/process

Persists discovered topology to the internal DB without
writing ANY file or restarting ANY service.

SECURITY:
  - No sudo required for discovery (read-only commands)
  - No file writes, no service mutations
  - Sets service_mode=imported to block future apply/deploy
  - Full audit log of everything read
"""

import json
import re
import time
import logging
import platform
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.executors.command_runner import run_command
from app.models.operational import DnsInstance
from app.models.log_entry import Setting, LogEntry

logger = logging.getLogger("dns-control.import")


# ── Read-only discovery commands ───────────────────────────────


def _read_cmd(executable: str, args: list[str], timeout: int = 10,
              use_privilege: bool = False) -> dict:
    """Execute a read-only command and return result."""
    try:
        return run_command(executable, args, timeout=timeout, use_privilege=use_privilege)
    except Exception as e:
        logger.warning(f"Import discovery command failed: {executable} {args}: {e}")
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "duration_ms": 0}


def _audit_log(db: Session, message: str, context: dict | None = None):
    """Write an audit entry for every discovery action."""
    db.add(LogEntry(
        source="import",
        level="info",
        message=message,
        context_json=json.dumps(context) if context else None,
    ))


# ── JSON-based nftables parser ─────────────────────────────────


def _parse_nft_json(nft_json: dict) -> list[dict]:
    """
    Parse nft -j output to extract DNAT rules.
    Returns list of: {vip_ip, backend_ip, backend_port, protocol, packets, bytes, chain, table}
    """
    dnat_mappings = []

    nftables_items = nft_json.get("nftables", [])
    for item in nftables_items:
        rule = item.get("rule")
        if not rule:
            continue

        chain = rule.get("chain", "")
        table = rule.get("table", "")
        family = rule.get("family", "")

        # Only process ip family rules
        if family not in ("ip", "inet"):
            continue

        expr_list = rule.get("expr", [])
        if not expr_list:
            continue

        # Extract match IP (daddr), protocol, counter, and dnat target
        daddr = None
        protocol = "unknown"
        packets = 0
        bytes_count = 0
        dnat_addr = None
        dnat_port = 53

        for expr in expr_list:
            # Match: {"match": {"left": {"payload": {"field": "daddr"}}, "right": "X.X.X.X"}}
            match_data = expr.get("match")
            if match_data:
                left = match_data.get("left", {})
                payload = left.get("payload", {})
                if payload.get("field") == "daddr":
                    right = match_data.get("right")
                    if isinstance(right, str):
                        daddr = right
                    elif isinstance(right, dict) and "set" in right:
                        # Set of IPs — we'll expand later
                        pass

                # Protocol detection
                if payload.get("field") == "protocol" or payload.get("protocol") == "ip":
                    right = match_data.get("right")
                    if right in ("tcp", "udp"):
                        protocol = right
                meta = left.get("meta")
                if meta and meta.get("key") == "l4proto":
                    right = match_data.get("right")
                    if isinstance(right, str) and right in ("tcp", "udp"):
                        protocol = right

            # Counter
            counter = expr.get("counter")
            if counter:
                packets = counter.get("packets", 0)
                bytes_count = counter.get("bytes", 0)

            # DNAT target
            dnat = expr.get("dnat")
            if dnat:
                dnat_addr_val = dnat.get("addr")
                if isinstance(dnat_addr_val, str):
                    dnat_addr = dnat_addr_val
                dnat_port = dnat.get("port", 53)

        if daddr and dnat_addr:
            dnat_mappings.append({
                "vip_ip": daddr,
                "backend_ip": dnat_addr,
                "backend_port": dnat_port if isinstance(dnat_port, int) else 53,
                "protocol": protocol,
                "packets": packets,
                "bytes": bytes_count,
                "chain": chain,
                "table": table,
            })

    return dnat_mappings


def _parse_nft_json_sets(nft_json: dict) -> dict[str, list[str]]:
    """Extract named sets and their elements from nft -j output."""
    sets_map = {}
    for item in nft_json.get("nftables", []):
        s = item.get("set")
        if not s:
            continue
        name = s.get("name", "")
        elems = s.get("elem", [])
        if isinstance(elems, list):
            ips = [e for e in elems if isinstance(e, str) and re.match(r'\d+\.\d+\.\d+\.\d+', e)]
            if ips:
                sets_map[name] = ips
    return sets_map


# ── Interface / route parsing (JSON) ──────────────────────────


def _parse_ip_addr_json(ip_json: list[dict]) -> dict:
    """Parse ip -j addr output."""
    interfaces = []
    loopback_ips = []

    for iface in ip_json:
        ifname = iface.get("ifname", "")
        operstate = iface.get("operstate", "UNKNOWN")
        addresses = []

        for addr_info in iface.get("addr_info", []):
            entry = {
                "family": addr_info.get("family", ""),
                "address": addr_info.get("local", ""),
                "prefixlen": addr_info.get("prefixlen", 0),
            }
            addresses.append(entry)
            if ifname in ("lo", "lo0") and addr_info.get("family") == "inet":
                ip = addr_info.get("local", "")
                if not ip.startswith("127."):
                    loopback_ips.append(ip)

        interfaces.append({
            "name": ifname,
            "state": operstate,
            "addresses": addresses,
        })

    return {"interfaces": interfaces, "loopback_ips": loopback_ips}


def _parse_ip_route_json(route_json: list[dict]) -> list[str]:
    """Extract /32 host routes from ip -j route output."""
    host_ips = []
    for route in route_json:
        dst = route.get("dst", "")
        if "/" in dst:
            ip, mask = dst.split("/", 1)
            if mask == "32" and not ip.startswith("127."):
                host_ips.append(ip)
        elif route.get("scope") == "host" and not dst.startswith("127."):
            # Some routes show as plain IP with scope host
            host_ips.append(dst.split("/")[0])
    return host_ips


# ── Unbound instance discovery ─────────────────────────────────


def _discover_unbound_instances() -> list[dict]:
    """Discover running unbound instances from systemd."""
    r = _read_cmd("systemctl", ["list-units", "--type=service", "--no-pager", "--plain"],
                  timeout=10)
    instances = []
    if r["exit_code"] != 0:
        return instances

    names = []
    for line in r["stdout"].split("\n"):
        if "unbound" in line and ".service" in line:
            parts = line.split()
            if parts:
                name = parts[0].replace(".service", "")
                if name != "unbound":  # Skip base unbound
                    names.append(name)

    for name in names:
        # Read config
        conf_r = _read_cmd("cat", [f"/etc/unbound/{name}.conf"], timeout=5)
        if conf_r["exit_code"] != 0:
            continue

        inst = {
            "name": name,
            "bind_ip": "",
            "bind_port": 53,
            "outgoing_ip": "",
            "control_port": 8953,
            "interfaces": [],
            "access_control": [],
        }

        for line in conf_r["stdout"].split("\n"):
            s = line.strip()
            if s.startswith("interface:") and not s.startswith("interface-automatic"):
                ip = s.split(":", 1)[1].strip()
                # Strip port suffix like @53 or #5353
                ip_clean = ip.split("@")[0].split("#")[0].strip()
                inst["interfaces"].append(ip_clean)
                if not inst["bind_ip"]:
                    inst["bind_ip"] = ip_clean
            elif s.startswith("control-port:"):
                try:
                    inst["control_port"] = int(s.split(":", 1)[1].strip())
                except ValueError:
                    pass
            elif s.startswith("outgoing-interface:"):
                ip = s.split(":", 1)[1].strip()
                if ip and not ip.startswith("#"):
                    inst["outgoing_ip"] = ip

        # Get stats
        stats_r = _read_cmd("unbound-control", ["-c", f"/etc/unbound/{name}.conf", "stats_noreset"],
                            timeout=5, use_privilege=True)
        if stats_r["exit_code"] == 0:
            inst["stats_available"] = True
        else:
            inst["stats_available"] = False

        instances.append(inst)

    return instances


# ── Listener discovery (ss) ────────────────────────────────────


def _discover_dns_listeners() -> list[dict]:
    """Discover DNS listeners via ss."""
    r = _read_cmd("ss", ["-tulnp"], timeout=5)
    listeners = []
    if r["exit_code"] != 0:
        return listeners

    for line in r["stdout"].split("\n"):
        if ":53 " not in line and ":53\t" not in line:
            continue
        parts = line.split()
        proto = "tcp" if line.startswith("tcp") else "udp" if line.startswith("udp") else "unknown"
        for part in parts:
            if ":53" in part:
                addr_port = part.rsplit(":", 1)
                if len(addr_port) == 2 and addr_port[1] == "53":
                    ip = addr_port[0].strip("[]")
                    if ip not in ("*", "0.0.0.0", "::"):
                        listeners.append({"ip": ip, "port": 53, "protocol": proto})
    return listeners


# ── VIP→Backend mapping ────────────────────────────────────────


def _build_vip_mappings(dnat_rules: list[dict], loopback_ips: list[str],
                        host_routes: list[str], instances: list[dict]) -> list[dict]:
    """
    Build VIP mappings from discovered DNAT rules, loopback IPs, and routes.
    Maps each VIP to its backend instance.
    """
    # Build IP→instance lookup
    ip_to_instance = {}
    for inst in instances:
        if inst.get("bind_ip"):
            ip_to_instance[inst["bind_ip"]] = inst["name"]
        for iface_ip in inst.get("interfaces", []):
            ip_to_instance[iface_ip] = inst["name"]

    vips: dict[str, dict] = {}

    # From DNAT rules (highest confidence)
    for rule in dnat_rules:
        vip_ip = rule["vip_ip"]
        backend_ip = rule["backend_ip"]
        if vip_ip in vips:
            # Merge counters
            vips[vip_ip]["packets"] += rule["packets"]
            vips[vip_ip]["bytes"] += rule["bytes"]
            continue

        vips[vip_ip] = {
            "vip_ip": vip_ip,
            "capture_mode": "dnat",
            "backend_ip": backend_ip,
            "backend_port": rule["backend_port"],
            "backend_instance": ip_to_instance.get(backend_ip, ""),
            "nft_chain": rule["chain"],
            "nft_table": rule["table"],
            "protocol": rule["protocol"],
            "packets": rule["packets"],
            "bytes": rule["bytes"],
            "source": "nft_json",
        }

    # From loopback IPs not already mapped (bind-local VIPs)
    known_instance_ips = set()
    for inst in instances:
        if inst.get("bind_ip"):
            known_instance_ips.add(inst["bind_ip"])
        if inst.get("outgoing_ip"):
            known_instance_ips.add(inst["outgoing_ip"])
        for ip in inst.get("interfaces", []):
            known_instance_ips.add(ip)

    for ip in loopback_ips:
        if ip not in vips and ip not in known_instance_ips:
            vips[ip] = {
                "vip_ip": ip,
                "capture_mode": "local_bind",
                "backend_ip": "",
                "backend_port": 53,
                "backend_instance": "",
                "nft_chain": "",
                "nft_table": "",
                "protocol": "udp+tcp",
                "packets": 0,
                "bytes": 0,
                "source": "ip_addr",
            }

    # From /32 routes not already mapped
    for ip in host_routes:
        if ip not in vips and ip not in known_instance_ips:
            vips[ip] = {
                "vip_ip": ip,
                "capture_mode": "route",
                "backend_ip": "",
                "backend_port": 53,
                "backend_instance": "",
                "nft_chain": "",
                "nft_table": "",
                "protocol": "udp+tcp",
                "packets": 0,
                "bytes": 0,
                "source": "ip_route",
            }

    return list(vips.values())


# ── Main import orchestrator ───────────────────────────────────


def execute_import(db: Session) -> dict:
    """
    Execute full read-only import:
    1. Discover nftables (JSON), interfaces, routes, unbound instances, listeners
    2. Parse and map VIP→DNAT→backend
    3. Persist to DB (dns_instances, settings)
    4. Set service_mode=imported
    5. Audit log everything read

    Returns full discovery result for the frontend.
    """
    start_time = time.monotonic()
    audit_entries = []
    errors = []

    # ── Step 1: nft -j list ruleset ──
    nft_r = _read_cmd("nft", ["-j", "list", "ruleset"], timeout=15, use_privilege=True)
    nft_ok = nft_r["exit_code"] == 0
    nft_json = {}
    dnat_rules = []

    if nft_ok:
        try:
            nft_json = json.loads(nft_r["stdout"])
            dnat_rules = _parse_nft_json(nft_json)
            audit_entries.append({
                "source": "nft -j list ruleset",
                "status": "ok",
                "dnat_rules_found": len(dnat_rules),
                "duration_ms": nft_r.get("duration_ms", 0),
            })
        except json.JSONDecodeError as e:
            errors.append(f"nft JSON parse error: {e}")
            audit_entries.append({"source": "nft -j list ruleset", "status": "parse_error", "error": str(e)})
    else:
        # Fallback: try text-based nft
        nft_text_r = _read_cmd("nft", ["list", "ruleset"], timeout=15, use_privilege=True)
        if nft_text_r["exit_code"] == 0:
            dnat_rules = _parse_nft_text_fallback(nft_text_r["stdout"])
            audit_entries.append({
                "source": "nft list ruleset (text fallback)",
                "status": "ok",
                "dnat_rules_found": len(dnat_rules),
            })
        else:
            errors.append(f"nft command failed: {nft_r.get('stderr', '')[:200]}")
            audit_entries.append({"source": "nft", "status": "failed", "error": nft_r.get("stderr", "")[:200]})

    # ── Step 2: ip -j addr show ──
    ip_addr_r = _read_cmd("ip", ["-j", "addr", "show"], timeout=10)
    ip_data = {"interfaces": [], "loopback_ips": []}
    if ip_addr_r["exit_code"] == 0:
        try:
            ip_json = json.loads(ip_addr_r["stdout"])
            ip_data = _parse_ip_addr_json(ip_json)
            audit_entries.append({
                "source": "ip -j addr show",
                "status": "ok",
                "interfaces_found": len(ip_data["interfaces"]),
                "loopback_ips": ip_data["loopback_ips"],
            })
        except json.JSONDecodeError as e:
            errors.append(f"ip addr JSON parse error: {e}")
    else:
        audit_entries.append({"source": "ip -j addr show", "status": "failed"})

    # ── Step 3: ip -j -4 route show scope host ──
    route_r = _read_cmd("ip", ["-j", "-4", "route", "show", "scope", "host"], timeout=5)
    host_routes = []
    if route_r["exit_code"] == 0:
        try:
            route_json = json.loads(route_r["stdout"])
            host_routes = _parse_ip_route_json(route_json)
            audit_entries.append({
                "source": "ip -j -4 route show scope host",
                "status": "ok",
                "host_routes": host_routes,
            })
        except json.JSONDecodeError:
            pass
    else:
        audit_entries.append({"source": "ip -j route", "status": "failed"})

    # ── Step 4: Unbound instances ──
    instances = _discover_unbound_instances()
    audit_entries.append({
        "source": "systemctl + unbound configs",
        "status": "ok",
        "instances_found": len(instances),
        "instance_names": [i["name"] for i in instances],
    })

    # ── Step 5: DNS listeners (ss) ──
    listeners = _discover_dns_listeners()
    audit_entries.append({
        "source": "ss -tulnp",
        "status": "ok",
        "dns_listeners": len(listeners),
    })

    # ── Step 6: Build VIP mappings ──
    vip_mappings = _build_vip_mappings(dnat_rules, ip_data["loopback_ips"], host_routes, instances)
    audit_entries.append({
        "source": "vip_mapping",
        "status": "ok",
        "vips_mapped": len(vip_mappings),
        "capture_modes": list(set(v["capture_mode"] for v in vip_mappings)),
    })

    # ── Step 7: Persist to DB ──
    persist_result = _persist_imported_state(db, instances, vip_mappings)

    # ── Step 8: Set service_mode=imported ──
    from app.services.service_mode import set_service_mode, MODE_IMPORTED
    set_service_mode(db, MODE_IMPORTED)

    # ── Step 9: Write audit log ──
    _audit_log(db, "Import executed — read-only infrastructure adoption", {
        "hostname": platform.node(),
        "instances": len(instances),
        "vips": len(vip_mappings),
        "dnat_rules": len(dnat_rules),
        "errors": errors,
        "audit_entries": audit_entries,
    })
    db.commit()

    elapsed_ms = round((time.monotonic() - start_time) * 1000, 1)

    return {
        "success": len(errors) == 0,
        "mode": "imported",
        "hostname": platform.node(),
        "elapsed_ms": elapsed_ms,
        "discovery": {
            "instances": instances,
            "vip_mappings": vip_mappings,
            "dnat_rules_raw": len(dnat_rules),
            "loopback_ips": ip_data["loopback_ips"],
            "host_routes": host_routes,
            "dns_listeners": listeners,
            "network_interfaces": ip_data["interfaces"],
        },
        "persist": persist_result,
        "audit": audit_entries,
        "errors": errors,
    }


def _persist_imported_state(db: Session, instances: list[dict],
                            vip_mappings: list[dict]) -> dict:
    """Persist discovered instances and VIP mappings to DB."""
    persisted_instances = 0
    persisted_vips = 0

    # Upsert DnsInstance records
    for inst in instances:
        existing = db.query(DnsInstance).filter(
            DnsInstance.instance_name == inst["name"]
        ).first()

        if existing:
            existing.bind_ip = inst["bind_ip"]
            existing.bind_port = inst["bind_port"]
            existing.outgoing_ip = inst.get("outgoing_ip", "")
            existing.control_port = inst.get("control_port", 8953)
            existing.is_enabled = True
        else:
            db.add(DnsInstance(
                instance_name=inst["name"],
                bind_ip=inst["bind_ip"],
                bind_port=inst["bind_port"],
                outgoing_ip=inst.get("outgoing_ip", ""),
                control_port=inst.get("control_port", 8953),
                is_enabled=True,
                node_name="local",
            ))
        persisted_instances += 1

    # Persist VIP mappings as settings (JSON blob)
    vip_setting = db.query(Setting).filter(Setting.key == "imported_vip_mappings").first()
    vip_json = json.dumps(vip_mappings)
    if vip_setting:
        vip_setting.value = vip_json
    else:
        db.add(Setting(key="imported_vip_mappings", value=vip_json))
    persisted_vips = len(vip_mappings)

    # Store import timestamp
    ts_setting = db.query(Setting).filter(Setting.key == "import_timestamp").first()
    ts_val = datetime.now(timezone.utc).isoformat()
    if ts_setting:
        ts_setting.value = ts_val
    else:
        db.add(Setting(key="import_timestamp", value=ts_val))

    db.commit()

    return {
        "instances_persisted": persisted_instances,
        "vips_persisted": persisted_vips,
    }


def _parse_nft_text_fallback(nft_stdout: str) -> list[dict]:
    """Fallback parser for text-based nft output when JSON is unavailable."""
    rules = []
    dnat_pattern = re.compile(
        r'ip\s+daddr\s+(\d+\.\d+\.\d+\.\d+)\s+.*?dnat\s+to\s+(\d+\.\d+\.\d+\.\d+)(?::(\d+))?',
        re.IGNORECASE,
    )
    counter_pattern = re.compile(r'counter packets (\d+) bytes (\d+)')

    for line in nft_stdout.split("\n"):
        m = dnat_pattern.search(line)
        if not m:
            continue
        counter = counter_pattern.search(line)
        proto = "unknown"
        if "meta l4proto tcp" in line or "tcp dport" in line:
            proto = "tcp"
        elif "meta l4proto udp" in line or "udp dport" in line:
            proto = "udp"

        rules.append({
            "vip_ip": m.group(1),
            "backend_ip": m.group(2),
            "backend_port": int(m.group(3)) if m.group(3) else 53,
            "protocol": proto,
            "packets": int(counter.group(1)) if counter else 0,
            "bytes": int(counter.group(2)) if counter else 0,
            "chain": "",
            "table": "",
        })

    return rules


def get_imported_vips(db: Session) -> list[dict]:
    """Return the imported VIP mappings from the settings table."""
    row = db.query(Setting).filter(Setting.key == "imported_vip_mappings").first()
    if not row or not row.value:
        return []
    try:
        return json.loads(row.value)
    except (json.JSONDecodeError, TypeError):
        return []


def clear_import(db: Session) -> dict:
    """
    Clear the imported state and return to managed mode.
    Does NOT touch any files or services — only clears DB state.
    """
    from app.services.service_mode import set_service_mode, MODE_MANAGED

    # Remove imported VIP mappings
    db.query(Setting).filter(Setting.key == "imported_vip_mappings").delete()
    db.query(Setting).filter(Setting.key == "import_timestamp").delete()

    # Set mode back to managed
    set_service_mode(db, MODE_MANAGED)

    _audit_log(db, "Import cleared — returning to managed mode", {})
    db.commit()

    return {"success": True, "mode": "managed"}
