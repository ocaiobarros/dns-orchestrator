"""
DNS Control — Network Configuration Generator
Generates ifupdown2 configuration and post-up scripts.
Ensures listener IPs, egress IPs, and VIPs are materialized on the host stack.
"""

from typing import Any


def generate_network_config(payload: dict[str, Any]) -> list[dict]:
    loopback = payload.get("loopback", {})
    instances = payload.get("instances", [])
    environment = payload.get("environment", {})
    egress_delivery = str(
        payload.get("egressDeliveryMode")
        or payload.get("_wizardConfig", {}).get("egressDeliveryMode")
        or "host-owned"
    )
    is_border_routed = egress_delivery == "border-routed"
    files = []

    # ── Collect distinct address sets ──
    loopback_ip = loopback.get("ip", "")
    loopback_vip = loopback.get("vip", "")
    reserved = {"127.0.0.1", loopback_ip, loopback_vip}

    listener_ips: list[str] = []
    egress_ips: list[str] = []
    listener_ipv6: list[str] = []
    egress_ipv6: list[str] = []

    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip and bind_ip not in reserved:
            listener_ips.append(bind_ip)
        bind_ipv6 = str(inst.get("bindIpv6", "")).strip()
        if bind_ipv6:
            listener_ipv6.append(bind_ipv6)
        exit_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
        if exit_ip:
            egress_ips.append(exit_ip)
        exit_ipv6 = str(inst.get("exitIpv6", "") or inst.get("egressIpv6", "")).strip()
        if exit_ipv6:
            egress_ipv6.append(exit_ipv6)

    # ── Loopback configuration (ifupdown2) ──
    lo_config = """# DNS Control — Loopback configuration
# Generated configuration — do not edit manually

auto lo
iface lo inet loopback
"""
    if loopback_ip:
        lo_config += f"    address {loopback_ip}/32\n"
    if loopback_vip:
        lo_config += f"    address {loopback_vip}/32\n"

    # Listener IPs MUST be on loopback for Unbound to bind and for direct dig to work
    for lip in listener_ips:
        lo_config += f"    address {lip}/32\n"

    # Egress IPs on loopback — only in host-owned mode
    if not is_border_routed:
        for eip in egress_ips:
            if eip not in reserved and eip not in listener_ips:
                lo_config += f"    address {eip}/32\n"

    files.append({
        "path": "/etc/network/interfaces.d/dns-control-loopback",
        "content": lo_config,
        "permissions": "0644",
        "owner": "root:root",
    })

    # ── Post-up script ──
    post_up_lines = [
        "#!/bin/bash",
        "# DNS Control — Network post-up script",
        "# Generated configuration — do not edit manually",
        "",
        "set -e",
        "",
    ]

    # Listener IPs — ALWAYS add to loopback (required for Unbound bind + health checks)
    if listener_ips:
        post_up_lines.append("# === Listener IPs (MUST exist locally for Unbound interface: binding) ===")
        for lip in listener_ips:
            post_up_lines.append(f'ip -4 addr replace {lip}/32 dev lo 2>/dev/null || true')
        post_up_lines.append("")

    # IPv6 listener IPs
    if listener_ipv6:
        post_up_lines.append("# === Listener IPv6 IPs ===")
        for lip6 in listener_ipv6:
            post_up_lines.append(f'ip -6 addr replace {lip6}/128 dev lo 2>/dev/null || true')
        post_up_lines.append("")

    # Egress IPs
    if egress_ips:
        if is_border_routed:
            post_up_lines.append("# === Egress IPs (border-routed: NOT added to host interfaces) ===")
            post_up_lines.append("# In border-routed mode, egress IPs are logical identities in Unbound outgoing-interface.")
            post_up_lines.append("# Upstream routing must return traffic for these IPs to this host.")
            for inst in instances:
                eip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
                name = inst.get("name", "unbound")
                if eip:
                    post_up_lines.append(f'# outgoing-interface: {eip} ({name}) — routed at border')
        else:
            post_up_lines.append("# === Egress IPs (host-owned: added to loopback) ===")
            for eip in egress_ips:
                post_up_lines.append(f'ip -4 addr replace {eip}/32 dev lo 2>/dev/null || true')
        post_up_lines.append("")

    # IPv6 egress IPs (only host-owned)
    if egress_ipv6 and not is_border_routed:
        post_up_lines.append("# === Egress IPv6 IPs ===")
        for eip6 in egress_ipv6:
            post_up_lines.append(f'ip -6 addr replace {eip6}/128 dev lo 2>/dev/null || true')
        post_up_lines.append("")

    post_up_lines.extend([
        "# Verify addresses",
        'echo "DNS Control: Network addresses applied"',
        "ip addr show lo",
    ])

    files.append({
        "path": "/etc/network/post-up.d/dns-control",
        "content": "\n".join(post_up_lines),
        "permissions": "0755",
        "owner": "root:root",
    })

    return files
