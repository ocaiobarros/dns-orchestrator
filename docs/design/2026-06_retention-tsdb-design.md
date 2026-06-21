# Design — Retenção Histórica via TSDB Externo (GATE-RETENÇÃO opção (c))

Status: **DESIGN / INVENTÁRIO**. Esta nota NÃO altera código de produção.
Escopo: definir o contrato para servir janelas de tempo LONGAS a partir de um
TSDB externo (Prometheus / VictoriaMetrics) que já scrapeia `/api/prometheus`,
mantendo o buffer local CURTO (`history.json`, 300 pontos @10s ≈ 50 min) para
a janela viva.

---

## 1. Inventário — Métricas reais expostas em `/api/prometheus`

Fonte verbatim: `backend/app/services/prometheus_service.py` (bloco `PROM_HELP`
e função `_append_latest_metrics`). Os nomes abaixo são literais; mantenha-os
no mapa de PromQL.

### 1.1 Saúde / topologia (gauges agregadas e por instância)
| Nome | TYPE | Labels | Significado |
|------|------|--------|-------------|
| `dns_control_up` | gauge | — | API viva (`1`). |
| `dns_instance_health` | gauge | `instance`, `bind_ip` | `1=healthy, 0.5=degraded, 0=failed/withdrawn`. |
| `dns_backend_in_rotation` | gauge | `instance`, `bind_ip` | Backend está no DNAT. |
| `dns_healthcheck_consecutive_failures` | gauge | `instance`, `bind_ip` | Falhas consecutivas. |
| `dns_instance_consecutive_successes` | gauge | `instance`, `bind_ip` | Sucessos consecutivos. |
| `dns_instance_cooldown_seconds` | gauge | `instance`, `bind_ip` | Cooldown anti-flap restante. |
| `dns_active_instances` | gauge | — | Saudáveis. |
| `dns_failed_instances` | gauge | — | Falhas. |
| `dns_nftables_backend_count` | gauge | — | Backends no DNAT. |

### 1.2 DNS / cache / latência (por instância)
| Nome | TYPE | Labels | Unidade |
|------|------|--------|---------|
| `dns_queries_total` | counter | `instance`, `bind_ip` | Total de queries. |
| `dns_cache_hits` | counter | `instance`, `bind_ip` | Total. |
| `dns_cache_misses` | counter | `instance`, `bind_ip` | Total. |
| `dns_cache_hit_ratio` | gauge | `instance`, `bind_ip` | **0-1** (HELP canônico). |
| `dns_cache_hit_percent` | gauge | `instance`, `bind_ip` | **0-100** (compat dashboards legados, GATE-PROM). |
| `dns_latency_ms` | gauge | `instance`, `bind_ip` | Recursão média em ms. |
| `dns_servfail_total` | counter | `instance`, `bind_ip` | SERVFAIL acumulado. |
| `dns_nxdomain_total` | counter | `instance`, `bind_ip` | NXDOMAIN acumulado. |

### 1.3 Eventos / reconciliação (agregadas com label de classificação)
| Nome | TYPE | Labels |
|------|------|--------|
| `dns_events_total` | counter | `severity={info,warning,critical}` |
| `dns_reconciliation_actions_total` | counter | `action={remove_backend,restore_backend}` |

**Observação importante sobre `*_total` counters**: hoje o backend emite o
valor absoluto cumulativo lido do `unbound-control stats_noreset` por scrape.
Para PromQL de QPS / erro-rate isso já basta: use `rate()` / `increase()` no
TSDB (não calcular delta na origem).

### 1.4 Métricas NÃO expostas hoje (gap conhecido)
Nenhum contador de **nftables** (DNAT/blocked packets) é exposto como métrica
Prometheus nomeada. Há telemetria inline em endpoints REST (`/api/telemetry/*`)
mas não em `/api/prometheus`. Tratar como decisão residual (§7).

---

