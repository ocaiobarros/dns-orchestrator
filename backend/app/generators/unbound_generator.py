"""
DNS Control — Unbound Configuration Generator
Generates per-instance unbound.conf files.
"""

from typing import Any


def _safe_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except Exception:
        return default


def generate_unbound_configs(payload: dict[str, Any]) -> list[dict]:
    files = []
    instances = payload.get("instances", [])
    security = payload.get("security", {})
    egress_delivery_mode = payload.get("egressDeliveryMode", "host-owned")

    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "127.0.0.1")
        port = _safe_int(inst.get("port", 53), 53)
        exit_ip = inst.get("exitIp", "")
        control_interface = inst.get("controlInterface", "127.0.0.1")
        control_port = _safe_int(inst.get("controlPort", 8953), 8953)
        access_cidrs = security.get("allowedCidrs", ["0.0.0.0/0"])

        config = f"""# DNS Control — Unbound instance: {name}
# Generated configuration — do not edit manually

server:
    verbosity: 1
    interface: {bind_ip}
    port: {port}
    do-ip4: yes
    do-ip6: no
    do-udp: yes
    do-tcp: yes

    # Access control
"""
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

        if exit_ip:
            config += f"\n    outgoing-interface: {exit_ip}\n"

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
