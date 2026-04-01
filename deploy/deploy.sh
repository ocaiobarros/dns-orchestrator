#!/usr/bin/env bash
# =============================================================
# DNS Control v2.1 — Instalador Idempotente para Debian 12/13
#
# Uso:
#   git clone <repositório> /opt/dns-control
#   cd /opt/dns-control
#   sudo bash deploy/deploy.sh
#
# Pode ser executado múltiplas vezes sem quebrar o sistema.
# =============================================================
set -euo pipefail

# ── Cores e helpers ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }

step() {
    CURRENT_STEP=$((CURRENT_STEP + 1))
    echo ""
    echo "════════════════════════════════════════════"
    echo "  [${CURRENT_STEP}/${TOTAL_STEPS}] $1"
    echo "════════════════════════════════════════════"
}

abort() {
    fail "$1"
    echo ""
    echo -e "  ${RED}Instalação abortada. Corrija o problema e execute novamente.${NC}"
    echo "  Log: ${INSTALL_LOG}"
    exit 1
}

# ── Constantes ──
TOTAL_STEPS=12
CURRENT_STEP=0
APP_USER="dns-control"
APP_ROOT="/opt/dns-control"
BACKEND_DIR="${APP_ROOT}/backend"
VENV_DIR="${BACKEND_DIR}/venv"
DATA_DIR="/var/lib/dns-control"
ENV_DIR="/etc/dns-control"
ENV_FILE="${ENV_DIR}/env"
DB_PATH="${DATA_DIR}/dns-control.db"
LOG_DIR="/var/log/dns-control"
INSTALL_LOG="${LOG_DIR}/install.log"
TELEMETRY_DIR="${DATA_DIR}/telemetry"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
ERRORS=0

# ── Verificações iniciais ──
[[ "${EUID}" -eq 0 ]] || abort "Execute como root: sudo bash deploy/deploy.sh"
[[ -d "${APP_ROOT}" ]] || abort "Diretório ${APP_ROOT} não encontrado. Clone o repositório primeiro."
[[ -f "${BACKEND_DIR}/requirements.txt" ]] || abort "requirements.txt não encontrado em ${BACKEND_DIR}."
[[ -f "${BACKEND_DIR}/app/main.py" ]] || abort "FastAPI entrypoint não encontrado em ${BACKEND_DIR}/app/main.py."

# Criar log dir cedo
mkdir -p "${LOG_DIR}"
echo "── DNS Control Install $(date -Is) ──" >> "${INSTALL_LOG}"

echo ""
echo "  DNS Control v2.1 — Instalador Idempotente"
echo "  Raiz: ${APP_ROOT}"
echo ""

# ═══════════════════════════════════════════════════════════════
step "Atualizando sistema e instalando pacotes"
# ═══════════════════════════════════════════════════════════════

apt-get update -qq >> "${INSTALL_LOG}" 2>&1

PACKAGES=(
    python3 python3-venv python3-pip
    nodejs npm
    nginx
    unbound
    nftables
    frr
    ifupdown2
    sqlite3
    dnsutils
    curl
    sudo
    openssl
)

apt-get install -y -qq "${PACKAGES[@]}" >> "${INSTALL_LOG}" 2>&1 \
    && ok "Pacotes instalados" \
    || abort "Falha na instalação de pacotes (ver ${INSTALL_LOG})"

# ═══════════════════════════════════════════════════════════════
step "Criando usuário de serviço"
# ═══════════════════════════════════════════════════════════════

if id -u "${APP_USER}" >/dev/null 2>&1; then
    ok "Usuário '${APP_USER}' já existe"
else
    useradd --system --shell /usr/sbin/nologin --home-dir "${APP_ROOT}" "${APP_USER}"
    ok "Usuário '${APP_USER}' criado"
fi

# ═══════════════════════════════════════════════════════════════
step "Criando diretórios"
# ═══════════════════════════════════════════════════════════════

