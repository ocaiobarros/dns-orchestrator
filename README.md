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

## Deploy em Produção — Debian 13

### Arquitetura

```
Cliente (HTTPS:443) → nginx → arquivos estáticos (frontend React)
                            → proxy /api/ → uvicorn (127.0.0.1:8000)
```

- nginx faz terminação HTTPS e serve o frontend
- Backend escuta apenas em `127.0.0.1:8000` (não exposto)
- `/api/` é proxy reverso para o FastAPI
- `/docs` e `/openapi.json` também são proxied

### Deploy automático (script completo)

```bash
# 1. Clonar repositório
git clone <repo> /opt/dns-control

# 2. Executar script de deploy
chmod +x /opt/dns-control/deploy/deploy.sh
sudo bash /opt/dns-control/deploy/deploy.sh
```

O script faz tudo: instala pacotes, cria usuário de serviço, virtualenv, build frontend, configura nginx e systemd.

### Deploy manual passo a passo

#### 1. Instalar pacotes

```bash
apt update
apt install -y python3 python3-venv python3-pip nginx sqlite3 curl openssl nodejs npm
```

#### 2. Criar usuário de serviço

```bash
useradd --system --create-home --shell /usr/sbin/nologin dns-control
```

#### 3. Backend — virtualenv e dependências

```bash
cd /opt/dns-control/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

#### 4. Arquivo de ambiente

```bash
mkdir -p /etc/dns-control
chmod 700 /etc/dns-control

cat > /etc/dns-control/env <<EOF
DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db
DNS_CONTROL_SECRET_KEY=$(openssl rand -hex 32)
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=TROCAR_IMEDIATAMENTE
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
EOF

chmod 600 /etc/dns-control/env
```

#### 5. Systemd service

```bash
cp /opt/dns-control/deploy/systemd/dns-control-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable dns-control-api
systemctl start dns-control-api
```

#### 6. Build frontend

```bash
cd /opt/dns-control
npm install
npm run build
# Build sai em /opt/dns-control/dist
```

#### 7. nginx

```bash
cp /opt/dns-control/deploy/nginx/dns-control.conf /etc/nginx/sites-available/dns-control
ln -s /etc/nginx/sites-available/dns-control /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Ajustar domínio e certificados
nano /etc/nginx/sites-available/dns-control

nginx -t
systemctl enable nginx
systemctl reload nginx
```

#### 8. Certificado TLS

Certificado próprio:
```bash
mkdir -p /etc/ssl/certs/dns-control /etc/ssl/private/dns-control
# Copie fullchain.pem e privkey.pem para os diretórios acima
```

Let's Encrypt:
```bash
apt install -y certbot
certbot certonly --standalone -d dnscontrol.seudominio.com.br
# Ajuste os paths no nginx para /etc/letsencrypt/live/...
```

### Validação

```bash
# Backend
curl http://127.0.0.1:8000/api/health

# nginx
nginx -t

# Frontend
# Abrir https://dnscontrol.seudominio.com.br no navegador

# Logs
journalctl -u dns-control-api -f
tail -f /var/log/nginx/dns-control-error.log
```

### Headers de segurança incluídos

- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `X-XSS-Protection: 1; mode=block`

### Arquivos de deploy no repositório

| Arquivo | Descrição |
|---------|-----------|
| `deploy/nginx/dns-control.conf` | Server block nginx completo |
| `deploy/systemd/dns-control-api.service` | Service systemd do backend |
| `deploy/env.example` | Modelo de arquivo de variáveis |
| `deploy/deploy.sh` | Script de deploy automatizado |

## API Documentation

Start the backend and visit `http://localhost:8000/docs` for interactive Swagger documentation.
