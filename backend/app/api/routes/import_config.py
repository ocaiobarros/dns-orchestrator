"""
DNS Control — Import Running Config
Reads the current host state and returns a WizardConfig-compatible payload.
Discovers intercepted VIPs from nftables DNAT rules and /32 routes.
"""

from fastapi import APIRouter, Depends
from app.api.deps import get_current_user
from app.models.user import User
from app.executors.command_runner import run_command
import json
import re
import platform

router = APIRouter()


@router.get("/import-host")
def import_host_config(_: User = Depends(get_current_user)):
    """
    Read the current host production state and return a wizard-compatible config.
    Sources: systemd units, unbound configs, ip addr, nft list ruleset, FRR config.
    Discovers intercepted VIPs from nftables DNAT rules and /32 routes.
    """
    config = {}

    # Hostname / host topology
    config["hostname"] = platform.node() or ""

    # Discover unbound instances
    instances = _read_unbound_instances()
    config["instances"] = instances
    config["instanceCount"] = len(instances)

    # Network state
    config["network"] = _read_network_state()

    # nftables state
    config["nftables"] = _read_nftables_state()

    # FRR state
    config["frr"] = _read_frr_state()

    # Egress mode detection
    config["egressDeliveryMode"] = _detect_egress_mode(instances)

    # ── VIP Interception Discovery ──
    # Build IP-to-instance mapping from discovered instances
    ip_to_instance = {}
    for inst in instances:
        if inst.get("bindIp"):
            ip_to_instance[inst["bindIp"]] = inst["name"]

    # Discover intercepted VIPs from nftables DNAT rules
    nft_ruleset = config["nftables"].get("ruleset", "")
    dnat_vips = _discover_dnat_vips(nft_ruleset, ip_to_instance)

    # Discover VIPs from /32 routes not belonging to known instances
    route_vips = _discover_route_vips(ip_to_instance, instances)

    # Merge: DNAT-discovered VIPs take precedence, route-only VIPs added as 'route' capture mode
    intercepted_vips = {}
    for vip in dnat_vips:
        intercepted_vips[vip["vipIp"]] = vip
    for vip in route_vips:
        if vip["vipIp"] not in intercepted_vips:
            intercepted_vips[vip["vipIp"]] = vip

    config["interceptedVips"] = list(intercepted_vips.values())

    return config


def _read_unbound_instances() -> list[dict]:
    """Parse all unbound instance configs."""
    r = run_command("systemctl", ["list-units", "--type=service", "--no-pager", "--plain"], timeout=10)
    names = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            if "unbound" in line and ".service" in line:
                name = line.split()[0].replace(".service", "")
                if name != "unbound":
                    names.append(name)

    if not names:
        names = ["unbound01", "unbound02"]

    instances = []
    for name in names:
        conf = run_command("cat", [f"/etc/unbound/{name}.conf"], timeout=5)
        if conf["exit_code"] != 0:
            continue

        inst = {
            "name": name,
            "bindIp": "",
            "bindIpv6": "",
            "publicListenerIp": "",
            "controlInterface": "127.0.0.1",
            "controlPort": 8953,
            "egressIpv4": "",
            "egressIpv6": "",
            "interfaces": [],
            "accessControl": [],
        }

        for line in conf["stdout"].split("\n"):
            s = line.strip()
            if s.startswith("interface:") and not s.startswith("interface-automatic"):
                ip = s.split(":", 1)[1].strip()
                inst["interfaces"].append(ip)
                if not inst["bindIp"]:
                    inst["bindIp"] = ip
            elif s.startswith("control-interface:"):
                inst["controlInterface"] = s.split(":", 1)[1].strip()
            elif s.startswith("control-port:"):
                try:
                    inst["controlPort"] = int(s.split(":", 1)[1].strip())
                except ValueError:
                    pass
            elif s.startswith("outgoing-interface:"):
                ip = s.split(":", 1)[1].strip()
                if ip and not ip.startswith("#"):
                    inst["egressIpv4"] = ip
            elif s.startswith("access-control:"):
                parts = s.split(":", 1)[1].strip().split()
                if len(parts) >= 2:
                    inst["accessControl"].append({"network": parts[0], "action": parts[1]})

        # Detect public listener IP: any interface IP that is NOT RFC1918/CGNAT/loopback
        for ip in inst["interfaces"]:
            ip_clean = ip.split("@")[0].split("#")[0].strip()
            if _is_public_ip(ip_clean) and ip_clean != inst["bindIp"]:
                inst["publicListenerIp"] = ip_clean
                break

        instances.append(inst)

    return instances


