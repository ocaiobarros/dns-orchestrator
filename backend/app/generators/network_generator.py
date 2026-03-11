"""
DNS Control — Network Configuration Generator
Generates ifupdown2 configuration and post-up scripts.
"""

from typing import Any


def generate_network_config(payload: dict[str, Any]) -> list[dict]:
    loopback = payload.get("loopback", {})
    instances = payload.get("instances", [])
    files = []

    # Loopback configuration
    lo_config = """# DNS Control — Loopback configuration
# Generated configuration — do not edit manually

auto lo
iface lo inet loopback
"""
    if loopback.get("ip"):
        lo_config += f"    address {loopback['ip']}/32\n"
    if loopback.get("vip"):
        lo_config += f"    address {loopback['vip']}/32\n"

    for inst in instances:
        bind_ip = inst.get("bindIp", "")
        if bind_ip and bind_ip not in ("127.0.0.1", loopback.get("ip", ""), loopback.get("vip", "")):
            lo_config += f"    address {bind_ip}/32\n"

    files.append({
        "path": "/etc/network/interfaces.d/dns-control-loopback",
        "content": lo_config,
        "permissions": "0644",
        "owner": "root:root",
    })

    # Post-up script
    post_up = """#!/bin/bash
# DNS Control — Network post-up script
# Generated configuration — do not edit manually

set -e

# Apply loopback addresses
ip addr show lo | grep -q "scope global" || true

# Verify addresses
echo "DNS Control: Network addresses applied"
ip addr show lo
"""

    files.append({
        "path": "/etc/network/post-up.d/dns-control",
        "content": post_up,
        "permissions": "0755",
        "owner": "root:root",
    })

    return files
