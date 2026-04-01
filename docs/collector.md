# DNS Control — Collector de Telemetria

## Visão Geral

O collector é um script Python (`collector/collector.py`) que coleta métricas operacionais do DNS a cada 10 segundos via systemd timer. Ele agrega dados de três fontes e os disponibiliza em arquivos JSON para consumo pela API e frontend.

---

## Fontes de Dados

### Fonte A — Unbound (métricas do resolver)

```bash
sudo unbound-control -s <ctrl_ip>@<port> -c /etc/unbound/<instancia>.conf stats_noreset
```

| Estatística Unbound | Métrica | Tipo |
|---|---|---|
| `total.num.queries` | Total de consultas | Contador |
| `total.num.cachehits` | Acertos de cache | Contador |
| `total.num.cachemiss` | Falhas de cache | Contador |
| `total.recursion.time.avg` | Latência média de recursão | Gauge |
| `num.answer.rcode.SERVFAIL` | Respostas SERVFAIL | Contador |
| `num.answer.rcode.NXDOMAIN` | Respostas NXDOMAIN | Contador |
| `num.answer.rcode.NOERROR` | Respostas NOERROR | Contador |
| `msg.cache.count` | Entradas no cache de mensagens | Gauge |
| `rrset.cache.count` | Entradas no cache de RRsets | Gauge |
| `time.up` | Tempo ativo da instância | Gauge |

### Fonte B — nftables (distribuição de tráfego)

```bash
sudo nft list ruleset
```

Extrai: pacotes, bytes, distribuição por backend, percentual de participação.

### Fonte C — Logs de consultas (top domains/clients)

```bash
journalctl -u unbound01 -u unbound02 --grep "query:"
```

Extrai: domínios mais consultados, clientes mais ativos, tipos de consulta.

---

## Métricas Derivadas

| Métrica | Fórmula |
|---|---|
| `cache_hit_ratio` | cache_hits / (cache_hits + cache_misses) × 100 |
| `qps` | Δ(total_queries) / Δ(tempo) |
| `nft_qps` | Δ(total_pacotes_nft) / Δ(tempo) |
| `backend_share` | pacotes_backend / total_pacotes × 100 |

---

## Arquivos de Saída

### `latest.json` — Snapshot Atual

Contém o snapshot completo da última coleta:

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
      "cache_misses": 288889,
      "cache_hit_ratio": 81.0,
      "qps": 342.5,
      "latency_avg_ms": 12.3,
      "servfail": 45,
      "nxdomain": 890
    }
  ],
  "nftables": {
    "total_packets": 5678900,
    "total_bytes": 890123456,
    "distribution": [
      {"backend": "unbound01", "packets": 1419725, "share": 25.0}
    ]
  },
  "top_domains": [...],
  "top_clients": [...]
}
```

### `history.json` — Séries Temporais

Buffer circular com até **300 pontos** (~50 minutos de dados):

```json
[
  {
    "timestamp": "2026-04-01T20:30:00Z",
    "qps": 342.5,
    "latency_ms": 12.3,
    "cache_hit_ratio": 81.0,
    "errors": 45
  },
  {
    "timestamp": "2026-04-01T20:30:10Z",
    "qps": 338.1,
    "latency_ms": 11.8,
    "cache_hit_ratio": 81.2,
    "errors": 43
  }
]
```

Cada ponto representa um snapshot agregado de todas as instâncias:

- `qps`: soma do QPS de todos os backends
- `latency_ms`: média ponderada da latência
- `cache_hit_ratio`: taxa de cache hit consolidada
- `errors`: soma de SERVFAIL + NXDOMAIN

---

## Serviço Systemd

### Service (oneshot)

```ini
# /etc/systemd/system/dns-control-collector.service
[Unit]
Description=DNS Control Telemetry Collector
After=network.target

[Service]
Type=oneshot
User=dns-control
Group=dns-control
ExecStart=/usr/bin/python3 /opt/dns-control/collector/collector.py
WorkingDirectory=/opt/dns-control
Environment=COLLECTOR_CONFIG=/opt/dns-control/collector/config.json
Environment=COLLECTOR_OUTPUT_DIR=/var/lib/dns-control/telemetry
```

### Timer (10 segundos)

```ini
# /etc/systemd/system/dns-control-collector.timer
[Unit]
Description=DNS Control Telemetry Collector Timer
After=network.target

[Timer]
OnBootSec=10s
OnUnitActiveSec=10s
AccuracySec=1s

[Install]
WantedBy=timers.target
```

### Comandos de gerenciamento

```bash
# Ativar
systemctl enable --now dns-control-collector.timer

# Verificar status
systemctl status dns-control-collector.timer
systemctl list-timers | grep dns-control

# Executar manualmente (debug)
sudo -u dns-control python3 /opt/dns-control/collector/collector.py

# Logs
journalctl -u dns-control-collector --since "5 minutes ago"
```

---

## Diagnóstico de Ingestão

O collector inclui um bloco `diag` no JSON de saída que registra o status técnico de cada tentativa de coleta:

```json
{
  "diag": {
    "unbound_control": {
      "exit_code": 0,
      "stderr": ""
    },
    "nft": {
      "exit_code": 0,
      "stderr": ""
    },
    "journalctl": {
      "exit_code": 1,
      "stderr": "No journal files were opened due to insufficient permissions."
    }
  }
}
```

Isso permite distinguir **falhas de tráfego real** de **problemas de ingestão**. Se o campo `diag` indicar erro, o dashboard exibe "Telemetria não conectada" em vez de valores zerados falsos.

---

## Limitações

- **Sem persistência longa**: o histórico mantém apenas ~50 minutos de dados (300 pontos × 10s)
- **Sem agregação temporal**: não há rollup para períodos maiores (hourly, daily)
- **Arquivo único**: o `history.json` é reescrito atomicamente a cada ciclo
- **Dependência de permissões**: `unbound-control` e `nft` requerem privilégios adequados
- **Sem retenção após reinício**: se o arquivo `history.json` for removido, o histórico recomeça do zero

Para monitoramento de longo prazo, integrar com Prometheus + Grafana (consulte [docs/api.md](api.md) para endpoints de métricas).
