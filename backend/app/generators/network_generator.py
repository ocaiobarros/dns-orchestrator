"""
DNS Control — Network Configuration Generator
Generates ifupdown2 configuration, persistent loopback aliases, and post-up scripts.
Matches production tutorial structure: ip addr add with 2>/dev/null || true,
gateway setup, IPv6 addressing, loopback for all addresses.
"""

from typing import Any


def generate_network_config(payload: dict[str, Any]) -> list[dict]:
    loopback = payload.get("loopback", {})
    instances = payload.get("instances", [])
    environment = payload.get("environment", {})
    wizard_cfg = payload.get("_wizardConfig", {}) or {}

    egress_delivery = str(
        payload.get("egressDeliveryMode")
        or wizard_cfg.get("egressDeliveryMode")
        or "host-owned"
    )
    is_border_routed = egress_delivery == "border-routed"
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)

    service_vips = payload.get("serviceVips") or payload.get("nat", {}).get("serviceVips", []) or []
    intercepted_vips = payload.get("interceptedVips") or wizard_cfg.get("interceptedVips", []) or []

    # Network params
    main_interface = str(payload.get("mainInterface") or wizard_cfg.get("mainInterface") or "ens192")
    ipv4_address = str(payload.get("ipv4Address") or wizard_cfg.get("ipv4Address") or "")
    ipv4_gateway = str(payload.get("ipv4Gateway") or wizard_cfg.get("ipv4Gateway") or "")
    ipv6_address = str(payload.get("ipv6Address") or wizard_cfg.get("ipv6Address") or "")
    ipv6_gateway = str(payload.get("ipv6Gateway") or wizard_cfg.get("ipv6Gateway") or "")
    bootstrap_dns = str(payload.get("bootstrapDns") or wizard_cfg.get("bootstrapDns") or "8.8.8.8")

    files = []

    # ── Collect address sets ──
    egress_ips: list[str] = []
    egress_ipv6: list[str] = []
    listener_ips: list[str] = []
    listener_ipv6: list[str] = []
    public_listener_ips: list[str] = []
    public_listener_ipv6: list[str] = []

    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip and bind_ip != "127.0.0.1":
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
        # Public listener IP — must be materialized on loopback for unbound to bind
        pub_ip = str(inst.get("publicListenerIp", "")).strip()
        if pub_ip and pub_ip not in listener_ips and pub_ip not in egress_ips:
            public_listener_ips.append(pub_ip)
        pub_ipv6 = str(inst.get("publicListenerIpv6", "")).strip()
        if pub_ipv6 and pub_ipv6 not in listener_ipv6 and pub_ipv6 not in egress_ipv6:
            public_listener_ipv6.append(pub_ipv6)

    # ── /etc/network/interfaces ──
    interfaces_content = f"""source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

allow-hotplug {main_interface}
iface {main_interface} inet static
    address {ipv4_address}
    gateway {ipv4_gateway}
    dns-nameservers {bootstrap_dns}

post-up /etc/network/post-up.sh
"""

    files.append({
        "path": "/etc/network/interfaces",
        "content": interfaces_content,
        "permissions": "0644",
        "owner": "root:root",
    })

    # ── /etc/network/post-up.sh ──
    post_up_lines = [
        "#!/bin/sh",
        "# DNS Control — Network post-up script",
        "# Generated configuration — do not edit manually",
        "",
    ]

    # Egress IPs on loopback (host-owned only)
    if egress_ips and not is_border_routed:
        post_up_lines.append("     # Egress IPv4 (outgoing-interface sources)")
        for eip in egress_ips:
            post_up_lines.append(f"     /usr/sbin/ip -4 addr add {eip}/32 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # IPv4 default gateway
    if ipv4_gateway:
        post_up_lines.append(f"     /usr/sbin/ip -4 route add default via {ipv4_gateway} 2>/dev/null || true")
        post_up_lines.append("")

    # IPv6 address on main interface + gateway
    if enable_ipv6 and ipv6_address:
        post_up_lines.append(f"     /usr/sbin/ip -6 addr add {ipv6_address} dev {main_interface} 2>/dev/null || true")
        if ipv6_gateway:
            post_up_lines.append(f"     /usr/sbin/ip -6 route add default via {ipv6_gateway} 2>/dev/null || true")
        post_up_lines.append("")

    # IPv6 egress IPs on loopback (host-owned)
    if egress_ipv6 and not is_border_routed:
        post_up_lines.append("     # Egress IPv6 (outgoing-interface sources)")
        for eip6 in egress_ipv6:
            post_up_lines.append(f"     /usr/sbin/ip addr add {eip6}/128 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # Listener IPv4 IPs on loopback
    if listener_ips:
        post_up_lines.append("     # Listener IPv4 (Unbound bind addresses)")
        for lip in listener_ips:
            post_up_lines.append(f"     /usr/sbin/ip addr add {lip}/32 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # Listener IPv6 IPs on loopback
    if listener_ipv6:
        post_up_lines.append("     # Listener IPv6 (Unbound bind addresses)")
        for lip6 in listener_ipv6:
            post_up_lines.append(f"     /usr/sbin/ip addr add {lip6}/128 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # Public listener IPs on loopback (public-facing IPs for each instance)
    if public_listener_ips:
        post_up_lines.append("     # Public Listener IPv4 (public-facing Unbound addresses)")
        for plip in public_listener_ips:
            post_up_lines.append(f"     /usr/sbin/ip addr add {plip}/32 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    if public_listener_ipv6:
        post_up_lines.append("     # Public Listener IPv6 (public-facing Unbound addresses)")
        for plip6 in public_listener_ipv6:
            post_up_lines.append(f"     /usr/sbin/ip addr add {plip6}/128 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # Service VIPs on loopback (required for DNAT interception to work)
    if service_vips:
        post_up_lines.append("     # Service VIPs (anycast/intercepted — required for nftables DNAT)")
        for vip in service_vips:
            if not isinstance(vip, dict):
                continue
            vip_ip = str(vip.get("ipv4", "")).strip()
            if vip_ip:
                post_up_lines.append(f"     /usr/sbin/ip addr add {vip_ip}/32 dev lo 2>/dev/null || true")
            vip_ipv6 = str(vip.get("ipv6", "")).strip()
            if vip_ipv6 and enable_ipv6:
                post_up_lines.append(f"     /usr/sbin/ip addr add {vip_ipv6}/128 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    # Intercepted VIPs on loopback (required for DNAT interception to work)
    if intercepted_vips:
        post_up_lines.append("     # Intercepted VIPs (DNS seizure — required for nftables DNAT)")
        for vip in intercepted_vips:
            if not isinstance(vip, dict):
                continue
            vip_ip = str(vip.get("vipIp", "")).strip()
            if vip_ip:
                post_up_lines.append(f"     /usr/sbin/ip addr add {vip_ip}/32 dev lo 2>/dev/null || true")
            vip_ipv6 = str(vip.get("vipIpv6", "")).strip()
            if vip_ipv6 and enable_ipv6:
                post_up_lines.append(f"     /usr/sbin/ip addr add {vip_ipv6}/128 dev lo 2>/dev/null || true")
        post_up_lines.append("")

    post_up_lines.append("exit 0")

    post_up_content = "\n".join(post_up_lines)

    files.append({
        "path": "/etc/network/post-up.sh",
        "content": post_up_content,
        "permissions": "0755",
        "owner": "root:root",
    })

    # Also place in post-up.d for ifupdown2 compatibility
    files.append({
        "path": "/etc/network/post-up.d/dns-control",
        "content": post_up_content,
        "permissions": "0755",
        "owner": "root:root",
    })

    return files
