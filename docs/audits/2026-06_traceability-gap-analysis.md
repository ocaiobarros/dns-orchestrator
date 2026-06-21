# Gap Analysis — Rastreabilidade de Operador e Atribuição de Consultas por Cliente

**Data:** 2026-06-21
**Escopo:** somente leitura + design. Nenhum arquivo de produção alterado, nenhuma migration criada.
**Compliance:** dado pessoal sensível (LGPD) — histórico de resolução DNS de assinante. Decisões legais ficam abertas para Scrum Master / Product Owner / DPO.

---

## A. OPERADOR-QUEM — estado atual

### A.1. O que existe hoje

* **Identidade do operador** é capturada pelo `User` (`backend/app/models/user.py`) com role `admin` ou `viewer` e exposta às rotas via `get_current_user` (`backend/app/api/deps.py:56-61`). Existe também `require_admin` mas **não é usado em nenhuma rota mutadora** — toda rota protegida aceita qualquer usuário autenticado, inclusive `viewer`. ⚠ (suposição: confirmado por `rg "require_admin"` sem hits em rotas).
* **Sessões** (`backend/app/models/session.py`): `session_token`, `user_id`, `client_ip`, `user_agent`, `created_at`, `expires_at`, `last_seen_at`, `is_active`. Não há `session_id` propagado para o log de evento — a correlação sessão↔ação **não existe**.
* **`log_entries`** (`backend/app/models/log_entry.py`): tabela genérica `(source, level, message, context_json, created_at)`. **Não tem coluna `user_id`** — autor entra concatenado no `message` ou dentro de `context_json` (campo livre, não indexado).
* **`events`** (`OperationalEvent` em `backend/app/models/operational.py:69-78`): `(event_type, severity, instance_id, message, details_json, created_at)`. **Sem `user_id`.**
* **`actions`** (`OperationalAction` em `:81-93`): `(action_type, target_type, target_id, status, stdout_log, stderr_log, exit_code, trigger_source, created_at, finished_at)`. `trigger_source` distingue `manual`/`health_engine`/`apply_engine`, mas **não diz qual operador disparou o `manual`**.
* **`apply_jobs`** (`backend/app/db/init.sql:61-74`): possui `created_by TEXT` — o único campo de autor estruturado em todo o esquema.
* **`config_profiles` / `config_revisions`**: também têm `created_by TEXT` (init.sql:42, 55).
* **Helper `log_event`** (`backend/app/core/logging.py:31-46`) e `log_auth_event` (`:49-54`) gravam em `log_entries` com username dentro do `context_json` ou concatenado na string.
* **`log_command_event`** (`:57-101`) registra `command_id`, `user`, `exit_code`, `duration_ms`, `diagnostic_status` em `context_json`. **Único ponto que persiste explicitamente o usuário de comando executado.** Chamado por `routes/troubleshooting.py:46-55`.

### A.2. Inventário ação → registra autor?

Tabela coletada por `rg "user.username|created_by|operator|log_event|log_command_event"` em `backend/app/api/routes/*` e `backend/app/services/deploy_service.py`.

