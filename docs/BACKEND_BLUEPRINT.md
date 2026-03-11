# DNS Control — Backend Blueprint

## Architecture

```
/opt/dns-control/
├── app/
│   ├── main.py              # FastAPI entrypoint
│   ├── config.py             # App settings (env vars, paths)
│   ├── auth.py               # Authentication (local/PAM)
│   ├── database.py           # SQLite connection + migrations
│   ├── models.py             # SQLAlchemy/Pydantic models
│   ├── routers/
│   │   ├── system.py         # GET /api/v1/system/info, /services, POST /services/{name}/restart
│   │   ├── network.py        # GET /api/v1/network/interfaces, /routes, POST /reachability
│   │   ├── dns.py            # GET /api/v1/dns/metrics, /top-domains, /instances
│   │   ├── nat.py            # GET /api/v1/nat/counters, /sticky, /ruleset
│   │   ├── ospf.py           # GET /api/v1/ospf/neighbors, /routes, /running-config
│   │   ├── logs.py           # GET /api/v1/logs, POST /logs/export
│   │   ├── diag.py           # GET /api/v1/diag/commands, POST /diag/run/{id}, /health-check
│   │   ├── config.py         # GET/POST /api/v1/config/current, /validate, /preview, /apply
│   │   ├── history.py        # GET /api/v1/history, /{id}, /diff, POST /{id}/reapply
│   │   ├── profiles.py       # CRUD /api/v1/profiles
│   │   └── reports.py        # POST /api/v1/reports/generate
│   ├── services/
│   │   ├── executor.py       # Controlled command execution (subprocess, no shell)
│   │   ├── config_gen.py     # Template-based config file generation
│   │   ├── applier.py        # Orchestrates apply: validate → backup → generate → write → restart → test
│   │   ├── validator.py      # Config validation logic
│   │   ├── metrics.py        # Parses unbound-control stats, nft counters, FRR output
│   │   ├── backup.py         # File backup/versioning before overwrite
│   │   └── health.py         # Health check runner
│   └── templates/            # Jinja2 templates for config files
│       ├── unbound.conf.j2
│       ├── nftables.conf.j2
│       ├── frr.conf.j2
│       ├── post-up.sh.j2
│       ├── systemd-unit.j2
│       └── interfaces.j2
├── scripts/
│   ├── install.sh            # Initial installation script
│   ├── dns-control-apply     # Privileged apply script (called by backend via sudo)
│   └── dns-control-diagnose  # Privileged diagnostic script
├── requirements.txt
├── systemd/
│   └── dns-control.service
├── venv/                     # Python virtual environment
└── README.md

/var/lib/dns-control/
├── dns-control.db            # SQLite database
├── config.json               # Current active configuration
├── backups/                  # Timestamped config backups
│   ├── 2026-03-10T14:30:00/
│   │   ├── unbound01.conf
│   │   ├── nftables.conf
│   │   └── ...
│   └── ...
└── profiles/                 # Saved config profiles

/var/log/dns-control/
├── app.log                   # Application log
├── apply.log                 # Apply execution log
└── audit.log                 # Audit trail
```

## SQLite Schema

### Authentication

```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login_at TEXT
);

CREATE TABLE sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(32)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Initial admin user (password: changeme, bcrypt hash)
-- Generate with: python3 -c "from passlib.hash import bcrypt; print(bcrypt.hash('changeme'))"
INSERT INTO users (id, username, password_hash) VALUES (
    'usr-admin-001',
    'admin',
    '$2b$12$PLACEHOLDER_HASH_CHANGE_ON_INSTALL'
);
```

### Application Data

```sql
CREATE TABLE config_snapshots (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    config_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    comment TEXT
);

CREATE TABLE apply_history (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    user TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success','failed','partial','dry-run')),
    scope TEXT NOT NULL CHECK(scope IN ('full','dns','network','frr','nftables')),
    dry_run INTEGER NOT NULL DEFAULT 0,
    comment TEXT,
    duration_ms INTEGER,
    config_snapshot_id TEXT REFERENCES config_snapshots(id),
    steps_json TEXT NOT NULL,
    files_json TEXT NOT NULL
);

CREATE TABLE apply_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apply_id TEXT REFERENCES apply_history(id),
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    level TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE file_backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apply_id TEXT REFERENCES apply_history(id),
    file_path TEXT NOT NULL,
    original_content TEXT,
    new_content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    user TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT
);

CREATE TABLE dns_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    instance TEXT NOT NULL,
    qps INTEGER,
    cache_hits INTEGER,
    cache_misses INTEGER,
    avg_latency_ms REAL,
    servfail INTEGER,
    nxdomain INTEGER,
    refused INTEGER,
    noerror INTEGER
);

CREATE INDEX idx_metrics_ts ON dns_metrics(timestamp);
CREATE INDEX idx_metrics_instance ON dns_metrics(instance);
CREATE INDEX idx_history_ts ON apply_history(created_at);
```

