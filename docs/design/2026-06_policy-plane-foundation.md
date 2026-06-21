# Policy Plane — Fundação do Plano de Política Nativo

> **Data:** 2026-06-21
> **Tipo:** SOMENTE DESIGN. Nenhum gerador, gerador FE/BE, golden, AnaBlock, `module-config` ou modelo de dados foi alterado por esta entrega. O diff é puramente aditivo (este `.md`).
> **Insumos:** `docs/audits/2026-06_policy-plane-gap-analysis.md` (DISC-05); memória `.lovable/memory/arquitetura/escopo-produto-recursivo-hibrido.md`; código vigente (vide §1).
> **Regra de evidência:** cada afirmação sobre o estado atual cita `arquivo:linha` real.

---

## 1. Evidência do estado atual (confirmado no código)

| Item | Estado | Evidência |
|---|---|---|
| `module-config` | `"validator iterator"` (DNSSEC ON, **sem `respip`**) | `backend/app/generators/unbound_generator.py` (DNSSEC habilitado em FIX-DNSSEC); FE espelhado em `src/lib/config-generator.ts:172` |
| `local-zone`/`local-data` "fixos" | Apenas `localhost.` e `127.in-addr.arpa.` | `src/lib/config-generator.ts:177-185` |
| Includes vigentes por instância | `unbound-block-domains.conf` (manual) + `anablock.conf` (judicial) | `src/lib/config-generator.ts:187-188` |
| AnaBlock nome (judicial) | Sync por timer; sobrescreve `anablock.conf` integralmente | `unbound_generator.py:395-560`; `config-generator.ts:383-431` |
| AnaBlock IP (judicial) | Rotas blackhole no kernel — **memória firme, intocada** | `backend/app/generators/ip_blocking_generator.py:1-264` |
| Blocklist do operador (nome) | Placeholder de arquivo + script gerador, **sem UI/DB** | `config-generator.ts:344-349, 1810-1858`; `organic_generator.py:327-361` |
| Allowlist / exceções | **Inexistente** | DISC-05 §A linha "Allowlist" — zero matches |
| Tenant / view / `access-control-view` | **Inexistente** | DISC-05 §C — `unbound_generator.py:295` emite apenas `access-control:` |
| Modelo de dados de política | **Inexistente** | `backend/app/models/` não contém `policy`/`tenant`/`view` |
| Auditoria de mudança de política | Parcial (`config_profile`/`config_revision` capturam toggles; sync externo só loga via syslog) | DISC-05 §A linha "Auditoria"; conecta com GO-4 |

Conclusão: o plano de política nativo é **majoritariamente greenfield**. AnaBlock cobre apenas o caso judicial e **não tem exceção** (P1 já registrado em DISC-05 §D.1).

---

## 2. Modelo de dados proposto (não implementar)

Princípio: **toda entidade de política nasce com escopo opcional (`scope_view`)**, mesmo que o MVP rode tudo em escopo `global`. Isso evita redesenho quando multi-view for ligado.

### 2.1 Entidades

```text
tenants                       (preparatório p/ multi-view; MVP pode conter só "default")
  id            uuid pk
  name          text unique
  description   text
  created_at    timestamptz

views                         (1↔1 com bloco "view:" do Unbound, futuro)
  id            uuid pk
  tenant_id     uuid fk tenants(id)
  name          text unique         -- vira o nome do view: "<name>" no Unbound
  cidrs         inet[]              -- alimenta access-control-view
  is_default    bool                -- view aplicado quando nenhum CIDR casa
  created_at    timestamptz

policy_rules                  (UNIFICA override/bloqueio/exceção nativos)
  id              uuid pk
  scope_view      uuid fk views(id) NULL    -- NULL = global (MVP)
  kind            enum('block_name','override_data','allow_exception','feed_rule')
  target          text                       -- FQDN ou padrão; semântica por kind
  action          enum('always_nxdomain','always_refuse','always_transparent',
                       'redirect_cname','redirect_ip','static_data','noop')
  payload         jsonb                       -- p/ redirect_cname: {cname}; redirect_ip: {a, aaaa}; static_data: lista de RR
  source          enum('operator','feed','anablock_mirror')  -- 'anablock_mirror' RESERVADO; ver §4
  source_ref      text                        -- p/ feed: feed_sources.id; p/ operator: user
  priority_layer  smallint                    -- 100=judicial, 200=operador-block, 300=feed, 400=allow_exception (§3)
  enabled         bool default true
  created_by      uuid fk users(id)
  created_at      timestamptz
  updated_at      timestamptz
  UNIQUE(scope_view, kind, target, source)

feed_sources                  (genérico; AnaBlock é caso particular — ver §4)
  id            uuid pk
  name          text unique
  kind          enum('domain_blocklist','ip_blocklist','reputation')
  url           text
  auth_header   text NULL
  integrity     enum('sha256_sidecar','signed_manifest','none')   -- ver §5
  cadence_sec   int
  enabled       bool
  is_judicial   bool default false          -- true ⇒ não-sobreponível (§3)
  last_version  text
  last_status   text
  last_sync_at  timestamptz

policy_audit                  (NÃO um subsistema novo — view sobre operational_events)
  -- materializada via filtro event_type IN ('policy.rule.created', ...) sobre operational_events
```

