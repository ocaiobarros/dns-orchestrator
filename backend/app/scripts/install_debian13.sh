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

ensure_runtime_dirs() {
    mkdir -p "${INSTALL_DIR}"
    mkdir -p "${DATA_DIR}/backups"
    mkdir -p "${DATA_DIR}/generated"
    mkdir -p "${DATA_DIR}/staging"
    mkdir -p "${DATA_DIR}/deployments"
    mkdir -p "${LOG_DIR}"
    mkdir -p "${ENV_DIR}"
    mkdir -p "/etc/unbound"
    mkdir -p "/etc/unbound/unbound.conf.d"
    mkdir -p "/etc/nftables.d"
    mkdir -p "/etc/network"
    mkdir -p "/etc/network/post-up.d"
    mkdir -p "/etc/sysctl.d"
    mkdir -p "/etc/frr"
    mkdir -p "/etc/default"
    mkdir -p "/etc/systemd/system"
    mkdir -p "/usr/lib/systemd/system"
}

# ── Path constants (must be defined before any use) ──
INSTALL_DIR="${INSTALL_DIR:-/opt/dns-control}"
DATA_DIR="${DATA_DIR:-/var/lib/dns-control}"
DB_PATH="${DB_PATH:-${DATA_DIR}/dns-control.db}"
LOCK_FILE="${LOCK_FILE:-/var/lock/dns-control-install.lock}"
TOTAL_STEPS="${TOTAL_STEPS:-10}"

# ── Runtime/config defaults (set -u safe) ──
SERVICE_USER="${SERVICE_USER:-dns-control}"
ENV_DIR="${ENV_DIR:-/etc/dns-control}"
ENV_FILE="${ENV_FILE:-${ENV_DIR}/env}"
LOG_DIR="${LOG_DIR:-/var/log/dns-control}"
INSTALL_LOG="${INSTALL_LOG:-${LOG_DIR}/install.log}"

# ── Upgrade state (must exist before traps) ──
UPGRADE_STAGING_DIR="${UPGRADE_STAGING_DIR:-${INSTALL_DIR}/.upgrade-staging}"
BACKEND_STAGING_DIR="${BACKEND_STAGING_DIR:-${UPGRADE_STAGING_DIR}/backend}"
PREVIOUS_BACKEND_DIR=""
BACKEND_SWAPPED=false
ROLLBACK_PERFORMED=false
ERRORS=0
WARNINGS=0
LOCK_DIR_FALLBACK="${LOCK_FILE}.d"

cleanup_upgrade_artifacts() {
    rm -rf "${UPGRADE_STAGING_DIR}" 2>/dev/null || true
    if [[ -d "${LOCK_DIR_FALLBACK}" ]]; then
        rmdir "${LOCK_DIR_FALLBACK}" 2>/dev/null || true
    fi
}

rollback_backend_if_needed() {
    if [[ "${ROLLBACK_PERFORMED}" == "true" ]]; then
        return 0
    fi

    if [[ "${BACKEND_SWAPPED}" == "true" ]] && [[ -n "${PREVIOUS_BACKEND_DIR}" ]] && [[ -d "${PREVIOUS_BACKEND_DIR}" ]]; then
        rm -rf "${INSTALL_DIR}/backend" 2>/dev/null || true
        mv "${PREVIOUS_BACKEND_DIR}" "${INSTALL_DIR}/backend"
        ROLLBACK_PERFORMED=true
        warn "Rollback aplicado: backend anterior restaurado"
    fi

    cleanup_upgrade_artifacts
}

on_error() {
    local line="$1"
    local cmd="$2"
    fail "Erro na linha ${line}: ${cmd}"
    ERRORS=$((ERRORS+1))
    rollback_backend_if_needed
}

# ── Auto-detect source root (supports reinstall/upgrade) ──
# Strategy: find repo root first (via multiple markers), then locate deps file separately.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Script lives in backend/app/scripts/ — source root is 3 levels up
REPO_ROOT_GUESS="$(cd "${SCRIPT_DIR}/../../.." 2>/dev/null && pwd || echo "")"
SOURCE_ROOT=""
REQUIREMENTS_FILE=""

