# Auditoria de Observabilidade — Time Range, Séries Temporais e Clareza Visual

**Data:** 2026-06-21
**Escopo:** somente leitura. Nenhum arquivo de produção foi alterado.
**Páginas auditadas:** `/dns` (`src/pages/DnsPage.tsx`), `/metrics` (`src/pages/MetricsPage.tsx`).
**Backend auditado:** `app/api/routes/{telemetry,metrics,metrics_v2,dns,dns_errors,health_v2,healthcheck,events}.py`, `app/services/{metrics_service,metrics_collector_service,history_service,health_service,unbound_stats_service}.py`, `backend/collector/collector.py`.

---

## TL;DR — principais causas de falha dos seletores de tempo

1. **`history.json` está limitado a `MAX_HISTORY_POINTS = 300`** (`backend/collector/collector.py:31`). Com o timer rodando a cada 10 s, a janela máxima retida é **~50 minutos**. Selecionar 6 h / 12 h / 24 h / 72 h na UI nunca traz mais dados do que selecionar 1 h — o seletor "funciona" mas é silenciosamente truncado pela camada de armazenamento. **Esta é a causa raiz #1 dos gráficos vazios/curtos.**
2. **`/api/telemetry/history` não aceita `range`.** O endpoint devolve sempre o buffer inteiro, sem filtro server-side (`backend/app/api/routes/telemetry.py:62`). A filtragem é feita no cliente (`DnsPage.tsx:661 minTs = Date.now() - hours*3600*1000`). Como o buffer já é pequeno, a janela é definida pelo tamanho do buffer, não pelo seletor.
3. **`/api/dns/metrics` aceita `range` mas degrada para snapshot único quando não há `DnsEvent`/`MetricSample` persistidos** (`metrics_service.py:45-49`), retornando 1 ponto com `timestamp=agora`. O seletor é honrado em SQL apenas quando há dados persistidos; caso contrário o gráfico mostra um único ponto independentemente da janela.
4. **Página `/metrics` não tem nenhum seletor de tempo.** Todos os KPIs/listas consomem `telemetry/latest` (snapshot atual). Top Domínios/Clientes da `/metrics` são *all-time* do collector — não respondem a janela alguma.
5. **Três escalas distintas para `cache_hit_ratio`** convivem no backend (ver Seção B/Defeito P1-04), o que faz o gráfico de Cache Hit aparecer travado em `0` ou em `100%` dependendo da fonte que estiver alimentando o `chartData`.

---

## A. Inventário de seletores de time range

