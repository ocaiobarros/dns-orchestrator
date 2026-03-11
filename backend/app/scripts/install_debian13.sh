#!/bin/bash
# ============================================================
# DNS Control — Debian 13 Installation Script
# Installs all dependencies, sets up the database,
# creates the admin user, and configures systemd services.
# ============================================================

set -euo pipefail

INSTALL_DIR="/opt/dns-control"
DATA_DIR="/var/lib/dns-control"
DB_PATH="${DATA_DIR}/dns-control.db"
SERVICE_USER="dns-control"
VENV_DIR="${INSTALL_DIR}/backend/venv"

echo "============================================"
echo "  DNS Control — Debian 13 Installer"
echo "============================================"
echo ""

# Check root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: This script must be run as root."
    exit 1
fi

# ---- Step 1: Install system packages ----
echo "[1/8] Installing system packages..."
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
    sudo

echo "  ✓ System packages installed"

# ---- Step 2: Create service user ----
echo "[2/8] Creating service user..."
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home-dir "${INSTALL_DIR}" "${SERVICE_USER}"
    echo "  ✓ User '${SERVICE_USER}' created"
else
    echo "  ✓ User '${SERVICE_USER}' already exists"
fi

# ---- Step 3: Create directories ----
echo "[3/8] Creating directories..."
mkdir -p "${INSTALL_DIR}"
mkdir -p "${DATA_DIR}/backups"
mkdir -p "${DATA_DIR}/generated"

echo "  ✓ Directories created"

# ---- Step 4: Copy application files ----
echo "[4/8] Copying application files..."
# Assumes this script is run from the repo root
if [ -d "backend" ]; then
    cp -r backend "${INSTALL_DIR}/"
    echo "  ✓ Backend files copied"
else
    echo "  ERROR: 'backend/' directory not found. Run from repo root."
    exit 1
fi

if [ -d "dist" ]; then
    mkdir -p "${INSTALL_DIR}/frontend"
    cp -r dist/* "${INSTALL_DIR}/frontend/"
    echo "  ✓ Frontend files copied"
else
    echo "  WARNING: 'dist/' not found. Build frontend first with 'npm run build'"
fi

# ---- Step 5: Setup Python virtualenv ----
echo "[5/8] Setting up Python virtual environment..."
python3 -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip -q
"${VENV_DIR}/bin/pip" install -r "${INSTALL_DIR}/backend/requirements.txt" -q

echo "  ✓ Python dependencies installed"

# ---- Step 6: Initialize database ----
echo "[6/8] Initializing database..."
export DNS_CONTROL_DB_PATH="${DB_PATH}"

# Set initial admin password from env or prompt
if [ -z "${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-}" ]; then
    read -sp "Enter initial admin password: " ADMIN_PASS
    echo ""
    export DNS_CONTROL_INITIAL_ADMIN_PASSWORD="${ADMIN_PASS}"
fi

# Generate secret key if not set
if [ -z "${DNS_CONTROL_SECRET_KEY:-}" ]; then
    export DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
    echo "  Generated secret key — save this in /etc/dns-control/env"
fi

# Run the app briefly to create tables and seed admin
cd "${INSTALL_DIR}/backend"
"${VENV_DIR}/bin/python" -c "
from app.core.database import init_db
init_db()
print('  ✓ Database initialized and admin user created')
"

# ---- Step 7: Set permissions ----
echo "[7/8] Setting permissions..."
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chmod 600 "${DB_PATH}" 2>/dev/null || true

# Configure sudoers for privileged commands
cat > /etc/sudoers.d/dns-control << 'EOF'
# DNS Control — Allowed privileged commands
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

# ---- Step 8: Install systemd services ----
echo "[8/8] Installing systemd services..."

# Create environment file
mkdir -p /etc/dns-control
cat > /etc/dns-control/env << EOF
DNS_CONTROL_DB_PATH=${DB_PATH}
DNS_CONTROL_SECRET_KEY=${DNS_CONTROL_SECRET_KEY}
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
EOF
chmod 600 /etc/dns-control/env

# API service
cat > /etc/systemd/system/dns-control-api.service << EOF
[Unit]
Description=DNS Control API
After=network.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}/backend
EnvironmentFile=/etc/dns-control/env
ExecStart=${VENV_DIR}/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dns-control-api
systemctl start dns-control-api

echo "  ✓ Systemd services installed and started"

echo ""
echo "============================================"
echo "  DNS Control — Installation Complete"
echo "============================================"
echo ""
echo "  API:      http://127.0.0.1:8000"
echo "  Database: ${DB_PATH}"
echo "  Config:   /etc/dns-control/env"
echo ""
echo "  Default admin: admin"
echo "  ⚠ Password change required on first login"
echo ""
echo "  Next steps:"
echo "    1. Configure a reverse proxy (nginx) for HTTPS"
echo "    2. Log in and change the admin password"
echo "    3. Run the configuration wizard"
echo ""