## 2. Configuração de endpoint de consulta TSDB — **NÃO EXISTE HOJE**

Confirmação por busca em `backend/app/core/config.py`, `backend/.env.example`,
`backend/app/services/settings_service.py`, `src/lib/api.ts`:

- Não há `prometheus_query_url`, `PROMETHEUS_URL`, `VICTORIAMETRICS_URL` nem
  qualquer setting equivalente.
- Não há cliente HTTP para PromQL (`query_range`) no backend.
- A direção do dado é **unidirecional**: o TSDB externo faz scrape de
  `/api/prometheus` (pull). O DNS Control não consulta o TSDB.

**Conclusão**: para implementar a opção (c) será necessária uma setting nova
e um cliente HTTP. Proposta concreta em §4.

---

## 3. Inventário — Seletor de time range no frontend

Fonte: `src/pages/DnsPage.tsx` (linhas 91–98, 122–135, 597–665).

- Chave de filtro persistida em `localStorage`: `dns-control:dns-page-filters:v2`.
- Estado React: `{ instance, qtype, timeRange }` com `timeRange` default `'1h'`.
- Janelas oferecidas pelo `Select` (verbatim `TIME_RANGE_HOURS`):
  `'1h' | '6h' | '12h' | '24h' | '48h' | '72h'`.
- Disparo: `useQuery` com `queryKey` incluindo `filters.timeRange`; chama
  `api.getDnsMetrics({ range })`, `api.getRecentQueries({ range })`,
  `api.getQueryRankings({ range })`. Refetch automático em mudança de filtro.
- `MetricsPage.tsx` usa o mesmo padrão de chaves mas com uma escala menor.

**Realidade dos dados hoje**: o backend honra o `range` no filtro de queries
recentes (após FIX-OBS-CORRECTNESS), mas a janela física de dados disponíveis
para `dns_metrics` é o `history.json` do collector — `MAX_HISTORY_POINTS=300`
@ 10s = **~50 min**. Qualquer `timeRange >= 6h` é cosmético hoje.

---

## 4. Proposta — Roteamento de fonte + proxy backend + setting

### 4.1 Regra de roteamento (frontend)
Decisão por janela, usando os campos que **JÁ EXISTEM** no envelope após
FIX-OBS-CORRECTNESS:

```
janela_requerida = TIME_RANGE_HOURS[timeRange] * 3600
buffer_local_s   = recent_queries.buffer_span_seconds  // do envelope existente

se janela_requerida <= buffer_local_s:
    fonte = "local"   → api.getDnsMetrics() (history.json, como hoje)
senão:
    fonte = "tsdb"    → api.getDnsMetricsRange() (proxy novo, §4.2)
```

Os campos `partial` e `buffer_span_seconds` de `/api/telemetry/recent-queries`
são, portanto, o **gatilho oficial de roteamento**. Não precisam ser
recalculados.

### 4.2 Proxy backend (esboço de contrato)
Endpoint novo proposto: **`GET /api/telemetry/range`**.

Motivação: evitar CORS, esconder credenciais do TSDB do SPA, padronizar a
saída no mesmo envelope `{rows, source, source_available, degraded}` já
adotado por `/api/dns/metrics`.

Entrada (query string):
| Campo | Tipo | Exemplo | Notas |
|-------|------|---------|-------|
| `metric` | enum | `qps`, `cache_hit_percent`, `latency_ms`, `errors_total`, `health` | Chave lógica, traduzida para PromQL via mapa §5. |
| `range` | string | `6h`, `24h`, `72h` | Mesmas chaves do `TIME_RANGE_HOURS`. |
| `step` | string opcional | `1m`, `5m` | Auto-derivado da janela se ausente. |
| `instance` | string opcional | `unbound-1` | Filtro `instance=` em PromQL. |

