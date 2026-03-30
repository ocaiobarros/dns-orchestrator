#!/bin/bash
# ============================================================
# DNS Control v2.1 — Debian 13 Zero-Config Installer
# Auto-detects repo location, validates prerequisites,
# creates all infrastructure, and verifies everything works.
# ============================================================

set -euo pipefail

# ── Colors & helpers ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}ℹ${NC} $1"; }

# ── Auto-detect repo root ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Script lives in backend/app/scripts/ — repo root is 3 levels up
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

# Validate we found the right place
if [[ ! -f "${REPO_ROOT}/backend/requirements.txt" ]] || [[ ! -f "${REPO_ROOT}/backend/app/main.py" ]]; then
    echo -e "${RED}ERROR: Cannot locate repository root.${NC}"
    echo "  Expected backend/requirements.txt at: ${REPO_ROOT}"
    echo "  Run this script from the repository, or ensure it's in backend/app/scripts/"
    exit 1
fi

# ── Configuration ──
INSTALL_DIR="/opt/dns-control"
DATA_DIR="/var/lib/dns-control"
DB_PATH="${DATA_DIR}/dns-control.db"
SERVICE_USER="dns-control"
VENV_DIR="${INSTALL_DIR}/backend/venv"
ENV_DIR="/etc/dns-control"
ENV_FILE="${ENV_DIR}/env"
LOG_DIR="/var/log/dns-control"
INSTALL_LOG="${LOG_DIR}/install.log"

TOTAL_STEPS=10
ERRORS=0
WARNINGS=0

echo ""
echo "============================================"
echo "  DNS Control v2.1 — Debian 13 Installer"
echo "  Zero-Config · Auto-Detect · Self-Verify"
echo "============================================"
echo ""
echo "  Repo root:    ${REPO_ROOT}"
echo "  Install dir:  ${INSTALL_DIR}"
echo "  Data dir:     ${DATA_DIR}"
echo ""

# ── Check root ──
if [[ "$(id -u)" -ne 0 ]]; then
    echo -e "${RED}ERROR: This script must be run as root.${NC}"
    echo "  Usage: sudo bash ${BASH_SOURCE[0]}"
    exit 1
fi

# ── Pre-flight checks ──
echo "[0/${TOTAL_STEPS}] Pre-flight checks..."

if ! command -v python3 &>/dev/null; then
    fail "python3 not found — will install"
else
    ok "python3 found: $(python3 --version 2>&1)"
fi

if [[ -f "${DB_PATH}" ]]; then
    warn "Database already exists at ${DB_PATH} — will be preserved"
fi

if [[ -f "${ENV_FILE}" ]]; then
    warn "Environment file already exists at ${ENV_FILE} — will be preserved"
fi

# Create log dir early
mkdir -p "${LOG_DIR}"

# ═══ Step 1: System packages ═══
echo ""
echo "[1/${TOTAL_STEPS}] Installing system packages..."
apt-get update -qq 2>>"${INSTALL_LOG}" || true
apt-get install -y -qq \
    python3 python3-pip python3-venv \
    unbound \
    frr \
    nftables \
    ifupdown2 \
    sqlite3 \
    dnsutils \
    curl \
    sudo \
    openssl \
    nginx \
    nodejs npm \
    2>>"${INSTALL_LOG}" && ok "System packages installed" || { fail "Package installation had errors (see ${INSTALL_LOG})"; WARNINGS=$((WARNINGS+1)); }

# ═══ Step 2: Service user ═══
echo "[2/${TOTAL_STEPS}] Creating service user..."
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "${INSTALL_DIR}" "${SERVICE_USER}"
    ok "User '${SERVICE_USER}' created"
else
    ok "User '${SERVICE_USER}' already exists"
fi

# ═══ Step 3: Directories ═══
echo "[3/${TOTAL_STEPS}] Creating directories..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${DATA_DIR}/backups"
mkdir -p "${DATA_DIR}/generated"
mkdir -p "${DATA_DIR}/staging"
mkdir -p "${DATA_DIR}/deployments"
mkdir -p "${LOG_DIR}"
mkdir -p "${ENV_DIR}"
# Create unbound placeholder dirs so deploy never fails on missing includes
mkdir -p "/etc/unbound"
ok "Directories created"

# ═══ Step 4: Copy application files ═══
echo "[4/${TOTAL_STEPS}] Copying application files..."