## Executor Design (executor.py)

```python
import subprocess
import logging

ALLOWED_COMMANDS = {
    'systemctl': ['/usr/bin/systemctl'],
    'ip': ['/usr/sbin/ip'],
    'ss': ['/usr/bin/ss'],
    'dig': ['/usr/bin/dig'],
    'nft': ['/usr/sbin/nft'],
    'vtysh': ['/usr/bin/vtysh'],
    'unbound-control': ['/usr/sbin/unbound-control'],
    'unbound-checkconf': ['/usr/sbin/unbound-checkconf'],
    'dpkg': ['/usr/bin/dpkg'],
    'apt-get': ['/usr/bin/apt-get'],
    'dns-control-apply': ['/usr/local/sbin/dns-control-apply'],
    'dns-control-diagnose': ['/usr/local/sbin/dns-control-diagnose'],
}

def run_command(cmd: list[str], timeout: int = 30) -> tuple[int, str, str]:
    """Execute a whitelisted command. No shell=True ever."""
    binary = cmd[0]
    if binary not in ALLOWED_COMMANDS:
        raise PermissionError(f"Command not whitelisted: {binary}")

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        shell=False,
    )
    return result.returncode, result.stdout, result.stderr
```

## Apply Flow

```
1. validate_config(config)          → Check all fields
2. backup_current_files()           → Copy existing configs to /var/lib/dns-control/backups/
3. generate_files(config)           → Render Jinja2 templates
4. write_files(files)               → Write to disk with correct permissions
5. reload_network()                 → Run post-up.sh
6. reload_nftables()                → nft -f /etc/nftables.conf
7. restart_unbound_instances()      → systemctl restart unbound01..N
8. restart_frr()                    → systemctl restart frr
9. validate_dns()                   → dig @VIP, dig @each-instance
10. validate_ospf()                 → vtysh show ip ospf neighbor
11. save_to_history()               → Insert into SQLite
```

## Metrics Collection (cron or systemd timer)

Every 60 seconds:
```bash
for inst in unbound01 unbound02 unbound03 unbound04; do
    unbound-control -c /etc/unbound/${inst}.conf stats_noreset
done
```
Parse output → INSERT INTO dns_metrics

## Installation Script (install.sh)

```bash
#!/bin/bash
set -euo pipefail

apt-get update
apt-get install -y python3 python3-venv python3-pip unbound frr nftables ifupdown2 dnsutils

# Create user
useradd -r -s /usr/sbin/nologin dns-control 2>/dev/null || true

# Create directories
mkdir -p /opt/dns-control /var/lib/dns-control/{backups,profiles} /var/log/dns-control

# Setup Python venv
python3 -m venv /opt/dns-control/venv
/opt/dns-control/venv/bin/pip install fastapi uvicorn[standard] jinja2 pydantic

# Copy application files
cp -r app/ /opt/dns-control/
cp scripts/dns-control-apply /usr/local/sbin/
cp scripts/dns-control-diagnose /usr/local/sbin/
chmod +x /usr/local/sbin/dns-control-*

# Sudoers for controlled privilege escalation
cat > /etc/sudoers.d/dns-control << 'EOF'
dns-control ALL=(root) NOPASSWD: /usr/local/sbin/dns-control-apply
dns-control ALL=(root) NOPASSWD: /usr/local/sbin/dns-control-diagnose
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart unbound*
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl restart frr
dns-control ALL=(root) NOPASSWD: /usr/bin/systemctl status *
dns-control ALL=(root) NOPASSWD: /usr/sbin/nft *
dns-control ALL=(root) NOPASSWD: /usr/sbin/ip *
dns-control ALL=(root) NOPASSWD: /usr/bin/vtysh *
dns-control ALL=(root) NOPASSWD: /usr/sbin/unbound-control *
EOF

# Install systemd service
cp systemd/dns-control.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable dns-control
systemctl start dns-control

echo "[OK] DNS Control installed successfully"
echo "Access: http://$(hostname -I | awk '{print $1}'):8443"
```

