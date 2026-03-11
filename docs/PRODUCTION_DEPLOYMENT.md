# DNS Control v2.1 — Production Deployment Guide

## Target Environment

| Item | Value |
|------|-------|
| OS | Debian 13 (Trixie) |
| Server IP | 172.250.40.100 |
| Hostname | dns-control |
| Backend | FastAPI + SQLite |
| Frontend | React (Vite build) |
| Reverse Proxy | Nginx |

---

## System Architecture

```
┌─────────────────────────────────────────────────┐
│                   Client / NOC                  │
│              https://dns-control                │
└───────────────────┬─────────────────────────────┘
                    │ :443 / :80
┌───────────────────▼─────────────────────────────┐
│                   Nginx                         │
│   TLS termination + static files + proxy        │
│   /api/* → 127.0.0.1:8000                       │
│   /metrics → 127.0.0.1:8000 (restricted)        │
│   /* → /opt/dns-control/dist/index.html          │
└───────────────────┬─────────────────────────────┘
                    │ :8000
┌───────────────────▼─────────────────────────────┐
│            DNS Control API (FastAPI)            │
│   Workers: Health(10s) Metrics(30s) Recon(10s)  │
│   Database: SQLite                              │
│   Auth: JWT + session management                │
└───────────────────┬─────────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌────────┐   ┌────────┐    ┌────────────┐
│Unbound │   │Unbound │    │  nftables  │
│  01    │   │  02    │    │  (DNAT)    │
└────────┘   └────────┘    └────────────┘
```

---

## Step 1 — System Preparation

```bash
# Update
apt update && apt upgrade -y

# Install packages
apt install -y \
  git curl vim sudo sqlite3 \
  python3 python3-venv python3-pip \
  nodejs npm nginx \
  nftables frr unbound ifupdown2 \
  openssl dnsutils
```

---

## Step 2 — Service User

```bash
useradd -r -s /usr/sbin/nologin -d /opt/dns-control dns-control
```

---

## Step 3 — Directory Structure

```bash
mkdir -p /opt/dns-control
mkdir -p /var/lib/dns-control/backups
mkdir -p /var/lib/dns-control/generated
mkdir -p /var/log/dns-control
mkdir -p /etc/dns-control

chown -R dns-control:dns-control /var/lib/dns-control
chown -R dns-control:dns-control /var/log/dns-control
chmod 700 /etc/dns-control
```

---

## Step 4 — Clone Repository

```bash
cd /opt
git clone <YOUR_REPOSITORY_URL> dns-control
cd dns-control
```

---

## Step 5 — Backend Setup

```bash
cd /opt/dns-control/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
```

---

## Step 6 — Environment Configuration

Create `/etc/dns-control/env`:

```bash
cat > /etc/dns-control/env << 'EOF'
DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db
DNS_CONTROL_SECRET_KEY=<GENERATE_WITH_openssl_rand_-hex_32>
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=<STRONG_PASSWORD>
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
EOF

chmod 600 /etc/dns-control/env
```

Generate secret key:

```bash
openssl rand -hex 32
```

---

## Step 7 — Database Initialization

```bash
cd /opt/dns-control/backend
source venv/bin/activate

# Load environment
set -a; source /etc/dns-control/env; set +a

python3 -c "from app.core.database import init_db; init_db()"
```

---

## Step 8 — Systemd Service

```bash
cp /opt/dns-control/deploy/systemd/dns-control-api.service \
   /etc/systemd/system/dns-control-api.service

systemctl daemon-reload
systemctl enable dns-control-api
systemctl start dns-control-api

# Verify
systemctl status dns-control-api
curl -s http://127.0.0.1:8000/api/health
```

---

## Step 9 — Frontend Build

```bash
cd /opt/dns-control
npm install
VITE_API_URL="" npm run build

# Verify build output exists
ls dist/index.html
```

---

## Step 10 — Nginx Configuration

```bash
cp /opt/dns-control/deploy/nginx/dns-control.conf \
   /etc/nginx/sites-available/dns-control

# Edit server_name and paths as needed
vim /etc/nginx/sites-available/dns-control

ln -sf /etc/nginx/sites-available/dns-control /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx
systemctl enable nginx
```

---

## Step 11 — TLS Setup

### Option A: Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dns-control.yourdomain.com
```

### Option B: Custom Certificate

```bash
mkdir -p /etc/ssl/certs/dns-control /etc/ssl/private/dns-control

# Copy your certificates
cp fullchain.pem /etc/ssl/certs/dns-control/
cp privkey.pem /etc/ssl/private/dns-control/

# Update nginx config with cert paths
```

---

## Step 12 — Sudoers for Service User

```bash
cat > /etc/sudoers.d/dns-control << 'EOF'
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
```

---

## Step 13 — Prometheus Integration

Add to `/etc/prometheus/prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'dns-control'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['172.250.40.100:8000']
```

Deploy alert rules:

```bash
cp /opt/dns-control/docs/dns-control-alerts.yml \
   /etc/prometheus/rules/dns-control.yml

promtool check rules /etc/prometheus/rules/dns-control.yml
systemctl reload prometheus
```

---

## Step 14 — Validation

```bash
# Backend health
curl -s http://127.0.0.1:8000/api/health

# Prometheus metrics
curl -s http://127.0.0.1:8000/metrics | head -20

# Frontend
curl -s -o /dev/null -w "%{http_code}" http://172.250.40.100

# Services
systemctl status dns-control-api nginx unbound frr nftables

# Ports
ss -lntup | grep -E ':80|:443|:8000|:53'
```

---

## Step 15 — First Login

1. Open `http://172.250.40.100` (or your domain)
2. Login with `admin` / `<configured password>`
3. Change password on first login
4. Run the configuration wizard

---

## Post-Deploy Checklist

| Item | Status |
|------|--------|
| Backend running | ☐ |
| Frontend accessible | ☐ |
| Nginx proxying `/api/*` | ☐ |
| TLS configured | ☐ |
| Admin password changed | ☐ |
| Prometheus scraping | ☐ |
| Health engine active | ☐ |
| Metrics collecting | ☐ |
| Sudoers configured | ☐ |
| Firewall rules set | ☐ |