is_repo_root() {
    local dir="$1"
    [[ -z "${dir}" ]] && return 1
    [[ ! -d "${dir}" ]] && return 1
    # Accept if ANY of these markers exist — not all repos have all of them
    [[ -d "${dir}/.git" ]] && return 0
    [[ -f "${dir}/backend/app/main.py" ]] && return 0
    [[ -f "${dir}/backend/app/scripts/install_debian13.sh" ]] && return 0
    [[ -d "${dir}/src" ]] && [[ -f "${dir}/package.json" ]] && return 0
    return 1
}

find_requirements() {
    local root="$1"
    # Check all possible locations for Python dependency manifests
    local candidates=(
        "${root}/backend/requirements.txt"
        "${root}/requirements.txt"
        "${root}/backend/pyproject.toml"
        "${root}/pyproject.toml"
    )
    for f in "${candidates[@]}"; do
        if [[ -f "${f}" ]]; then
            REQUIREMENTS_FILE="${f}"
            return 0
        fi
    done
    return 1
}

detect_source_root() {
    local candidates=(
        "${REPO_ROOT_GUESS}"
        "$(pwd)"
        "/opt/dns-control"
        "/opt/dns-control/backend/.."
    )

    # Deduplicate and resolve
    local seen=()
    local candidate
    for candidate in "${candidates[@]}"; do
        [[ -z "${candidate}" ]] && continue
        local resolved
        resolved="$(cd "${candidate}" 2>/dev/null && pwd || echo "")"
        [[ -z "${resolved}" ]] && continue

        # Skip if already checked
        local already=false
        for s in "${seen[@]+"${seen[@]}"}"; do
            [[ "${s}" == "${resolved}" ]] && already=true && break
        done
        ${already} && continue
        seen+=("${resolved}")

        if is_repo_root "${resolved}"; then
            SOURCE_ROOT="${resolved}"
            return 0
        fi
    done

    return 1
}

# ── Configuration ──
# (moved below detection block but defined here for early reference)

if ! detect_source_root; then
    echo -e "${RED}ERROR: Cannot locate source repository root.${NC}"
    echo "  Checked markers: .git, backend/app/main.py, backend/app/scripts/install_debian13.sh, src/+package.json"
    echo "  Scanned directories:"
    for d in "${REPO_ROOT_GUESS}" "$(pwd)" "/opt/dns-control"; do
        echo "    - ${d} (exists: $(test -d "${d}" && echo yes || echo no))"
    done
    echo ""
    echo "  Ensure you are running from a full source checkout, e.g.:"
    echo "    cd /opt/dns-control && sudo bash backend/app/scripts/install_debian13.sh"
    exit 1
fi

# Locate requirements file
if ! find_requirements "${SOURCE_ROOT}"; then
    echo -e "${RED}ERROR: Repository found at ${SOURCE_ROOT}, but no Python dependency manifest.${NC}"
    echo "  Searched for:"
    echo "    - ${SOURCE_ROOT}/backend/requirements.txt"
    echo "    - ${SOURCE_ROOT}/requirements.txt"
    echo "    - ${SOURCE_ROOT}/backend/pyproject.toml"
    echo "    - ${SOURCE_ROOT}/pyproject.toml"
    echo ""
    echo "  Contents of ${SOURCE_ROOT}/backend/:"
    ls -la "${SOURCE_ROOT}/backend/" 2>/dev/null || echo "    (directory does not exist)"
    echo ""
    echo "  Ensure backend/requirements.txt is committed and pushed."
    exit 1
fi

echo "  Source root:  ${SOURCE_ROOT}"
echo "  Dependencies: ${REQUIREMENTS_FILE}"
echo ""

mkdir -p /var/lock
if command -v flock >/dev/null 2>&1; then
    exec 9>"${LOCK_FILE}"
    if ! flock -n 9; then
        echo -e "${RED}ERROR: Another install/upgrade is already running.${NC}"
        exit 1
    fi
