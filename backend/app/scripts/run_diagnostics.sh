#!/bin/bash
# DNS Control — Diagnostics runner
# Quick system health check from the command line.

set -uo pipefail

echo "============================================"
echo "  DNS Control — System Diagnostics"
echo "============================================"
echo ""

# Services
echo "── Services ──"
for svc in unbound frr nftables; do
    status=$(systemctl is-active "${svc}" 2>/dev/null || echo "inactive")
    printf "  %-20s %s\n" "${svc}:" "${status}"
done
echo ""

# DNS Test
echo "── DNS Resolution ──"
dig @127.0.0.1 google.com +short +time=2 2>/dev/null || echo "  FAILED"
echo ""

# OSPF
echo "── OSPF Neighbors ──"
vtysh -c "show ip ospf neighbor" 2>/dev/null || echo "  FRR not available"
echo ""

# nftables
echo "── nftables Tables ──"
nft list tables 2>/dev/null || echo "  nftables not available"
echo ""

# Network
echo "── Listening on port 53 ──"
ss -tlnp | grep ":53 " || echo "  No listeners on port 53"
echo ""

# Memory
echo "── Memory ──"
free -m
echo ""

# Uptime
echo "── Uptime ──"
uptime
echo ""
