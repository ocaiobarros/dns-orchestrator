#!/bin/bash
# DNS Control — Manual config apply script
# This is used as a fallback when the API apply endpoint is not available.

set -euo pipefail

BACKUP_DIR="/var/lib/dns-control/backups/$(date +%Y%m%d_%H%M%S)"

echo "DNS Control — Applying configuration"
echo ""

# Backup
echo "[1] Creating backup in ${BACKUP_DIR}..."
mkdir -p "${BACKUP_DIR}"
cp -a /etc/unbound/unbound.conf.d/ "${BACKUP_DIR}/unbound/" 2>/dev/null || true
cp /etc/nftables.conf "${BACKUP_DIR}/" 2>/dev/null || true
cp /etc/frr/frr.conf "${BACKUP_DIR}/" 2>/dev/null || true
echo "  ✓ Backup created"

# Apply nftables
echo "[2] Applying nftables..."
nft -f /etc/nftables.conf && echo "  ✓ nftables applied" || echo "  ✗ nftables failed"

# Restart Unbound instances
echo "[3] Restarting Unbound instances..."
for unit in /etc/systemd/system/unbound*.service; do
    name=$(basename "${unit}" .service)
    systemctl restart "${name}" && echo "  ✓ ${name} restarted" || echo "  ✗ ${name} failed"
done

# Restart FRR
echo "[4] Restarting FRR..."
systemctl restart frr && echo "  ✓ FRR restarted" || echo "  ✗ FRR failed"

# Reload network
echo "[5] Reloading network..."
ifreload -a && echo "  ✓ Network reloaded" || echo "  ✗ Network reload failed"

echo ""
echo "Configuration applied. Check service status with:"
echo "  systemctl status unbound frr nftables"