else
    warn "flock not found; using mkdir lock fallback"
    if ! mkdir "${LOCK_DIR_FALLBACK}" 2>/dev/null; then
        echo -e "${RED}ERROR: Another install/upgrade is already running (lock dir exists).${NC}"
        exit 1
    fi
fi

trap 'on_error "${LINENO}" "${BASH_COMMAND}"' ERR

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
ensure_runtime_dirs
ok "Directories created (including unit file ReadWritePaths)"

# ═══ Step 4: Copy application files ═══
echo "[4/${TOTAL_STEPS}] Staging application files..."

if [[ ! -d "${SOURCE_ROOT}/backend" ]]; then
    fail "Backend source directory not found at ${SOURCE_ROOT}/backend"
    ERRORS=$((ERRORS+1))
    exit 1
fi

# Detect in-place install (SOURCE_ROOT == INSTALL_DIR)
IN_PLACE=false
if [[ "$(realpath "${SOURCE_ROOT}")" == "$(realpath "${INSTALL_DIR}")" ]]; then
    IN_PLACE=true
    info "In-place install detected (source == install dir) — skipping self-copies"
fi

cleanup_upgrade_artifacts
mkdir -p "${UPGRADE_STAGING_DIR}"

# Copy backend to staging first (never delete active backend before staging is valid)
if [[ "${IN_PLACE}" == true ]] && [[ "$(realpath "${SOURCE_ROOT}/backend")" == "$(realpath "${BACKEND_STAGING_DIR}" 2>/dev/null || echo __none__)" ]]; then
    info "Backend already at staging target — skipping copy"
else
    if command -v rsync &>/dev/null; then
        rsync -a --delete "${SOURCE_ROOT}/backend/" "${BACKEND_STAGING_DIR}/"
    else
        mkdir -p "${BACKEND_STAGING_DIR}"
        cp -a "${SOURCE_ROOT}/backend/." "${BACKEND_STAGING_DIR}/"
    fi
fi

# Determine requirements file path relative to staging
STAGING_REQUIREMENTS=""
if [[ -f "${BACKEND_STAGING_DIR}/requirements.txt" ]]; then
    STAGING_REQUIREMENTS="${BACKEND_STAGING_DIR}/requirements.txt"
elif [[ -f "${UPGRADE_STAGING_DIR}/requirements.txt" ]]; then
    STAGING_REQUIREMENTS="${UPGRADE_STAGING_DIR}/requirements.txt"
elif [[ -f "${REQUIREMENTS_FILE}" ]]; then
    # Copy from detected source location into staging
    cp "${REQUIREMENTS_FILE}" "${BACKEND_STAGING_DIR}/requirements.txt"
    STAGING_REQUIREMENTS="${BACKEND_STAGING_DIR}/requirements.txt"
fi

if [[ -n "${STAGING_REQUIREMENTS}" ]] && [[ -f "${BACKEND_STAGING_DIR}/app/main.py" ]]; then
    ok "Backend files staged (requirements: $(basename ${STAGING_REQUIREMENTS}))"
else
    fail "Staged backend is incomplete"
    [[ ! -f "${BACKEND_STAGING_DIR}/app/main.py" ]] && fail "  Missing: app/main.py"
    [[ -z "${STAGING_REQUIREMENTS}" ]] && fail "  Missing: requirements.txt"
    ERRORS=$((ERRORS+1))
    exit 1
fi

# Always rebuild venv in final backend path; moved venv scripts keep stale shebangs.
rm -rf "${BACKEND_STAGING_DIR}/venv"

# Copy or build frontend dist
if [[ -d "${SOURCE_ROOT}/dist" ]]; then
    if [[ "${IN_PLACE}" == true ]]; then
        ok "Frontend dist/ already in place — skipping copy"
    else
        mkdir -p "${INSTALL_DIR}/dist"
        cp -a "${SOURCE_ROOT}/dist/." "${INSTALL_DIR}/dist/"
        ok "Frontend build copied from existing dist/"
    fi