| # | Arquivo:linha | Página | Opções | Propaga para | Verdade no caminho ponta-a-ponta |
|---|---|---|---|---|---|
| A1 | `src/pages/DnsPage.tsx:1046-1056` (`<Select value={timeRange}>`) | `/dns` | `1h`, `6h`, `12h`, `24h`, `48h`, `72h` (`TIME_RANGE_HOURS` em :92-99) | `setFilter({timeRange})` → `filters.timeRange` → 3 queries TanStack | Parcial. Ver A1.a/b/c. |
| A1.a | `DnsPage.tsx:580-588` → `api.getDnsMetrics({ range: timeRange })` | `/dns` charts | ditto | `GET /api/dns/metrics?range=<X>h` → `dns.py:24-34` → `metrics_service._hours_from_range` (`metrics_service.py:23-25`) | **Funcional no contrato, quebrado no dado.** Se `DnsEvent`/`MetricSample` estão vazios, retorna 1 ponto (`metrics_service.py:45-49`), ignorando a janela. |
| A1.b | `DnsPage.tsx:601-610` → `api.getRecentQueries({ range: timeRange })` | `/dns` recent queries | ditto | `GET /api/telemetry/recent-queries?range=<X>h` → `telemetry.py:281-307` | **`range` é recebido mas nunca usado.** O endpoint não filtra por janela; apenas devolve o buffer `recent_queries` (cap pelo `limit`). Quebra em `telemetry.py:289-307`. |
| A1.c | `DnsPage.tsx:612-621` → `api.getQueryRankings({ range: timeRange })` | `/dns` Top Domínios/Clientes | ditto | `GET /api/telemetry/query-rankings?range=<X>h` → `telemetry.py:310-331` → `top_domains_by_range[range_key]` | **Funcional**, desde que o collector tenha rodado em mais de uma janela. Antes do primeiro ciclo do bucket de 72 h, faz *fallback* para `top_domains` global (`telemetry.py:325-327`) sem indicar isso na UI. |
| A1.d | `DnsPage.tsx:627-698` (`chartData useMemo`) | `/dns` filtro client-side | `hours` derivado de `timeRange` | `minTs = Date.now() - hours*3_600_000` (`:661`) | Lógico ok, mas **`telemetryHistory` tem no máximo ~50 min** (ver TL;DR #1). Janela de 6 h+ exibe os mesmos ~50 min. |
| A2 | `src/pages/MetricsPage.tsx` (todo o arquivo) | `/metrics` | **— nenhum seletor —** | `useTelemetry()` (snapshot `latest.json`) | **Lacuna estrutural.** Página inteira sem controle de janela; tudo é *as-of-now*. |

**Outros consumidores indiretos com `range`/`hours` no projeto** (não estão em `/dns` nem `/metrics`, mas foram inspecionados por completude):

* `getDnsErrorsSummary(minutes)` em `src/lib/api.ts:390` → `metrics/dns/errors/summary?minutes=…`. Usado em painéis NOC; possui seletor próprio fora do escopo desta auditoria.
* `getDnsErrorsLive(since)` em `src/lib/api.ts:391`. Sem seletor de UI.

---

## B. Inventário de séries / gráficos

Cada gráfico de `/dns`, com fonte de dados, estado vazio/erro e correção de escala.

| # | Componente (arquivo:linha) | Fonte de dados | Campos | Loading | Vazio | Erro | Escala correta? |
|---|---|---|---|---|---|---|---|
| B1 | `TrafficEvolutionChart` `DnsPage.tsx:513-547` | `effectiveChartData` (mix `filteredMetrics` + `telemetryHistory`) | `qps`, `latency` | Não tem skeleton; usa `[{ts,qps:0}]` quando vazio (`:326`) | Render fantasma de 2 pontos com 0 — **aparenta gráfico "ok" sem dados reais**. | Nenhum tratamento. Erro do React Query é silenciosamente descartado. | OK (qps absoluto, latency em ms). |
| B2 | `ChartPanel` "QPS" `DnsPage.tsx:1292` | idem B1 | `qps` | idem | idem (placeholder zero) | idem | OK. |
| B3 | `ChartPanel` "Latência (ms)" `:1293` | idem; quando há `selectedBackend`, sobrescreve com `recursion_avg_ms` (`:673`) | `latency` | idem | idem | idem | OK em ms (×1000 já feito no collector `:242`). |
| B4 | `CacheHitChart` `:360-381` (`:1296`) | idem | `hitRatio` | idem | placeholder zero | idem | **Inconsistente** — fonte pode ser collector (0-100), pode ser `MetricSample` (`metrics_collector_service.py:57` já em %), pode ser Prometheus (`metrics.py:60-66` em 0-1). Ver P1-04. |
| B5 | `ErrorsChart` `:386-415` (`:1297`) | idem; soma `servfail+nxdomain` em `total` | `total` | idem | placeholder zero | idem | OK (contagens). |
| B6 | `Top Domínios` `/dns` (`DnsPage.tsx ~970+` consumindo `queryRankings.top_domains`) | `/api/telemetry/query-rankings` (A1.c) | `domain`, `count` | placeholder anterior (`placeholderData`) | `EmptyTopState` (`:431-470`) com diagnóstico real | sem estado de erro distinto | OK. |
| B7 | `Top Clientes` `/dns` | idem | `client`, `count` | idem | `EmptyTopState` | idem | OK. |
| B8 | `/metrics` Top Domínios (`MetricsPage.tsx:86-127`) | `telemetry.top_domains` (snapshot `latest.json`) | `domain`, `count` | `<LoadingState />` global da página | mensagem textual com causa (`log-queries`/`collector inativo`) | sem distinção de erro | OK, mas **all-time** — não responde a janela. |
| B9 | `/metrics` Top Clientes | `telemetry.top_clients` | `ip`, `count` | idem | idem | idem | idem. |
| B10 | `/metrics` Top Query Types / Backends | `telemetry.{top_query_types,backends}` | vários | idem | idem | idem | OK. |

**Observações transversais aos gráficos de `/dns`:**

* `series` recebe um array sintético `[{ts,...,0},{ts+1,...,0}]` quando `data.length === 0` (`DnsPage.tsx:326, 362, 391`). Isso renderiza um gráfico achatado em 0 **mesmo quando o collector está parado** — operador acha que "está zerado" quando na verdade "não há dados".
* `useQuery` não trata `error` em UI: o `error` retornado pelo `useTelemetry` é capturado (`:554`) mas nenhum *fallback* visual com a mensagem é exibido. As páginas mostram a UI vazia.

---

## C. Lacunas de clareza — dado existe no backend, não chega à UI

| # | Lacuna | Dado-fonte já disponível | Onde o backend já expõe | Onde a UI deveria exibir e não exibe |
|---|---|---|---|---|
| C1 | "Instância removida do DNAT por falha" não é indicada nos cards/série de `/dns` nem em `/metrics`. | `state` ∈ {`healthy`,`degraded`,`failed`,`removed`} + `removed_at` | `health_service.get_all_instance_states` (`:253-290`), retornado por `/api/health/instances` (`health_v2.py:23`) | Apenas `NocInstanceTable.tsx:83-84` exibe `cooldown_remaining`. `DnsPage`/`MetricsPage` não consomem `instance_state`. |
| C2 | Cooldown anti-flap (120 s) ativo após recuperação não tem badge na página `/dns`. | `cooldown_remaining` (segundos) e `cooldown_until` (ISO) | `health_service.py:206-264` → `/api/health/instances` | Só aparece em `NocInstanceTable`. |
| C3 | Fonte de log degradada (`telemetry_mode=logless` ou `log_source=none`) não tem indicador global em `/dns`/`/metrics`. | `telemetry_mode`, `log_source`, `query_analytics.diag` | `collector.py:437,689-705`; `/api/telemetry/log-validation` (`telemetry.py:236-275`) | `EmptyTopState` mostra só quando o Top está vazio. KPIs principais e gráficos não declaram a degradação. |
| C4 | Drift de configuração (arquivos no host ≠ profile aplicado) não aparece nas páginas de observabilidade. | `drift_service` (todo o serviço) | endpoint `dns_errors`/`deploy` expõe estado; `drift_service.py` calcula | Nenhuma referência em `DnsPage.tsx`/`MetricsPage.tsx`. |
| C5 | Janela efetiva real do `history.json` (~50 min) não é comunicada quando o operador escolhe 24 h/72 h. | `MAX_HISTORY_POINTS=300` (~50 min @10s), `retention_minutes` já é exposto em `latest.json` (`collector.py:705,1014`) | `latest.json.query_analytics.retention_minutes` | UI não compara `retention_minutes` × janela escolhida. Deveria avisar "buffer cobre apenas X min". |
| C6 | `fallback` global de `query-rankings` (quando o bucket de 72 h ainda não está cheio) é silencioso. | `top_domains_by_range[range] || top_domains` (`telemetry.py:325-327`) | mesmo endpoint | Não há aviso "exibindo agregação acumulada — bucket 72 h ainda em formação". |
| C7 | Contadores de nftables (DNAT real corrente) não aparecem em `/dns`. | `traffic.qps`, `traffic.total_packets` + `nft_qps`, `nft_packets` salvos em `history.json` (`collector.py:1046-1047`) e contadores de `nat.summary` | `/api/nat/summary` (`nat.py`) e `latest.json.traffic.*` | KPIs de `/dns` se baseiam só em `resolver.*` do unbound — não diferenciam "queries entrando no host" (nft) vs "queries respondidas" (unbound). |
| C8 | Estado de paridade (geradores TS vs Python) e timestamp do último deploy não constam em `/dns`/`/metrics`. | `deploy_service` mantém `state` + `history`; `/api/deploy/state` | `/api/deploy/state`, `apply_jobs` (`history_service.py:9-14`) | Apenas página de histórico mostra. Painel NOC não consome. |
| C9 | Erros recentes (SERVFAIL/NXDOMAIN com domínio/cliente) — backend tem dnstap collector e `/metrics/dns/errors/live`, mas `/dns` só agrega `servfail+nxdomain` num total. | `dns_errors` events (`dns_error_collector_service.py`) | `/api/metrics/dns/errors/{summary,live,stats,dnstap/*}` | `/dns` `ErrorsChart` (B5) não linka para a listagem; operador vê pico sem saber onde clicar. |
| C10 | Idade do `latest.json` (stale > 60 s) só aparece em `/api/telemetry/status` mas não vira badge nas páginas. | `file_age_seconds`, `stale` | `telemetry.py:79-100` (`useTelemetryStatus`) | `MetricsPage` chama `useTelemetryStatus` (`:54`) mas não exibe `stale`. `DnsPage` nem chama. |

---

## D. Resumo priorizado (P1 = sangra, corrigir já; P2 = engana, alta prioridade; P3 = polimento)

### P1 — Falhas que invalidam o produto observabilidade

| ID | Defeito | Evidência | Impacto |
|---|---|---|---|
| **P1-01** | `history.json` truncado em 300 pontos (~50 min) faz todo seletor ≥ 6 h ser cosmético. | `backend/collector/collector.py:31, 1059-1062` | Toda janela acima de 1 h mente. |
| **P1-02** | `/api/telemetry/recent-queries` recebe `range` e ignora silenciosamente. | `backend/app/api/routes/telemetry.py:281-307` | Filtros de "Eventos recentes" em `/dns` (A1.b) não funcionam. |
| **P1-03** | Charts renderizam série sintética `[{0},{0}]` quando não há dados, sem informar ausência de fonte. | `src/pages/DnsPage.tsx:326, 362, 389-391` | Operador interpreta como "tráfego zero", não como "telemetria ausente". |
| **P1-04** | Três escalas diferentes para `cache_hit_ratio` na mesma plataforma: collector grava 0-100 (`collector.py:241,884`), `metrics_collector_service` grava 0-100 (`:57-58`), `routes/metrics.py` Prometheus grava 0-1 (`:60-66`). `chartData` mistura essas fontes (`DnsPage.tsx:676,693`). | citações acima | Gráfico de Cache Hit oscila entre `<1%` aparente e `100%` dependendo da fonte vencedora; KPI vs gráfico discordam. |
| **P1-05** | Página `/metrics` não tem seletor de janela; Top Domínios/Clientes ali são *all-time*. | `src/pages/MetricsPage.tsx` (ausência) | Operador compara `/dns` (`6h`) com `/metrics` (`all-time`) acreditando ser o mesmo intervalo. |

### P2 — Enganos de estado/contexto

| ID | Defeito | Evidência | Lacuna C# |
|---|---|---|---|
| **P2-01** | Instância "removida do DNAT" não tem indicador nas páginas de observabilidade. | `/api/health/instances` já expõe `instance_state` | C1 |
| **P2-02** | Cooldown anti-flap (120 s) não é badge global. | `health_service.py:206-264` | C2 |
| **P2-03** | `telemetry_mode=logless` / `log_source=none` não é banner. | `collector.py:437,689` | C3 |
| **P2-04** | Idade de `latest.json` (`stale=true`) não vira selo "telemetria desatualizada". | `telemetry.py:79-100` | C10 |
| **P2-05** | `query-rankings` faz fallback global silencioso (`top_domains_by_range[X] || top_domains`). | `telemetry.py:325-327` | C6 |
| **P2-06** | UI não compara `retention_minutes` (já no payload) com a janela escolhida pelo operador. | `latest.json.query_analytics.retention_minutes` | C5 |

### P3 — Polimento / contexto operacional

| ID | Defeito | Evidência | Lacuna C# |
|---|---|---|---|
| **P3-01** | Drift de configuração não é exibido em `/dns`/`/metrics`. | `drift_service.py` | C4 |
| **P3-02** | KPIs não distinguem "entrou no host" (nftables) de "respondido pelo unbound". | `traffic.qps` vs `resolver.qps` no `latest.json` | C7 |
| **P3-03** | Não há link do `ErrorsChart` para a tabela detalhada de `/api/metrics/dns/errors/live`. | `dns_errors.py:85-93` | C9 |
| **P3-04** | `useQuery` errors não viram banner; só `console`. | `DnsPage.tsx:554` (descartado) | — |
| **P3-05** | `MetricsPage` chama `useTelemetryStatus` e não usa o `stale`/`file_age_seconds`. | `MetricsPage.tsx:54` | C10 |

---

## Arquivos inspecionados

**Frontend:**
* `src/pages/DnsPage.tsx`
* `src/pages/MetricsPage.tsx`
* `src/lib/api.ts`
* `src/lib/hooks.ts`
* `src/lib/noc-context.tsx`
* `src/components/noc/NocInstanceTable.tsx`
* `src/components/noc/NocHealthMatrix.tsx`
* `src/components/DnsTimeSeriesCharts.tsx`

**Backend (rotas):**
* `backend/app/api/routes/telemetry.py`
* `backend/app/api/routes/dns.py`
* `backend/app/api/routes/dns_errors.py`
* `backend/app/api/routes/metrics.py`
* `backend/app/api/routes/metrics_v2.py`
* `backend/app/api/routes/health_v2.py`
* `backend/app/api/routes/healthcheck.py`
* `backend/app/api/routes/events.py`

**Backend (serviços + collector):**
* `backend/app/services/metrics_service.py`
* `backend/app/services/metrics_collector_service.py`
* `backend/app/services/history_service.py`
* `backend/app/services/health_service.py`
* `backend/app/services/unbound_stats_service.py`
* `backend/collector/collector.py`

---

## Critérios de aceite — checklist

- [x] Todo seletor de `/dns` e `/metrics` inventariado com ponto de quebra exato (Seção A).
- [x] Todo gráfico com fonte, loading/vazio/erro e correção de escala documentados (Seção B).
- [x] Lacunas de clareza com o dado-fonte do backend que existe mas não é exibido (Seção C).
- [x] Defeitos priorizados P1/P2/P3 com evidência (Seção D).
- [x] Nenhum código de produção alterado — diff só adiciona este `.md`.
