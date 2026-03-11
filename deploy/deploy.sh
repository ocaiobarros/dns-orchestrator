#!/usr/bin/env bash
# =============================================================
# DNS Control — Script de Deploy Completo para Debian 13
#
# Uso:
#   chmod +x deploy.sh
#   sudo bash deploy.sh
#
# Pré-requisitos:
#   - Repositório clonado em /opt/dns-control
#   - Executar como root
# =============================================================
set -euo pipefail

# ---- Configurações ----
APP_USER="dns-control"
APP_GROUP="dns-control"
APP_ROOT="/opt/dns-control"
BACKEND_DIR="$APP_ROOT/backend"
FRONTEND_DIR="$APP_ROOT"
VENV_DIR="$BACKEND_DIR/venv"
ENV_DIR="/etc/dns-control"
ENV_FILE="$ENV_DIR/env"
SYSTEMD_FILE="/etc/systemd/system/dns-control-api.service"
NGINX_SITE="/etc/nginx/sites-available/dns-control"
NGINX_ENABLED="/etc/nginx/sites-enabled/dns-control"
DOMAIN="dnscontrol.seudominio.com.br"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
FRONTEND_BUILD_DIR="$FRONTEND_DIR/dist"
TLS_CERT="/etc/ssl/certs/dns-control/fullchain.pem"
TLS_KEY="/etc/ssl/private/dns-control/privkey.pem"

log() {
  echo ""
  echo "============================================================"
  echo "[DNS CONTROL] $1"
  echo "============================================================"
}

fail() {
  echo "[ERRO] $1" >&2
  exit 1
}

# ---- Verificações ----
[[ "${EUID}" -eq 0 ]] || fail "Execute como root."
[[ -d "$APP_ROOT" ]] || fail "Diretório $APP_ROOT não encontrado. Clone o repositório primeiro."
[[ -f "$BACKEND_DIR/requirements.txt" ]] || fail "requirements.txt não encontrado em $BACKEND_DIR."
[[ -f "$BACKEND_DIR/app/main.py" ]] || fail "FastAPI entrypoint não encontrado."

# ---- 1. Pacotes do sistema ----
log "Instalando pacotes do sistema"
apt update
apt install -y \
  python3 python3-venv python3-pip \
  nginx sqlite3 curl openssl \
  nodejs npm

# ---- 2. Usuário de serviço ----
log "Criando usuário de serviço"
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# ---- 3. Diretórios ----
log "Preparando diretórios"
mkdir -p "$ENV_DIR"
mkdir -p /var/lib/dns-control
mkdir -p /var/log/dns-control
chown -R "$APP_USER:$APP_GROUP" /var/lib/dns-control
chown -R "$APP_USER:$APP_GROUP" /var/log/dns-control
chmod 700 "$ENV_DIR"

# ---- 4. Virtualenv Python ----
log "Criando virtualenv e instalando dependências Python"
cd "$BACKEND_DIR"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip wheel
pip install -r requirements.txt

# ---- 5. Arquivo de ambiente ----
log "Criando arquivo de ambiente"
if [[ ! -f "$ENV_FILE" ]]; then
  SECRET_KEY="$(openssl rand -hex 32)"
  cat > "$ENV_FILE" <<EOF
DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db
DNS_CONTROL_SECRET_KEY=$SECRET_KEY
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=TROCAR_IMEDIATAMENTE
DNS_CONTROL_HOST=$BACKEND_HOST
DNS_CONTROL_PORT=$BACKEND_PORT
EOF
  chmod 600 "$ENV_FILE"
  echo "[AVISO] Arquivo $ENV_FILE criado. Troque a senha inicial antes de produção."
else
  echo "[INFO] $ENV_FILE já existe. Mantendo."
fi

# ---- 6. Systemd service ----
log "Criando service systemd"
cp "$APP_ROOT/deploy/systemd/dns-control-api.service" "$SYSTEMD_FILE"
systemctl daemon-reload
systemctl enable dns-control-api

# ---- 7. Build frontend ----
log "Buildando frontend"
cd "$FRONTEND_DIR"
npm install
VITE_API_URL="" npm run build
[[ -d "$FRONTEND_BUILD_DIR" ]] || fail "Build do frontend não encontrado em $FRONTEND_BUILD_DIR."

# ---- 8. nginx ----
log "Configurando nginx"
cp "$APP_ROOT/deploy/nginx/dns-control.conf" "$NGINX_SITE"

# Substituir domínio se definido
sed -i "s/dnscontrol.seudominio.com.br/$DOMAIN/g" "$NGINX_SITE"
sed -i "s|/opt/dns-control/frontend/dist|$FRONTEND_BUILD_DIR|g" "$NGINX_SITE"

ln -sf "$NGINX_SITE" "$NGINX_ENABLED"
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# ---- 9. Validar TLS ----
log "Verificando certificados TLS"
if [[ ! -f "$TLS_CERT" || ! -f "$TLS_KEY" ]]; then
  echo "[AVISO] Certificados TLS não encontrados:"
  echo "        CERT: $TLS_CERT"
  echo "        KEY:  $TLS_KEY"
  echo ""
  echo "  Para Let's Encrypt:"
  echo "    apt install -y certbot"
  echo "    certbot certonly --standalone -d $DOMAIN"
  echo ""
  echo "  Ou ajuste os caminhos no nginx:"
  echo "    $NGINX_SITE"
fi

# ---- 10. Subir serviços ----
log "Subindo serviços"
systemctl restart dns-control-api
nginx -t && systemctl restart nginx
systemctl enable nginx

# ---- 11. Health checks ----
log "Validando deploy"
sleep 2

echo "[CHECK] Backend status:"
systemctl --no-pager status dns-control-api || true

echo ""
echo "[CHECK] Health endpoint:"
curl -fsS "http://$BACKEND_HOST:$BACKEND_PORT/api/health" 2>/dev/null && echo "" || echo "[AVISO] /api/health não respondeu."

echo ""
echo "[CHECK] nginx status:"
systemctl --no-pager status nginx || true

echo ""
echo "[CHECK] Portas:"
ss -lntup | grep -E ":80|:443|:$BACKEND_PORT" || true

# ---- Conclusão ----
log "Deploy concluído"
cat <<EOF

Próximos passos:

1. Ajuste a senha inicial em:
   $ENV_FILE
   → DNS_CONTROL_INITIAL_ADMIN_PASSWORD=TROCAR_IMEDIATAMENTE

2. Ajuste o domínio em:
   $NGINX_SITE
   → server_name $DOMAIN

3. Instale certificado TLS:
   $TLS_CERT
   $TLS_KEY

4. Teste:
   curl http://127.0.0.1:$BACKEND_PORT/api/health
   https://$DOMAIN

5. Logs:
   journalctl -u dns-control-api -f
   tail -f /var/log/nginx/dns-control-error.log

EOF
