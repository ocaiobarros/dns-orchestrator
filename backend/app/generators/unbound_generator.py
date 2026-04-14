"""
DNS Control — Unbound Configuration Generator
Generates per-instance unbound configs at /etc/unbound/{name}.conf
Matches vdns-02 runtime exactly:
- verbosity: 1, statistics-interval: 20, extended-statistics: yes
- outgoing-range: 8192, outgoing-port-avoid/permit
- so-rcvbuf/sndbuf: 8m, so-reuseport: yes
- prefetch: yes, prefetch-key: yes
- msg-cache-slabs: 4, rrset-cache-slabs: 4
- use-syslog: no, module-config: "iterator"
- pidfile: /var/run/{name}.pid (per-instance)
- include: unbound-block-domains.conf
- forward-zone with forward-first: yes
- server: include: anablock.conf at end
- Standalone instances, IPv4+IPv6, per-instance remote-control
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
    """Generate inert master /etc/unbound/unbound.conf."""
    content = """# DNS Control — Unbound master configuration
# This file is inert. Each instance is started with -c /etc/unbound/{name}.conf
# Do not edit manually — managed by DNS Control.

server:

include: "/etc/unbound/unbound.conf.d/*.conf"
"""
    return {
        "path": "/etc/unbound/unbound.conf",
        "content": content,
        "permissions": "0644",
        "owner": "root:unbound",
    }


def _generate_root_hints() -> dict:
    """Generate /etc/unbound/named.cache with IANA root server hints."""
    content = """; DNS Control — Root Hints (named.cache)
