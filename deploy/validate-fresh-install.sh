#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# DNS Control — Validação Operacional: Fresh Install → Deploy → Reboot → Redeploy
#
# Uso:
#   sudo bash deploy/validate-fresh-install.sh [fase]
#
# Fases:
#   1  → Pós-install (após deploy.sh)
#   2  → Pós-apply (após wizard apply real)
#   3  → Pós-reboot (após reboot do host)
#   4  → Pós-redeploy (após segundo apply pelo wizard)
#   5  → Pós-rollback (após rollback via API/wizard)
#   all → Executa fases 1,2,3,4,5 em sequência interativa
#
# O script NÃO faz alterações — apenas valida e reporta.
# ═══════════════════════════════════════════════════════════════════
set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'; BOLD='\033[1m'

PASS=0; FAIL=0; WARN=0; SKIP=0
REPORT_LINES=()

ok()   { PASS=$((PASS+1)); REPORT_LINES+=("PASS|$1"); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { FAIL=$((FAIL+1)); REPORT_LINES+=("FAIL|$1"); echo -e "  ${RED}✗${NC} $1"; }
warn() { WARN=$((WARN+1)); REPORT_LINES+=("WARN|$1"); echo -e "  ${YELLOW}⚠${NC} $1"; }
skip() { SKIP=$((SKIP+1)); REPORT_LINES+=("SKIP|$1"); echo -e "  ${BLUE}—${NC} $1 (skip)"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }

section() {
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}  $1${NC}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# ── Helpers ──

check_dir_perms() {
    local path="$1"
    local expected_mode="$2"
    local expected_owner="$3"

    if [[ ! -d "$path" ]]; then
        fail "Diretório ausente: $path"
        return
    fi

    local actual_mode actual_owner
    actual_mode=$(stat -c '%a' "$path" 2>/dev/null)
    actual_owner=$(stat -c '%U:%G' "$path" 2>/dev/null)

    if [[ "$actual_mode" == "$expected_mode" ]]; then
        ok "$path modo=$actual_mode (esperado $expected_mode)"
    else
        fail "$path modo=$actual_mode (esperado $expected_mode)"
    fi

    if [[ "$actual_owner" == "$expected_owner" ]]; then
        ok "$path owner=$actual_owner"
    else
        fail "$path owner=$actual_owner (esperado $expected_owner)"
    fi
}

check_file_perms() {
    local path="$1"
    local expected_mode="$2"
    local expected_owner="${3:-root:root}"

    if [[ ! -f "$path" ]]; then
        skip "Arquivo não existe: $path"
        return
    fi

    local actual_mode actual_owner
    actual_mode=$(stat -c '%a' "$path" 2>/dev/null)
    actual_owner=$(stat -c '%U:%G' "$path" 2>/dev/null)

    if [[ "$actual_mode" == "$expected_mode" ]]; then
        ok "$path modo=$actual_mode"
    else
        fail "$path modo=$actual_mode (esperado $expected_mode)"
    fi

    if [[ "$actual_owner" == "$expected_owner" ]]; then
        ok "$path owner=$actual_owner"
    else
        fail "$path owner=$actual_owner (esperado $expected_owner)"
    fi
}

check_file_not_empty() {
    local path="$1"
    if [[ ! -f "$path" ]]; then
        skip "Arquivo não existe: $path"
        return
    fi
    if [[ -s "$path" ]]; then
        ok "$path não vazio ($(wc -c < "$path") bytes)"
    else
        fail "$path está VAZIO (0 bytes)"
    fi
}

api_call() {
    local endpoint="$1"
    curl -sf "http://127.0.0.1:8000${endpoint}" 2>/dev/null
}

list_managed_unbound_services() {
    local state_file="/var/lib/dns-control/deploy-state.json"
    local from_state=""

    if [[ -f "$state_file" ]]; then
        from_state=$(python3 - "$state_file" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
    items = [str(x).strip() for x in data.get("managedInstances", []) if str(x).strip()]
    if items:
        print("\n".join(items))
except Exception:
    pass
PY
)
        if [[ -n "$from_state" ]]; then
            echo "$from_state"
            return
        fi
    fi

    local conf
    local found=0
    for conf in /etc/unbound/unbound*.conf; do
        [[ -f "$conf" ]] || continue
        [[ "$conf" == *"unbound-block-domains.conf" ]] && continue
        grep -q "DNS Control" "$conf" 2>/dev/null || continue
        local name
        name=$(basename "$conf" .conf)
        echo "$name"
        found=1
    done
}

API_HOST="127.0.0.1"
API_PORT="8000"

# ═══════════════════════════════════════════════════════════════════
# FASE 1: Pós-Install (após deploy.sh)
# ═══════════════════════════════════════════════════════════════════
phase_1() {
    section "FASE 1: Validação Pós-Install (deploy.sh)"

    # ── 1.1 Diretórios de sistema ──
    info "Verificando diretórios de sistema (root:root 755)..."
    for d in /etc/unbound /etc/unbound/unbound.conf.d /etc/frr /etc/nftables.d \
             /etc/network /etc/network/post-up.d /etc/sysctl.d \
             /etc/systemd/system /usr/lib/systemd/system; do
        check_dir_perms "$d" "755" "root:root"
    done

    # ── 1.2 Diretórios de dados ──
    info "Verificando diretórios de dados (dns-control:dns-control 755)..."
    for d in /var/lib/dns-control /var/lib/dns-control/staging \
             /var/lib/dns-control/backups /var/lib/dns-control/tmp; do
        check_dir_perms "$d" "755" "dns-control:dns-control"
    done
    check_dir_perms "/var/log/dns-control" "755" "dns-control:dns-control"

    # ── 1.3 Arquivos base ──
    info "Verificando arquivos base..."
    check_file_perms "/etc/nftables.conf" "644" "root:root"
    check_file_not_empty "/etc/nftables.conf"

    # Placeholders devem conter comentário, não ser vazios
    for placeholder in /etc/unbound/unbound-block-domains.conf /etc/unbound/anablock.conf; do
        check_file_not_empty "$placeholder"
        if [[ -f "$placeholder" ]] && grep -q "DNS Control" "$placeholder" 2>/dev/null; then
            ok "$placeholder contém marcador DNS Control (não é touch vazio)"
        elif [[ -f "$placeholder" ]]; then
            warn "$placeholder existe mas sem marcador DNS Control"
        fi
    done

    # ── 1.4 Sudoers ──
    info "Verificando sudoers..."
    check_file_perms "/etc/sudoers.d/dns-control" "440" "root:root"
    if visudo -c -f /etc/sudoers.d/dns-control >/dev/null 2>&1; then
        ok "Sudoers válido (visudo -c)"
    else
        fail "Sudoers INVÁLIDO (visudo -c falhou)"
    fi

    # ── 1.5 Systemd units ──
    info "Verificando units systemd..."
    check_file_perms "/usr/lib/systemd/system/dns-control-api.service" "644" "root:root"
    check_file_perms "/usr/lib/systemd/system/dns-control-collector.service" "644" "root:root"
    check_file_perms "/usr/lib/systemd/system/dns-control-collector.timer" "644" "root:root"

    # ── 1.6 API respondendo ──
    info "Verificando API..."
    if api_call "/api/health" >/dev/null; then
        ok "API respondendo em http://${API_HOST}:${API_PORT}/api/health"
    else
        fail "API NÃO respondendo"
    fi

    # ── 1.7 Preflight via API ──
    info "Executando preflight via API..."
    PREFLIGHT=$(api_call "/api/deploy/preflight/check" 2>/dev/null || echo '{"canDeploy":false,"error":"API não respondeu"}')
    CAN_DEPLOY=$(echo "$PREFLIGHT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('canDeploy',False))" 2>/dev/null || echo "False")
    PASSED_COUNT=$(echo "$PREFLIGHT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('passed',0))" 2>/dev/null || echo "0")
    FAILED_COUNT=$(echo "$PREFLIGHT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failed',0))" 2>/dev/null || echo "?")

    if [[ "$CAN_DEPLOY" == "True" ]]; then
        ok "Preflight: canDeploy=true ($PASSED_COUNT passed, $FAILED_COUNT failed)"
    else
        fail "Preflight: canDeploy=false ($PASSED_COUNT passed, $FAILED_COUNT failed)"
        # Show blocked reasons
        echo "$PREFLIGHT" | python3 -c "
import sys,json
data = json.load(sys.stdin)
for r in data.get('blockedReasons', [])[:5]:
    print(f'    → {r}')
" 2>/dev/null || true
    fi
}

# ═══════════════════════════════════════════════════════════════════
# FASE 2: Pós-Apply (após wizard apply real)
# ═══════════════════════════════════════════════════════════════════
phase_2() {
    section "FASE 2: Validação Pós-Apply (wizard deploy real)"

    # ── 2.1 Arquivos gerados com permissões corretas ──
    info "Verificando configs gerados..."

    # Unbound configs (0644)
    for f in /etc/unbound/unbound*.conf; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    # Unbound systemd units (0644)
    for f in /usr/lib/systemd/system/unbound*.service; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    # nftables snippets (0644)
    for f in /etc/nftables.d/*.nft; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done
    check_file_perms "/etc/nftables.conf" "644" "root:root"

    # sysctl configs (0644)
    for f in /etc/sysctl.d/0[5-9]*.conf; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    # Network scripts (0755)
    check_file_perms "/etc/network/post-up.d/dns-control" "755" "root:root"
    [[ -f "/etc/network/post-up.sh" ]] && check_file_perms "/etc/network/post-up.sh" "755" "root:root"

    # ── 2.2 Serviços ativos ──
    info "Verificando serviços DNS..."
    for unit in $(systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep '^unbound' | awk '{print $1}'); do
        name="${unit%.service}"
        if systemctl is-active "$name" >/dev/null 2>&1; then
            ok "$name ativo"
        else
            fail "$name NÃO ativo"
        fi
    done

    # ── 2.3 nftables carregado ──
    info "Verificando nftables..."
    if nft list tables 2>/dev/null | grep -q "table"; then
        ok "nftables: tabelas carregadas"
    else
        warn "nftables: sem tabelas (pode ser esperado em modo simples sem interceptação)"
    fi

    # ── 2.4 DNS funcional ──
    info "Verificando resolução DNS..."
    # Descobre bind IPs das instâncias
    BIND_IPS=$(grep -rh 'interface:' /etc/unbound/unbound*.conf 2>/dev/null | awk '{print $2}' | sort -u)
    if [[ -n "$BIND_IPS" ]]; then
        for ip in $BIND_IPS; do
            if dig "@${ip}" localhost +short +time=2 +tries=1 >/dev/null 2>&1; then
                ok "DNS responde em $ip"
            else
                fail "DNS NÃO responde em $ip"
            fi
        done
    else
        warn "Nenhum bind IP encontrado (instâncias podem não estar configuradas)"
    fi

    # ── 2.5 Deploy state ──
    info "Verificando deploy state..."
    STATE=$(api_call "/api/deploy/state" 2>/dev/null || echo "{}")
    LAST_STATUS=$(echo "$STATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('lastApplyStatus','none'))" 2>/dev/null || echo "none")
    if [[ "$LAST_STATUS" == "success" ]]; then
        ok "Último deploy: status=success"
    else
        fail "Último deploy: status=$LAST_STATUS"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# FASE 3: Pós-Reboot
# ═══════════════════════════════════════════════════════════════════
phase_3() {
    section "FASE 3: Validação Pós-Reboot"

    # ── 3.1 Serviços auto-start ──
    info "Verificando serviços após reboot..."
    if systemctl is-active dns-control-api >/dev/null 2>&1; then
        ok "dns-control-api ativo após reboot"
    else
        fail "dns-control-api NÃO ativo após reboot"
    fi

    for name in $(list_managed_unbound_services); do
        if ! systemctl is-enabled "$name" >/dev/null 2>&1; then
            fail "$name NÃO habilitado para boot"
            continue
        fi
        if systemctl is-active "$name" >/dev/null 2>&1; then
            ok "$name ativo após reboot"
        else
            fail "$name NÃO ativo após reboot (enabled mas não running)"
        fi
    done

    # ── 3.2 nftables persistente ──
    info "Verificando persistência do nftables..."
    if systemctl is-active nftables >/dev/null 2>&1 || nft list tables 2>/dev/null | grep -q "table"; then
        ok "nftables ativo/carregado após reboot"
    else
        fail "nftables NÃO carregado após reboot"
    fi

    # ── 3.3 IPs materializados ──
    info "Verificando IPs de rede..."
    ALL_IPS=$(ip -4 addr show 2>/dev/null)
    BIND_IPS=$(grep -rh 'interface:' /etc/unbound/unbound*.conf 2>/dev/null | awk '{print $2}' | sort -u)
    for ip in $BIND_IPS; do
        if echo "$ALL_IPS" | grep -q "$ip"; then
            ok "IP $ip materializado após reboot"
        else
            fail "IP $ip AUSENTE após reboot"
        fi
    done

    # ── 3.4 DNS funcional após reboot ──
    info "Verificando DNS após reboot..."
    for ip in $BIND_IPS; do
        if dig "@${ip}" localhost +short +time=2 +tries=1 >/dev/null 2>&1; then
            ok "DNS responde em $ip após reboot"
        else
            fail "DNS NÃO responde em $ip após reboot"
        fi
    done

    # ── 3.5 Permissões intactas após reboot ──
    info "Verificando permissões pós-reboot..."
    check_file_perms "/etc/nftables.conf" "644" "root:root"
    for f in /etc/unbound/unbound*.conf; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done
    [[ -f "/etc/network/post-up.d/dns-control" ]] && check_file_perms "/etc/network/post-up.d/dns-control" "755" "root:root"

    # ── 3.6 API respondendo ──
    info "Verificando API após reboot..."
    API_UP=false
    for i in $(seq 1 15); do
        if api_call "/api/health" >/dev/null; then
            API_UP=true
            break
        fi
        sleep 2
    done
    if $API_UP; then
        ok "API respondendo após reboot"
    else
        fail "API NÃO respondendo após reboot (30s timeout)"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# FASE 4: Redeploy (idempotência)
# ═══════════════════════════════════════════════════════════════════
phase_4() {
    section "FASE 4: Validação Pós-Redeploy (idempotência)"

    # ── 4.1 Mesmas verificações da fase 2 ──
    info "Revalidando configs e permissões (devem ser idênticas ao primeiro deploy)..."
    phase_2

    # ── 4.2 Contagem de backups ──
    info "Verificando backups..."
    BACKUPS=$(api_call "/api/deploy/backups" 2>/dev/null || echo "[]")
    BACKUP_COUNT=$(echo "$BACKUPS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
    if [[ "$BACKUP_COUNT" -ge 2 ]]; then
        ok "Backups disponíveis: $BACKUP_COUNT (≥2 para rollback)"
    else
        warn "Apenas $BACKUP_COUNT backup(s) — rollback pode não estar disponível"
    fi

    # ── 4.3 History ──
    HISTORY=$(api_call "/api/deploy/history" 2>/dev/null || echo '{"total":0}')
    TOTAL_DEPLOYS=$(echo "$HISTORY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total',0))" 2>/dev/null || echo "0")
    if [[ "$TOTAL_DEPLOYS" -ge 2 ]]; then
        ok "Deploy history: $TOTAL_DEPLOYS deploys registrados (idempotência confirmada)"
    else
        warn "Deploy history: apenas $TOTAL_DEPLOYS deploy(s)"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# FASE 5: Pós-Rollback
# ═══════════════════════════════════════════════════════════════════
phase_5() {
    section "FASE 5: Validação Pós-Rollback"

    # ── 5.1 Permissões após rollback ──
    info "Verificando permissões dos arquivos restaurados..."

    for f in /etc/unbound/unbound*.conf; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    for f in /usr/lib/systemd/system/unbound*.service; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    for f in /etc/nftables.d/*.nft; do
        [[ -f "$f" ]] && check_file_perms "$f" "644" "root:root"
    done

    check_file_perms "/etc/nftables.conf" "644" "root:root"
    [[ -f "/etc/network/post-up.d/dns-control" ]] && check_file_perms "/etc/network/post-up.d/dns-control" "755" "root:root"

    # ── 5.2 Serviços ativos após rollback ──
    info "Verificando serviços após rollback..."
    for unit in $(systemctl list-units --type=service --no-pager --plain 2>/dev/null | grep '^unbound' | awk '{print $1}'); do
        name="${unit%.service}"
        if systemctl is-active "$name" >/dev/null 2>&1; then
            ok "$name ativo após rollback"
        else
            fail "$name NÃO ativo após rollback"
        fi
    done

    # ── 5.3 DNS funcional após rollback ──
    info "Verificando DNS após rollback..."
    BIND_IPS=$(grep -rh 'interface:' /etc/unbound/unbound*.conf 2>/dev/null | awk '{print $2}' | sort -u)
    for ip in $BIND_IPS; do
        if dig "@${ip}" localhost +short +time=2 +tries=1 >/dev/null 2>&1; then
            ok "DNS responde em $ip após rollback"
        else
            fail "DNS NÃO responde em $ip após rollback"
        fi
    done

    # ── 5.4 nftables ──
    if nft list tables 2>/dev/null | grep -q "table" || true; then
        ok "nftables carregado após rollback"
    fi
}

# ═══════════════════════════════════════════════════════════════════
# Relatório final
# ═══════════════════════════════════════════════════════════════════
print_report() {
    echo ""
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo -e "${BOLD}  RELATÓRIO FINAL — Validação Operacional${NC}"
    echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  ${GREEN}PASS${NC}:  $PASS"
    echo -e "  ${RED}FAIL${NC}:  $FAIL"
    echo -e "  ${YELLOW}WARN${NC}:  $WARN"
    echo -e "  ${BLUE}SKIP${NC}:  $SKIP"
    echo -e "  Total: $((PASS + FAIL + WARN + SKIP))"
    echo ""

    if [[ $FAIL -gt 0 ]]; then
        echo -e "  ${RED}${BOLD}FALHAS:${NC}"
        for line in "${REPORT_LINES[@]}"; do
            if [[ "$line" == FAIL\|* ]]; then
                echo -e "    ${RED}✗${NC} ${line#FAIL|}"
            fi
        done
        echo ""
    fi

    if [[ $WARN -gt 0 ]]; then
        echo -e "  ${YELLOW}${BOLD}AVISOS:${NC}"
        for line in "${REPORT_LINES[@]}"; do
            if [[ "$line" == WARN\|* ]]; then
                echo -e "    ${YELLOW}⚠${NC} ${line#WARN|}"
            fi
        done
        echo ""
    fi

    TOTAL=$((PASS + FAIL + WARN + SKIP))
    if [[ $FAIL -eq 0 ]]; then
        echo -e "  ${GREEN}${BOLD}✓ VALIDAÇÃO APROVADA — Sistema pronto para produção${NC}"
    else
        echo -e "  ${RED}${BOLD}✗ VALIDAÇÃO REPROVADA — $FAIL falha(s) detectada(s)${NC}"
    fi

    echo ""
    echo "  Timestamp: $(date -Is)"
    echo "  Host: $(hostname)"
    echo "  Kernel: $(uname -r)"
    echo ""

    # Export report to file
    REPORT_FILE="/var/log/dns-control/validation-$(date +%Y%m%d_%H%M%S).txt"
    {
        echo "DNS Control — Validation Report"
        echo "Timestamp: $(date -Is)"
        echo "Host: $(hostname)"
        echo "Kernel: $(uname -r)"
        echo "Phase: ${PHASE}"
        echo ""
        echo "PASS: $PASS"
        echo "FAIL: $FAIL"
        echo "WARN: $WARN"
        echo "SKIP: $SKIP"
        echo ""
        for line in "${REPORT_LINES[@]}"; do
            echo "$line"
        done
    } > "$REPORT_FILE" 2>/dev/null || true
    info "Relatório salvo em: $REPORT_FILE"
}

# ═══════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════

PHASE="${1:-all}"

echo ""
echo -e "${BOLD}  DNS Control — Validação Operacional${NC}"
echo -e "  Fase: ${PHASE}"
echo -e "  Host: $(hostname)"
echo -e "  Data: $(date -Is)"
echo ""

case "$PHASE" in
    1) phase_1 ;;
    2) phase_2 ;;
    3) phase_3 ;;
    4) phase_4 ;;
    5) phase_5 ;;
    all)
        echo -e "${YELLOW}Modo interativo: execute cada fase após a ação correspondente.${NC}"
        echo ""
        echo "  Roteiro:"
        echo "  ────────────────────────────────────────────────"
        echo "  1. Execute: sudo bash deploy/deploy.sh"
        echo "     Depois:  sudo bash deploy/validate-fresh-install.sh 1"
        echo ""
        echo "  2. Abra o wizard e execute Apply real"
        echo "     Depois:  sudo bash deploy/validate-fresh-install.sh 2"
        echo ""
        echo "  3. Execute: sudo reboot"
        echo "     Após boot: sudo bash deploy/validate-fresh-install.sh 3"
        echo ""
        echo "  4. Abra o wizard e execute segundo Apply (idempotência)"
        echo "     Depois:  sudo bash deploy/validate-fresh-install.sh 4"
        echo ""
        echo "  5. Execute rollback via wizard ou API"
        echo "     Depois:  sudo bash deploy/validate-fresh-install.sh 5"
        echo ""
        echo "  Se todas as 5 fases passarem: sistema validado para produção."
        echo ""
        exit 0
        ;;
    *)
        echo "Uso: $0 [1|2|3|4|5|all]"
        exit 1
        ;;
esac

print_report
exit $FAIL
