"""
DNS Control — Systemd Unit File Generator
Generates per-instance service units for Unbound and the DNS Control API.
Config path: /etc/unbound/{name}.conf
"""

from typing import Any


def generate_systemd_units(payload: dict[str, Any]) -> list[dict]:
    instances = payload.get("instances", [])
    files = []

    for inst in instances:
        name = inst.get("name", "unbound")
        unit = f"""[Unit]
Description=Unbound DNS resolver — {name}
Documentation=man:unbound(8)
After=network.target
Before=nss-lookup.target
Wants=nss-lookup.target

[Service]
Type=notify
Restart=on-failure
RestartSec=5
ExecStartPre=/usr/sbin/unbound-checkconf /etc/unbound/{name}.conf
ExecStart=/usr/sbin/unbound -d -c /etc/unbound/{name}.conf
ExecReload=/bin/kill -HUP $MAINPID

[Install]
WantedBy=multi-user.target
"""
        files.append({
            "path": f"/etc/systemd/system/{name}.service",
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
