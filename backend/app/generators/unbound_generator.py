"""
DNS Control — Unbound Configuration Generator
Generates per-instance unbound.conf files in /etc/unbound/unbound.conf.d/
Also generates the master /etc/unbound/unbound.conf include file.
"""

from typing import Any


def _safe_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except Exception:
        return default


def generate_unbound_master_conf() -> dict:
    """Generate the master /etc/unbound/unbound.conf that includes per-instance configs."""
    content = """# DNS Control — Unbound master configuration
# This file only includes per-instance configurations.
# Do not edit manually — managed by DNS Control.

server:
    # Minimal server block — per-instance configs handle all settings

include: "/etc/unbound/unbound.conf.d/*.conf"
"""
    return {
        "path": "/etc/unbound/unbound.conf",
        "content": content,
        "permissions": "0644",
        "owner": "root:unbound",
    }


def generate_unbound_configs(payload: dict[str, Any]) -> list[dict]:
    files = []

    # Always generate master config
    files.append(generate_unbound_master_conf())

    instances = payload.get("instances", [])
    security = payload.get("security", {})
    egress_delivery_mode = payload.get("egressDeliveryMode", "host-owned")
    is_border_routed = egress_delivery_mode == "border-routed"

    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "127.0.0.1")
        port = _safe_int(inst.get("port", 53), 53)
        exit_ip = inst.get("exitIp", "") or inst.get("egressIpv4", "")
        control_interface = inst.get("controlInterface", "127.0.0.1")
        control_port = _safe_int(inst.get("controlPort", 8953), 8953)
        access_cidrs = security.get("allowedCidrs", ["0.0.0.0/0"])

        config = f"""# DNS Control — Unbound instance: {name}
# Generated configuration — do not edit manually
# Config path: /etc/unbound/{name}.conf
# Listener: {bind_ip}:{port}
# Control: {control_interface}:{control_port}
# Egress: {exit_ip} ({egress_delivery_mode})

server:
    verbosity: 1
    interface: {bind_ip}
    port: {port}
    do-ip4: yes
    do-ip6: no
    do-udp: yes
    do-tcp: yes
"""

        # In host-owned mode, also bind on egress IP for direct DNS queries
        if not is_border_routed and exit_ip and exit_ip != bind_ip:
            config += f"    interface: {exit_ip}  # egress IP — also listening (host-owned mode)\n"

        config += "\n    # Access control\n"
        for cidr in access_cidrs:
            config += f"    access-control: {cidr} allow\n"

        config += f"""
    # Performance
    num-threads: 4
    msg-cache-slabs: 4
    rrset-cache-slabs: 4
    infra-cache-slabs: 4
    key-cache-slabs: 4
    msg-cache-size: 128m
    rrset-cache-size: 256m
    cache-min-ttl: 60
    cache-max-ttl: 86400
    prefetch: yes
    prefetch-key: yes
    serve-expired: yes
    serve-expired-ttl: 86400

    # Security
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    use-caps-for-id: yes
    val-clean-additional: yes
    aggressive-nsec: yes

    # Logging
    log-queries: no
    log-replies: no
    log-servfail: yes
    logfile: ""
    use-syslog: yes
"""

        # Egress outgoing-interface — conditional on delivery mode
        if exit_ip and not is_border_routed:
            config += f"\n    outgoing-interface: {exit_ip}\n"
        elif exit_ip and is_border_routed:
            config += f"\n    # outgoing-interface: {exit_ip}  # SUPPRESSED — border-routed mode\n"
            config += "    # Egress identity enforced at border device (SNAT/policy/static return path)\n"
            config += "    # Unbound will use the host's default IP for recursive queries\n"

        if security.get("enableDnssec", True):
            config += """
    # DNSSEC
    auto-trust-anchor-file: "/var/lib/unbound/root.key"
"""

        config += f"""
    # Root hints
    root-hints: "/usr/share/dns/root.hints"

remote-control:
    control-enable: yes
    control-interface: {control_interface}
    control-port: {control_port}
    control-use-cert: no
"""

        files.append({
            "path": f"/etc/unbound/unbound.conf.d/{name}.conf",
            "content": config,
            "permissions": "0644",
            "owner": "root:unbound",
        })

    return files