| Ação operacional | Rota / serviço | Autor registrado? | Onde / campo |
|---|---|---|---|
| Login / logout / mudança de senha | `routes/auth.py:82-175` | **Sim** | `log_entries.context_json.username` + `OperationalEvent(event_type=login_success)` (apenas login). Logout/senha **não geram `OperationalEvent`**. |
| Reiniciar serviço (`/services/{name}/restart`) | `routes/services.py:30` | **Parcial** | Texto livre `message="Serviço X reiniciado por <user>"`. Sem `user_id`. |
| Remove backend manual | `routes/actions.py:34` | **Parcial** | Texto livre `"Backend X manually removed by <user>"`. Sem coluna; ação não chega à tabela `actions` (essa tabela é escrita por `decision_service`). |
| Restore backend manual | `routes/actions.py:44` | **Parcial** | idem. |
| Reconcile-now manual | `routes/actions.py:82-92` | **Parcial** | Texto livre; no-op só vai pro log Python, **não persiste no DB**. |
| Deploy dry-run / apply | `routes/deploy.py:103-160` + `deploy_service._save_deploy_state` (`:2374`, `:2466`) | **Sim** | `apply_jobs.created_by` + manifest JSON em disco com `operator`/`user`. Estruturado. |
| Apply (legacy) `/apply/*` | `routes/apply.py:33-83` | **Sim** | `apply_jobs.created_by`. |
| Rollback | `routes/deploy.py:164-181` | **Sim** | `execute_rollback(operator=user.username)` + `apply_jobs.created_by`. |
| Criar / editar / clonar config profile | `routes/configs.py:184-252` | **Sim** | `config_profiles.created_by` + `config_revisions.created_by`. |
| Criar / resetar / excluir usuário | `routes/users.py:65-155` | **Parcial** | Texto livre em `log_entries.message`. Sem coluna `actor_user_id` no destino. |
| Run diagnostic command (`/troubleshooting/run`) | `routes/troubleshooting.py:46-55` | **Sim (em `context_json`)** | `log_command_event` grava `user=user.username` em `context_json`. |
| Importar config (`/import`) | `routes/import_config.py` | **Não confirmado** — sem ocorrência de `user.username` neste arquivo (suposição: rota não registra autor). |
| Settings (`/settings`) | `routes/settings.py` | **Não confirmado** — sem `log_event` neste arquivo. |
| Network / OSPF / NAT changes | `routes/network.py`, `ospf.py`, `nat.py` | **Não confirmado** — sem `log_event` nestes arquivos. |
| Files (`/files`) | `routes/files.py` | **Não confirmado**. |
| Recollect telemetria | `routes/telemetry.py:198-247` | **Não** — só faz `subprocess.run`. |

### A.3. Síntese

* **O autor é registrado parcialmente, sempre como string em `log_entries.message`** (não-indexada, não-pesquisável por usuário sem `LIKE %...%`).
* **A única coluna estruturada de autor** existe em `apply_jobs.created_by`, `config_profiles.created_by`, `config_revisions.created_by`. Para todo o resto a recuperação por usuário é frágil.
* **Não há `session_id` em nenhum log.** Não é possível responder "todas as ações da sessão `<X>` do usuário `<Y>` entre 14:00 e 15:00".
* **`require_admin` existe mas não é aplicado** — qualquer `viewer` logado pode disparar mutações via API.

---

## B. ASSINANTE-QUEM — estado atual

### B.1. Como Top Clients é obtido hoje

Fonte primária em produção: `backend/collector/collector.py`, função de parse em `:465-684`.

* Roda via `dns-control-collector.timer` a cada 10 s.
* Executa `journalctl -u unboundXX --since "..." --no-pager` (sudoers exige `NOPASSWD`).
* Aplica três regexes (`collector.py:577-588`):
  * **Primária:** `info:\s+(\S+?)(?:[#@]\d+)?\s+(\S+)\s+([A-Z0-9]+)\s+([A-Z0-9]+)` → `<client> <domain> <qtype> <qclass>`.
  * **Tagged:** `info:\s+query[^:]*:\s+...` para logs com prefixo de tag.
  * **Fallback:** `query: <domain> <class> <type> from <client>`.
* Validação do IP capturado: regex `^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,})$` (`:617`) — aceita IPv4 e IPv6 cru, mas regex IPv6 é frouxa (qualquer string com 2+ chars hexa e `:`).
* Agregação **somente em memória + JSON** (`.query_history.json` e `latest.json`/`history.json`). **Nenhuma linha vai para SQLite.**
* Buckets por minuto, dedup por SHA1 da linha; retenção configurável `QUERY_RETENTION_MINUTES` (default 72 h).
* Saída exposta na UI:
  * `latest.json.top_domains`, `top_clients`, `top_query_types` (snapshot atual).
  * `top_domains_by_range`, `top_clients_by_range` (agregação por janela).
  * `recent_queries` (buffer de eventos recentes, sem atribuição estável de instância — ver auditoria de observabilidade).

### B.2. Fragilidades do parser regex (confirmadas no código)