Saída (JSON):
```json
{
  "source": "tsdb" | "none",
  "source_available": true | false,
  "degraded": false,
  "metric": "cache_hit_percent",
  "range_seconds": 86400,
  "step_seconds": 300,
  "rows": [{ "ts": 1719000000, "value": 87.3 }, ...]
}
```

Erros / degradação:
- TSDB não configurado → `200` com `source="none"`, `source_available=false`,
  `rows=[]`, mensagem curta em `error` (string). **Não** 500.
- TSDB inacessível / timeout → mesmo shape, `degraded=true`,
  `error="upstream_unreachable"`.
- Frontend renderiza `NoDataPlaceholder` (componente já existente) com a
  legenda "histórico externo não configurado / indisponível".

### 4.3 Setting nova proposta
Local: `backend/app/core/config.py` (mesmo padrão `pydantic_settings`,
prefixo `DNS_CONTROL_`).

| Chave env / settings | Tipo | Default | Significado |
|----------------------|------|---------|-------------|
| `DNS_CONTROL_PROMETHEUS_QUERY_URL` | str | `""` (vazio = desligado) | Base URL para PromQL, ex.: `http://prom:9090` ou `http://victoria:8428`. |
| `DNS_CONTROL_PROMETHEUS_AUTH_HEADER` | str (secret) | `""` | Header Authorization completo (ex.: `Bearer ...`) se houver. |
| `DNS_CONTROL_PROMETHEUS_HOST_LABEL` | str | `""` | Label de host para filtrar (ex.: `node`, `host`); vazio = sem filtro. |
| `DNS_CONTROL_PROMETHEUS_HOST_VALUE` | str | `""` | Valor do label deste host. Vazio = TSDB já filtra por scrape job. |

Validação no boot: se `PROMETHEUS_QUERY_URL` estiver vazio, o endpoint
`/api/telemetry/range` responde `source="none"` imediatamente, sem tocar a
rede. Sem panic, sem warning ruidoso.

---

## 5. Mapa de métricas — DNS Control → PromQL

Notação: `${INSTANCE}` é o filtro opcional vindo do request; `${HOST}` é o
filtro opcional vindo de `PROMETHEUS_HOST_LABEL/VALUE` (omitir chaves quando
vazias). `$step` deriva da janela (1m até 6h, 5m até 24h, 15m acima).

| Chave lógica (request) | PromQL proposto | Unidade saída |
|------------------------|-----------------|---------------|
| `qps` | `sum by (instance) (rate(dns_queries_total{${HOST},${INSTANCE}}[$step]))` | queries/s |
| `cache_hit_percent` | `avg by (instance) (dns_cache_hit_percent{${HOST},${INSTANCE}})` | 0-100 |
| `cache_hit_ratio` | `avg by (instance) (dns_cache_hit_ratio{${HOST},${INSTANCE}})` | 0-1 |
| `latency_ms` | `avg by (instance) (dns_latency_ms{${HOST},${INSTANCE}})` | ms |
| `errors_total` | `sum by (instance) (rate(dns_servfail_total{${HOST},${INSTANCE}}[$step]) + rate(dns_nxdomain_total{${HOST},${INSTANCE}}[$step]))` | err/s |
| `health` | `min by (instance) (dns_instance_health{${HOST},${INSTANCE}})` | 0/0.5/1 |
| `in_rotation` | `min by (instance) (dns_backend_in_rotation{${HOST},${INSTANCE}})` | 0/1 |
| `cooldown_seconds` | `max by (instance) (dns_instance_cooldown_seconds{${HOST},${INSTANCE}})` | s |
| `events_rate` | `sum by (severity) (rate(dns_events_total{${HOST}}[$step]))` | ev/s |
| `reconcile_rate` | `sum by (action) (rate(dns_reconciliation_actions_total{${HOST}}[$step]))` | ações/s |

A unidade `cache_hit_percent` é a preferida no frontend (o chart canônico
interno já é 0-100); manter `cache_hit_ratio` apenas como espelho para
dashboards legados.

