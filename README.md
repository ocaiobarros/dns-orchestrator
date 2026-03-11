# DNS Control

Infrastructure management console for recursive DNS on Debian 13.  
Manages Unbound, FRR/OSPF, nftables, and systemd through a unified web interface.

## Architecture

```
dns-control/
├── backend/                    # Python/FastAPI backend
│   ├── app/
│   │   ├── main.py            # FastAPI entry point
│   │   ├── core/              # Config, security, database, sessions
│   │   ├── models/            # SQLAlchemy models (User, Session, ConfigProfile, etc.)
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── api/routes/        # REST API endpoints
│   │   ├── services/          # Business logic layer
│   │   ├── executors/         # Secure command execution (whitelist-based)
│   │   ├── generators/        # Config file generators (Unbound, nftables, FRR)
│   │   ├── db/                # SQLite schema and seed scripts
│   │   └── scripts/           # Installation and admin scripts
│   └── requirements.txt
├── src/                        # React/TypeScript frontend
│   ├── components/            # Reusable UI components
│   ├── lib/                   # API client, auth, types, validation
│   └── pages/                 # Route-based pages
└── docs/                      # Backend blueprint documentation
```

## Requirements

- **Target OS**: Debian 13 (Trixie)
- **System packages**: unbound, frr, nftables, ifupdown2, sqlite3, python3
- **Python**: 3.11+
- **Node.js**: 18+ (for frontend build)

## Quick Start — Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
export DNS_CONTROL_INITIAL_ADMIN_PASSWORD=changeme
export DNS_CONTROL_DB_PATH=./dns-control.db

uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The database and default admin user are created automatically on first startup.  
The admin must change their password on first login (`must_change_password=true`).

## Quick Start — Frontend

```bash
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

Without `VITE_API_URL`, the frontend runs in preview mode with mock data.

## Production Build

```bash
npm run build    # outputs to dist/
```

## Debian 13 Installation

```bash
sudo bash backend/app/scripts/install_debian13.sh
```

This script:
1. Installs system packages (unbound, frr, nftables, ifupdown2)
2. Creates the `dns-control` service user
3. Sets up the Python virtualenv and dependencies
4. Initializes the SQLite database
5. Creates the default admin user
6. Installs and starts the systemd service
7. Configures sudoers for privileged commands

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DNS_CONTROL_DB_PATH` | `/var/lib/dns-control/dns-control.db` | SQLite database path |
| `DNS_CONTROL_SECRET_KEY` | *(required)* | JWT signing key |
| `DNS_CONTROL_SESSION_TIMEOUT_MINUTES` | `30` | Session timeout |
| `DNS_CONTROL_SESSION_WARNING_SECONDS` | `120` | Warning before expiry |
| `DNS_CONTROL_INITIAL_ADMIN_USERNAME` | `admin` | Bootstrap admin username |
| `DNS_CONTROL_INITIAL_ADMIN_PASSWORD` | `admin` | Bootstrap admin password |
| `DNS_CONTROL_HOST` | `127.0.0.1` | API bind address |
| `DNS_CONTROL_PORT` | `8000` | API port |

## SQLite Tables

- **users** — Local user accounts with bcrypt password hashing
- **sessions** — Server-side session tracking with expiration
- **config_profiles** — Saved infrastructure configurations
- **config_revisions** — Version history for each profile
- **apply_jobs** — Deployment execution history with stdout/stderr
- **log_entries** — Structured audit and system logs
- **settings** — Key-value application settings

## Authentication

- Local authentication with bcrypt password hashing
- JWT-based session tokens with server-side validation
- Configurable session timeout with countdown warning
- Forced password change on first login
- User management: create, disable, enable, delete, password reset

## Security

- **Command execution**: Whitelist-based only — no arbitrary shell access
- **Sudoers**: Least-privilege escalation for specific system commands
- **Sessions**: Server-side validation, automatic expiration
- **Passwords**: bcrypt with minimum length enforcement
- **API**: All endpoints require valid authentication token

## Systemd Service

```ini
# /etc/systemd/system/dns-control-api.service
[Unit]
Description=DNS Control API
After=network.target

[Service]
Type=simple
User=dns-control
Group=dns-control
WorkingDirectory=/opt/dns-control/backend
EnvironmentFile=/etc/dns-control/env
ExecStart=/opt/dns-control/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Troubleshooting

```bash
# Check API status
systemctl status dns-control-api

# View API logs
journalctl -u dns-control-api -f

# Reset admin password
cd /opt/dns-control/backend
source venv/bin/activate
python app/scripts/create_admin.py admin newpassword

# Test DNS resolution
dig @127.0.0.1 google.com +short

# Check OSPF neighbors
vtysh -c "show ip ospf neighbor"

# List nftables rules
nft list ruleset
```

## Production Deployment with nginx

### Install nginx

```bash
apt install -y nginx
```

### Configure reverse proxy

```bash
cp deploy/nginx/dns-control.conf /etc/nginx/sites-available/dns-control
ln -s /etc/nginx/sites-available/dns-control /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
```

### Edit server name and TLS paths

```bash
nano /etc/nginx/sites-available/dns-control
# Replace dns-control.example.com with your domain
# Update ssl_certificate and ssl_certificate_key paths
```

### Obtain TLS certificate (Let's Encrypt)

```bash
mkdir -p /var/www/certbot
apt install -y certbot
certbot certonly --webroot -w /var/www/certbot -d dns-control.example.com
```

### Deploy frontend build

```bash
npm run build
mkdir -p /opt/dns-control/frontend
cp -r dist/ /opt/dns-control/frontend/dist/
```

### Test and reload nginx

```bash
nginx -t
systemctl reload nginx
```

### Production architecture

```
Client (HTTPS:443) → nginx → static files (frontend)
                           → proxy /api/ → uvicorn (127.0.0.1:8000)
```

- nginx handles HTTPS termination and security headers
- Backend binds only to `127.0.0.1` (not exposed externally)
- Static frontend assets served directly by nginx with 1-year cache
- API responses are not cached

### Security headers included

- `Strict-Transport-Security` (HSTS with preload)
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy`
- `Referrer-Policy`
- `Permissions-Policy`

## API Documentation

Start the backend and visit `http://localhost:8000/docs` for interactive Swagger documentation.
