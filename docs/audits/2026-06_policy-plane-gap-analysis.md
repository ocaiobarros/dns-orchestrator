# Policy Plane — Gap Analysis

> **Data:** 2026-06-21
> **Escopo:** SOMENTE LEVANTAMENTO. Nenhum gerador, .conf, paridade FE↔BE, golden test ou o mecanismo blackhole do AnaBlock foi alterado.
> **Regra de evidência:** toda afirmação cita arquivo:linha real (lição GO-3). "Não confirmável" quando não há evidência direta.
> **Memória firme preservada:** AnaBlock IP usa rotas blackhole no kernel — NÃO foi tocado.

---

## B. Os dois planos de bloqueio — afirmação explícita

O DNS Control opera dois planos **distintos e independentes** de bloqueio:

| Plano | Sujeito do bloqueio | Mecanismo | Onde é aplicado | Arquivo principal |
|---|---|---|---|---|
| **(a) IP / destino** | endereço IP de destino | rota `blackhole` no kernel + sync script | tabela de rotas do host | `backend/app/generators/ip_blocking_generator.py:1-264` |
| **(b) Nome / consulta** | FQDN consultado | `local-zone` no Unbound (`anablock.conf`, `unbound-block-domains.conf`) | resolver Unbound | `backend/app/generators/unbound_generator.py:395-412, 414-560` |

Os dois planos compartilham a marca "AnaBlock" e a mesma fonte (`api.anablock.net.br`), mas são execuções separadas:

- **(a)** ativado por `enableIpBlocking` (`src/pages/Wizard.tsx:936-939`), gera `/usr/local/bin/anablock-ip-sync.sh` + unit/timer systemd (`ip_blocking_generator.py:217-247`).
- **(b)** ativado por `enableBlocklist` (`src/pages/Wizard.tsx:898-901`), gera `/etc/unbound/gen-anablock.sh` + `anablock.conf` placeholder (`unbound_generator.py:405-412, 558-560`).

Nenhum deles é RPZ. Não há diretiva `response-policy` nem zona RPZ em ponto algum (`rg -ni "rpz|response.policy" backend src` → apenas matches em strings de erro/log não relacionados, **zero** em generators).

---

## A. Matriz Mecanismo × Estado