def _is_public_ip(ip: str) -> bool:
    """Check if an IPv4 address is publicly routable."""
    try:
        parts = [int(p) for p in ip.split(".")]
        if len(parts) != 4:
            return False
        if parts[0] == 10:
            return False
        if parts[0] == 172 and 16 <= parts[1] <= 31:
            return False
        if parts[0] == 192 and parts[1] == 168:
            return False
        if parts[0] == 100 and 64 <= parts[1] <= 127:
            return False
        if parts[0] == 127:
            return False
        return True
    except (ValueError, IndexError):
        return False


def _read_network_state() -> dict:
    """Read interfaces, IPs, listeners."""
    result = {}

    r = run_command("ip", ["-j", "addr", "show"], timeout=10)
    try:
        ifaces = json.loads(r["stdout"])
        result["interfaces"] = []
        for iface in ifaces:
            ips = []
            for a in iface.get("addr_info", []):
                ips.append({"family": a.get("family"), "address": a.get("local"), "prefixlen": a.get("prefixlen")})
            result["interfaces"].append({
                "name": iface.get("ifname"),
                "state": iface.get("operstate"),
                "addresses": ips,
            })
    except (json.JSONDecodeError, KeyError):
        result["interfaces"] = []

    r = run_command("ss", ["-tulnp"], timeout=5)
    listeners = []
    if r["exit_code"] == 0:
        for line in r["stdout"].split("\n"):
            if ":53 " in line or ":53\t" in line:
                parts = line.split()
                for part in parts:
                    if ":53" in part:
                        ip = part.rsplit(":", 1)[0]
                        if ip not in ("*", "0.0.0.0", "[::"):
                            listeners.append(ip)
    result["listeners"] = list(set(listeners))

    return result


def _read_nftables_state() -> dict:
    r = run_command("nft", ["list", "ruleset"], timeout=10, use_privilege=True)
    return {
        "loaded": r["exit_code"] == 0,
        "ruleset": r["stdout"][:50000] if r["exit_code"] == 0 else "",
    }


def _read_frr_state() -> dict:
    r = run_command("vtysh", ["-c", "show running-config"], timeout=10, use_privilege=True)
    return {
        "active": r["exit_code"] == 0,
        "config": r["stdout"][:10000] if r["exit_code"] == 0 else "",
    }


def _detect_egress_mode(instances: list[dict]) -> str:
    """Detect if egress IPs are local (host-owned) or border-routed."""
    r = run_command("ip", ["-j", "addr", "show"], timeout=5)
    local_ips = set()
    try:
        ifaces = json.loads(r["stdout"])
        for iface in ifaces:
            for a in iface.get("addr_info", []):
                local_ips.add(a.get("local", ""))
    except (json.JSONDecodeError, KeyError):
        pass

    for inst in instances:
        egress = inst.get("egressIpv4", "")
        if egress and egress not in local_ips:
            return "border-routed"

    return "host-owned"


