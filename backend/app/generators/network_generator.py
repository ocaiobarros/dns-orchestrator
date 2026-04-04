"""
DNS Control — Network Configuration Generator
Generates ifupdown2 configuration and post-up script.
Matches vdns-02 runtime: dual-plane model:
  - lo  = egress IPv4 ONLY
  - lo0 = dummy interface for listeners IPv4/IPv6 + VIPs IPv4/IPv6 + egress IPv6
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

    # ── /etc/network/interfaces ──
    interfaces_content = f"""
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

allow-hotplug {main_interface}
iface {main_interface} inet static
    address {ipv4_address}
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
    # Runtime model: lo = egress, lo0 = listeners + VIPs
    post_up_lines = [
        "#!/bin/sh",
    ]

    # Egress IPv4 on lo (host-owned)
    if egress_ips and not is_border_routed:
        for eip in egress_ips:
            post_up_lines.append(f"     /usr/sbin/ip -4 addr add {eip}/32 dev lo")

    # IPv4 default route
    if ipv4_gateway:
        post_up_lines.append(f"     /usr/sbin/ip -4 route add default via {ipv4_gateway}")

    # IPv6 address on main interface + gateway
    if enable_ipv6 and ipv6_address:
        post_up_lines.append(f"")
        post_up_lines.append(f"     /usr/sbin/ip -6 addr add {ipv6_address} dev {main_interface}")
        if ipv6_gateway:
            post_up_lines.append(f"     /usr/sbin/ip -6 route add default via {ipv6_gateway}")

    # IPv6 egress on lo0 (runtime vdns-02: egress IPv6 lives on lo0, NOT lo)
    # Will be added after lo0 creation below

    # ── Create dummy lo0 for listeners and VIPs ──
    post_up_lines.append(f"")
    post_up_lines.append("     /usr/sbin/ip link add lo0 type dummy 2>/dev/null || true")
    post_up_lines.append("     /usr/sbin/ip link set lo0 up")

    # Listener IPv4 on lo0
    if listener_ips:
        post_up_lines.append(f"")
        for lip in listener_ips:
            post_up_lines.append(f"     /usr/sbin/ip addr add {lip}/32 dev lo0")

    # Listener IPv6 on lo0
    if listener_ipv6:
        post_up_lines.append(f"")
        for lip6 in listener_ipv6:
            post_up_lines.append(f"     /usr/sbin/ip addr add {lip6}/128 dev lo0")

    # Intercepted VIPs on lo0 (anycast public)
    vip_ipv4s = []
    vip_ipv6s = []
    for vip in intercepted_vips:
        if not isinstance(vip, dict):
            continue
        vip_ip = str(vip.get("vipIp", "")).strip()
        if vip_ip:
            vip_ipv4s.append(vip_ip)
        vip_ipv6 = str(vip.get("vipIpv6", "")).strip()
        if vip_ipv6:
            vip_ipv6s.append(vip_ipv6)

    # Service VIPs on lo0
    for vip in service_vips:
        if not isinstance(vip, dict):
            continue
        vip_ip = str(vip.get("ipv4", "")).strip()
        if vip_ip and vip_ip not in vip_ipv4s:
            vip_ipv4s.append(vip_ip)
        vip_ipv6 = str(vip.get("ipv6", "")).strip()
        if vip_ipv6 and vip_ipv6 not in vip_ipv6s:
            vip_ipv6s.append(vip_ipv6)

    if vip_ipv4s:
        post_up_lines.append(f"")
        post_up_lines.append(f"     # Anycast publico")
        for vip in vip_ipv4s:
            post_up_lines.append(f"     /usr/sbin/ip addr add {vip}/32 dev lo0")

    if vip_ipv6s and enable_ipv6:
        for vip6 in vip_ipv6s:
            post_up_lines.append(f"     /usr/sbin/ip addr add {vip6}/128 dev lo0")

    post_up_lines.append(f"")
    post_up_lines.append("exit 0")

    post_up_content = "\n".join(post_up_lines) + "\n"

    files.append({
        "path": "/etc/network/post-up.sh",
        "content": post_up_content,
        "permissions": "0755",
        "owner": "root:root",
    })

    return files