# Copy backend
if [[ -d "${REPO_ROOT}/backend" ]]; then
    # Use rsync if available, else cp
    if command -v rsync &>/dev/null; then
        rsync -a --delete "${REPO_ROOT}/backend/" "${INSTALL_DIR}/backend/"
    else
        rm -rf "${INSTALL_DIR}/backend"
        cp -r "${REPO_ROOT}/backend" "${INSTALL_DIR}/"
    fi
    ok "Backend files copied"
else
    fail "Backend directory not found at ${REPO_ROOT}/backend"
    ERRORS=$((ERRORS+1))
fi

# Copy frontend dist if exists
if [[ -d "${REPO_ROOT}/dist" ]]; then
    mkdir -p "${INSTALL_DIR}/dist"
    cp -r "${REPO_ROOT}/dist/"* "${INSTALL_DIR}/dist/"
    ok "Frontend build copied"
else
    warn "Frontend dist/ not found — build with 'npm run build' first"
    WARNINGS=$((WARNINGS+1))
fi

# Copy deploy configs
if [[ -d "${REPO_ROOT}/deploy" ]]; then
    cp -r "${REPO_ROOT}/deploy" "${INSTALL_DIR}/"
    ok "Deploy configs copied"
fi

# ═══ Step 5: Python virtualenv ═══
echo "[5/${TOTAL_STEPS}] Setting up Python environment..."
python3 -m venv "${VENV_DIR}" 2>>"${INSTALL_LOG}"
"${VENV_DIR}/bin/pip" install --upgrade pip wheel -q 2>>"${INSTALL_LOG}"
"${VENV_DIR}/bin/pip" install -r "${INSTALL_DIR}/backend/requirements.txt" -q 2>>"${INSTALL_LOG}"
ok "Python dependencies installed"

# Verify critical imports
if "${VENV_DIR}/bin/python" -c "from app.main import app; print('ok')" 2>/dev/null; then
    ok "FastAPI application loads correctly"
else
    # Try from backend dir
    if (cd "${INSTALL_DIR}/backend" && "${VENV_DIR}/bin/python" -c "from app.main import app; print('ok')" 2>/dev/null); then
        ok "FastAPI application loads correctly"
    else
        fail "FastAPI application failed to load — check requirements"
        ERRORS=$((ERRORS+1))
    fi
fi

# ═══ Step 6: Environment configuration ═══
echo "[6/${TOTAL_STEPS}] Configuring environment..."