def _discover_dnat_vips(ruleset: str, ip_to_instance: dict[str, str]) -> list[dict]:
    """
    Parse nftables ruleset to discover DNAT rules that intercept VIPs.
    
    Looks for patterns like:
      ip daddr <VIP> ... dnat to <BACKEND_IP>:53
      ip daddr { <VIP1>, <VIP2> } ... dnat to <BACKEND_IP>:53
    
    Returns list of InterceptedVip-compatible dicts.
    """
    vips: dict[str, dict] = {}

    # Pattern 1: Direct DNAT rules: ip daddr X.X.X.X ... dnat to Y.Y.Y.Y
    dnat_pattern = re.compile(
        r'ip\s+daddr\s+(\d+\.\d+\.\d+\.\d+)\s+.*?dnat\s+to\s+(\d+\.\d+\.\d+\.\d+)',
        re.IGNORECASE,
    )
    for m in dnat_pattern.finditer(ruleset):
        vip_ip = m.group(1)
        backend_ip = m.group(2)
        if _is_public_ip(vip_ip) or vip_ip.startswith("4."):
            backend_name = ip_to_instance.get(backend_ip, "")
            if vip_ip not in vips:
                vips[vip_ip] = _make_intercepted_vip(vip_ip, "dnat", backend_name, backend_ip)

    # Pattern 2: Jump rules referencing $DNS_ANYCAST_IPV4 or defines
    # Look for 'define DNS_ANYCAST_IPV4' to find the set of VIP IPs
    define_pattern = re.compile(
        r'define\s+DNS_ANYCAST_IPV4\s*=\s*\{([^}]+)\}',
        re.IGNORECASE | re.DOTALL,
    )
    for m in define_pattern.finditer(ruleset):
        ip_list = re.findall(r'(\d+\.\d+\.\d+\.\d+)', m.group(1))
        for ip in ip_list:
            if ip not in vips and (_is_public_ip(ip) or ip.startswith("4.")):
                vips[ip] = _make_intercepted_vip(ip, "dnat", "", "")

    # Pattern 3: Per-instance chain DNAT rules for backend association
    # e.g., "chain ipv4_dns_udp_unbound01 { ... dnat to 100.127.255.101:53 }"
    chain_dnat_pattern = re.compile(
        r'chain\s+ipv4_dns_(?:udp|tcp)_(\w+)\s*\{[^}]*?dnat\s+to\s+(\d+\.\d+\.\d+\.\d+)',
        re.IGNORECASE | re.DOTALL,
    )
    chain_backend_map: dict[str, str] = {}
    for m in chain_dnat_pattern.finditer(ruleset):
        instance_name = m.group(1)
        backend_ip = m.group(2)
        chain_backend_map[instance_name] = backend_ip

    # Associate VIPs that have no backend yet with discovered backends
    for vip_ip, vip_data in vips.items():
        if not vip_data["backendInstance"] and chain_backend_map:
            # Pick the first discovered backend
            for inst_name, bip in chain_backend_map.items():
                vip_data["backendInstance"] = inst_name
                vip_data["backendTargetIp"] = bip
                break

    return list(vips.values())


def _discover_route_vips(ip_to_instance: dict[str, str], instances: list[dict]) -> list[dict]:
    """
    Discover VIPs from /32 routes that are NOT listener or egress IPs.
    These are IPs locally routed but not used by any unbound instance.
    """
    r = run_command("ip", ["-4", "route", "show", "scope", "host"], timeout=5)
    if r["exit_code"] != 0:
        return []

    # Collect all known instance IPs to exclude
    known_ips = set()
    for inst in instances:
        if inst.get("bindIp"):
            known_ips.add(inst["bindIp"])
        if inst.get("egressIpv4"):
            known_ips.add(inst["egressIpv4"])
        if inst.get("publicListenerIp"):
            known_ips.add(inst["publicListenerIp"])
        for iface_ip in inst.get("interfaces", []):
            ip_clean = iface_ip.split("@")[0].split("#")[0].strip()
            known_ips.add(ip_clean)

    vips = []
    for line in r["stdout"].split("\n"):
        line = line.strip()
        if not line:
            continue
        # Parse: "4.2.2.5 dev lo0 proto kernel scope host src 4.2.2.5"
        parts = line.split()
        if not parts:
            continue
        route_ip = parts[0].split("/")[0]  # Strip /32 if present
        if route_ip in known_ips:
            continue
        if route_ip in ("127.0.0.1", "0.0.0.0"):
            continue
        # Only treat publicly routable IPs or well-known DNS IPs as intercepted VIPs
        if _is_public_ip(route_ip) or route_ip.startswith("4."):
            vips.append(_make_intercepted_vip(route_ip, "route", "", ""))

    return vips


def _make_intercepted_vip(
    vip_ip: str,
    capture_mode: str,
    backend_instance: str,
    backend_target_ip: str,
) -> dict:
    """Create a wizard-compatible InterceptedVip dict."""
    return {
        "vipIp": vip_ip,
        "vipIpv6": "",
        "vipType": "intercepted",
        "captureMode": capture_mode,
        "backendInstance": backend_instance,
        "backendTargetIp": backend_target_ip,
        "description": f"Discovered: {vip_ip} ({capture_mode})",
        "expectedLocalLatencyMs": 1,
        "validationMode": "strict",
        "protocol": "udp+tcp",
        "port": 53,
    }
