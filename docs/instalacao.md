# DNS Control — Instalação

## Requisitos

| Item | Versão |
|---|---|
| Sistema operacional | Debian 12 (Bookworm) ou Debian 13 (Trixie) |
| Python | 3.11+ |
| Node.js | 18+ (para build do frontend) |
| Pacotes de sistema | unbound, nftables, frr, ifupdown2, sqlite3 |

---

## Instalação Automatizada

```bash
git clone <repositório> /opt/dns-control
cd /opt/dns-control
chmod +x deploy/deploy.sh
sudo bash deploy/deploy.sh
```

O script executa automaticamente:

1. Instalação de pacotes do sistema (unbound, frr, nftables, nginx, etc.)
2. Criação do usuário de serviço `dns-control`
3. Estrutura de diretórios (`/var/lib/dns-control`, `/etc/dns-control`)
4. Virtualenv Python e dependências
5. Inicialização do banco SQLite
6. Criação do usuário admin padrão
7. Build do frontend React
8. Configuração do nginx e systemd
9. Ativação dos serviços

---

## Instalação Manual — Passo a Passo

### 1. Pacotes do Sistema

```bash
apt update && apt upgrade -y
apt install -y \
  git curl vim sudo sqlite3 \
  python3 python3-venv python3-pip \
  nodejs npm nginx openssl dnsutils \
  nftables frr unbound ifupdown2
```

### 2. Usuário de Serviço

```bash
useradd -r -s /usr/sbin/nologin -d /opt/dns-control dns-control
```

### 3. Estrutura de Diretórios

```bash
mkdir -p /opt/dns-control
mkdir -p /var/lib/dns-control/{backups,deployments,staging,telemetry}
mkdir -p /etc/dns-control

chown -R dns-control:dns-control /var/lib/dns-control
chmod 700 /etc/dns-control
```

### 4. Clonar Repositório

```bash
cd /opt
git clone <repositório> dns-control
cd dns-control
```

### 5. Backend — Virtualenv e Dependências

```bash
cd /opt/dns-control/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip wheel
pip install -r requirements.txt
```

### 6. Arquivo de Ambiente

```bash
cat > /etc/dns-control/env << 'EOF'
DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db
DNS_CONTROL_SECRET_KEY=GERAR_COM_openssl_rand_-hex_32
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=TROCAR_IMEDIATAMENTE
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
COLLECTOR_OUTPUT_DIR=/var/lib/dns-control/telemetry
EOF

chmod 600 /etc/dns-control/env
```

Gerar chave secreta:

```bash
openssl rand -hex 32
```

### 7. Inicialização do Banco

```bash
cd /opt/dns-control/backend
source venv/bin/activate
set -a; source /etc/dns-control/env; set +a
python3 -c "from app.core.database import init_db; init_db()"
```

### 8. Serviço Systemd — API

```bash
cp /opt/dns-control/deploy/systemd/dns-control-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable dns-control-api
systemctl start dns-control-api

# Verificar
systemctl status dns-control-api
curl -s http://127.0.0.1:8000/api/health
```

### 9. Serviço Systemd — Collector de Telemetria

```bash
cp /opt/dns-control/deploy/systemd/dns-control-collector.service /etc/systemd/system/
cp /opt/dns-control/deploy/systemd/dns-control-collector.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dns-control-collector.timer

# Verificar
systemctl status dns-control-collector.timer
cat /var/lib/dns-control/telemetry/latest.json | python3 -m json.tool | head -20
```

### 10. Build do Frontend

```bash
cd /opt/dns-control
npm install
VITE_API_URL="" npm run build

# Verificar
ls dist/index.html
```

### 11. Nginx

```bash
cp /opt/dns-control/deploy/nginx/dns-control.conf /etc/nginx/sites-available/dns-control
ln -sf /etc/nginx/sites-available/dns-control /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Ajustar server_name e caminhos de certificado
nano /etc/nginx/sites-available/dns-control

nginx -t
systemctl enable nginx
systemctl reload nginx
```

### 12. Certificado TLS

**Let's Encrypt:**

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dns-control.seudominio.com.br
```

**Certificado próprio:**

```bash
mkdir -p /etc/ssl/certs/dns-control /etc/ssl/private/dns-control
cp fullchain.pem /etc/ssl/certs/dns-control/
cp privkey.pem /etc/ssl/private/dns-control/
# Ajustar caminhos no nginx
```

### 13. Sudoers para Diagnósticos Privilegiados

```bash
cp /opt/dns-control/deploy/sudoers/dns-control-diagnostics /etc/sudoers.d/
chmod 0440 /etc/sudoers.d/dns-control-diagnostics

# Validar sintaxe (CRÍTICO — sudoers corrompido pode travar o acesso)
visudo -cf /etc/sudoers.d/dns-control-diagnostics
```

---

## Primeiro Acesso

1. Abrir `https://dns-control.seudominio.com.br` no navegador
2. Login com `admin` / senha configurada em `/etc/dns-control/env`
3. Alterar a senha obrigatoriamente no primeiro acesso
4. Executar o Wizard de Configuração para gerar os artefatos

---

## Checklist Pós-Instalação

| Item | Comando | Esperado |
|---|---|---|
| API rodando | `systemctl status dns-control-api` | active (running) |
| Saúde da API | `curl http://127.0.0.1:8000/api/health` | `{"status":"ok"}` |
| Frontend acessível | `curl -I https://dns-control.seudominio.com.br` | 200 OK |
| Collector ativo | `systemctl status dns-control-collector.timer` | active |
| Telemetria | `ls /var/lib/dns-control/telemetry/latest.json` | arquivo presente |
| Resolução DNS | `dig @127.0.0.1 google.com +short` | IP válido |
| Nginx | `nginx -t` | syntax is ok |
| TLS | Verificar no navegador | Certificado válido |
| Sudoers | `visudo -cf /etc/sudoers.d/dns-control-diagnostics` | parsed OK |
| Senha admin alterada | Login no dashboard | Sem redirecionamento para troca |