; Source: https://www.internic.net/domain/named.root
; This file is managed by DNS Control. For updates:
;   wget https://www.internic.net/domain/named.root -O /etc/unbound/named.cache
;
.                        3600000      NS    A.ROOT-SERVERS.NET.
A.ROOT-SERVERS.NET.      3600000      A     198.41.0.4
A.ROOT-SERVERS.NET.      3600000      AAAA  2001:503:ba3e::2:30
.                        3600000      NS    B.ROOT-SERVERS.NET.
B.ROOT-SERVERS.NET.      3600000      A     170.247.170.2
B.ROOT-SERVERS.NET.      3600000      AAAA  2801:1b8:10::b
.                        3600000      NS    C.ROOT-SERVERS.NET.
C.ROOT-SERVERS.NET.      3600000      A     192.33.4.12
C.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:2::c
.                        3600000      NS    D.ROOT-SERVERS.NET.
D.ROOT-SERVERS.NET.      3600000      A     199.7.91.13
D.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:2d::d
.                        3600000      NS    E.ROOT-SERVERS.NET.
E.ROOT-SERVERS.NET.      3600000      A     192.203.230.10
E.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:a8::e
.                        3600000      NS    F.ROOT-SERVERS.NET.
F.ROOT-SERVERS.NET.      3600000      A     192.5.5.241
F.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:2f::f
.                        3600000      NS    G.ROOT-SERVERS.NET.
G.ROOT-SERVERS.NET.      3600000      A     192.112.36.4
G.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:12::d0d
.                        3600000      NS    H.ROOT-SERVERS.NET.
H.ROOT-SERVERS.NET.      3600000      A     198.97.190.53
H.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:1::53
.                        3600000      NS    I.ROOT-SERVERS.NET.
I.ROOT-SERVERS.NET.      3600000      A     192.36.148.17
I.ROOT-SERVERS.NET.      3600000      AAAA  2001:7fe::53
.                        3600000      NS    J.ROOT-SERVERS.NET.
J.ROOT-SERVERS.NET.      3600000      A     192.58.128.30
J.ROOT-SERVERS.NET.      3600000      AAAA  2001:503:c27::2:30
.                        3600000      NS    K.ROOT-SERVERS.NET.
K.ROOT-SERVERS.NET.      3600000      A     193.0.14.129
K.ROOT-SERVERS.NET.      3600000      AAAA  2001:7fd::1
.                        3600000      NS    L.ROOT-SERVERS.NET.
L.ROOT-SERVERS.NET.      3600000      A     199.7.83.42
L.ROOT-SERVERS.NET.      3600000      AAAA  2001:500:9f::42
.                        3600000      NS    M.ROOT-SERVERS.NET.
M.ROOT-SERVERS.NET.      3600000      A     202.12.27.33
M.ROOT-SERVERS.NET.      3600000      AAAA  2001:dc3::35
"""
    return {
        "path": "/etc/unbound/named.cache",
        "content": content,
        "permissions": "0644",
        "owner": "root:unbound",
    }


def _compute_slabs(threads: int) -> int:
    """Compute slabs as power of 2 derived from thread count."""
    if threads <= 2:
        return 2
    if threads <= 4:
        return 4
    if threads <= 8:
        return 8
    return 16


def _compute_network_address(ip: str, mask: int) -> str:
    """Compute network address from IP string and CIDR mask."""
    octets = [int(o) for o in ip.split(".")]
    ip_num = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]
    mask_bits = (0xFFFFFFFF << (32 - mask)) & 0xFFFFFFFF if mask > 0 else 0
    network = ip_num & mask_bits
    return f"{(network >> 24) & 0xFF}.{(network >> 16) & 0xFF}.{(network >> 8) & 0xFF}.{network & 0xFF}"


def _generate_access_control(payload: dict, wizard_cfg: dict) -> str:
    """Generate smart access-control from host CIDR.

    When securityProfile == 'legacy', Unbound becomes an open resolver
    (access-control: 0.0.0.0/0 allow) — security is delegated to nftables
    or the network perimeter.
    """
    security_profile = (
        payload.get("securityProfile")
        or wizard_cfg.get("securityProfile", "isp-hardened")
    )

    if security_profile == "legacy":
        lines = [
            "    # ═══ OPEN RESOLVER — Sem Proteção (Legacy) ═══",
            "    # Segurança delegada ao firewall/perímetro de rede",
            "    access-control: 0.0.0.0/0 allow",
        ]
        enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
        if enable_ipv6:
            lines.append("    access-control: ::/0 allow")
        return "\n".join(lines)

    # ── ISP Hardened: restrictive ACLs ──
    lines = ["    access-control: 127.0.0.0/8 allow"]
    ipv4_addr = payload.get("ipv4Address") or wizard_cfg.get("ipv4Address", "")
    import re
    cidr_match = re.match(r"^(\d+\.\d+\.\d+\.\d+)/(\d+)$", ipv4_addr)
    if cidr_match:
        ip, mask = cidr_match.group(1), int(cidr_match.group(2))
        net = _compute_network_address(ip, mask)
        lines.append(f"    access-control: {net}/{mask} allow")
    lines.append("    access-control: 100.64.0.0/10 allow")
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
    if enable_ipv6:
        lines.append("    access-control: ::1/128 allow")
    return "\n".join(lines)


def generate_unbound_configs(payload: dict[str, Any]) -> list[dict]:
    files = []

    # Always generate master config
    files.append(generate_unbound_master_conf())

    instances = payload.get("instances", [])
    wizard_cfg = payload.get("_wizardConfig", {}) or {}
    is_simple = payload.get("operationMode") == "simple" or wizard_cfg.get("operationMode") == "simple"

    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
    enable_blocklist = payload.get("enableBlocklist") or wizard_cfg.get("enableBlocklist", False)
    threads = _safe_int(payload.get("threads") or wizard_cfg.get("threads"), 4)
    msg_cache_size = _safe_str(payload.get("msgCacheSize") or wizard_cfg.get("msgCacheSize"), "512m")
    rrset_cache_size = _safe_str(payload.get("rrsetCacheSize") or wizard_cfg.get("rrsetCacheSize"), "512m")
    max_ttl = _safe_int(payload.get("maxTtl") or wizard_cfg.get("maxTtl"), 7200)
    cache_min_ttl = _safe_int(payload.get("cacheMinTtl") or wizard_cfg.get("cacheMinTtl"), 300)
    serve_expired = payload.get("serveExpired") if payload.get("serveExpired") is not None else wizard_cfg.get("serveExpired", True)
    serve_expired_ttl = _safe_int(payload.get("serveExpiredTtl") or wizard_cfg.get("serveExpiredTtl"), 86400)
    num_queries_per_thread = _safe_int(
        payload.get("numQueriesPerThread") or wizard_cfg.get("numQueriesPerThread"), 3200
    )

    # Dynamic slabs from threads
    slabs = _compute_slabs(threads)

    dns_identity = _safe_str(
        payload.get("dnsIdentity") or wizard_cfg.get("dnsIdentity"),
        payload.get("hostname", "67-DNS"),
    )
    dns_version = _safe_str(payload.get("dnsVersion") or wizard_cfg.get("dnsVersion"), "1.0")

    # Egress delivery mode
    egress_delivery_mode = str(
        payload.get("egressDeliveryMode")
        or wizard_cfg.get("egressDeliveryMode")
        or "host-owned"
    )
    is_border_routed = egress_delivery_mode == "border-routed"

    # Forward zone settings
    forward_addrs = payload.get("forwardAddrs") or wizard_cfg.get("forwardAddrs") or ["1.1.1.1", "1.0.0.1", "8.8.8.8", "9.9.9.9"]
    forward_first = payload.get("forwardFirst") if payload.get("forwardFirst") is not None else wizard_cfg.get("forwardFirst", False)

    # AD forward zones
    ad_forward_zones = payload.get("adForwardZones") or wizard_cfg.get("adForwardZones") or []

    # Advanced hardening options
    harden_dnssec = payload.get("hardenDnssecStripped") if payload.get("hardenDnssecStripped") is not None else wizard_cfg.get("hardenDnssecStripped", True)
    use_caps_for_id = payload.get("useCapsForId") if payload.get("useCapsForId") is not None else wizard_cfg.get("useCapsForId", False)

    # Smart access-control
    access_control_block = _generate_access_control(payload, wizard_cfg)

    # Root hints — only generate for interception mode
    if not is_simple:
        root_hints_path = _safe_str(
            payload.get("rootHintsPath") or wizard_cfg.get("rootHintsPath"),
            "/etc/unbound/named.cache",
        )
        files.append(_generate_root_hints())

    for inst in instances:
        name = inst.get("name", "unbound")
        bind_ip = inst.get("bindIp", "127.0.0.1")
        bind_ipv6 = _safe_str(inst.get("bindIpv6", ""))
        exit_ip = _safe_str(inst.get("exitIp", "") or inst.get("egressIpv4", ""))
        exit_ipv6 = _safe_str(inst.get("exitIpv6", "") or inst.get("egressIpv6", ""))
        control_interface = inst.get("controlInterface", "127.0.0.1")
        control_port = _safe_int(inst.get("controlPort", 8953), 8953)

        # ═══ BLOCK 1: server: ═══
        config = f"""server:
    verbosity: 1
    statistics-interval: 20
    extended-statistics: yes
    num-threads: {threads}

    interface: {bind_ip}