mkdir -p "${DATA_DIR}"/{backups,generated,staging,deployments,telemetry}
mkdir -p "${LOG_DIR}"
mkdir -p "${ENV_DIR}"
mkdir -p /etc/unbound/unbound.conf.d
mkdir -p /etc/nftables.d
mkdir -p /etc/network/post-up.d
mkdir -p /etc/sysctl.d
mkdir -p /etc/frr
mkdir -p /etc/default

chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${LOG_DIR}"
chmod 700 "${ENV_DIR}"
ok "Diretórios criados e permissões aplicadas"

# ═══════════════════════════════════════════════════════════════
step "Configurando virtualenv Python"
# ═══════════════════════════════════════════════════════════════

if [[ -x "${VENV_DIR}/bin/python" ]] && "${VENV_DIR}/bin/python" --version >/dev/null 2>&1; then
    info "Virtualenv existente detectado — atualizando dependências"
else
    python3 -m venv --clear "${VENV_DIR}" >> "${INSTALL_LOG}" 2>&1
    ok "Virtualenv criado"
fi

"${VENV_DIR}/bin/pip" install --upgrade pip wheel -q >> "${INSTALL_LOG}" 2>&1
"${VENV_DIR}/bin/pip" install -r "${BACKEND_DIR}/requirements.txt" -q >> "${INSTALL_LOG}" 2>&1 \
    || abort "Falha ao instalar dependências Python"

# Validar binários críticos
[[ -x "${VENV_DIR}/bin/uvicorn" ]] || abort "uvicorn não encontrado no venv"
"${VENV_DIR}/bin/uvicorn" --version >/dev/null 2>&1 || abort "uvicorn presente mas não executável"
ok "Dependências Python instaladas (uvicorn validado)"

# ═══════════════════════════════════════════════════════════════
step "Configurando arquivo de ambiente"
# ═══════════════════════════════════════════════════════════════

if [[ -f "${ENV_FILE}" ]]; then
    ok "Arquivo ${ENV_FILE} já existe — preservando"
else
    SECRET_KEY="$(openssl rand -hex 32)"

    if [[ -n "${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-}" ]]; then
        ADMIN_PASS="${DNS_CONTROL_INITIAL_ADMIN_PASSWORD}"
    else
        ADMIN_PASS="$(openssl rand -base64 12)"
        warn "Senha admin gerada: ${ADMIN_PASS}"
        warn "SALVE ESTA SENHA — não será exibida novamente"
    fi

    cat > "${ENV_FILE}" <<EOF
DNS_CONTROL_DB_PATH=${DB_PATH}
DNS_CONTROL_SECRET_KEY=${SECRET_KEY}
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=${ADMIN_PASS}
DNS_CONTROL_HOST=${BACKEND_HOST}
DNS_CONTROL_PORT=${BACKEND_PORT}
COLLECTOR_OUTPUT_DIR=${TELEMETRY_DIR}
EOF

    chmod 600 "${ENV_FILE}"
    ok "Arquivo de ambiente criado em ${ENV_FILE}"
fi

# ═══════════════════════════════════════════════════════════════
step "Inicializando banco de dados"
# ═══════════════════════════════════════════════════════════════

set -a; source "${ENV_FILE}"; set +a

if (cd "${BACKEND_DIR}" && "${VENV_DIR}/bin/python" -c "from app.core.database import init_db; init_db()" >> "${INSTALL_LOG}" 2>&1); then
    ok "Banco inicializado em ${DB_PATH}"
else
    abort "Falha ao inicializar banco de dados"
fi

chmod 600 "${DB_PATH}" 2>/dev/null || true

# ═══════════════════════════════════════════════════════════════
step "Build do frontend"
# ═══════════════════════════════════════════════════════════════

if [[ -f "${APP_ROOT}/dist/index.html" ]]; then
    info "Build anterior encontrado — reconstruindo"
fi