### 2.2 Multi-view-readiness explícita

Toda regra carrega `scope_view`. No MVP, o gerador trata `scope_view IS NULL` como "emitir fora de qualquer bloco `view:`". Quando multi-view ligar (§6), o mesmo schema produz `view: "<name>" { local-zone ... }`. **Sem migração destrutiva.**

---

## 3. Precedência / Layering (regra crítica — legal)

### 3.1 Ordem canônica (alta → baixa precedência)

```text
  [100] AnaBlock JUDICIAL          (nome via local-zone; IP via blackhole)
                                   NÃO SOBREPONÍVEL por allow_exception nativa.
   ↓
  [200] Bloqueio NATIVO do operador (policy_rules.kind='block_name')
   ↓
  [300] Feeds de reputação          (policy_rules.kind='feed_rule', source='feed')
   ↓
  [400] Allowlist / exceção nativa  (policy_rules.kind='allow_exception')
                                   Só sobrepõe camadas 200 e 300. NUNCA 100.
   ↓
  [999] Resolução recursiva padrão  (iterator + validator DNSSEC)
```

**Regra inegociável (landmine):**
> `allow_exception` **nunca** desbloqueia um alvo coberto pela camada 100. O validador de política rejeita a regra na criação; o gerador, mesmo recebendo uma regra mal-formada, **omite-a** se houver casamento exato/sufixo com o conjunto judicial vigente.

### 3.2 Como o Unbound materializa

Unbound aplica `local-zone`/`local-data` por **especificidade de nome** (longest match), com tipos `static`/`redirect`/`transparent`/`always_*`. A precedência é obtida por:

1. **Ordem de `include:` no `unboundXX.conf`** define quem ganha em caso de empate de especificidade. Ordem proposta para a próxima implementação (NÃO alterar agora):
   ```text
   include: /etc/unbound/policy.d/100-anablock-judicial.conf   # gerado pelo sync AnaBlock
   include: /etc/unbound/policy.d/200-operator-block.conf       # gerado de policy_rules
   include: /etc/unbound/policy.d/300-feeds.conf                # gerado de policy_rules+feed_sources
   include: /etc/unbound/policy.d/400-operator-allow.conf       # gerado de policy_rules (allow_exception)
   ```
2. **`always_transparent`** na camada 400 desfaz `always_nxdomain` da 200/300 para o mesmo nome.
3. Camada 100 emite `always_nxdomain`/`redirect_*` e **não é citada** pela 400 (filtrada no gerador, §3.1).

### 3.3 Prontidão para tags/views

Quando multi-view entrar, cada arquivo acima passa a ser **por view**:
`/etc/unbound/policy.d/<view>/100-…conf` incluído **dentro** do bloco `view: "<view>" {…}`. A ordem 100→400 se preserva por view. O escopo `global` continua válido para regras `scope_view IS NULL`.

---

## 4. Coexistência com AnaBlock (intocado)

AnaBlock é **integração opcional de terceiro**, com fluxo próprio:

- **Nome:** `gen-anablock.sh` → `/etc/unbound/anablock.conf` (sobrescrita integral; `unbound_generator.py:546`).
- **IP:** `anablock-ip-sync.sh` → rotas `blackhole` no kernel (`ip_blocking_generator.py`).

A política nativa **não toca esses arquivos**. Coexistência por separação física:

| Camada | Arquivo gerado | Quem gera | Mantido por |
|---|---|---|---|
| 100 (judicial) | `/etc/unbound/anablock.conf` | `gen-anablock.sh` (existente) | AnaBlock sync timer |
| 100 (judicial) | rotas blackhole no FIB | `anablock-ip-sync.sh` (existente) | AnaBlock IP sync timer |
| 200/300/400 (nativo) | `/etc/unbound/policy.d/2xx|3xx|4xx-*.conf` | novo gerador `policy_generator.py` (futuro) | Reconciler a partir de `policy_rules` |