---

## 6. Degradação honesta (regra obrigatória)

- TSDB não configurado: `source="none"`, `source_available=false`. O chart
  reusa `NoDataPlaceholder` com legenda "Histórico externo não configurado".
- TSDB configurado mas inacessível: `degraded=true`,
  `error="upstream_unreachable"`. Legenda: "Fonte de histórico longa
  indisponível".
- Resposta PromQL vazia: `rows=[]`, `source="tsdb"`,
  `source_available=true`. Legenda: "Sem dados na janela".
- **Proibido**: preencher com zeros sintéticos, repetir o último valor, ou
  exibir o buffer local quando o usuário pediu uma janela maior.

---

## 7. Restrição registrada — Buffer local CURTO permanece curto

Decisão GATE-RETENÇÃO opção (c). **NÃO** estender `MAX_HISTORY_POINTS`
(`backend/collector/collector.py:31`). Consequências preservadas e desejadas:

- Parsing `HH:MM:SS` em `_parse_recent_query_epoch` continua seguro (janela
  física curta ⇒ ambiguidade de dia ≈ nula; o clamp `ts -= 86400` cobre o
  caso de borda).
- Collector-timestamp absoluto (epoch no item) permanece higiene **P3** —
  recomendado, não bloqueador.
- O buffer local serve só a janela viva (≈ 50 min). Tudo acima é TSDB.

---

## 8. Decisões residuais (NÃO decididas aqui)

1. **Auth do TSDB**: Bearer token, basic, mTLS, ou nada? Hoje o esboço suporta
   header opaco em `PROMETHEUS_AUTH_HEADER`. Confirmar política antes de
   implementar e definir se o secret entra em `/etc/dns-control/env` ou em
   Lovable Cloud secrets.
2. **Label de host**: o TSDB é central (multi-host) ou por host? Se central,
   qual label canonical (`node`, `host`, `instance_host`) e como populá-lo —
   via relabel no scrape ou via novo label exposto pelo backend? Hoje as
   métricas têm apenas `instance` (= `instance_name` do Unbound) e `bind_ip`.
3. **Dependência da UI em serviço externo**: aceitar que janelas longas
   ficam offline quando o TSDB cai (degradação honesta) ou bloquear seleção
   no `Select`? Recomendação: deixar selecionável + degradar honestamente.
4. **Retenção no próprio TSDB**: 7d? 30d? 90d? Definir do lado de
   Prometheus/VictoriaMetrics — fora do DNS Control. Documentar requisito
   mínimo (ex.: 7d) no runbook quando implementar.
5. **Contadores de nftables**: expor ou não no `/api/prometheus` (gap §1.4).
   Se sim, decisão futura — fora desta tarefa.
6. **Step adaptativo**: regras finais de `$step` por janela; valores em §5
   são proposta inicial.
7. **Cache do proxy**: se o `/api/telemetry/range` deve memoizar por
   `(metric, range, step, instance)` por alguns segundos para reduzir carga
   no TSDB.

---

## 9. Resumo executivo

- Métricas reais inventariadas verbatim (§1). Sem suposições.
- Não há configuração de endpoint de consulta TSDB hoje (§2). Será preciso
  criar `DNS_CONTROL_PROMETHEUS_QUERY_URL` + auth + label de host.
- Seletor de janela já existe no frontend (`1h..72h`) e usa
  `react-query`; basta acrescentar a regra de roteamento por
  `buffer_span_seconds` (§4.1).
- Proxy backend `/api/telemetry/range` evita CORS/secret no SPA e padroniza
  o envelope (§4.2).
- Mapa de métricas pronto para virar prompt de implementação (§5).
- Degradação reusa `NoDataPlaceholder`; nunca chart cosmético (§6).
- Buffer local CURTO permanece curto — premissa da opção (c) (§7).
- 7 decisões residuais explicitadas para a próxima rodada (§8).