else
    info "dist/ not found — attempting automatic frontend build..."
    if [[ -f "${SOURCE_ROOT}/package.json" ]]; then
        # Ensure Node.js is available (installed in step 1)
        if ! command -v node &>/dev/null; then
            fail "Node.js not available — cannot build frontend"
            WARNINGS=$((WARNINGS+1))
        elif ! command -v npm &>/dev/null; then
            fail "npm not available — cannot build frontend"
            WARNINGS=$((WARNINGS+1))
        else
            info "Running npm install..."
            (cd "${SOURCE_ROOT}" && npm install --production=false --ignore-scripts 2>>"${INSTALL_LOG}") && ok "npm install completed" || {
                fail "npm install failed (see ${INSTALL_LOG})"
                WARNINGS=$((WARNINGS+1))
            }
            info "Running npm run build..."
            if (cd "${SOURCE_ROOT}" && npm run build 2>>"${INSTALL_LOG}"); then
                if [[ -d "${SOURCE_ROOT}/dist" ]]; then
                    ok "Frontend built successfully (dist/ created in place)"
                else
                    fail "npm run build succeeded but dist/ was not created"
                    WARNINGS=$((WARNINGS+1))
                fi
            else
                fail "npm run build failed (see ${INSTALL_LOG})"
                WARNINGS=$((WARNINGS+1))
            fi
        fi
    else
        warn "No package.json found — skipping frontend build (API-only mode)"
        WARNINGS=$((WARNINGS+1))
    fi
fi

# Copy deploy configs (optional — not all installations use nginx proxy)
if [[ -d "${SOURCE_ROOT}/deploy" ]]; then
    if [[ "${IN_PLACE}" == true ]]; then
        ok "Deploy configs already in place — skipping copy"
    else
        rm -rf "${INSTALL_DIR}/deploy"
        cp -a "${SOURCE_ROOT}/deploy" "${INSTALL_DIR}/"
        ok "Deploy configs copied (nginx, systemd templates)"
    fi
else
    info "deploy/ directory not found — skipping (optional: nginx/systemd templates)"
    info "  The API will run standalone on port 8000 without reverse proxy"
fi

# ═══ Step 5: Backend dependency manifest validation ═══
echo "[5/${TOTAL_STEPS}] Validating staged dependency manifest..."
if [[ ! -f "${STAGING_REQUIREMENTS}" ]]; then
    fail "requirements.txt missing in staged backend"
    ERRORS=$((ERRORS+1))
    exit 1
fi
if grep -Eiq '^\s*uvicorn(\[[^]]+\])?' "${STAGING_REQUIREMENTS}"; then
    ok "uvicorn dependency found in requirements"
else
    fail "uvicorn dependency missing from requirements"
    ERRORS=$((ERRORS+1))
    exit 1
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
echo "[7/${TOTAL_STEPS}] Activating backend and initializing database..."
set -a; source "${ENV_FILE}"; set +a

# Atomic backend swap (only after staged backend is fully validated)
if [[ -d "${INSTALL_DIR}/backend" ]]; then
    PREVIOUS_BACKEND_DIR="${INSTALL_DIR}/backend.previous.$(date +%s)"
    mv "${INSTALL_DIR}/backend" "${PREVIOUS_BACKEND_DIR}"
    BACKEND_SWAPPED=true
    ok "Previous backend moved to ${PREVIOUS_BACKEND_DIR}"
fi

mv "${BACKEND_STAGING_DIR}" "${INSTALL_DIR}/backend"
BACKEND_SWAPPED=true
VENV_DIR="${INSTALL_DIR}/backend/venv"
ACTIVE_REQUIREMENTS="${INSTALL_DIR}/backend/requirements.txt"
ok "Staged backend activated"

# Build venv in final path to keep uvicorn/python shebangs valid.
python3 -m venv --clear "${VENV_DIR}" 2>>"${INSTALL_LOG}"
"${VENV_DIR}/bin/pip" install --upgrade pip wheel -q 2>>"${INSTALL_LOG}"
if [[ ! -f "${ACTIVE_REQUIREMENTS}" ]]; then
    fail "requirements.txt missing in active backend: ${ACTIVE_REQUIREMENTS}"
    ERRORS=$((ERRORS+1))
    exit 1