"""

        # IPv6 listener
        if enable_ipv6 and bind_ipv6:
            config += f"    interface: {bind_ipv6}\n"

        # Egress outgoing-interface
        if is_simple or not exit_ip:
            config += "\n    # outgoing-interface: não aplicável — modo recursivo simples\n"
        elif exit_ip and not is_border_routed:
            config += f"\n    outgoing-interface: {exit_ip}\n"
        elif exit_ip and is_border_routed:
            config += f"\n    # outgoing-interface: {exit_ip}  # SUPPRESSED — border-routed mode\n"

        if enable_ipv6 and exit_ipv6 and not is_border_routed and not is_simple:
            config += f"    outgoing-interface: {exit_ipv6}\n"

        config += f"""
    outgoing-range: 8192
    outgoing-port-avoid: 0-1024
    outgoing-port-permit: 1025-65535
    num-queries-per-thread: {num_queries_per_thread}

    so-rcvbuf: 8m
    so-sndbuf: 8m
    so-reuseport: yes

    msg-cache-size: {msg_cache_size}
    rrset-cache-size: {rrset_cache_size}

    msg-cache-slabs: {slabs}
    rrset-cache-slabs: {slabs}
    infra-cache-slabs: {slabs}
    key-cache-slabs: {slabs}

    prefetch: yes
    prefetch-key: yes
    serve-expired: {"yes" if serve_expired else "no"}
    serve-expired-ttl: {serve_expired_ttl}

    cache-min-ttl: {cache_min_ttl}
    cache-max-ttl: {max_ttl}
    infra-host-ttl: 60
    infra-lame-ttl: 120

    infra-cache-numhosts: 10000
    infra-cache-lame-size: 10k

    do-ip4: yes
    do-ip6: {"yes" if enable_ipv6 else "no"}
    do-udp: yes
    do-tcp: yes
    do-daemonize: yes