1. **Dependência absoluta de `log-queries: yes` + `use-syslog: yes` em todos `/etc/unbound/unbound*.conf`.** Sem isso, `journalctl` não tem linha `info:` parseável e o sistema cai para `telemetry_mode=logless` (zero atribuição).
2. **Performance:** o collector roda `journalctl --since` a cada 10 s. Em ISP com >50 k qps, o volume de linhas inviabiliza o parse (limite operacional não medido).
3. **Linhas multi-tag:** unbound escreve diferentes formatos conforme `log-tag-queryreply`, `log-replies`, `log-queries`. Os 3 padrões cobrem boa parte mas **não 100%**.
4. **IPv6:** regex `[0-9a-fA-F:]{2,}` faz match em strings que não são endereços válidos (`info:`, `time:`, etc.). Filtragem por `re.match` é insuficiente sem `ipaddress.ip_address()`.
5. **Sem `rcode`/`response_size`/`latency`** — o log de query do unbound não carrega o resultado; é só a pergunta. Quem responde "essa query deu SERVFAIL?" é o `dns_error_collector_service` separado.
6. **Sem atribuição de instância na linha individual** — collector deduz pela process tag `unbound[pid]`, mas não anexa `instance` ao evento (auditoria anterior confirmou isso).
7. **Logrotate / journal vacuum** podem cortar a janela; o collector não detecta lacunas (continuidade do `--since` é "best effort").

### B.3. Estado real do `dnstap_collector.py`

Arquivo `backend/collector/dnstap_collector.py` (660 linhas):

* **Existe e é completo** — conecta a `/var/run/unbound/dnstap.sock` via Frame Streams + protobuf (parser próprio quando `dnstap_pb2` indisponível, `:7-16`).
* Suporta `CLIENT_QUERY`, `CLIENT_RESPONSE`, `RESOLVER_*`, `FORWARDER_*` (`:66-80`).
* **Persistência exclusivamente em JSON** (`_atomic_write` em `:548-556`): grava `dnstap.json` (summary) e `dnstap-events.json` (buffer 5 000 eventos por padrão). **Não toca SQLite.**
* Serviço systemd `deploy/systemd/dns-control-dnstap.service` existe. **Atualmente não é parte do deploy padrão** (precisa `dnstap-enable: yes` + soquete habilitado no unbound — não setado por nenhum generator hoje, suposição com base em `rg "dnstap-enable" backend/app/generators`).
* `dns_error_collector_service.py:4` diz literalmente: *"dnstap (highest fidelity) — not yet integrated here"*.

### B.4. Persistência consultável por cliente?

**Não existe.** Conferido em:

* Tabelas SQLite (`db/init.sql` + `models/*.py`): **nenhuma** tabela tem `client_ip`+`qname`+`qtype`+`timestamp`. O que mais se aproxima é `DnsEvent` (referenciado em `metrics_service.py:14`), mas a busca `rg "class DnsEvent"` em `backend/app/models/` não retorna nada — **o modelo `DnsEvent` é importado mas não está definido no repositório auditado** ⚠ (suposição: pode ter sido removido sem limpeza do import; o `metrics_service.py:54` faria fallback para snapshot, o que casa com a observação de auditoria anterior de "1 ponto only").
* JSON do collector: agregado, não permite drill-down por cliente histórico além das janelas pré-computadas.
* JSON do dnstap: buffer de 5 000 eventos, sobreescrito.

**Resposta operacional à pergunta "que assinante resolveu `dominio.com` ontem às 14:30?": impossível com a infra atual.**

---

## C. Gap analysis

### C.1. Operador-quem

| ID | Lacuna | Severidade | Evidência |
|---|---|---|---|
| GO-1 | Sem coluna `actor_user_id` / `actor_username` em `log_entries`, `events`, `actions`. Autor só em texto. | **Alta** | `models/log_entry.py:14-19`, `models/operational.py:69-93` |
| GO-2 | Sem `session_id` em nenhum log. Correlação sessão↔ação impossível. | **Alta** | `models/session.py` × tabelas de log |
| GO-3 | `require_admin` não é aplicado em nenhuma rota mutadora. `viewer` pode disparar restart, reconcile, delete user, deploy. | **Crítica** | `deps.py:56-61` definido, não consumido. |
| GO-4 | `routes/network.py`, `ospf.py`, `nat.py`, `files.py`, `settings.py`, `import_config.py` não chamam `log_event`. Mutações silenciosas. | **Alta** | `rg "log_event" backend/app/api/routes/{network,ospf,nat,files,settings,import_config}.py` → vazio. |
| GO-5 | `client_ip`/`user_agent` capturados em `sessions` mas não copiados para o log da ação. | **Média** | `models/session.py:21-22` |
| GO-6 | Falhas de autorização (401/403) não geram `log_entries` — só sucessos de login. | **Média** | `routes/auth.py:82-84` |
| GO-7 | Sem retenção configurada para `log_entries` / `events`. Crescimento indefinido em SQLite single-writer. | **Média** | sem `DELETE`/cron de purga no repo. |
| GO-8 | `OperationalEvent` e `log_entries` são duas tabelas que se sobrepõem semanticamente. Audit trail fica fragmentado em dois lugares. | **Média** | comparar `models/operational.py:69` × `models/log_entry.py:11`. |