**Evidência de não-colisão:**
- `anablock.conf` é arquivo único e auto-contido (`config-generator.ts:1801, 1805-1808`).
- O include nativo proposto é em **diretório separado** (`policy.d/`), portanto não há sobre-escrita cruzada.
- O unboundXX.conf atual já usa `include:` por linha (`config-generator.ts:187-188`); adicionar `include: /etc/unbound/policy.d/*.conf` é aditivo.

**AnaBlock permanece opt-in e desligável** sem afetar a política nativa (e vice-versa). O placeholder seguro de `anablock.conf` quando desabilitado (`config-generator.ts:1805-1808`) continua válido.

---

## 5. RPZ — avaliação e veredito

| Critério | `local-zone`/`local-data` (atual) | RPZ (`respip` + zona) |
|---|---|---|
| Suporta NXDOMAIN/NODATA/CNAME/A/AAAA por **nome** | Sim | Sim |
| Suporta política por **IP de resposta** (ex.: bloquear se A retornar X) | **Não** | Sim (`rpz-ip`) |
| Atualização incremental (IXFR) | Não (sobrescreve arquivo + reload) | Sim |
| Requer `module-config: "respip iterator"` | Não | **Sim** (mudança sensível) |
| Requer servidor de zona AXFR/IXFR autoritativo no operador | Não | Sim (ou pull periódico) |
| Cabe no caso de uso atual (judicial + operador + feeds por nome) | Sim | Sobra |

**Veredito (MVP):** **NÃO habilitar RPZ.** O par `local-zone`/`local-data` cobre 100% dos casos de uso desenhados (judicial, operador, allowlist, feeds por nome). RPZ é re-avaliado **apenas se** surgir requisito de "bloqueio por IP de resposta" que não esteja já coberto pelo plano blackhole no kernel — provavelmente não.

**Trade-off registrado:** ganhar IXFR e `rpz-ip` exige tocar `module-config` (sensível, recém estabilizado por FIX-DNSSEC) e operar uma zona autoritativa de política. Custo > benefício hoje.

---

## 6. Feeds de reputação genéricos (desenho, não implementar)

### 6.1 Modelo

- `feed_sources` (§2) descreve qualquer feed (AnaBlock judicial é uma instância com `is_judicial=true`).
- Ingestor único `feed_reconciler` lê `feed_sources`, baixa, valida integridade, materializa em `policy_rules` com `source='feed'` e `priority_layer=300` (ou `100` quando `is_judicial`).

### 6.2 Atualização — dinâmico endurecido (decisão anterior, mantida)

| Etapa | Requisito |
|---|---|
| Download | Timer systemd; jitter; backoff; never block reload em falha de rede |
| Integridade | `sha256_sidecar` (arquivo `.sha256` ao lado) **ou** `signed_manifest` (assinatura destacada). `none` permitido só para feeds internos. |
| Staging | Gravar em `/var/lib/dns-control/feeds/<feed>/staging/`; validar com `unbound-checkconf` sobre arquivo de teste |
| Apply | `mv` atômico para `/etc/unbound/policy.d/<layer>-<feed>.conf` + `unbound-control reload` por instância |
| Rollback | Manter `.bak`; em falha de checkconf, abortar e logar `policy.feed.apply.failed` em `operational_events` |
| Versionamento | `feed_sources.last_version` + sidecar de versão (já é o padrão AnaBlock) |

AnaBlock vigente **não migra hoje**; passa a ser um `feed_sources` somente quando a história de migração for priorizada (§8).

### 6.3 Relação com `named.cache`

A memória firme `mem://arquitetura/named-cache-snapshot-deterministico` veta download em runtime **especificamente** para root hints. **Não se aplica** a feeds de política, que são dinâmicos por natureza.

---

## 7. Prontidão multi-view

Tudo no §2 carrega `scope_view`. O gerador futuro decide:

- `scope_view IS NULL` → emite no escopo global do `unboundXX.conf`.
- `scope_view = X` → emite dentro de `view: "<X>" { … }` do mesmo arquivo, e emite `access-control-view: <cidr> <X>` para cada CIDR de `views.cidrs`.

Sem multi-view, o produto é monoview e nada muda no gerador. Ligar multi-view é **aditivo**: novas linhas `view:` e `access-control-view:`, sem renomear ou migrar regras existentes.

