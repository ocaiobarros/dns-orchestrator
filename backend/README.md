# DNS Control — Backend

API FastAPI para gerenciamento de infraestrutura DNS recursiva em Debian 12/13.

## Início Rápido

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

O banco e o usuário admin são criados automaticamente na primeira execução.
O admin deve trocar a senha no primeiro login (`must_change_password=true`).

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `DNS_CONTROL_DB_PATH` | `/var/lib/dns-control/dns-control.db` | Caminho do banco SQLite |
| `DNS_CONTROL_SECRET_KEY` | *(obrigatório)* | Chave de assinatura JWT |
| `DNS_CONTROL_SESSION_TIMEOUT_MINUTES` | `30` | Duração da sessão |
| `DNS_CONTROL_SESSION_WARNING_SECONDS` | `120` | Aviso antes da expiração |
| `DNS_CONTROL_INITIAL_ADMIN_USERNAME` | `admin` | Usuário admin padrão |
| `DNS_CONTROL_INITIAL_ADMIN_PASSWORD` | `admin` | Senha admin padrão |
| `DNS_CONTROL_HOST` | `127.0.0.1` | Endereço de bind da API |
| `DNS_CONTROL_PORT` | `8000` | Porta da API |

## Documentação da API

Inicie o backend e acesse `http://localhost:8000/docs` para a documentação interativa (Swagger).

## Documentação Completa

Consulte a [documentação principal](../docs/) para arquitetura, instalação, operação e troubleshooting.
