"""
DNS Control — Network Configuration Generator
Generates ifupdown2 configuration, persistent loopback aliases, and post-up scripts.
Ensures listener IPs, egress IPs, VIPs, and IPv6 addresses are materialized on the host stack.
Aligned with vdns-01 production model.
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
    deployment_mode = str(payload.get("deploymentMode") or wizard_cfg.get("deploymentMode") or "public-controlled")

    files = []

    # ── Collect distinct address sets ──
    loopback_ip = loopback.get("ip", "")
    loopback_vip = loopback.get("vip", "")
    reserved = {"127.0.0.1", loopback_ip, loopback_vip}

    listener_ips: list[str] = []
    public_listener_ips: list[str] = []
    egress_ips: list[str] = []
    listener_ipv6: list[str] = []
    egress_ipv6: list[str] = []
    intercepted_vips = payload.get("interceptedVips") or wizard_cfg.get("interceptedVips", []) or []

    for inst in instances:
        bind_ip = str(inst.get("bindIp", "")).strip()
        if bind_ip and bind_ip not in reserved:
            listener_ips.append(bind_ip)
        public_listener_ip = str(inst.get("publicListenerIp", "")).strip()
        if public_listener_ip and public_listener_ip not in reserved:
            public_listener_ips.append(public_listener_ip)
        bind_ipv6 = str(inst.get("bindIpv6", "")).strip()
        if bind_ipv6:
            listener_ipv6.append(bind_ipv6)
        exit_ip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
        if exit_ip:
            egress_ips.append(exit_ip)
        exit_ipv6 = str(inst.get("exitIpv6", "") or inst.get("egressIpv6", "")).strip()
        if exit_ipv6:
            egress_ipv6.append(exit_ipv6)

    # ── Persistent loopback aliases (ifupdown2) ──
    lo_lines = [
        "# DNS Control — Persistent loopback addresses",
        "# Generated configuration — do not edit manually",
        "",
    ]
    alias_index = 0

    # Listener IPs
    for lip in listener_ips:
        lo_lines.extend([
            f"# Listener IP",
            f"auto lo:dc{alias_index}",
            f"iface lo:dc{alias_index} inet static",
            f"    address {lip}",
            f"    netmask 255.255.255.255",
            "",
        ])
        alias_index += 1

    for plip in public_listener_ips:
        if plip not in listener_ips:
            lo_lines.extend([
                f"# Public listener IP",
                f"auto lo:dc{alias_index}",
                f"iface lo:dc{alias_index} inet static",
                f"    address {plip}",
                f"    netmask 255.255.255.255",
                "",
            ])
            alias_index += 1

    # Egress IPs (host-owned only)
    if not is_border_routed:
        for eip in egress_ips:
            if eip not in reserved and eip not in listener_ips:
                lo_lines.extend([
                    f"# Egress IP (host-owned)",
                    f"auto lo:dc{alias_index}",
                    f"iface lo:dc{alias_index} inet static",
                    f"    address {eip}",
                    f"    netmask 255.255.255.255",
                    "",
                ])
                alias_index += 1

    # VIPs (when local)
    needs_local_vip = deployment_mode in ("pseudo-anycast-local", "vip-local-dummy", "anycast-frr-ospf")
    if needs_local_vip:
        for vip in service_vips:
            if not isinstance(vip, dict):
                continue
            vip_ip = str(vip.get("ipv4", "")).strip()
            if vip_ip:
                lo_lines.extend([
                    f"# VIP: {vip.get('description', vip_ip)}",
                    f"auto lo:dc{alias_index}",
                    f"iface lo:dc{alias_index} inet static",
                    f"    address {vip_ip}",
                    f"    netmask 255.255.255.255",
                    "",
                ])
                alias_index += 1

    for vip in intercepted_vips:
        if not isinstance(vip, dict):
            continue
        vip_ip = str(vip.get("vipIp", "")).strip()
        capture_mode = str(vip.get("captureMode", "")).strip()
        if vip_ip and capture_mode == "bind":
            lo_lines.extend([
                f"# Intercepted VIP: {vip.get('description', vip_ip)} [bind]",
                f"auto lo:dc{alias_index}",
                f"iface lo:dc{alias_index} inet static",
                f"    address {vip_ip}",
                f"    netmask 255.255.255.255",
                "",
            ])
            alias_index += 1

    files.append({
        "path": "/etc/network/interfaces.d/dns-control-loopback",
        "content": "\n".join(lo_lines),
        "permissions": "0644",
        "owner": "root:root",
    })

    # ── Post-up script ──
    post_up_lines = [
        "#!/bin/sh",
        "# DNS Control — Network post-up script",
        "# Generated configuration — do not edit manually",
        "",
    ]

    # Listener IPs — ALWAYS add to loopback
    if listener_ips:
        post_up_lines.append("# === Listener IPs (MUST exist locally for Unbound interface: binding) ===")
        for lip in listener_ips:
            post_up_lines.append(f'  /usr/sbin/ip -4 addr replace {lip}/32 dev lo')
        post_up_lines.append("")

    if public_listener_ips:
        post_up_lines.append("# === Public listener IPs ===")
        for plip in public_listener_ips:
            post_up_lines.append(f'  /usr/sbin/ip -4 addr replace {plip}/32 dev lo')
        post_up_lines.append("")

    # IPv6 listener IPs
    if listener_ipv6:
        post_up_lines.append("# === Listener IPv6 IPs ===")
        for lip6 in listener_ipv6:
            post_up_lines.append(f'  /usr/sbin/ip addr replace {lip6}/128 dev lo')
        post_up_lines.append("")

    # Egress IPs
    if egress_ips:
        if is_border_routed:
            post_up_lines.append("# === Egress IPs (border-routed: NOT added to host interfaces) ===")
            for inst in instances:
                eip = str(inst.get("exitIp", "") or inst.get("egressIpv4", "")).strip()
                name = inst.get("name", "unbound")
                if eip:
                    post_up_lines.append(f'  # outgoing-interface: {eip} ({name}) — routed at border')
        else:
            post_up_lines.append("# === Egress IPs (host-owned: added to loopback) ===")
            for eip in egress_ips:
                post_up_lines.append(f'  /usr/sbin/ip -4 addr replace {eip}/32 dev lo')
        post_up_lines.append("")

    # IPv6 egress IPs (only host-owned)
    if egress_ipv6 and not is_border_routed:
        post_up_lines.append("# === Egress IPv6 IPs ===")
        for eip6 in egress_ipv6:
            post_up_lines.append(f'  /usr/sbin/ip addr replace {eip6}/128 dev lo')
        post_up_lines.append("")

    # VIP anycast IPs
    if service_vips:
        if needs_local_vip:
            post_up_lines.append("# === VIPs de serviço (local) ===")
        else:
            post_up_lines.append("# === VIPs de serviço (borda — descomentar se necessário) ===")
        for vip in service_vips:
            if not isinstance(vip, dict):
                continue
            vip_ip = str(vip.get("ipv4", "")).strip()
            if vip_ip:
                prefix = "" if needs_local_vip else "  #"
                post_up_lines.append(f'{prefix}  /usr/sbin/ip addr replace {vip_ip}/32 dev lo')
            vip_ipv6 = str(vip.get("ipv6", "")).strip()
            if vip_ipv6 and enable_ipv6:
                prefix = "" if needs_local_vip else "  #"
                post_up_lines.append(f'{prefix}  /usr/sbin/ip addr replace {vip_ipv6}/128 dev lo')
        post_up_lines.append("")

    if intercepted_vips:
        post_up_lines.append("# === Intercepted VIPs (DNS VIP Interception) ===")
        for vip in intercepted_vips:
            if not isinstance(vip, dict):
                continue
            vip_ip = str(vip.get("vipIp", "")).strip()
            capture_mode = str(vip.get("captureMode", "")).strip()
            if not vip_ip:
                continue
            if capture_mode == "bind":
                post_up_lines.append(f'  /usr/sbin/ip -4 addr replace {vip_ip}/32 dev lo')
            else:
                post_up_lines.append(f'  /usr/sbin/ip -4 route replace {vip_ip}/32 dev lo')
        post_up_lines.append("")

    post_up_lines.extend([
        "  exit 0",
    ])

    post_up_content = "\n".join(post_up_lines)

    files.append({
        "path": "/etc/network/post-up.sh",
        "content": post_up_content,
        "permissions": "0755",
        "owner": "root:root",
    })

    files.append({
        "path": "/etc/network/post-up.d/dns-control",
        "content": post_up_content,
        "permissions": "0755",
        "owner": "root:root",
    })

    return files