### C.2. Assinante-quem

| ID | Lacuna | Severidade | Evidência |
|---|---|---|---|
| GA-1 | Nenhuma persistência relacional de consultas por cliente. JSON é sumário. | **Alta** (operacional); **bloqueante** se houver requisito judicial. | `rg "client_ip" backend/app/models/` → vazio. |
| GA-2 | Fonte primária (`journalctl` + regex) é frágil: depende de config do unbound, performance limitada, IPv6 com falso positivo. | **Alta** | `collector.py:577-617`. |
| GA-3 | `dnstap_collector.py` está pronto mas **não é ativado por padrão**; nenhum gerador habilita `dnstap-enable: yes`. | **Alta** | `dns_error_collector_service.py:4`; ausência de `dnstap-enable` em `app/generators/unbound_generator.py` (suposição: precisa confirmar). |
| GA-4 | Dnstap também só persiste em JSON (`dnstap-events.json`), buffer de 5 000 eventos. Mesma dívida de GA-1. | **Alta** | `dnstap_collector.py:39, 530-532`. |
| GA-5 | Sem controle de acesso diferenciado: Top Clients aparece em telas acessíveis a qualquer login (kiosk inclusive?). | **Crítica** (LGPD) | confirmar se `KioskDashboard` mostra clientes — suposição: dashboard kiosk consome `telemetry/latest` que inclui `top_clients`. |
| GA-6 | Sem anonimização/pseudonimização. IP de assinante aparece em claro. | **Crítica** (LGPD) | mesmo collector. |
| GA-7 | Sem retenção declarada / configurável dos buffers de query. | **Alta** | `QUERY_RETENTION_MINUTES` default 72 h é puramente operacional, não política. |
| GA-8 | Sem trilha de quem consultou o histórico de consultas (meta-auditoria do acesso a dado sensível). | **Alta** | nenhuma rota de query DNS por cliente existe ainda; precisa nascer já com auditoria. |

---

## D. Proposta de design (NÃO implementar — discutir)

### D.1. Audit trail de operador

#### Esquema proposto (NOVA tabela `audit_events`)

```sql
CREATE TABLE audit_events (
  id              TEXT PRIMARY KEY,           -- uuid
  occurred_at     TEXT NOT NULL,              -- ISO8601 UTC
  actor_user_id   TEXT REFERENCES users(id),  -- NULL para system/cron
  actor_username  TEXT NOT NULL,              -- snapshot (sobrevive a delete user)
  actor_role      TEXT NOT NULL,              -- admin/viewer/system
  session_id      TEXT REFERENCES sessions(id),
  client_ip       TEXT,
  user_agent      TEXT,
  category        TEXT NOT NULL,              -- auth | config | deploy | service | reconcile | user_mgmt | network | settings | data_access
  action          TEXT NOT NULL,              -- 'service.restart', 'deploy.apply', 'config.update', 'reconcile.manual', etc.
  target_type     TEXT,                       -- 'instance' | 'service' | 'profile' | 'user' | ...
  target_id       TEXT,
  target_label    TEXT,                       -- 'unbound02', etc. (snapshot)
  outcome         TEXT NOT NULL,              -- success | failure | denied
  reason          TEXT,                       -- mensagem livre / detalhe da falha
  details_json    TEXT,                       -- payload estruturado, sem segredos
  http_method     TEXT,
  http_path       TEXT,
  correlation_id  TEXT                        -- propagado via header X-Request-Id
);
CREATE INDEX idx_audit_actor   ON audit_events(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_target  ON audit_events(target_type, target_id, occurred_at DESC);
CREATE INDEX idx_audit_action  ON audit_events(action, occurred_at DESC);
CREATE INDEX idx_audit_session ON audit_events(session_id);
```