fi
"${VENV_DIR}/bin/pip" install -r "${ACTIVE_REQUIREMENTS}" -q 2>>"${INSTALL_LOG}"
ok "Python dependencies installed in active backend venv"

# ── Validate venv binaries exist and are executable ──
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
    fail "venv python missing or not executable: ${VENV_DIR}/bin/python"
    ERRORS=$((ERRORS+1))
    exit 1
fi
if [[ ! -x "${VENV_DIR}/bin/uvicorn" ]]; then
    fail "venv uvicorn missing or not executable: ${VENV_DIR}/bin/uvicorn"
    ERRORS=$((ERRORS+1))
    exit 1
fi
if ! "${VENV_DIR}/bin/uvicorn" --version >/dev/null 2>&1; then
    fail "venv uvicorn is present but not runnable (invalid shebang/runtime)"
    ERRORS=$((ERRORS+1))
    exit 1
fi
ok "venv binaries validated (python + uvicorn)"

# Verify critical imports from active backend
if (cd "${INSTALL_DIR}/backend" && "${VENV_DIR}/bin/python" -c "from app.main import app; print('ok')" 2>/dev/null); then
    ok "FastAPI application loads correctly"
else
    fail "FastAPI application failed to load from active backend"
    ERRORS=$((ERRORS+1))
    exit 1
fi