if [[ -f "${APP_ROOT}/package.json" ]]; then
    cd "${APP_ROOT}"
    npm install --ignore-scripts >> "${INSTALL_LOG}" 2>&1 && ok "npm install concluído" || abort "npm install falhou"
    VITE_API_URL="" npm run build >> "${INSTALL_LOG}" 2>&1 && ok "Frontend compilado" || abort "npm run build falhou"
    [[ -f "${APP_ROOT}/dist/index.html" ]] || abort "dist/index.html não encontrado após build"
    cd - >/dev/null
else
    warn "package.json não encontrado — modo API-only"
fi

# ═══════════════════════════════════════════════════════════════
step "Configurando permissões e sudoers"
# ═══════════════════════════════════════════════════════════════

chown -R "${APP_USER}:${APP_USER}" "${APP_ROOT}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${LOG_DIR}"
chown "${APP_USER}:${APP_USER}" /etc/nftables.d 2>/dev/null || true

# Instalar sudoers do repositório (fonte de verdade única)
SUDOERS_SRC="${APP_ROOT}/deploy/sudoers/dns-control-diagnostics"
if [[ -f "${SUDOERS_SRC}" ]]; then
    cp "${SUDOERS_SRC}" /etc/sudoers.d/dns-control-diagnostics
    chmod 440 /etc/sudoers.d/dns-control-diagnostics
    cp "${SUDOERS_SRC}" /etc/sudoers.d/dns-control
    chmod 440 /etc/sudoers.d/dns-control

    if visudo -c -f /etc/sudoers.d/dns-control >/dev/null 2>&1; then
        ok "Sudoers instalado e validado"
    else
        abort "Validação do sudoers falhou — CRÍTICO"
    fi
else
    abort "Arquivo sudoers não encontrado: ${SUDOERS_SRC}"
fi

# ═══════════════════════════════════════════════════════════════
step "Configurando nginx"
# ═══════════════════════════════════════════════════════════════

NGINX_SRC="${APP_ROOT}/deploy/nginx/dns-control.conf"
NGINX_DEST="/etc/nginx/sites-available/dns-control"

if [[ -f "${NGINX_SRC}" ]]; then
    cp "${NGINX_SRC}" "${NGINX_DEST}"
    ln -sf "${NGINX_DEST}" /etc/nginx/sites-enabled/dns-control
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

    # Validar que o SPA fallback está presente
    if grep -q "try_files.*index.html" "${NGINX_DEST}"; then
        ok "nginx configurado (SPA fallback presente)"
    else
        warn "SPA fallback não detectado no nginx — rotas como /dns podem não funcionar"
    fi

    nginx -t >> "${INSTALL_LOG}" 2>&1 || abort "nginx -t falhou — configuração inválida"
else
    abort "Configuração nginx não encontrada: ${NGINX_SRC}"
fi

# ═══════════════════════════════════════════════════════════════
step "Configurando nftables"
# ═══════════════════════════════════════════════════════════════

# Garantir que o arquivo de configuração base existe
if [[ ! -f "/etc/nftables.conf" ]]; then
    cat > /etc/nftables.conf <<'NFTEOF'
#!/usr/sbin/nft -f
flush ruleset
include "/etc/nftables.d/*.nft"
NFTEOF
    chmod 0644 /etc/nftables.conf
    ok "nftables.conf base criado"
else
    ok "nftables.conf já existe"
fi

systemctl enable nftables >> "${INSTALL_LOG}" 2>&1 || true
ok "nftables habilitado para persistência"

# ═══════════════════════════════════════════════════════════════
step "Configurando serviços systemd"
# ═══════════════════════════════════════════════════════════════

# Preparar placeholders necessários antes do start
touch /etc/unbound/unbound-block-domains.conf 2>/dev/null || true
touch /etc/unbound/anablock.conf 2>/dev/null || true
chown "${APP_USER}:${APP_USER}" /etc/unbound/unbound-block-domains.conf 2>/dev/null || true
chown "${APP_USER}:${APP_USER}" /etc/unbound/anablock.conf 2>/dev/null || true