#### Pontos de gravação propostos

* Middleware FastAPI que captura request_id, `current_user`, sessão (via lookup em `sessions` por `session_token`).
* Decorator `@audit("category", "action")` aplicado nas rotas mutadoras (todas as não-GET de `routes/*`).
* Migração: manter `log_entries`/`events` para logs operacionais. `audit_events` é **trilha legal**, não compete com observabilidade.

#### Exposição na UI

* Página `/audit` (nova, admin-only via `require_admin`).
* Filtros: ator, ação, alvo, janela temporal, outcome.
* Export CSV/JSON com timestamp servidor.
* **Nenhum acesso para `viewer` nem rota kiosk.**

#### Retenção sugerida (a decidir)

Mínimo 1 ano para compliance; rotação para arquivo cold (gzip mensal) recomendada.

### D.2. Atribuição de consultas por cliente

#### Fonte recomendada: **dnstap, primária; journalctl como fallback degradado**

| Critério | journalctl + regex | **dnstap** |
|---|---|---|
| Fidelidade | linhas texto, regex frágil | binário Frame Streams, sem ambiguidade |
| Latência | até 10 s (timer) | tempo real (stream) |
| Performance | linear no volume; CPU intenso > 30 kqps | bem mais barato; protobuf parseável incrementalmente |
| Resposta/rcode | não captura | captura `CLIENT_RESPONSE` com rcode + tempo |
| IPv6 robusto | falso positivo possível | endereço binário tipado |
| Requer config | `log-queries: yes` + `use-syslog: yes` | `dnstap-enable: yes` + `dnstap-socket-path` |
| Já existe no repo | sim, produção | sim (`dnstap_collector.py`), **inativo** |
| Suportado pelo upstream | ad-hoc | nativo Unbound 1.10+ |

**Recomendação:** ativar dnstap como fonte primária, manter parser journalctl apenas como fallback exibido com selo de "degraded".

#### Modelo de dados proposto (NOVA tabela `dns_query_log`)

⚠ **Não criar sem decisão LGPD.** Esquema sugerido:

```sql
CREATE TABLE dns_query_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,  -- rotativo
  occurred_at     INTEGER NOT NULL,                   -- epoch ms
  instance        TEXT NOT NULL,                      -- 'unbound01'
  client_ip       TEXT NOT NULL,                      -- ou hash (ver D.3)
  qname           TEXT NOT NULL,
  qtype           TEXT NOT NULL,                      -- A, AAAA, ...
  rcode           TEXT,                               -- NOERROR/NXDOMAIN/SERVFAIL/REFUSED
  response_ms    INTEGER,
  source          TEXT NOT NULL                       -- 'dnstap' | 'journalctl'
);
CREATE INDEX idx_dql_client ON dns_query_log(client_ip, occurred_at DESC);
CREATE INDEX idx_dql_qname  ON dns_query_log(qname, occurred_at DESC);
CREATE INDEX idx_dql_time   ON dns_query_log(occurred_at DESC);
```

**Implementação NÃO sugerida em SQLite single-writer para ISP médio/grande.** Alternativas a discutir:

* SQLite separado, particionado por dia, com `PRAGMA journal_mode=WAL` dedicado.
* Banco append-only (DuckDB, ClickHouse, victorialogs) fora do processo da API.
* Arquivos NDJSON rotativos diários + índice secundário (mais barato; busca via `grep`/`zgrep`).

#### Acesso

* Endpoint sob `require_admin`, **nunca** `viewer`, **nunca** kiosk.
* Toda consulta a `dns_query_log` **deve gerar `audit_events`** (`category=data_access`, `action='dns_query.search'`, com filtros usados em `details_json`).
* Sem export em massa sem segunda confirmação (e log explícito de export).

### D.3. Controles obrigatórios — DECISÕES EM ABERTO (Scrum Master / PO / DPO)

> Estas perguntas **não são respondidas pela equipe técnica sozinha**. Cada uma altera materialmente o design acima.

