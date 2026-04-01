# DNS Control — Instalação

## Requisitos

| Item | Versão |
|---|---|
| Sistema operacional | Debian 12 (Bookworm) ou Debian 13 (Trixie) |
| Python | 3.11+ |
| Node.js | 18+ (para build do frontend) |
| Pacotes de sistema | unbound, nftables, frr, ifupdown2, nginx, sqlite3 |

---

## Instalação Automatizada (Recomendada)

```bash
git clone <repositório> /opt/dns-control
cd /opt/dns-control
sudo bash deploy/deploy.sh
```

O script é **idempotente** — pode ser executado múltiplas vezes sem quebrar o sistema.

### O que o script executa (12 etapas)

| Etapa | Descrição |
|---|---|
| 1 | Atualização do sistema e instalação de pacotes (python3, nodejs, nginx, unbound, nftables, frr) |
| 2 | Criação do usuário de serviço `dns-control` |
| 3 | Criação de diretórios (`/var/lib/dns-control`, `/etc/dns-control`, `/var/log/dns-control`) |
| 4 | Virtualenv Python e instalação de dependências |
| 5 | Criação do arquivo de ambiente (`/etc/dns-control/env`) |
| 6 | Inicialização do banco SQLite |
| 7 | Build do frontend React |
| 8 | Permissões e sudoers |
| 9 | Configuração do nginx (proxy reverso + SPA fallback) |
| 10 | Configuração do nftables (persistência) |
| 11 | Instalação e ativação dos serviços systemd (API + Collector) |
| 12 | Validações automáticas |

### Validações automáticas

Ao final, o script verifica automaticamente:

```
✓ dns-control-api ativo
✓ dns-control-collector.timer ativo
✓ nginx ativo
✓ nftables ativo
✓ API /health responde
✓ Banco de dados acessível
✓ Frontend dist/index.html existe
✓ Sudoers validado
```

Se alguma validação falhar, o script exibe o erro e o caminho para o log.

---

## Estrutura de Diretórios

```
/opt/dns-control/             # Código-fonte e binários
├── backend/                  # API FastAPI + geradores
│   └── venv/                 # Virtualenv Python
├── collector/                # Coletor de telemetria
├── deploy/                   # Configs de deploy (nginx, systemd, sudoers)
├── dist/                     # Frontend compilado
└── src/                      # Código-fonte do frontend

/var/lib/dns-control/         # Dados persistentes
├── dns-control.db            # Banco SQLite
├── backups/                  # Backups de configuração
├── deployments/              # Histórico de deploys
├── staging/                  # Staging pré-apply
└── telemetry/                # Séries temporais do collector
    ├── latest.json           # Última coleta
    └── history.json          # Histórico (últimas 360 amostras)

/etc/dns-control/             # Configuração global
└── env                       # Variáveis de ambiente (chmod 600)

/var/log/dns-control/         # Logs
└── install.log               # Log da instalação
```

---

## Arquivo de Ambiente

O arquivo `/etc/dns-control/env` é criado automaticamente pelo instalador. Para personalizar antes da instalação:

```bash
export DNS_CONTROL_INITIAL_ADMIN_PASSWORD="SuaSenhaForte123"
sudo bash deploy/deploy.sh
```

Se nenhuma senha for fornecida, o instalador gera uma senha aleatória e exibe no terminal.

### Variáveis disponíveis

```bash
DNS_CONTROL_DB_PATH=/var/lib/dns-control/dns-control.db
DNS_CONTROL_SECRET_KEY=<gerada automaticamente>
DNS_CONTROL_SESSION_TIMEOUT_MINUTES=30
DNS_CONTROL_SESSION_WARNING_SECONDS=120
DNS_CONTROL_INITIAL_ADMIN_USERNAME=admin
DNS_CONTROL_INITIAL_ADMIN_PASSWORD=<definida na instalação>
DNS_CONTROL_HOST=127.0.0.1
DNS_CONTROL_PORT=8000
COLLECTOR_OUTPUT_DIR=/var/lib/dns-control/telemetry
```

Para gerar uma nova chave secreta manualmente:

```bash
openssl rand -hex 32
```

---

## Serviços Systemd

O instalador configura três serviços:

| Serviço | Tipo | Descrição |
|---|---|---|
| `dns-control-api` | simple | API FastAPI (uvicorn na porta 8000) |
| `dns-control-collector.service` | oneshot | Coleta de métricas (unbound-control, nftables) |
| `dns-control-collector.timer` | timer | Dispara o collector a cada 10 segundos |

### Comandos de gerenciamento

```bash
# Status dos serviços
systemctl status dns-control-api
systemctl status dns-control-collector.timer

# Logs em tempo real
journalctl -u dns-control-api -f
journalctl -u dns-control-collector -f

# Reiniciar API
systemctl restart dns-control-api

# Verificar timer do collector
systemctl list-timers dns-control-collector.timer
```

---

## Configuração do nginx

O nginx é configurado como proxy reverso com SPA fallback:

- `/api/*` → proxy para `127.0.0.1:8000`
- `/metrics` → proxy para `127.0.0.1:8000`
- `/docs` → proxy para `127.0.0.1:8000` (Swagger)
- `/*` → `try_files $uri $uri/ /index.html` (SPA fallback)

O SPA fallback é **obrigatório** — sem ele, rotas como `/dns`, `/metrics` e `/settings` retornam 404 ao recarregar a página.

### Certificado TLS (opcional)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d dns-control.seudominio.com.br
```

Para certificado próprio, edite o bloco HTTPS comentado em `/etc/nginx/sites-available/dns-control`.

---

## Persistência nftables

O instalador garante que o nftables esteja habilitado para iniciar no boot:

```bash
systemctl enable nftables
```

As regras são gerenciadas pelo DNS Control via snippets em `/etc/nftables.d/` e carregadas por `include` no `/etc/nftables.conf`.

Para verificar o ruleset carregado:

```bash
nft list ruleset
```

---

## Primeiro Acesso

1. Abra `http://<IP_DO_SERVIDOR>` no navegador
2. Login com `admin` / senha definida na instalação
3. Altere a senha no primeiro acesso (obrigatório)
4. Execute o **Wizard de Configuração**
5. Após o Wizard: DNS, métricas e gráficos estarão operacionais (~30 segundos)

---

## Checklist Pós-Instalação

| Item | Comando | Esperado |
|---|---|---|
| API rodando | `systemctl is-active dns-control-api` | active |
| Collector ativo | `systemctl is-active dns-control-collector.timer` | active |
| nginx rodando | `systemctl is-active nginx` | active |
| nftables ativo | `systemctl is-active nftables` | active |
| Saúde da API | `curl http://127.0.0.1:8000/api/health` | `{"status":"ok"}` |
| Frontend | `curl -I http://<IP>` | 200 OK |
| Resolução DNS | `dig @127.0.0.1 google.com +short` | IP válido |
| Telemetria | `cat /var/lib/dns-control/telemetry/latest.json \| python3 -m json.tool \| head -5` | JSON válido |
| Logs API | `journalctl -u dns-control-api -n 5` | Sem erros |
| Sudoers | `visudo -cf /etc/sudoers.d/dns-control` | parsed OK |

---

## Reinstalação / Atualização

Para atualizar o sistema em produção:

```bash
cd /opt/dns-control
git pull
sudo bash deploy/deploy.sh
```

O script preserva automaticamente:
- Banco de dados existente
- Arquivo de ambiente (`/etc/dns-control/env`)
- Dados de telemetria

---

## Resolução de Problemas na Instalação

### API não inicia

```bash
journalctl -u dns-control-api --no-pager -n 30
# Verificar se uvicorn está funcional:
/opt/dns-control/backend/venv/bin/uvicorn --version
```

### nginx retorna 502

```bash
# API está rodando?
curl http://127.0.0.1:8000/api/health
# nginx aponta para a porta correta?
grep proxy_pass /etc/nginx/sites-available/dns-control
```

### Collector não gera dados

```bash
# Timer ativo?
systemctl status dns-control-collector.timer
# Executar manualmente:
sudo -u dns-control python3 /opt/dns-control/collector/collector.py
# Verificar saída:
ls -la /var/lib/dns-control/telemetry/
```

### Página recarrega com 404 (rotas SPA)

```bash
# Verificar SPA fallback:
grep try_files /etc/nginx/sites-available/dns-control
# Deve conter: try_files $uri $uri/ /index.html;
```