| Mecanismo | Existe? | Evidência arquivo:linha | Persistência | Observável na UI? | Lacuna |
|---|---|---|---|---|---|
| **Bloqueio por IP (AnaBlock blackhole)** | **Sim** | `backend/app/generators/ip_blocking_generator.py:35` (URL API), `:122-204` (sync script), `:217-247` (unit/timer); Wizard `src/pages/Wizard.tsx:936-939` | Lista volátil em `/var/lib/dns-control/anablock-ipv4-current.list` (filesystem, não DB) | `NocAnablockStatus` (`src/components/noc/NocAnablockStatus.tsx`) — confirmar campos específicos | **Memória firme — intocado.** Sem lista de exceções (P1, ver abaixo). |
| **Bloqueio por nome — AnaBlock judicial (`local-zone`)** | **Sim** | `unbound_generator.py:395-412` (placeholders), `:414-560` (sync script com `curl -sf "$APIURL"` → `local-zone: "domain" always_nxdomain`); Wizard `src/pages/Wizard.tsx:898-924` (modo + URL + redirect) | `/etc/unbound/anablock.conf` (filesystem) + `/var/lib/dns-control/anablock-version` | `GET /api/telemetry/anablock` (`backend/app/api/routes/telemetry.py:116-160`) expõe `domains_loaded_count`, `last_status`, `last_update_iso`. UI: `NocAnablockStatus.tsx` | Modos suportados: `always_nxdomain`, `redirect_cname`, `redirect_ip`, `redirect_ip_dualstack` (`unbound_generator.py:421-442`). Sem exceções por domínio. |
| **Bloqueio por nome — operador (`local-zone` customizado)** | **Placeholder** | `unbound_generator.py:395-404` (arquivo `/etc/unbound/unbound-block-domains.conf` com comentário "Add custom local-zone directives here, one per line"); FE espelhado em `src/lib/config-generator.ts:344-346, 1811-1858` | Filesystem manual; **sem UI nem DB** | **Não** — nenhum componente para gerenciar | **Greenfield**: domain blocklist do operador hoje é edição manual em arquivo. |
| **RPZ (Response Policy Zone)** | **Não** | `rg -ni "rpz\|response.policy\|response-policy" backend/app src/lib/config-generator.ts` → **zero matches em generators**. Confirmado: nenhuma diretiva `response-policy` em `unbound_generator.py` ou `config-generator.ts`. | n/a | n/a | **Greenfield total**. RPZ requer Unbound ≥ 1.14 com módulo `respip` (não habilitado: `module-config: "iterator"` em `unbound_generator.py:342`). |
| **Overrides (`local-data` arbitrário do operador)** | **Não** (apenas `local-data` fixos de localhost) | `unbound_generator.py:344-352` emite só localhost/127-in-addr.arpa estáticos; **nenhum mecanismo para o operador injetar `local-data` arbitrário** via Wizard/API | n/a | n/a | **Greenfield**. Não há editor de override CNAME/A. |
| **Feeds de reputação externos (Spamhaus, abuse.ch, Quad9, etc.)** | **Não** | Única fonte externa: `api.anablock.net.br` (judicial). `rg -ni "spamhaus\|abuse.ch\|quad9\|threat\|reputation" backend src` → **zero matches**. | n/a | n/a | **Greenfield**. |
| **Política de atualização de feed** | **Curl em runtime** (apenas AnaBlock) | `unbound_generator.py:533` — `curl -sf --max-time 30 "$APIURL" -o "$CONF_TMP"`; `ip_blocking_generator.py` análogo. Versionamento por endpoint `/api/version`. | Versão em `/var/lib/dns-control/anablock-version`; status em `anablock-status.json` | Via `/api/telemetry/anablock` | **Nuance de memória**: a memória firme `mem://arquitetura/named-cache-snapshot-deterministico` veta download em runtime **especificamente para `named.cache`** (root hints). Para AnaBlock, o download em runtime é projeto vigente (gen-anablock.sh roda via timer). **Decisão pendente** se essa regra deve ser estendida a feeds. |
| **Allowlist / exceções (override de bloqueio)** | **Não** | `rg -ni "allowlist\|whitelist\|exception\|exempt" backend/app/generators src/lib/config-generator.ts src/pages/Wizard.tsx` → **zero matches semânticos** (matches em código só ocorrem como `except Exception` Python). Não há diretiva no gerador para inserir `local-zone always_transparent` ou `local-data` que sobreponha um bloqueio. | n/a | n/a | **P1 de segurança/jurídico** — ver seção D. |
| **Segmentação por tenant / view / rede** | **Não** | `rg -ni "view:\|access-control-view\|access-control-tag\|tenant" backend/app/generators src/lib/config-generator.ts` → **zero matches**. `unbound_generator.py:295` emite apenas `access-control:` (allow/deny por CIDR), sem `access-control-tag` nem blocos `view:`. | n/a | n/a | **Greenfield**. Toda política é global ao host/instância. Ver seção C. |
| **Modelo de dados de política (DB)** | **Não** | `ls backend/app/models/` → `apply_job, config_profile, config_revision, dns_events, log_entry, operational, session, user, vip_counter`. **Nenhuma tabela** `policy`, `blocklist`, `exception`, `tenant`, `view`. | Filesystem + script | n/a | **Greenfield**. Sem rastreamento relacional do que está bloqueado. |
| **Auditoria de alteração de política** | **Parcial** | `enableBlocklist`/`enableIpBlocking` são campos do `config_profile` (capturados via revisão de config — `models/config_profile.py`, `models/config_revision.py`). **Mas** a edição da blocklist em si (curl externo) não passa pelo audit trail: o sync roda como systemd timer e só registra via `logger -t anablock-sync` (`unbound_generator.py:467, 526, 530, 554`) — sem `log_event` estruturado. | journalctl (syslog tag) | Não | Conecta com `docs/audits/2026-06_traceability-gap-analysis.md` GO-4 (mutações silenciosas). |

---

## C. Segmentação por tenant/rede — avaliação

**Estado atual (com evidência):** **inexistente**. O Unbound gerado opera com política única por instância. A única diferenciação por origem é o `access-control:` allow/deny (`backend/app/generators/unbound_generator.py:295`, `:121-127`), que decide **se** o cliente pode recursar — não **qual política** se aplica.

**O que falta para suportar tenant/rede:**

1. `access-control-view: <CIDR> <viewname>` por faixa de cliente — não emitido.
2. Blocos `view: "<name>"` contendo `local-zone`/`local-data`/`response-policy` por tenant — não emitidos.
3. Modelo de dados: tabela `tenants(id, name, cidrs[])` ↔ `policies(tenant_id, rule_type, target, action)` — inexistente.
4. UI para mapear tenant → política — inexistente.

**Trade-offs (decisão de arquitetura pendente — NÃO implementar nesta tarefa):**