1. **Período de retenção dos logs de consulta DNS?** (30 d? 90 d? 6 m? mínimo legal Marco Civil 6 m? mais por requisição judicial específica?)
2. **Acesso restrito a admin?** Confirmar que `viewer` e `kiosk` **nunca** veem IP de assinante (proposta: sim — `top_clients` deve ser ocultado do kiosk).
3. **Anonimização / pseudonimização do IP do assinante?**
   * (a) gravar em claro;
   * (b) hash determinístico (HMAC com chave rotacionada) — permite estatística por cliente sem identificar;
   * (c) /24 truncado para IPv4 e /64 para IPv6 quando exibido a operador;
   * (d) (a) por X dias e depois agregar/anonimizar.
4. **Base legal LGPD?** Execução de contrato com assinante? Cumprimento de obrigação legal (Marco Civil art. 13)? Legítimo interesse? Documentar.
5. **Comunicação ao titular** sobre tratamento de dados de navegação DNS na política de privacidade do ISP.
6. **Impacto de volume em SQLite single-writer:** aceitável escrever 5–50 k linhas/s no mesmo SQLite da API? (proposta técnica: separar storage — ver D.2).
7. **Trilha de meta-auditoria:** quem consulta o histórico de consultas precisa autorização adicional (4-eyes)? Notificar segundo admin?
8. **Tratamento de requisições judiciais (AnaBlock):** já há subsistema — definir se a busca por cliente integra com workflow judicial existente ou roda paralela.
9. **Política de export:** export CSV de consultas autorizado? Watermark com nome do operador no arquivo?
10. **`require_admin` retroativo:** aplicar imediatamente em todas rotas mutadoras quebra integrações existentes? Plano de migração?

---

## Resumo (entrega obrigatória)

* **Operador-quem hoje:** autor presente como texto em `log_entries.message`/`context_json`; coluna estruturada **só em `apply_jobs.created_by`, `config_profiles.created_by`, `config_revisions.created_by`**. Sem `session_id` em log algum. `require_admin` existe mas **não é aplicado**.
* **Assinante-quem hoje:** parser regex de `journalctl` no `collector.py` agrega Top Clients em JSON. Sem persistência relacional. `dnstap_collector.py` está implementado mas **inativo**. Nenhum gerador habilita dnstap.
* **Principais lacunas:** GO-3 (RBAC não aplicado — crítica), GO-1/GO-2 (sem autor estruturado / sem sessão), GA-5/GA-6 (sem RBAC nem anonimização sobre dado sensível — crítica LGPD), GA-1/GA-4 (sem persistência consultável), GA-3 (dnstap dormente).
* **Fonte recomendada para atribuição:** **dnstap como primária**, journalctl como fallback rotulado "degraded". Justificativa: fidelidade binária, captura de rcode/tempo, performance, IPv6 correto, suporte nativo do Unbound, código já presente no repo.
* **Decisões em aberto:** retenção, anonimização, base legal LGPD, modelo de storage para volume real, meta-auditoria de acesso, comunicação ao titular, política de export, plano de aplicação retroativa do RBAC.
* **Arquivos inspecionados (read-only):**
  * Backend modelos: `models/user.py`, `session.py`, `log_entry.py`, `operational.py`.
  * Backend core/serviços: `core/logging.py`, `services/event_service.py`, `services/auth_service.py`, `services/deploy_service.py`, `executors/command_runner.py`, `core/sessions.py`.
  * Backend rotas: `api/deps.py`, `api/routes/{auth,actions,services,deploy,apply,configs,users,troubleshooting,logs,events,telemetry,settings,network,ospf,nat,files,import_config,system}.py`.
  * Collectors: `collector/collector.py` (parse journalctl), `collector/dnstap_collector.py`.
  * Schema: `db/init.sql`.
  * Frontend: presença confirmada das páginas `LogsPage.tsx`, `EventsPage.tsx`, `LogValidationPage.tsx`, `ObservedQueriesPage.tsx` (não inspecionadas em profundidade nesta tarefa — design da UI fica como follow-up).

## Critérios de aceite — checklist

- [x] Estado atual das duas dimensões documentado com evidência de código.
- [x] Gap analysis com severidade.
- [x] Proposta de design **não implementada** — apenas proposta.
- [x] Decisões LGPD / retenção / acesso listadas como perguntas abertas.
- [x] Nenhum código de produção alterado, nenhuma migration criada.
