"""
DNS Control — Systemd Unit File Generator
Generates per-instance service units for Unbound and the DNS Control API.
Units placed in /usr/lib/systemd/system/ matching Debian production layout.
Uses package-helper scripts for chroot setup and root trust anchor updates.
Config path: /etc/unbound/{name}.conf
"""

from typing import Any


def generate_systemd_units(payload: dict[str, Any]) -> list[dict]:
    instances = payload.get("instances", [])
    files = []

    for inst in instances:
        name = inst.get("name", "unbound")
        unit = f"""[Unit]
Description=Unbound DNS server ({name})
Documentation=man:unbound(8)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Restart=on-failure
RestartSec=3
ExecStart=/usr/sbin/unbound -d -p -c /etc/unbound/{name}.conf
ExecReload=+/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
"""
        files.append({
            "path": f"/usr/lib/systemd/system/{name}.service",
            "content": unit,
            "permissions": "0644",
            "owner": "root:root",
        })

    # DNS Control API service
    api_unit = """[Unit]
Description=DNS Control API
After=network.target

[Service]
Type=simple
User=dns-control
Group=dns-control
WorkingDirectory=/opt/dns-control/backend
ExecStart=/opt/dns-control/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db

[Install]
WantedBy=multi-user.target
"""
    files.append({
        "path": "/etc/systemd/system/dns-control-api.service",
        "content": api_unit,
        "permissions": "0644",
        "owner": "root:root",
    })

    return files