Restrição conhecida do Unbound: **dentro de um `view:`**, `local-zone`/`local-data` sobrepõem o global por casamento de nome; `access-control-view` redireciona o cliente para o view inteiro. A precedência §3 vale **por view**.

---

## 8. Auditoria

Não criar subsistema novo. Reusar `operational_events` (existente, conectado ao GO-4):

| event_type | Quando | Payload mínimo |
|---|---|---|
| `policy.rule.created` | INSERT em `policy_rules` | `{rule_id, kind, target, action, layer, scope_view, actor}` |
| `policy.rule.updated` | UPDATE | diff |
| `policy.rule.deleted` | soft delete (`enabled=false`) ou DELETE | `{rule_id, reason}` |
| `policy.feed.synced` | reconciler aplicou ok | `{feed_id, version, rules_added, rules_removed}` |
| `policy.feed.apply.failed` | checkconf falhou / rollback | `{feed_id, error}` |
| `policy.allow_exception.rejected` | tentativa de exceção sobre camada 100 | `{target, blocked_by}` (registra a tentativa para auditoria legal) |

Atribuição (operador/quando/o quê) sai dos campos `created_by`/`updated_at` + `operational_events.actor`. Já existe; basta o gerador novo emitir os eventos. Fecha GO-4 para o plano de política.

---

## 9. Quebra em histórias proposta

Sequência sugerida (cada item é uma história implementável, com testes e paridade FE↔BE):

1. **POL-1 — Esquema mínimo + UI somente-leitura**
   migrations: `tenants`, `views`, `policy_rules`, `feed_sources`. RLS por papel (admin write, viewer read). UI lista vazia. Sem gerador novo. Sem alterar Unbound.
2. **POL-2 — Bloqueio nativo do operador (camada 200)**
   CRUD de `policy_rules(kind='block_name')` global. Gerador `policy_generator.py` produzindo `200-operator-block.conf`. Include em `unboundXX.conf` (paridade FE↔BE + golden). Reload por instância.
3. **POL-3 — Allowlist / exceção nativa (camada 400)**
   `kind='allow_exception'`. Validador rejeita sobreposição da camada 100 (testes obrigatórios: tentativa registrada em `policy.allow_exception.rejected`). Gera `400-operator-allow.conf`.
4. **POL-4 — `feed_sources` genérico + reconciler dinâmico endurecido**
   Integridade `sha256_sidecar`; staging + checkconf + apply atômico; auditoria `policy.feed.*`. Sem migrar AnaBlock ainda.
5. **POL-5 — Auditoria completa em `operational_events`**
   Garantir os 6 event_types do §7, com painel filtrável (fecha GO-4 para política).
6. **POL-6 — Multi-view (opt-in)**
   Emissão de `view:` + `access-control-view:` quando `scope_view` for usado; UI de tenants/views. Default segue monoview.
7. **POL-7 (opcional) — Mirror de AnaBlock como `feed_sources` (`is_judicial=true`)**
   Apenas se o operador quiser unificar telemetria de feeds. AnaBlock vigente continua funcionando em paralelo até cutover explícito.
8. **POL-8 (condicional) — RPZ/`respip`**
   Só se um requisito real exigir `rpz-ip`. Caso contrário, **não fazer**.

---

## 10. Arquivos inspecionados (evidência)

- `backend/app/generators/unbound_generator.py` (DNSSEC, includes, ausência de RPZ/views)
- `backend/app/generators/organic_generator.py:327-361` (script da blocklist do operador)
- `backend/app/generators/ip_blocking_generator.py:1-264` (AnaBlock IP — intocado)
- `src/lib/config-generator.ts:21, 172, 177-188, 330, 344-431, 471-625, 1792-1912` (FE espelho; AnaBlock; placeholder)
- `src/pages/Wizard.tsx:898-939` (toggles de AnaBlock nome/IP)
- `backend/app/api/routes/telemetry.py:116-160` (telemetria AnaBlock — não tocada)
- `backend/app/models/` (ausência de tabelas de política)
- `docs/audits/2026-06_policy-plane-gap-analysis.md` (DISC-05 — base do desenho)

---

## 11. O que esta entrega NÃO faz

- Não cria migration, não cria tabela, não toca gerador FE/BE.
- Não habilita `respip`/RPZ.
- Não altera `anablock.conf`, `gen-anablock.sh` nem o sync de IP (memória firme: AnaBlock IP por blackhole no kernel).
- Não muda `module-config` (recém estabilizado por FIX-DNSSEC).
- Não introduz dependências novas.

Diff: **puramente aditivo** (este `.md`).