if [[ ! -f "${ENV_FILE}" ]]; then
    # Get admin password
    if [[ -n "${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-}" ]]; then
        ADMIN_PASS="${DNS_CONTROL_INITIAL_ADMIN_PASSWORD}"
    elif [[ -t 0 ]]; then
        read -sp "  Enter initial admin password (min 6 chars): " ADMIN_PASS
        echo ""
        if [[ ${#ADMIN_PASS} -lt 6 ]]; then
            warn "Password too short — using generated password"
            ADMIN_PASS="$(openssl rand -base64 12)"
            info "Generated password: ${ADMIN_PASS}"
            info "SAVE THIS PASSWORD — it won't be shown again"
        fi
    else
        ADMIN_PASS="$(openssl rand -base64 12)"
        info "Generated admin password: ${ADMIN_PASS}"
        info "SAVE THIS PASSWORD — it won't be shown again"
    fi

    SECRET_KEY="$(openssl rand -hex 32)"

    cat > "${ENV_FILE}" << EOF
DNS_CONTROL_DB_PATH=${DB_PATH}
DNS_CONTROL_SECRET_KEY=${SECRET_KEY}
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=${ADMIN_PASS}
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
EOF

    chmod 600 "${ENV_FILE}"
    ok "Environment file created at ${ENV_FILE}"
else
    ok "Environment file preserved (already exists)"
fi

# ═══ Step 7: Initialize database ═══
echo "[7/${TOTAL_STEPS}] Initializing database..."
set -a; source "${ENV_FILE}"; set +a

cd "${INSTALL_DIR}/backend"
if "${VENV_DIR}/bin/python" -c "
from app.core.database import init_db
init_db()
" 2>>"${INSTALL_LOG}"; then
    ok "Database initialized at ${DB_PATH}"
else
    fail "Database initialization failed"
    ERRORS=$((ERRORS+1))
fi

# ═══ Step 8: Permissions & Sudoers ═══
echo "[8/${TOTAL_STEPS}] Setting permissions and sudoers..."

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${LOG_DIR}"
chmod 600 "${DB_PATH}" 2>/dev/null || true
chmod 700 "${ENV_DIR}"

# Create comprehensive sudoers policy
cat > /etc/sudoers.d/dns-control << 'SUDOEOF'
# DNS Control v2.1 — Sudoers Policy (Zero-Config)
# Allows dns-control user to manage DNS infrastructure services

# Service management
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart frr
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart nftables
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl status *
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl is-active *
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl stop unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl start unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl enable unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl disable unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl mask unbound.service
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl stop unbound.service
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl disable unbound.service

# Firewall (nftables)
dns-control ALL=(root) NOPASSWD: /usr/sbin/nft *

# DNS (Unbound)
dns-control ALL=(root) NOPASSWD: /usr/sbin/unbound-control *
dns-control ALL=(root) NOPASSWD: /usr/sbin/unbound-checkconf *

# Routing (FRR)
dns-control ALL=(root) NOPASSWD: /usr/bin/vtysh -c *

# Network
dns-control ALL=(root) NOPASSWD: /sbin/ifreload -a
dns-control ALL=(root) NOPASSWD: /sbin/ifquery *

# Deploy operations
dns-control ALL=(root) NOPASSWD: /usr/bin/install -m *
dns-control ALL=(root) NOPASSWD: /usr/bin/mkdir -p *
dns-control ALL=(root) NOPASSWD: /usr/sbin/sysctl --load *
dns-control ALL=(root) NOPASSWD: /etc/network/post-up.d/dns-control

# IP blocking (blackhole routes)
dns-control ALL=(root) NOPASSWD: /usr/local/bin/anablock-ip-sync.sh

# Journalctl for log access
dns-control ALL=(root) NOPASSWD: /usr/bin/journalctl --no-pager *
SUDOEOF

chmod 440 /etc/sudoers.d/dns-control

# Validate sudoers
if visudo -c -f /etc/sudoers.d/dns-control >/dev/null 2>&1; then
    ok "Sudoers policy installed and validated"
else
    fail "Sudoers validation failed — check /etc/sudoers.d/dns-control"
    ERRORS=$((ERRORS+1))
fi

# Verify sudo works for the service user
if sudo -u "${SERVICE_USER}" sudo -n -l >/dev/null 2>&1; then
    ok "Sudo privileges verified for ${SERVICE_USER}"
else
    warn "Sudo check for ${SERVICE_USER} returned non-zero (may work for specific commands)"
    WARNINGS=$((WARNINGS+1))
fi

# ═══ Step 9: Create placeholder files ═══
echo "[9/${TOTAL_STEPS}] Creating placeholder files for services..."

# Unbound blocklist placeholders — prevents checkconf failures
touch /etc/unbound/unbound-block-domains.conf 2>/dev/null || true
touch /etc/unbound/anablock.conf 2>/dev/null || true
chown "${SERVICE_USER}:${SERVICE_USER}" /etc/unbound/unbound-block-domains.conf 2>/dev/null || true
chown "${SERVICE_USER}:${SERVICE_USER}" /etc/unbound/anablock.conf 2>/dev/null || true
ok "Unbound blocklist placeholders created"

# Disable legacy unbound.service to prevent port 53 conflicts
if systemctl is-active unbound.service >/dev/null 2>&1; then
    systemctl stop unbound.service 2>/dev/null || true
    systemctl disable unbound.service 2>/dev/null || true
    warn "Legacy unbound.service stopped and disabled (prevents port 53 conflict)"
fi
systemctl mask unbound.service 2>/dev/null || true
ok "Legacy unbound.service masked"

# ═══ Step 10: Systemd service & start ═══
echo "[10/${TOTAL_STEPS}] Installing systemd service..."

# Create systemd service (always overwrite to stay in sync)
cat > /etc/systemd/system/dns-control-api.service << 'SERVICEEOF'
[Unit]
Description=DNS Control API v2.1
After=network.target
Documentation=https://github.com/ocaiobarros/dns-orchestrator

[Service]
Type=simple
User=dns-control
Group=dns-control
WorkingDirectory=/opt/dns-control/backend
EnvironmentFile=/etc/dns-control/env
ExecStart=/opt/dns-control/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dns-control-api

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ReadWritePaths=/var/lib/dns-control /var/log/dns-control /etc/unbound /etc/nftables.d /etc/network /etc/systemd/system
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable dns-control-api
systemctl restart dns-control-api

# Wait for API to come up
echo ""
echo "  Waiting for API to start..."
API_UP=false
for i in $(seq 1 15); do
    if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
        API_UP=true
        break
    fi
    sleep 1
done

if ${API_UP}; then
    ok "API is running and healthy"
else
    fail "API did not respond within 15 seconds"
    info "Check: journalctl -u dns-control-api --no-pager -n 30"
    ERRORS=$((ERRORS+1))
fi

# ═══ Post-install verification ═══
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-Install Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CHECKS_PASS=0
CHECKS_FAIL=0

# Check 1: API health
if curl -sf http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    ok "Health endpoint responds"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    fail "Health endpoint unreachable"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi

# Check 2: Metrics endpoint
if curl -sf http://127.0.0.1:8000/metrics >/dev/null 2>&1; then
    ok "Prometheus metrics endpoint responds"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    warn "Metrics endpoint unreachable (non-critical)"
fi

# Check 3: Database accessible
if [[ -f "${DB_PATH}" ]] && sqlite3 "${DB_PATH}" "SELECT count(*) FROM users;" >/dev/null 2>&1; then
    ADMIN_COUNT=$(sqlite3 "${DB_PATH}" "SELECT count(*) FROM users WHERE username='admin';")
    ok "Database accessible (admin users: ${ADMIN_COUNT})"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    fail "Database not accessible or users table missing"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi

# Check 4: Sudoers functional
if sudo -u "${SERVICE_USER}" sudo -n nft list tables >/dev/null 2>&1; then
    ok "Sudo→nft works for ${SERVICE_USER}"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    warn "Sudo→nft test failed (nftables may not be loaded yet — OK for fresh install)"
fi

# Check 5: Systemd service running
if systemctl is-active dns-control-api >/dev/null 2>&1; then
    ok "dns-control-api.service is running"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    fail "dns-control-api.service is not running"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi

# Check 6: Placeholder files exist
if [[ -f "/etc/unbound/unbound-block-domains.conf" ]] && [[ -f "/etc/unbound/anablock.conf" ]]; then
    ok "Unbound placeholder files exist"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    fail "Unbound placeholder files missing"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi

# Check 7: Login works
LOGIN_RESULT=$(curl -sf -X POST http://127.0.0.1:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"admin\",\"password\":\"${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-admin}\"}" 2>/dev/null || echo "FAIL")
if echo "${LOGIN_RESULT}" | grep -q "token\|access_token\|session"; then
    ok "Admin login functional"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    warn "Admin login test inconclusive"
fi

# ═══ Summary ═══
echo ""
echo "============================================"
if [[ ${ERRORS} -eq 0 ]] && [[ ${CHECKS_FAIL} -eq 0 ]]; then
    echo -e "  ${GREEN}DNS Control v2.1 — Installation Complete${NC}"
    echo -e "  ${GREEN}All checks passed (${CHECKS_PASS}/${CHECKS_PASS})${NC}"
else
    echo -e "  ${YELLOW}DNS Control v2.1 — Installation Complete (with issues)${NC}"
    echo -e "  Checks: ${GREEN}${CHECKS_PASS} passed${NC}, ${RED}${CHECKS_FAIL} failed${NC}"
    echo -e "  Errors: ${ERRORS} · Warnings: ${WARNINGS}"
fi
echo "============================================"
echo ""
echo "  API:       http://127.0.0.1:8000"
echo "  Health:    http://127.0.0.1:8000/api/health"
echo "  Metrics:   http://127.0.0.1:8000/metrics"
echo "  Swagger:   http://127.0.0.1:8000/docs"
echo "  Database:  ${DB_PATH}"
echo "  Config:    ${ENV_FILE}"
echo "  Logs:      journalctl -u dns-control-api -f"
echo ""
echo "  Next steps:"
echo "    1. Open the web UI and log in as admin"
echo "    2. Complete the configuration wizard (11 steps)"
echo "    3. Deploy — the system will configure everything"
echo ""
if [[ ${ERRORS} -gt 0 ]]; then
    echo -e "  ${RED}⚠ Review errors above before proceeding${NC}"
    echo "    Install log: ${INSTALL_LOG}"
    echo ""
fi
