"""
DNS Control — IP Blocking Generator (Blackhole Routes)
Generates sync script, systemd service/timer for AnaBlock IP blocking.
Uses `ip route add blackhole` — NOT nftables.
nftables remains exclusively for DNAT/load balancing.
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


def generate_ip_blocking_configs(payload: dict[str, Any]) -> list[dict]:
    """Generate blackhole-route-based IP blocking artifacts."""
    files: list[dict] = []

    enable_ip_blocking = payload.get("enableIpBlocking", False)
    if not enable_ip_blocking:
        return files

    wizard_cfg = payload.get("_wizardConfig", {}) or {}

    api_url = _safe_str(
        payload.get("ipBlockingApiUrl") or wizard_cfg.get("ipBlockingApiUrl"),
        "https://api.anablock.net.br",
    ).rstrip("/")
    sync_hours = _safe_int(
        payload.get("ipBlockingSyncIntervalHours") or wizard_cfg.get("ipBlockingSyncIntervalHours"), 6
    )
    auto_sync = payload.get("ipBlockingAutoSync") if payload.get("ipBlockingAutoSync") is not None else wizard_cfg.get("ipBlockingAutoSync", True)
    enable_ipv6 = payload.get("enableIpv6") or wizard_cfg.get("enableIpv6", False)
    tag = _safe_str(
        payload.get("ipBlockingRouteTag") or wizard_cfg.get("ipBlockingRouteTag"),
        "anablock",
    )
    metric = _safe_int(
        payload.get("ipBlockingRouteMetric") or wizard_cfg.get("ipBlockingRouteMetric"), 1
    )

    # ═══ IPv6 block in script ═══
    ipv6_block = ""
    if enable_ipv6:
        ipv6_block = r"""
# ═══ IPv6 Blocking ═══
BLOCK_V6_URL="${APIURL_BASE}/ipv6/block"
UNBLOCK_V6_URL="${APIURL_BASE}/ipv6/unblock"
LIST_V6="/var/lib/dns-control/anablock-ipv6-current.list"
LIST_V6_BAK="/var/lib/dns-control/anablock-ipv6-current.list.bak"
NEW_V6="/tmp/anablock-ipv6-new-$$.list"
BATCH_V6="/tmp/anablock-ipv6-batch-$$.txt"

if curl -sf --max-time 30 "$BLOCK_V6_URL" -o "$NEW_V6"; then
    # Backup
    [ -f "$LIST_V6" ] && cp "$LIST_V6" "$LIST_V6_BAK"

    # Compute diff
    touch "$LIST_V6"
    TO_ADD_V6=$(comm -13 <(sort "$LIST_V6") <(sort "$NEW_V6"))
    TO_DEL_V6=$(comm -23 <(sort "$LIST_V6") <(sort "$NEW_V6"))

    # Build batch file
    > "$BATCH_V6"
    while IFS= read -r prefix; do
        [ -z "$prefix" ] && continue
        echo "route add blackhole $prefix" >> "$BATCH_V6"
    done <<< "$TO_ADD_V6"
    while IFS= read -r prefix; do
        [ -z "$prefix" ] && continue
        echo "route del blackhole $prefix" >> "$BATCH_V6"
    done <<< "$TO_DEL_V6"

    if [ -s "$BATCH_V6" ]; then
        if ip -6 -batch "$BATCH_V6" 2>/dev/null; then
            ADDED_V6=$(echo "$TO_ADD_V6" | grep -c . || true)
            REMOVED_V6=$(echo "$TO_DEL_V6" | grep -c . || true)
            logger -t anablock-ip-sync "IPv6: +${ADDED_V6} -${REMOVED_V6} rotas blackhole"
        else
            logger -t anablock-ip-sync "ERRO: falha ao aplicar batch IPv6 — rollback"
            # Rollback: restore previous list
            if [ -f "$LIST_V6_BAK" ]; then
                cp "$LIST_V6_BAK" "$LIST_V6"
            fi
            rm -f "$NEW_V6" "$BATCH_V6"
            ERRORS=$((ERRORS + 1))
        fi
    else
        logger -t anablock-ip-sync "IPv6: sem alterações"
    fi

    # Update current list
    mv "$NEW_V6" "$LIST_V6"
    rm -f "$BATCH_V6"
else
    logger -t anablock-ip-sync "AVISO: falha ao baixar lista IPv6 — ignorando"
fi
"""

    # ═══ Sync script ═══
    sync_script = f"""#!/bin/bash
# DNS Control — AnaBlock IP Blocking Sync Script
# Sincroniza IPs bloqueados judicialmente via rotas blackhole
# Método: ip route add/del blackhole (NÃO usa nftables)
# IPv6: {"ativo" if enable_ipv6 else "desativado"}
# Gerado automaticamente — não editar manualmente

set -euo pipefail

APIURL_BASE="{api_url}"
BLOCK_V4_URL="${{APIURL_BASE}}/ipv4/block"
UNBLOCK_V4_URL="${{APIURL_BASE}}/ipv4/unblock"
VERSION_URL="${{APIURL_BASE}}/api/version"
VERSION_FILE="/var/lib/dns-control/anablock-ip-version"
LIST_V4="/var/lib/dns-control/anablock-ipv4-current.list"
LIST_V4_BAK="/var/lib/dns-control/anablock-ipv4-current.list.bak"
NEW_V4="/tmp/anablock-ipv4-new-$$.list"
BATCH_V4="/tmp/anablock-ipv4-batch-$$.txt"
ERRORS=0