# Mascarar unbound padrão para evitar conflito na porta 53
if systemctl is-active unbound.service >/dev/null 2>&1; then
    systemctl stop unbound.service 2>/dev/null || true
fi
systemctl disable unbound.service 2>/dev/null || true
systemctl mask unbound.service 2>/dev/null || true
info "unbound.service padrão mascarado (DNS Control gerencia instâncias próprias)"

# ── API service ──
API_UNIT_SRC="${APP_ROOT}/deploy/systemd/dns-control-api.service"
if [[ -f "${API_UNIT_SRC}" ]]; then
    cp "${API_UNIT_SRC}" /usr/lib/systemd/system/dns-control-api.service
    rm -f /etc/systemd/system/dns-control-api.service 2>/dev/null || true
    ok "dns-control-api.service instalado"
else
    abort "Unit file não encontrado: ${API_UNIT_SRC}"
fi

# ── Collector service + timer ──
COLLECTOR_SVC="${APP_ROOT}/deploy/systemd/dns-control-collector.service"
COLLECTOR_TMR="${APP_ROOT}/deploy/systemd/dns-control-collector.timer"
if [[ -f "${COLLECTOR_SVC}" ]] && [[ -f "${COLLECTOR_TMR}" ]]; then
    cp "${COLLECTOR_SVC}" /usr/lib/systemd/system/dns-control-collector.service
    cp "${COLLECTOR_TMR}" /usr/lib/systemd/system/dns-control-collector.timer
    rm -f /etc/systemd/system/dns-control-collector.service /etc/systemd/system/dns-control-collector.timer 2>/dev/null || true
    ok "dns-control-collector units instalados"
else
    abort "Units do collector não encontrados em deploy/systemd/"
fi

# ── Instalar script do collector ──
mkdir -p "${APP_ROOT}/collector"
if [[ -f "${APP_ROOT}/collector/collector.py" ]]; then
    ok "Collector script já presente"
elif [[ -f "${BACKEND_DIR}/collector/collector.py" ]]; then
    cp "${BACKEND_DIR}/collector/collector.py" "${APP_ROOT}/collector/collector.py"
    cp "${BACKEND_DIR}/collector/config.json" "${APP_ROOT}/collector/config.json" 2>/dev/null || true
    ok "Collector script instalado"
else
    warn "Collector script não encontrado — telemetria pode não funcionar"
fi

# ── Reload e ativação ──
systemctl daemon-reload

# ═══════════════════════════════════════════════════════════════
step "Iniciando serviços"
# ═══════════════════════════════════════════════════════════════

# nginx
systemctl enable nginx >> "${INSTALL_LOG}" 2>&1
systemctl restart nginx >> "${INSTALL_LOG}" 2>&1 && ok "nginx ativo" || { fail "nginx falhou ao iniciar"; ERRORS=$((ERRORS+1)); }

# nftables
systemctl restart nftables >> "${INSTALL_LOG}" 2>&1 || true

# API
systemctl enable dns-control-api >> "${INSTALL_LOG}" 2>&1
systemctl restart dns-control-api >> "${INSTALL_LOG}" 2>&1

# Collector timer
systemctl enable dns-control-collector.timer >> "${INSTALL_LOG}" 2>&1
systemctl start dns-control-collector.timer >> "${INSTALL_LOG}" 2>&1
ok "Collector timer ativado"

# Aguardar API subir
info "Aguardando API responder..."
API_UP=false
for i in $(seq 1 20); do
    if curl -sf "http://${BACKEND_HOST}:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
        API_UP=true
        break
    fi
    sleep 1
done

if ${API_UP}; then
    ok "API respondendo em http://${BACKEND_HOST}:${BACKEND_PORT}"
else
    fail "API não respondeu em 20 segundos"
    echo "  Logs: journalctl -u dns-control-api --no-pager -n 30"
    journalctl -u dns-control-api --no-pager -n 15 2>/dev/null || true
    ERRORS=$((ERRORS+1))