## API Contract Summary

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/system/info | System info (hostname, versions, uptime) |
| GET | /api/v1/system/services | All service statuses |
| POST | /api/v1/system/services/{name}/restart | Restart a service |
| GET | /api/v1/network/interfaces | Network interfaces with IPs |
| GET | /api/v1/network/routes | Routing table |
| POST | /api/v1/network/reachability | Ping test targets |
| GET | /api/v1/dns/metrics?hours=6&instance= | DNS metrics timeseries |
| GET | /api/v1/dns/top-domains?limit=20 | Top queried domains |
| GET | /api/v1/dns/instances | Per-instance statistics |
| GET | /api/v1/nat/counters | nftables DNAT counters |
| GET | /api/v1/nat/sticky | Sticky table entries |
| GET | /api/v1/nat/ruleset | Full nft ruleset |
| GET | /api/v1/ospf/neighbors | OSPF neighbor table |
| GET | /api/v1/ospf/routes | OSPF redistributed routes |
| GET | /api/v1/ospf/running-config | FRR running config |
| GET | /api/v1/logs?source=&search=&page= | Paginated logs |
| POST | /api/v1/logs/export | Export logs as file |
| GET | /api/v1/diag/commands | Available diagnostic commands |
| POST | /api/v1/diag/run/{id} | Execute a diagnostic command |
| POST | /api/v1/diag/health-check | Run full health check |
| GET | /api/v1/config/current | Current active config |
| POST | /api/v1/config/validate | Validate a config |
| POST | /api/v1/config/preview | Preview generated files |
| POST | /api/v1/config/apply | Apply configuration |
| GET | /api/v1/history?page= | Apply history |
| GET | /api/v1/history/{id} | Single history entry |
| GET | /api/v1/history/diff?from=&to= | Config diff between versions |
| POST | /api/v1/history/{id}/reapply | Reapply a historical config |
| GET | /api/v1/profiles | List saved profiles |
| POST | /api/v1/profiles | Save new profile |
| POST | /api/v1/profiles/import | Import profile from JSON |
| GET | /api/v1/profiles/{id}/export | Export profile as JSON |
| DELETE | /api/v1/profiles/{id} | Delete profile |
| POST | /api/v1/reports/generate | Generate technical report |

### Authentication Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/v1/auth/login | Login with username/password → returns JWT token |
| POST | /api/v1/auth/logout | Invalidate current session |
| GET | /api/v1/auth/session | Validate token, return current user |
| GET | /api/v1/auth/users | List all users |
| POST | /api/v1/auth/users | Create new user |
| PATCH | /api/v1/auth/users/{id} | Update user (enable/disable) |
| PATCH | /api/v1/auth/users/{id}/password | Change user password |
| DELETE | /api/v1/auth/users/{id} | Delete user |

### Auth Request/Response Schemas

**POST /api/v1/auth/login**
```json
// Request
{ "username": "admin", "password": "secret" }

// Response (200)
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": "usr-001", "username": "admin", "isActive": true, "lastLoginAt": "..." }
  }
}

// Response (401)
{ "success": false, "error": "Credenciais inválidas" }
```

**POST /api/v1/auth/users**
```json
// Request
{ "username": "operador", "password": "min6chars" }

// Response (201)
{ "success": true, "data": { "id": "usr-002", "username": "operador", "isActive": true, ... } }

// Response (409)
{ "success": false, "error": "Usuário já existe" }
```

### Authentication Flow

1. **Login**: Client sends POST /auth/login → backend verifies bcrypt hash → creates session → returns JWT
2. **Session**: All protected endpoints require `Authorization: Bearer <token>` header
3. **Validation**: Backend middleware decodes JWT, checks session table, verifies expiry
4. **Logout**: POST /auth/logout invalidates the session in SQLite
5. **Timeout**: Sessions expire after 8 hours (configurable). Frontend redirects to /login on 401.

### Password Strategy

- **Hashing**: bcrypt with cost factor 12 (via `passlib[bcrypt]`)
- **Minimum length**: 6 characters enforced server-side
- **No plaintext storage**: Only bcrypt hashes stored in SQLite
- **First admin**: Created by install.sh with a temporary password, must be changed on first login

### Backend Auth Module (auth.py)

```python
from passlib.hash import bcrypt
from jose import jwt
import secrets
from datetime import datetime, timedelta

SECRET_KEY = os.environ.get("DNS_CONTROL_SECRET", secrets.token_hex(32))
TOKEN_EXPIRY_HOURS = 8

def hash_password(password: str) -> str:
    return bcrypt.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.verify(password, password_hash)

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRY_HOURS),
        "iat": datetime.utcnow(),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")

def verify_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return None

# FastAPI dependency
async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Token não fornecido")
    token = authorization.split(" ", 1)[1]
    payload = verify_token(token)
    if not payload:
        raise HTTPException(401, "Token inválido ou expirado")
    user = await db.get_user_by_id(payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401, "Usuário inativo ou não encontrado")
    return user
```


## Requirements.txt

```
fastapi==0.115.0
uvicorn[standard]==0.32.0
jinja2==3.1.4
pydantic==2.10.0
python-multipart==0.0.12
passlib[bcrypt]==1.7.4
python-jose[cryptography]==3.3.0
aiosqlite==0.20.0
```