if (cd "${INSTALL_DIR}/backend" && "${VENV_DIR}/bin/python" -c "
from app.core.database import init_db
init_db()
" 2>>"${INSTALL_LOG}"); then
    ok "Database initialized at ${DB_PATH}"
else
    fail "Database initialization failed"
    ERRORS=$((ERRORS+1))
fi

# ═══ Step 8: Permissions & Sudoers ═══
echo "[8/${TOTAL_STEPS}] Setting permissions and sudoers..."

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${LOG_DIR}"
chown "${SERVICE_USER}:${SERVICE_USER}" "/etc/nftables.d" 2>/dev/null || true
chmod 600 "${DB_PATH}" 2>/dev/null || true
chmod 700 "${ENV_DIR}"
ok "Permissions set on install dir, data dir, and log dir"

# Install sudoers policy from repository file (single source of truth)
SUDOERS_SRC="${SOURCE_ROOT}/deploy/sudoers/dns-control-diagnostics"
if [[ -f "${SUDOERS_SRC}" ]]; then
    cp "${SUDOERS_SRC}" /etc/sudoers.d/dns-control-diagnostics
    chmod 440 /etc/sudoers.d/dns-control-diagnostics
    # Also install as dns-control for backward compat
    cp "${SUDOERS_SRC}" /etc/sudoers.d/dns-control
    chmod 440 /etc/sudoers.d/dns-control
else
    fail "Sudoers source file not found: ${SUDOERS_SRC}"
    ERRORS=$((ERRORS+1))
fi

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

# Re-assert runtime dirs before service start (hardening + upgrades)
ensure_runtime_dirs
if [[ ! -d "/etc/nftables.d" ]]; then
    fail "Required runtime directory missing before service start: /etc/nftables.d"
    ERRORS=$((ERRORS+1))
    exit 1
fi

# Create systemd service (always overwrite to stay in sync)
cat > /etc/systemd/system/dns-control-api.service << 'SERVICEEOF'
[Unit]
Description=DNS Control API v2.1
After=network.target
Documentation=https://github.com/ocaiobarros/dns-orchestrator
ConditionPathIsDirectory=/etc/nftables.d
ConditionPathExists=/opt/dns-control/backend/venv/bin/uvicorn

[Service]
Type=simple
User=dns-control
Group=dns-control
WorkingDirectory=/opt/dns-control/backend
EnvironmentFile=/etc/dns-control/env
ExecStartPre=/usr/bin/test -d /etc/nftables.d
ExecStartPre=/usr/bin/test -x /opt/dns-control/backend/venv/bin/uvicorn
ExecStart=/opt/dns-control/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=dns-control-api

# Security hardening
# All ReadWritePaths directories are created by this installer in Step 3.
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
if ! systemctl is-active --quiet dns-control-api; then
    fail "dns-control-api did not start"
    echo ""
    echo "  ── journalctl -u dns-control-api (last 50 lines) ──"
    journalctl -u dns-control-api --no-pager -n 50 2>/dev/null || true
    echo "  ── end of journal ──"
    echo ""
    ERRORS=$((ERRORS+1))
fi

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
    echo ""
    echo "  ── journalctl -u dns-control-api (last 50 lines) ──"
    journalctl -u dns-control-api --no-pager -n 50 2>/dev/null || true
    echo "  ── end of journal ──"
    echo ""
    ERRORS=$((ERRORS+1))
fi

# ═══ Post-install verification ═══
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Post-Install Verification"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

CHECKS_PASS=0
CHECKS_FAIL=0

# Check 0: venv uvicorn executable really works
if [[ -x "${VENV_DIR}/bin/uvicorn" ]] && "${VENV_DIR}/bin/uvicorn" --version >/dev/null 2>&1; then
    ok "venv uvicorn executable is present and runnable"
    CHECKS_PASS=$((CHECKS_PASS+1))
else
    fail "venv uvicorn executable missing or broken"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi

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
LOGIN_CHECK_FILE="/tmp/dns-control-login-check.json"
LOGIN_HTTP_CODE=$(curl -sS -o "${LOGIN_CHECK_FILE}" -w "%{http_code}" -X POST http://127.0.0.1:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${DNS_CONTROL_INITIAL_ADMIN_USERNAME:-admin}\",\"password\":\"${DNS_CONTROL_INITIAL_ADMIN_PASSWORD:-admin}\"}" 2>>"${INSTALL_LOG}" || echo "000")

if [[ "${LOGIN_HTTP_CODE}" == "200" ]]; then
    ok "Admin login functional (credentials validated)"
    CHECKS_PASS=$((CHECKS_PASS+1))
elif [[ "${LOGIN_HTTP_CODE}" == "401" ]]; then
    warn "Login endpoint funcional, mas credenciais em ENV não bateram (senha pode ter sido alterada)"
    CHECKS_PASS=$((CHECKS_PASS+1))
elif [[ "${LOGIN_HTTP_CODE}" == "500" ]]; then
    fail "Login endpoint retornou 500"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
else
    fail "Login endpoint inválido (HTTP ${LOGIN_HTTP_CODE})"
    CHECKS_FAIL=$((CHECKS_FAIL+1))
fi
rm -f "${LOGIN_CHECK_FILE}" 2>/dev/null || true

if [[ ${ERRORS} -gt 0 ]] || [[ ${CHECKS_FAIL} -gt 0 ]]; then
    warn "Falha em validações críticas — executando rollback automático"
    rollback_backend_if_needed
fi

# ═══ Summary ═══
echo ""
echo "============================================"
if [[ ${ERRORS} -eq 0 ]] && [[ ${CHECKS_FAIL} -eq 0 ]]; then
    if [[ -n "${PREVIOUS_BACKEND_DIR}" ]] && [[ -d "${PREVIOUS_BACKEND_DIR}" ]]; then
        rm -rf "${PREVIOUS_BACKEND_DIR}" 2>/dev/null || true
    fi
    cleanup_upgrade_artifacts
    trap - ERR
    echo -e "  ${GREEN}DNS Control v2.1 — Installation Complete${NC}"
    echo -e "  ${GREEN}All checks passed (${CHECKS_PASS}/${CHECKS_PASS})${NC}"
else
    echo -e "  ${YELLOW}DNS Control v2.1 — Installation Complete (with issues)${NC}"
    echo -e "  Checks: ${GREEN}${CHECKS_PASS} passed${NC}, ${RED}${CHECKS_FAIL} failed${NC}"
    echo -e "  Errors: ${ERRORS} · Warnings: ${WARNINGS}"
fi
if [[ "${ROLLBACK_PERFORMED}" == "true" ]]; then
    echo -e "  ${YELLOW}Rollback automático aplicado para preservar serviço/autenticação.${NC}"
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