# Criar diretório de estado
mkdir -p /var/lib/dns-control

# Verificar se houve atualização na base
REMOTE_VERSION=$(curl -sf --max-time 10 "$VERSION_URL" 2>/dev/null || echo "0")
LOCAL_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "0")

if [ "$REMOTE_VERSION" = "$LOCAL_VERSION" ] && [ -f "$LIST_V4" ]; then
    logger -t anablock-ip-sync "AnaBlock IP: sem alterações (versão $LOCAL_VERSION)"
    exit 0
fi

logger -t anablock-ip-sync "AnaBlock IP: atualizando $LOCAL_VERSION → $REMOTE_VERSION"

# ═══ IPv4 Blocking ═══
if curl -sf --max-time 30 "$BLOCK_V4_URL" -o "$NEW_V4"; then
    # Backup da lista anterior
    [ -f "$LIST_V4" ] && cp "$LIST_V4" "$LIST_V4_BAK"

    # Diff incremental — só altera o que mudou
    touch "$LIST_V4"
    TO_ADD=$(comm -13 <(sort "$LIST_V4") <(sort "$NEW_V4"))
    TO_DEL=$(comm -23 <(sort "$LIST_V4") <(sort "$NEW_V4"))

    # Construir batch file para ip -batch (performance)
    > "$BATCH_V4"
    while IFS= read -r prefix; do
        [ -z "$prefix" ] && continue
        echo "route add blackhole $prefix" >> "$BATCH_V4"
    done <<< "$TO_ADD"
    while IFS= read -r prefix; do
        [ -z "$prefix" ] && continue
        echo "route del blackhole $prefix" >> "$BATCH_V4"
    done <<< "$TO_DEL"

    if [ -s "$BATCH_V4" ]; then
        if ip -batch "$BATCH_V4" 2>/dev/null; then
            ADDED=$(echo "$TO_ADD" | grep -c . || true)
            REMOVED=$(echo "$TO_DEL" | grep -c . || true)
            logger -t anablock-ip-sync "IPv4: +${{ADDED}} -${{REMOVED}} rotas blackhole"
        else
            logger -t anablock-ip-sync "ERRO: falha ao aplicar batch IPv4 — rollback"
            # Rollback: restaurar lista anterior
            if [ -f "$LIST_V4_BAK" ]; then
                cp "$LIST_V4_BAK" "$LIST_V4"
                # Re-aplicar lista anterior
                ROLLBACK_BATCH="/tmp/anablock-ipv4-rollback-$$.txt"
                > "$ROLLBACK_BATCH"
                while IFS= read -r prefix; do
                    [ -z "$prefix" ] && continue
                    echo "route add blackhole $prefix" >> "$ROLLBACK_BATCH"
                done < "$LIST_V4_BAK"
                ip -batch "$ROLLBACK_BATCH" 2>/dev/null || true
                rm -f "$ROLLBACK_BATCH"
            fi
            rm -f "$NEW_V4" "$BATCH_V4"
            ERRORS=$((ERRORS + 1))
        fi
    else
        logger -t anablock-ip-sync "IPv4: sem alterações"
    fi

    # Atualizar lista corrente
    mv "$NEW_V4" "$LIST_V4"
    rm -f "$BATCH_V4"
else
    logger -t anablock-ip-sync "ERRO: falha ao baixar lista IPv4"
    rm -f "$NEW_V4"
    ERRORS=$((ERRORS + 1))
fi
{ipv6_block}
# Salvar versão
if [ "$ERRORS" -eq 0 ]; then
    echo "$REMOTE_VERSION" > "$VERSION_FILE"
    TOTAL_V4=$(wc -l < "$LIST_V4" 2>/dev/null || echo "0")
    logger -t anablock-ip-sync "AnaBlock IP: sync concluído (versão $REMOTE_VERSION, $TOTAL_V4 rotas IPv4 ativas)"
else
    logger -t anablock-ip-sync "ERRO: sync concluído com $ERRORS erro(s) — versão NÃO atualizada"
    exit 1
fi

# ═══ Saída compatível com FRR (preparação futura) ═══
# Para migrar para FRR blackhole routes:
#   vtysh -c "conf t" -c "ip route <prefix> blackhole tag {tag} {metric}"
# Lista atual em: $LIST_V4
"""

    files.append({
        "path": "/usr/local/bin/anablock-ip-sync.sh",
        "content": sync_script,
        "permissions": "0755",
        "owner": "root:root",
    })

    # ═══ Systemd service ═══
    files.append({
        "path": "/etc/systemd/system/anablock-ip-sync.service",
        "content": """[Unit]
Description=AnaBlock IP blocking sync (blackhole routes)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/anablock-ip-sync.sh
TimeoutSec=120
User=root

[Install]
WantedBy=multi-user.target
""",
        "permissions": "0644",
        "owner": "root:root",
    })

    # ═══ Systemd timer (only if autoSync) ═══
    if auto_sync:
        files.append({
            "path": "/etc/systemd/system/anablock-ip-sync.timer",
            "content": f"""[Unit]
Description=AnaBlock IP blocking sync timer

[Timer]
OnBootSec=3min
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
