#!/bin/bash
# ============================================================
# DNS Control v2.1 — Debian 13 Installation Script
# Installs all dependencies, sets up the database,
# creates the admin user, and configures systemd services.
# ============================================================

set -euo pipefail

INSTALL_DIR="/opt/dns-control"
DATA_DIR="/var/lib/dns-control"
DB_PATH="${DATA_DIR}/dns-control.db"
SERVICE_USER="dns-control"
VENV_DIR="${INSTALL_DIR}/backend/venv"
ENV_DIR="/etc/dns-control"
ENV_FILE="${ENV_DIR}/env"

echo "============================================"
echo "  DNS Control v2.1 — Debian 13 Installer"
echo "============================================"
echo ""

# Check root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run as root."
    exit 1
fi

# ---- Step 1: Install system packages ----
echo "[1/9] Installing system packages..."
apt-get update -qq
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
    nodejs npm

echo "  ✓ System packages installed"

# ---- Step 2: Create service user ----
echo "[2/9] Creating service user..."
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "${INSTALL_DIR}" "${SERVICE_USER}"
    echo "  ✓ User '${SERVICE_USER}' created"
else
    echo "  ✓ User '${SERVICE_USER}' already exists"
fi

# ---- Step 3: Create directories ----
echo "[3/9] Creating directories..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${DATA_DIR}/backups"
mkdir -p "${DATA_DIR}/generated"
mkdir -p "/var/log/dns-control"
mkdir -p "${ENV_DIR}"

echo "  ✓ Directories created"

# ---- Step 4: Copy application files ----
echo "[4/9] Copying application files..."
# Assumes this script is run from the repo root
if [ -d "backend" ]; then
    cp -r backend "${INSTALL_DIR}/"
    echo "  ✓ Backend files copied"
else
    echo "  ERROR: 'backend/' directory not found. Run from repo root."
    exit 1
fi

if [ -d "dist" ]; then
    mkdir -p "${INSTALL_DIR}/dist"
    cp -r dist/* "${INSTALL_DIR}/dist/"
    echo "  ✓ Frontend files copied"
else
    echo "  WARNING: 'dist/' not found. Build frontend first with 'npm run build'"
fi

# Copy deploy files
if [ -d "deploy" ]; then
    cp -r deploy "${INSTALL_DIR}/"
    echo "  ✓ Deploy files copied"
fi

# ---- Step 5: Setup Python virtualenv ----
echo "[5/9] Setting up Python virtual environment..."
python3 -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip wheel -q
"${VENV_DIR}/bin/pip" install -r "${INSTALL_DIR}/backend/requirements.txt" -q

echo "  ✓ Python dependencies installed"

# ---- Step 6: Environment configuration ----
echo "[6/9] Configuring environment..."

if [ ! -f "${ENV_FILE}" ]; then
    # Set initial admin password from env or prompt
    if [ -z "${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-}" ]; then
        read -sp "Enter initial admin password: " ADMIN_PASS
        echo ""
    else
        ADMIN_PASS="${DNS_CONTROL_INITIAL_ADMIN_PASSWORD}"
    fi

    # Generate secret key
    SECRET_KEY=$(openssl rand -hex 32)

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
    echo "  ✓ Environment file created"
    echo "  ⚠ Change the admin password after first login!"
else
    echo "  ✓ Environment file already exists, keeping it"
fi

# ---- Step 7: Initialize database ----
echo "[7/9] Initializing database..."
set -a; source "${ENV_FILE}"; set +a

cd "${INSTALL_DIR}/backend"
"${VENV_DIR}/bin/python" -c "
from app.core.database import init_db
init_db()
print('  ✓ Database initialized')
"

# ---- Step 8: Set permissions ----
echo "[8/9] Setting permissions..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "/var/log/dns-control"
chmod 600 "${DB_PATH}" 2>/dev/null || true
chmod 700 "${ENV_DIR}"

# Configure sudoers for privileged commands
cat > /etc/sudoers.d/dns-control << 'EOF'
# DNS Control v2.1 — Allowed privileged commands
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart frr
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart nftables
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl status *
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl is-active *
dns-control ALL=(root) NOPASSWD: /usr/sbin/nft *
dns-control ALL=(root) NOPASSWD: /usr/bin/vtysh -c *
dns-control ALL=(root) NOPASSWD: /usr/sbin/unbound-control *
dns-control ALL=(root) NOPASSWD: /usr/sbin/unbound-checkconf *
dns-control ALL=(root) NOPASSWD: /sbin/ifreload -a
dns-control ALL=(root) NOPASSWD: /sbin/ifquery *
EOF
chmod 440 /etc/sudoers.d/dns-control

echo "  ✓ Permissions and sudoers configured"

# ---- Step 9: Install systemd service and start ----
echo "[9/9] Installing systemd service..."

cp "${INSTALL_DIR}/deploy/systemd/dns-control-api.service" \
   /etc/systemd/system/dns-control-api.service

systemctl daemon-reload
systemctl enable dns-control-api
systemctl start dns-control-api

echo "  ✓ Systemd service installed and started"

echo ""
echo "============================================"
echo "  DNS Control v2.1 — Installation Complete"
echo "============================================"
echo ""
echo "  API:      http://127.0.0.1:8000"
echo "  Health:   http://127.0.0.1:8000/api/health"
echo "  Metrics:  http://127.0.0.1:8000/metrics"
echo "  Database: ${DB_PATH}"
echo "  Config:   ${ENV_FILE}"
echo ""
echo "  Default admin: admin"
echo "  ⚠ Password change required on first login"
echo ""
echo "  Next steps:"
echo "    1. Build frontend: npm install && npm run build"
echo "    2. Configure Nginx (see deploy/nginx/dns-control.conf)"
echo "    3. Setup TLS certificates"
echo "    4. Log in and change the admin password"
echo "    5. Run the configuration wizard"
echo "    6. Configure Prometheus scraping (see docs/PROMETHEUS_ALERTS.md)"
echo ""
echo "  Verify:"
echo "    curl http://127.0.0.1:8000/api/health"
echo "    curl http://127.0.0.1:8000/metrics | head"
echo "    journalctl -u dns-control-api | grep Scheduler"
echo ""
