"""
DNS Control — Unbound Configuration Generator
Generates per-instance unbound configs at /etc/unbound/{name}.conf
Each systemd unit references its own config file directly.
Aligned with vdns-01 production model: standalone instances, IPv4+IPv6,
statistics, outgoing-range, local-zones, conditional blocklist, named.cache.
DNSSEC via auto-trust-anchor-file only (no inline trust-anchor).
"""

from typing import Any


def _safe_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
        return parsed if parsed > 0 else default
    except Exception:
        return default


def _safe_str(value: Any, default: str = "") -> str:
    return str(value).strip() if value else default


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

    # Global settings from payload or wizard config
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
    threads = _safe_int(payload.get("threads") or wizard_cfg.get("threads"), 4)
    msg_cache_size = _safe_str(payload.get("msgCacheSize") or wizard_cfg.get("msgCacheSize"), "512m")
    rrset_cache_size = _safe_str(payload.get("rrsetCacheSize") or wizard_cfg.get("rrsetCacheSize"), "32m")
    max_ttl = _safe_int(payload.get("maxTtl") or wizard_cfg.get("maxTtl"), 7200)
    min_ttl = _safe_int(payload.get("minTtl") or wizard_cfg.get("minTtl"), 0)
    root_hints_path = _safe_str(
        payload.get("rootHintsPath") or wizard_cfg.get("rootHintsPath"),
        "/etc/unbound/named.cache",
    )
    dns_identity = _safe_str(
        payload.get("dnsIdentity") or wizard_cfg.get("dnsIdentity"),
        payload.get("hostname", "dns-control"),
    )
    dns_version = _safe_str(payload.get("dnsVersion") or wizard_cfg.get("dnsVersion"), "1.0")
    enable_detailed_logs = payload.get("enableDetailedLogs") or wizard_cfg.get("enableDetailedLogs", False)

    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "127.0.0.1")
        bind_ipv6 = _safe_str(inst.get("bindIpv6", ""))
        public_listener_ip = _safe_str(inst.get("publicListenerIp", ""))
        port = _safe_int(inst.get("port", 53), 53)
        exit_ip = _safe_str(inst.get("exitIp", "") or inst.get("egressIpv4", ""))
        exit_ipv6 = _safe_str(inst.get("exitIpv6", "") or inst.get("egressIpv6", ""))
        control_interface = inst.get("controlInterface", "127.0.0.1")
        control_port = _safe_int(inst.get("controlPort", 8953), 8953)
        access_cidrs_v4 = security.get("allowedCidrs", ["0.0.0.0/0"])
        access_cidrs_v6 = security.get("allowedCidrsV6", ["::/0"])

        verbosity = 2 if enable_detailed_logs else 1

        config = f"""# DNS Control — Unbound instance: {name}
# Generated configuration — do not edit manually
# Config path: /etc/unbound/{name}.conf
# Listener: {bind_ip}:{port}
# Control: {control_interface}:{control_port}
# Egress IPv4: {exit_ip or '(default)'} ({egress_delivery_mode})
# Egress IPv6: {exit_ipv6 or '(default)'}

server:
    verbosity: {verbosity}
    statistics-interval: 20
    extended-statistics: yes
    num-threads: {threads}

    interface: {bind_ip}
"""

        # IPv6 listener
        if enable_ipv6 and bind_ipv6:
            config += f"    interface: {bind_ipv6}\n"

        # Public listener / public identity can coexist with private listener
        if public_listener_ip and public_listener_ip != bind_ip:
            config += f"    interface: {public_listener_ip}  # public listener / identity\n"

        # In host-owned mode, also bind on egress IP for direct DNS queries
        if not is_border_routed and exit_ip and exit_ip != bind_ip:
            config += f"\n    interface: {exit_ip}  # egress IP — also listening (host-owned mode)\n"
        if not is_border_routed and enable_ipv6 and exit_ipv6 and exit_ipv6 != bind_ipv6:
            config += f"    interface: {exit_ipv6}  # egress IPv6 — also listening (host-owned mode)\n"

        # Egress outgoing-interface
        config += "\n"
        if exit_ip and not is_border_routed:
            config += f"    outgoing-interface: {exit_ip}\n"
        elif exit_ip and is_border_routed:
            config += f"    # outgoing-interface: {exit_ip}  # SUPPRESSED — border-routed mode\n"

        if enable_ipv6 and exit_ipv6 and not is_border_routed:
            config += f"    outgoing-interface: {exit_ipv6}\n"
        elif enable_ipv6 and exit_ipv6 and is_border_routed:
            config += f"    # outgoing-interface: {exit_ipv6}  # SUPPRESSED — border-routed\n"

        config += f"""
    outgoing-range: 512
    num-queries-per-thread: 3200

    msg-cache-size: {msg_cache_size}
    rrset-cache-size: {rrset_cache_size}

    msg-cache-slabs: {threads}
    rrset-cache-slabs: {threads}

    cache-max-ttl: {max_ttl}
    cache-min-ttl: {min_ttl}
    infra-host-ttl: 60
    infra-lame-ttl: 120

    infra-cache-numhosts: 10000
    infra-cache-lame-size: 10k
    infra-cache-slabs: {threads}
    key-cache-slabs: {threads}

    do-ip4: yes
    do-ip6: {"yes" if enable_ipv6 else "no"}
    do-udp: yes
    do-tcp: yes
    do-daemonize: yes

"""

        # Access control
        for cidr in access_cidrs_v4:
            config += f"    access-control: {cidr} allow\n"
        if enable_ipv6:
            for cidr in access_cidrs_v6:
                config += f"    access-control: {cidr} allow\n"

        config += f"""
    username: "unbound"
    directory: "/etc/unbound"
    logfile: ""
    use-syslog: no
    pidfile: "/var/run/{name}.pid"
    root-hints: "{root_hints_path}"

    identity: "{dns_identity}"
    version: "{dns_version}"
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    do-not-query-address: 127.0.0.1/8
    do-not-query-localhost: yes
    module-config: "iterator"

    #zone localhost
    local-zone: "localhost." static
    local-data: "localhost. 10800 IN NS localhost."
    local-data: "localhost. 10800 IN SOA localhost. nobody.invalid. 1 3600 1200 604800 10800"
    local-data: "localhost. 10800 IN A 127.0.0.1"

    local-zone: "127.in-addr.arpa." static
    local-data: "127.in-addr.arpa. 10800 IN NS localhost."
    local-data: "127.in-addr.arpa. 10800 IN SOA localhost. nobody.invalid. 2 3600 1200 604800 10800"
    local-data: "1.0.0.127.in-addr.arpa. 10800 IN PTR localhost."

    include: /etc/unbound/unbound-block-domains.conf

#forward-zone:
#    name: "."
#    forward-addr: 8.8.8.8
#    forward-addr: 8.8.4.4

remote-control:
    control-enable: yes
    control-interface: {control_interface}
    control-port: {control_port}
    control-use-cert: "no"

server:
    include: /etc/unbound/anablock.conf
"""

        files.append({
            "path": f"/etc/unbound/{name}.conf",
            "content": config,
            "permissions": "0644",
            "owner": "root:unbound",
        })

    return files