{access_control_block}

    username: "unbound"
    directory: "/etc/unbound"
    logfile: ""
"""

        # ═══ Query Logging — driven by observability.enableQueryLogging ═══
        obs = payload.get("observability") or wizard_cfg.get("observability") or {}
        enable_query_logging = obs.get("enableQueryLogging", True)

        if enable_query_logging:
            config += """    use-syslog: yes
    log-queries: yes
    log-replies: no
    log-servfail: yes
    log-time-ascii: yes
"""
        else:
            config += """    use-syslog: no
    log-queries: no
    log-replies: no
    log-servfail: no
"""

        config += f'    pidfile: "/var/run/{name}.pid"\n'
"""
        if is_simple:
            config += "    # root-hints: REMOVED — forward-only mode (no iterator/root recursion)\n"
        else:
            config += f'    root-hints: "{root_hints_path}"\n'

        # AD private-domain directives
        private_domains = ""
        for ad in ad_forward_zones:
            domain = ad.get("domain", "")
            servers = ad.get("dnsServers", [])
            if not domain or not servers:
                continue
            private_domains += f'    private-domain: "{domain}"\n'

        config += f"""
    identity: "{dns_identity}"
    version: "{dns_version}"
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: {"yes" if harden_dnssec else "no"}
    use-caps-for-id: {"yes" if use_caps_for_id else "no"}
    do-not-query-address: 127.0.0.1/8
    do-not-query-localhost: yes
    module-config: "iterator"

{private_domains}    local-zone: "localhost." static
    local-data: "localhost. 10800 IN NS localhost."
    local-data: "localhost. 10800 IN SOA localhost. nobody.invalid. 1 3600 1200 604800 10800"
    local-data: "localhost. 10800 IN A 127.0.0.1"

    local-zone: "127.in-addr.arpa." static
    local-data: "127.in-addr.arpa. 10800 IN NS localhost."
    local-data: "127.in-addr.arpa. 10800 IN SOA localhost. nobody.invalid. 2 3600 1200 604800 10800"
    local-data: "1.0.0.127.in-addr.arpa. 10800 IN PTR localhost."

    include: /etc/unbound/unbound-block-domains.conf
    include: /etc/unbound/anablock.conf

"""

        # ═══ BLOCK 2: remote-control: ═══
        config += f"""remote-control:
    control-enable: yes
    control-interface: {control_interface}
    control-port: {control_port}
    control-use-cert: "no"

"""

        # ═══ BLOCK 3: forward-zone: ═══
        config += 'forward-zone:\n    name: "."\n'
        for faddr in forward_addrs:
            config += f"    forward-addr: {faddr}\n"
        if forward_first and not is_simple:
            config += "    forward-first: yes\n"

        # AD forward zones
        for ad in ad_forward_zones:
            domain = ad.get("domain", "")
            servers = ad.get("dnsServers", [])
            if not domain or not servers:
                continue
            config += f'\nforward-zone:\n    name: "{domain}"\n'
            for srv in servers:
                config += f"    forward-addr: {srv}\n"
            config += f'\nforward-zone:\n    name: "_msdcs.{domain}"\n'
            for srv in servers:
                config += f"    forward-addr: {srv}\n"

        files.append({
            "path": f"/etc/unbound/{name}.conf",
            "content": config,
            "permissions": "0644",
            "owner": "root:unbound",
        })

    # Always generate blocklist placeholder files
    files.append({
        "path": "/etc/unbound/unbound-block-domains.conf",
        "content": "# DNS Control — Domain Blocklist (local/custom)\n"
                   "# Add custom local-zone directives here, one per line:\n"
                   "# local-zone: \"example-ads.com\" always_refuse\n"
                   "# local-zone: \"tracking.example.com\" always_refuse\n",
        "permissions": "0644",
        "owner": "root:unbound",
    })
    files.append({
        "path": "/etc/unbound/anablock.conf",
        "content": "# DNS Control — AnaBlock placeholder\n"
                   "# Este arquivo será populado automaticamente pelo script de sincronização.\n"
                   "# Primeira execução: systemctl start dns-control-anablock.service\n",
        "permissions": "0644",
        "owner": "root:unbound",
    })

    # AnaBlock sync script (when blocklist explicitly enabled)
    if enable_blocklist:
        blocklist_cfg = payload.get("_wizardConfig", {}) or {}
        api_url = _safe_str(
            payload.get("blocklistApiUrl") or blocklist_cfg.get("blocklistApiUrl"),
            "https://api.anablock.net.br",
        ).rstrip("/")
        blocklist_mode = _safe_str(
            payload.get("blocklistMode") or blocklist_cfg.get("blocklistMode"),
            "always_nxdomain",
        )
        cname_target = _safe_str(payload.get("blocklistCnameTarget") or blocklist_cfg.get("blocklistCnameTarget"), "")
        redirect_ipv4 = _safe_str(payload.get("blocklistRedirectIpv4") or blocklist_cfg.get("blocklistRedirectIpv4"), "")
        redirect_ipv6 = _safe_str(payload.get("blocklistRedirectIpv6") or blocklist_cfg.get("blocklistRedirectIpv6"), "")
        sync_hours = _safe_int(payload.get("blocklistSyncIntervalHours") or blocklist_cfg.get("blocklistSyncIntervalHours"), 6)
        auto_sync = payload.get("blocklistAutoSync") if payload.get("blocklistAutoSync") is not None else blocklist_cfg.get("blocklistAutoSync", True)
        validate_before = payload.get("blocklistValidateBeforeReload") if payload.get("blocklistValidateBeforeReload") is not None else blocklist_cfg.get("blocklistValidateBeforeReload", True)
        auto_reload = payload.get("blocklistAutoReload") if payload.get("blocklistAutoReload") is not None else blocklist_cfg.get("blocklistAutoReload", True)

        # Build API URL with output params
        domain_url = f"{api_url}/domains/all?output=unbound"
        if blocklist_mode == "redirect_cname" and cname_target:
            domain_url += f"&cname={cname_target}"
        elif blocklist_mode == "redirect_ip" and redirect_ipv4:
            domain_url += f"&ipv4={redirect_ipv4}"
        elif blocklist_mode == "redirect_ip_dualstack" and redirect_ipv4:
            domain_url += f"&ipv4={redirect_ipv4}"
            if redirect_ipv6:
                domain_url += f"&ipv6={redirect_ipv6}"

        validate_block = """
# Validar configuração antes de aplicar
UNBOUND_TEST="/tmp/unbound-anablock-test-$$.conf"
(
    cat /etc/unbound/unbound.conf
    echo "server:"
    cat "$CONF_TMP"
) > "$UNBOUND_TEST"

if ! unbound-checkconf "$UNBOUND_TEST" >/dev/null 2>&1; then
    logger -t anablock-sync "ERRO: configuração AnaBlock inválida — rejeitada"
    rm -f "$CONF_TMP" "$UNBOUND_TEST"
    exit 1
fi
rm -f "$UNBOUND_TEST"
""" if validate_before else "# Validação desativada pelo operador"

        reload_block = """
# Recarregar todas as instâncias Unbound
for UNIT in /usr/lib/systemd/system/unbound*.service; do
    UNIT_NAME=$(basename "$UNIT" .service)
    if systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; then
        unbound-control -c /etc/unbound/"$UNIT_NAME".conf reload 2>/dev/null || true
        logger -t anablock-sync "AnaBlock: reload $UNIT_NAME OK"
    fi
done
""" if auto_reload else "# Reload automático desativado pelo operador — reload manual necessário"

        sync_script = f"""#!/bin/bash
# DNS Control — AnaBlock Sync Script
# Sincroniza domínios bloqueados judicialmente via API AnaBlock
# Modo: {blocklist_mode}
# Validação: {"ativa" if validate_before else "desativada"}
# Auto-reload: {"ativo" if auto_reload else "desativado"}
# Gerado automaticamente — não editar manualmente

set -euo pipefail

APIURL="{domain_url}"
CONF="/etc/unbound/anablock.conf"
CONF_BAK="/etc/unbound/anablock.conf.bak"
CONF_TMP="/tmp/anablock-sync-$$.conf"
VERSION_URL="{api_url}/api/version"
VERSION_FILE="/var/lib/dns-control/anablock-version"

# Verificar se houve atualização na base
REMOTE_VERSION=$(curl -sf --max-time 10 "$VERSION_URL" 2>/dev/null || echo "0")
LOCAL_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "0")

if [ "$REMOTE_VERSION" = "$LOCAL_VERSION" ] && [ -f "$CONF" ]; then
    logger -t anablock-sync "AnaBlock: sem alterações (versão $LOCAL_VERSION)"
    exit 0
fi

logger -t anablock-sync "AnaBlock: atualizando $LOCAL_VERSION → $REMOTE_VERSION"

# Baixar nova configuração
if ! curl -sf --max-time 30 "$APIURL" -o "$CONF_TMP"; then
    logger -t anablock-sync "ERRO: falha ao baixar configuração AnaBlock"
    rm -f "$CONF_TMP"
    exit 1
fi
{validate_block}
# Backup da versão anterior
if [ -f "$CONF" ]; then
    cp "$CONF" "$CONF_BAK"
fi

# Aplicar: mover atomicamente
mv "$CONF_TMP" "$CONF"
chown root:unbound "$CONF"
chmod 0644 "$CONF"
{reload_block}
# Salvar versão
echo "$REMOTE_VERSION" > "$VERSION_FILE"
logger -t anablock-sync "AnaBlock: atualização concluída (versão $REMOTE_VERSION)"
"""
        files.append({
            "path": "/opt/dns-control/scripts/anablock-sync.sh",
            "content": sync_script,
            "permissions": "0755",
            "owner": "root:root",
        })

        files.append({
            "path": "/etc/systemd/system/anablock-sync.service",
            "content": """[Unit]
Description=AnaBlock judicial blocklist sync
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/opt/dns-control/scripts/anablock-sync.sh
TimeoutSec=120
User=root

[Install]
WantedBy=multi-user.target
""",
            "permissions": "0644",
            "owner": "root:root",
        })

        if auto_sync:
            files.append({
                "path": "/etc/systemd/system/anablock-sync.timer",
                "content": f"""[Unit]
Description=AnaBlock judicial blocklist sync timer

[Timer]
OnBootSec=2min
OnUnitActiveSec={sync_hours}h
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
""",
                "permissions": "0644",
                "owner": "root:root",
            })

    return files
