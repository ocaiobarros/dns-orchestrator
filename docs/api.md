# DNS Control — API

## Visão Geral

API REST servida via FastAPI na porta 8000 (bind em `127.0.0.1`, acesso externo via nginx proxy reverso). Todos os endpoints (exceto `/api/health`) exigem autenticação via header `Authorization: Bearer <token>`.

Documentação interativa (Swagger): `http://127.0.0.1:8000/docs`

---

## Autenticação

### POST /api/auth/login

```bash
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"senha123"}'
```

**Resposta (200):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "usr-001",
      "username": "admin",
      "isActive": true,
      "mustChangePassword": false
    }
  }
}
```

### Outros endpoints de autenticação

| Método | Caminho | Descrição |
|---|---|---|
| POST | `/api/auth/logout` | Invalidar sessão atual |
| GET | `/api/auth/me` | Dados do usuário autenticado |
| POST | `/api/auth/change-password` | Alterar senha |
| POST | `/api/auth/force-change-password` | Troca obrigatória (primeiro acesso) |

---

## Telemetria (Collector)

### GET /api/telemetry/latest

Retorna o snapshot completo da última coleta do collector.

```bash
curl -s http://127.0.0.1:8000/api/telemetry/latest \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

**Resposta:**
```json
{
  "mode": "recursive_simple",
  "health": {
    "collector": "ok",
    "last_update": "2026-04-01T20:30:00Z",
    "collection_duration_ms": 245
  },
  "backends": [
    {
      "name": "unbound01",
      "bind_ip": "100.127.255.1",
      "status": "active",
      "total_queries": 1523456,
      "cache_hits": 1234567,
      "cache_hit_ratio": 81.0,
      "qps": 342.5,
      "latency_avg_ms": 12.3,
      "servfail": 45,
      "nxdomain": 890
    }
  ],
  "nftables": { "total_packets": 5678900, "distribution": [...] },
  "top_domains": [...],
  "top_clients": [...]
}
```

### GET /api/telemetry/history

Retorna array de pontos de séries temporais (buffer circular, ~300 pontos).

```bash
curl -s http://127.0.0.1:8000/api/telemetry/history \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -30
```

**Resposta:**
```json
[
  {
    "timestamp": "2026-04-01T20:30:00Z",
    "qps": 342.5,
    "latency_ms": 12.3,
    "cache_hit_ratio": 81.0,
    "errors": 45
  }
]
```

### GET /api/telemetry/status

Verificação rápida de saúde do collector.

```bash
curl -s http://127.0.0.1:8000/api/telemetry/status \
  -H "Authorization: Bearer $TOKEN"
```

**Resposta:**
```json
{
  "collector_status": "ok",
  "last_update": "2026-04-01T20:30:00Z",
  "collection_duration_ms": 245,
  "file_age_seconds": 5,
  "stale": false,
  "mode": "recursive_simple"
}
```

### GET /api/telemetry/simple

Dados de telemetria específicos do modo Recursivo Simples.

### GET /api/telemetry/interception

Dados de telemetria específicos do modo Recursivo com Interceptação.

---

## Sistema

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/health` | Saúde da API (sem autenticação) |
| GET | `/api/system/info` | Informações do sistema (hostname, versões, uptime) |
| GET | `/api/system/services` | Status de todos os serviços |
| POST | `/api/system/services/{nome}/restart` | Reiniciar um serviço |

---

## DNS

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/dns/metrics?hours=6&instance=` | Métricas DNS (séries temporais) |
| GET | `/api/dns/top-domains?limit=20` | Domínios mais consultados |
| GET | `/api/dns/instances` | Estatísticas por instância |

---

## Rede

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/network/interfaces` | Interfaces de rede com IPs |
| GET | `/api/network/routes` | Tabela de rotas |
| POST | `/api/network/reachability` | Teste de alcançabilidade (ping) |

---

## NAT / Balanceamento

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/nat/counters` | Contadores nftables DNAT |
| GET | `/api/nat/sticky` | Entradas da tabela sticky |
| GET | `/api/nat/ruleset` | Ruleset nft completo |

---

## OSPF / FRR

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/ospf/neighbors` | Tabela de vizinhos OSPF |
| GET | `/api/ospf/routes` | Rotas redistribuídas |
| GET | `/api/ospf/running-config` | Configuração FRR ativa |

---

## Saúde e Reconciliação

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/health/instances` | Estado de saúde de todas as instâncias |
| POST | `/api/actions/reconcile-now` | Forçar reconciliação DNAT |
| POST | `/api/actions/remove-backend/{id}` | Remover backend manualmente |
| POST | `/api/actions/restore-backend/{id}` | Restaurar backend manualmente |

---

## Configuração e Deploy

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/config/current` | Configuração ativa |
| POST | `/api/config/validate` | Validar configuração |
| POST | `/api/config/preview` | Pré-visualizar arquivos gerados |
| POST | `/api/config/apply` | Aplicar configuração |
| GET | `/api/history?page=1` | Histórico de deploys |
| GET | `/api/history/{id}` | Detalhe de um deploy |

---

## Diagnósticos

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/troubleshooting/commands` | Comandos disponíveis |
| POST | `/api/troubleshooting/run/{id}` | Executar comando diagnóstico |
| GET | `/api/troubleshooting/health-check` | Verificação completa de saúde |
| GET | `/api/troubleshooting/privilege-status` | Status de privilégios do backend |

---

## Logs e Eventos

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/logs?source=&search=&page=` | Logs paginados e filtrados |
| GET | `/api/events?limit=10` | Eventos operacionais |

---

## Usuários

| Método | Caminho | Descrição |
|---|---|---|
| GET | `/api/users` | Listar todos os usuários |
| POST | `/api/users` | Criar novo usuário |
| PATCH | `/api/users/{id}` | Atualizar usuário (ativar/desativar) |
| POST | `/api/users/{id}/change-password` | Alterar senha de outro usuário |
| DELETE | `/api/users/{id}` | Remover usuário |

---

## Prometheus

```bash
curl -s http://127.0.0.1:8000/metrics | head -20
```

Endpoint `/metrics` expõe métricas em formato Prometheus text. Configuração de scrape:

```yaml
scrape_configs:
  - job_name: 'dns-control'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['172.250.40.100:8000']
```

Métricas disponíveis:

| Métrica | Descrição |
|---|---|
| `dns_qps` | Consultas por segundo |
| `dns_cache_hit_ratio` | Taxa de acerto de cache |
| `dns_latency_ms` | Latência de resolução |
| `dns_instance_health` | Saúde da instância (1=ok, 0=falha) |
| `dns_backend_in_rotation` | Backend no pool DNAT (1=sim, 0=não) |
| `dns_servfail_total` | Total de respostas SERVFAIL |
| `dns_nxdomain_total` | Total de respostas NXDOMAIN |