fi

# ═══════════════════════════════════════════════════════════════
step "Validações pós-instalação"
# ═══════════════════════════════════════════════════════════════

CHECKS_PASS=0
CHECKS_FAIL=0

check() {
    local desc="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        ok "${desc}"
        CHECKS_PASS=$((CHECKS_PASS+1))
    else
        fail "${desc}"
        CHECKS_FAIL=$((CHECKS_FAIL+1))
    fi
}

check "dns-control-api ativo"              systemctl is-active --quiet dns-control-api
check "dns-control-collector.timer ativo"   systemctl is-active --quiet dns-control-collector.timer
check "nginx ativo"                         systemctl is-active --quiet nginx
check "nftables ativo"                      systemctl is-active --quiet nftables
check "API /health responde"                curl -sf "http://${BACKEND_HOST}:${BACKEND_PORT}/api/health"
check "Banco de dados acessível"            test -f "${DB_PATH}"
check "Frontend dist/index.html existe"     test -f "${APP_ROOT}/dist/index.html"
check "Sudoers validado"                    visudo -c -f /etc/sudoers.d/dns-control

# Unbound pode não estar ativo ainda (DNS Control gerencia)
if systemctl is-active --quiet unbound 2>/dev/null; then
    ok "unbound ativo"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    info "unbound inativo (será gerenciado via Wizard)"
fi

# DNS resolution (pode falhar em VM limpa sem upstream configurado)
if dig @127.0.0.1 google.com +short +time=3 +tries=1 2>/dev/null | grep -q '^[0-9]'; then
    ok "Resolução DNS funcional"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    info "Resolução DNS ainda não funcional (configure via Wizard)"
fi

# Verificar se collector já produziu dados
sleep 2
if [[ -f "${TELEMETRY_DIR}/latest.json" ]]; then
    ok "Telemetria: latest.json presente"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    info "Telemetria: latest.json ainda não gerado (aguarde ~10s)"
fi

# ═══════════════════════════════════════════════════════════════
# Resumo final
# ═══════════════════════════════════════════════════════════════

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL_CHECKS=$((CHECKS_PASS + CHECKS_FAIL))
if [[ ${CHECKS_FAIL} -eq 0 ]] && [[ ${ERRORS} -eq 0 ]]; then
    echo -e "  ${GREEN}DNS Control v2.1 — Instalação Concluída${NC}"
    echo -e "  ${GREEN}Todas as validações passaram (${CHECKS_PASS}/${TOTAL_CHECKS})${NC}"
else
    echo -e "  ${YELLOW}DNS Control v2.1 — Instalação Concluída (com alertas)${NC}"
    echo -e "  Validações: ${GREEN}${CHECKS_PASS} ok${NC}, ${RED}${CHECKS_FAIL} falhas${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Dashboard:  http://<IP_DO_SERVIDOR>"
echo "  API:        http://${BACKEND_HOST}:${BACKEND_PORT}/api/health"
echo "  Métricas:   http://${BACKEND_HOST}:${BACKEND_PORT}/metrics"
echo "  Swagger:    http://${BACKEND_HOST}:${BACKEND_PORT}/docs"
echo "  Config:     ${ENV_FILE}"
echo "  Banco:      ${DB_PATH}"
echo "  Logs:       journalctl -u dns-control-api -f"
echo ""
echo "  Próximos passos:"
echo "    1. Acesse o dashboard e faça login como admin"
echo "    2. Execute o Wizard de Configuração"
echo "    3. Após o Wizard, o DNS e as métricas estarão operacionais"
echo ""
if [[ ${ERRORS} -gt 0 ]] || [[ ${CHECKS_FAIL} -gt 0 ]]; then
    echo -e "  ${RED}⚠ Revise os erros acima antes de prosseguir${NC}"
    echo "  Log completo: ${INSTALL_LOG}"
    echo ""
fi