| Abordagem | Prós | Contras |
|---|---|---|
| **A. Manter política global** (status quo) | Simples, baixa cardinalidade de regras, paridade FE↔BE fácil | Não atende ISP B2B com clientes que demandam política diferenciada |
| **B. Multi-view do Unbound (`view:` + `access-control-view`)** | Nativo do Unbound, sem componente extra, RPZ pode ser por view | Cardinalidade de regras × tenants pode estourar; arquivo único `unboundXX.conf` cresce; reload mais caro |
| **C. Multi-instância por tenant** (uma instância Unbound por tenant) | Isolamento operacional, telemetria nativa por instância (já existe) | Custo de memória/CPU; complica DNAT/VIP; quebra o modelo atual de pool homogêneo |
| **D. RPZ central + tags** | Padrão de mercado, atualização incremental | Requer `module-config: "respip iterator"` e zona AXFR/IXFR — entra em território autoritativo (fora do escopo do produto) |

**Recomendação registrada (sem implementação):** se segmentação for prioridade, **B** é o caminho menos disruptivo dentro do escopo recursivo do produto. **D** sai do escopo.

---

## D. Resumo priorizado

### D.1. Achados de segurança / jurídico — **P1**

1. **Sem exceção possível ao bloqueio judicial (AnaBlock nome).** O sync sobrescreve `anablock.conf` integralmente (`unbound_generator.py:546` — `mv "$CONF_TMP" "$CONF"`). Qualquer `local-zone always_transparent` adicionado manualmente é destruído no próximo ciclo. Implicação operacional: se a API AnaBlock retornar um falso-positivo (ex.: domínio legítimo do próprio ISP), **não há mecanismo no produto para liberá-lo sem desativar AnaBlock por completo**. **Risco P1.**

2. **Sem exceção ao bloqueio judicial (AnaBlock IP).** Mesmo padrão em `ip_blocking_generator.py:122-204`. Rotas blackhole são reconciliadas a partir da lista remota; intervenção manual via `ip route del` é desfeita no próximo sync. **Risco P1.** *(Mitigação fora do escopo desta tarefa.)*

3. **Sem trilha de auditoria estruturada do que entrou/saiu da blocklist.** Mudanças passam só por `logger -t anablock-sync` (syslog). Operador não consegue responder "quando o domínio X foi bloqueado e por qual versão da base?" via UI/DB. Conecta com GO-4 do audit de rastreabilidade.

4. **Default permissivo do `securityProfile`.** Referência cruzada: `docs/audits/2026-06_resolver-rfc-posture.md` seção B já classificou como P1 o default `legacy` (open resolver). Política de nome (AnaBlock) opera sobre **qualquer cliente** que conseguir recursar — em modo legacy, isso inclui clientes fora do operador, ampliando o blast-radius de qualquer regra incorreta.

### D.2. **Ajuste do existente** (capacidade já presente, falta UI/governança)

- Editor de **blocklist customizada do operador** (`unbound-block-domains.conf` já é gerado como placeholder em `unbound_generator.py:395-404`). Backend só precisa de endpoint CRUD + reload; gerador já injeta via `include` (`unbound_generator.py:354`).
- Painel de status mais rico para AnaBlock: dados já existem em `/api/telemetry/anablock` (`telemetry.py:116-160`); UI mostra subconjunto.

### D.3. **Greenfield** (não existe — exige design)

- **Allowlist/exceção formal** (P1 acima). Modelo: tabela `policy_exceptions(scope_kind, scope_value, reason, expires_at, created_by)` + injeção no gerador antes do `mv` atômico.
- **RPZ** (`response-policy` + `module-config: "respip iterator"` + zona). Maior obra.
- **Feeds de reputação não-judiciais** (Spamhaus DROP, abuse.ch, etc.). Pipeline de ingestão + governança de licença.
- **Segmentação por tenant/rede** (seção C).
- **Persistência relacional da política.** Hoje policy é "arquivo + script"; greenfield para tabela de regras consultável.
- **Audit estruturado de mutação de política** (cruza com GO-4 do audit de rastreabilidade).

---

## Arquivos inspecionados (read-only)

- Generators: `backend/app/generators/unbound_generator.py`, `backend/app/generators/ip_blocking_generator.py`, `src/lib/config-generator.ts`
- Wizard / UI: `src/pages/Wizard.tsx`, `src/components/noc/NocAnablockStatus.tsx`
- Rotas backend: `backend/app/api/routes/telemetry.py`, `backend/app/api/routes/configs.py`
- Modelos: `backend/app/models/` (lista completa via `ls`)
- Buscas exaustivas: `rg -ni "rpz|response.policy|view:|access-control-tag|tenant|allowlist|whitelist|exception|reputation"` em `backend/app` e `src/`

## Restrições atendidas

- Nenhum código de produção alterado. Diff puramente aditivo (1 arquivo `.md`).
- Mecanismo blackhole do AnaBlock intocado (memória firme respeitada).
- Nenhuma migration criada — apenas proposta de modelo no greenfield.
- Nada autoritativo discutido como implementação (RPZ citado só como opção de design).
- Toda afirmação tem arquivo:linha ou está marcada como "não confirmável".
