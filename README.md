# DNS Control

Plataforma de implantação, administração e monitoramento de infraestrutura DNS recursiva para provedores de internet e ambientes corporativos.

Gerencia **Unbound**, **nftables**, **FRR/OSPF** e **systemd** através de uma interface web unificada com dashboard operacional em tempo real.

---

## Arquitetura

```
Cliente (HTTPS:443)
    │
    ▼
┌─────────────────────────────────────────────┐
│                   Nginx                     │
│   Terminação TLS + arquivos estáticos       │
│   /api/* → proxy → 127.0.0.1:8000          │
└───────────────────┬─────────────────────────┘
                    │
┌───────────────────▼─────────────────────────┐
│          DNS Control API (FastAPI)           │
│   Workers: Health(10s) Metrics(30s)         │
│   Banco: SQLite · Auth: JWT + bcrypt        │
└───────────────────┬─────────────────────────┘
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
┌────────┐   ┌────────┐    ┌────────────┐
│Unbound │   │Unbound │    │  nftables  │
│  01-N  │   │  02-N  │    │  (DNAT)    │
└────────┘   └────────┘    └────────────┘
```

```
dns-control/
├── backend/                    # API Python/FastAPI
│   ├── app/
│   │   ├── main.py            # Ponto de entrada FastAPI
│   │   ├── core/              # Configuração, segurança, banco, sessões
│   │   ├── models/            # Modelos SQLAlchemy
│   │   ├── schemas/           # Schemas Pydantic (request/response)
│   │   ├── api/routes/        # Endpoints REST
│   │   ├── services/          # Camada de lógica de negócio
│   │   ├── executors/         # Execução segura de comandos (whitelist)
│   │   ├── generators/        # Geradores de configuração (Unbound, nftables, FRR)
│   │   ├── workers/           # Workers de saúde, métricas e reconciliação
│   │   └── scripts/           # Scripts de instalação e administração
│   └── requirements.txt
├── collector/                  # Coletor de telemetria (systemd timer)
├── src/                        # Frontend React/TypeScript
├── deploy/                     # Arquivos de deploy (nginx, systemd, sudoers)
└── docs/                       # Documentação técnica
```

---

## Modos de Operação

### 1. Recursivo Simples

O servidor expõe seu IP principal como Frontend DNS. Internamente, múltiplas instâncias Unbound operam como backends em IPs dedicados (`100.127.255.x`). O balanceamento é feito via nftables (PREROUTING + OUTPUT) com estratégia `numgen random`.

```
Cliente → IP do Host (53/UDP) → nftables DNAT → Unbound backend → Upstream
```

### 2. Recursivo com Interceptação (DNS Seizure)

Além dos VIPs de serviço próprios, o sistema intercepta consultas DNS destinadas a servidores públicos (ex: `4.2.2.5`, `8.8.8.8`) via DNAT, redirecionando-as para os resolvers locais. Ideal para provedores que desejam forçar resolução local.

```
Cliente → IP público sequestrado (53/UDP) → nftables DNAT → Unbound backend → Upstream
```

---

## Stack Tecnológica

| Componente | Tecnologia | Função |
|---|---|---|
| Resolver DNS | Unbound | Resolução recursiva multi-instância |
| Balanceamento | nftables | DNAT com sticky por origem + nth |
| Roteamento | FRR/OSPF | Anúncio de VIPs (opcional) |
| Gerenciamento | systemd | Units por instância Unbound |
| API | FastAPI + SQLite | Backend REST com auth JWT |
| Frontend | React + TypeScript | Dashboard operacional |
| Telemetria | Collector Python | Coleta a cada 10s via systemd timer |
| SO alvo | Debian 12/13 | Produção |

---

## Início Rápido

### Instalação automatizada (Debian 13)

```bash
git clone <repositório> /opt/dns-control
cd /opt/dns-control
chmod +x deploy/deploy.sh
sudo bash deploy/deploy.sh
```

O script executa: instalação de pacotes, criação do usuário de serviço, virtualenv Python, build do frontend, configuração do nginx e systemd.

### Instalação manual

Consulte [docs/instalacao.md](docs/instalacao.md) para o procedimento passo a passo.

### Ativação do Collector de Telemetria

```bash
sudo cp deploy/systemd/dns-control-collector.service /etc/systemd/system/
sudo cp deploy/systemd/dns-control-collector.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dns-control-collector.timer
```

Verificação:

```bash
systemctl status dns-control-collector.timer
ls -lh /var/lib/dns-control/telemetry/latest.json
```

---

## Validação Pós-Deploy

```bash
# Backend
curl http://127.0.0.1:8000/api/health

# Frontend
curl -s -o /dev/null -w "%{http_code}" https://dns-control.seudominio.com.br

# Serviços
systemctl status dns-control-api nginx unbound frr nftables

# Resolução DNS
dig @127.0.0.1 google.com +short

# Telemetria
curl -s http://127.0.0.1:8000/api/telemetry/status | python3 -m json.tool
```

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `DNS_CONTROL_DB_PATH` | `/var/lib/dns-control/dns-control.db` | Caminho do banco SQLite |
| `DNS_CONTROL_SECRET_KEY` | *(obrigatório)* | Chave de assinatura JWT |
| `DNS_CONTROL_SESSION_TIMEOUT_MINUTES` | `30` | Timeout de sessão |
| `DNS_CONTROL_SESSION_WARNING_SECONDS` | `120` | Aviso antes da expiração |
| `DNS_CONTROL_INITIAL_ADMIN_USERNAME` | `admin` | Usuário admin inicial |
| `DNS_CONTROL_INITIAL_ADMIN_PASSWORD` | `admin` | Senha admin inicial |
| `DNS_CONTROL_HOST` | `127.0.0.1` | Endereço de bind da API |
| `DNS_CONTROL_PORT` | `8000` | Porta da API |
| `COLLECTOR_OUTPUT_DIR` | `/var/lib/dns-control/telemetry` | Diretório de saída do collector |

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/arquitetura.md](docs/arquitetura.md) | Fluxo de tráfego, camadas de rede, balanceamento |
| [docs/instalacao.md](docs/instalacao.md) | Procedimento completo de instalação (Debian 12/13) |
| [docs/operacao.md](docs/operacao.md) | Validação, interpretação do dashboard, runbook |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Problemas comuns e comandos de diagnóstico |
| [docs/collector.md](docs/collector.md) | Motor de telemetria, history.json, fontes de dados |
| [docs/api.md](docs/api.md) | Endpoints REST, estrutura JSON, exemplos |
| [docs/nftables.md](docs/nftables.md) | Regras DNAT, balanceamento, interceptação |
| [docs/unbound.md](docs/unbound.md) | Configuração multi-instância, tuning, egress |

---

## Segurança

- **Execução de comandos**: exclusivamente via whitelist — sem acesso shell arbitrário
- **Sudoers**: escalação de privilégio mínima para comandos específicos de leitura
- **Sessões**: validação server-side com expiração automática
- **Senhas**: bcrypt com tamanho mínimo obrigatório
- **API**: todos os endpoints exigem token de autenticação válido
- **Troca obrigatória**: senha do admin deve ser alterada no primeiro login

---

## Licença

Projeto interno — uso restrito conforme políticas da organização.
