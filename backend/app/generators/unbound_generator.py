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

    # Global settings from payload or wizard config
    wizard_cfg = payload.get("_wizardConfig", {}) or {}

    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
    enable_blocklist = payload.get("enableBlocklist") or wizard_cfg.get("enableBlocklist", False)
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

    # Egress delivery mode — check both payload and wizard config for consistency
    egress_delivery_mode = str(
        payload.get("egressDeliveryMode")
        or wizard_cfg.get("egressDeliveryMode")
        or "host-owned"
    )
    is_border_routed = egress_delivery_mode == "border-routed"

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
        # In border-routed mode, public IPs are NOT local — skip binding
        if public_listener_ip and public_listener_ip != bind_ip and not is_border_routed:
            config += f"    interface: {public_listener_ip}  # public listener / identity (host-owned)\n"
        elif public_listener_ip and is_border_routed:
            config += f"    # interface: {public_listener_ip}  # SUPPRESSED — border-routed mode\n"

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
"""

        # ═══ Conditional blocklist includes ═══
        if enable_blocklist:
            config += "\n    include: /etc/unbound/unbound-block-domains.conf\n"
            config += "\n"

        config += f"""
#forward-zone:
#    name: "."
#    forward-addr: 8.8.8.8
#    forward-addr: 8.8.4.4

remote-control:
    control-enable: yes
    control-interface: {control_interface}
    control-port: {control_port}
    control-use-cert: "no"
"""

        # ═══ Conditional anablock include ═══
        if enable_blocklist:
            config += """
server:
    include: /etc/unbound/anablock.conf
"""

        files.append({
            "path": f"/etc/unbound/{name}.conf",
            "content": config,
            "permissions": "0644",
            "owner": "root:unbound",
        })

    # ═══ Generate blocklist placeholder files when enabled ═══
    if enable_blocklist:
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

        # ═══ AnaBlock sync script ═══
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

        # Validation block
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

        # Reload block
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

        # ═══ Systemd service (always generated) ═══
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

        # ═══ Systemd timer (only if autoSync enabled) ═══
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
