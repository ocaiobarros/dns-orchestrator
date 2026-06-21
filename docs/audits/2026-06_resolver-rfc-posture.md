# Resolver RFC Posture — Auditoria do DNS Control sobre Unbound

> **Data:** 2026-06-21
> **Escopo:** SOMENTE LEVANTAMENTO. Nenhum gerador, .conf, Wizard, collector ou paridade FE↔BE foi alterado.
> **Regra de evidência:** toda afirmação de presença/ausência cita arquivo:linha real (lição GO-3). Onde não confirmável → "não confirmável".
> **Recursor:** o DNS Control não implementa DNS — orquestra Unbound. Esta auditoria mede o que o **gerador** emite, o que o **Wizard** expõe e o que a **telemetria** observa, contra o que cada RFC exige de um recursor de carrier.

---

## A. Matriz RFC × Estado

| RFC | Diretiva Unbound relevante | Exposto no Wizard? | Emitido pelo gerador (BE / FE)? | Observável na telemetria? | Evidência arquivo:linha | Lacuna |
|---|---|---|---|---|---|---|
| **RFC 5358** — proteção contra resolver aberto | `access-control:` | **Sim**, via `securityProfile` (`legacy` × `isp-hardened`) e `accessControlIpv4[]` | Sim, BE: `_generate_access_control` emite ACLs em `isp-hardened`; em `legacy` emite `access-control: 0.0.0.0/0 allow` | Não há métrica de "recursão de fora da base de assinantes" | `backend/app/generators/unbound_generator.py:98-156`, `:295`; FE `src/lib/config-generator.ts:237-261`; Wizard `src/pages/Wizard.tsx:1207-1281` | **P1**: default do Wizard é `legacy` (open) — ver seção B |
| **RFC 5452** — randomização source-port/qID (anti-poisoning) | `outgoing-port-permit`, `outgoing-port-avoid`, `use-caps-for-id` | `useCapsForId` exposto (toggle) | BE emite `outgoing-port-avoid: 0-1024` + `outgoing-port-permit: 1025-65535` + `use-caps-for-id: …` | Não confirmável (não há contador específico de retentativa por mismatch) | `backend/app/generators/unbound_generator.py:260-261, 339`; FE `src/lib/config-generator.ts:143-169`; Wizard `:833` | Randomização de port preservada (Unbound default). `use-caps-for-id` desativado por padrão (`types.ts:828`) |
| **RFC 9156** — QNAME minimisation | `qname-minimisation:` | **Não exposto** | **Não emitido** em nenhum gerador | Não há métrica | `rg -n qname backend/app/generators/unbound_generator.py src/lib/config-generator.ts` → **vazio** | **P2**: depende do default do Unbound (que hoje é `yes`); não há controle explícito |
| **RFC 8767** — serve-stale | `serve-expired`, `serve-expired-ttl` | **Sim** (toggle + TTL) | Sim, BE+FE | Não há métrica de "respostas servidas a partir de cache expirado" | BE `unbound_generator.py:176-177, 278-279`; FE `config-generator.ts:130-131`; Wizard `Wizard.tsx:820-823` | **Suportado, telemetria invisível** |
| **RFC 2308 / RFC 9520** — cache negativo / cache de falhas | `cache-min-neg-ttl`, `cache-max-neg-ttl`, `infra-host-ttl`, `infra-lame-ttl` | **Não exposto** (apenas `cache-min-ttl` / `cache-max-ttl` positivos) | Apenas TTL **positivo** emitido (`cache-min-ttl`, `cache-max-ttl`); `infra-host-ttl: 60`, `infra-lame-ttl: 120` emitidos fixos; **`cache-min-neg-ttl` / `cache-max-neg-ttl` ausentes** | Métricas de NXDOMAIN agregadas existem (`num.answer.rcode.NXDOMAIN`) — não diferenciam negativo cacheado × resolvido | BE `unbound_generator.py:281-287`; FE `config-generator.ts` (busca por `neg-ttl` → vazio); telemetria `backend/collector/collector.py:243-244` | **P2**: TTL negativo no default do Unbound, sem governança |
| **RFC 6891 / RFC 8914** — EDNS / EDE | `edns-buffer-size`, `ede: yes` | **Não exposto** | **Não emitido** | **EDE NÃO coletado**. `rg -i "ede\|extended" backend/collector backend/app/services` retorna apenas matches de `timedelta`/`datetime` — **nenhum parser de EDE** | BE generator (nenhum `edns-buffer-size`/`ede`); `backend/collector/collector.py` (sem EDE); `backend/app/services/dns_error_collector_service.py:28-29, 117-122` (regex apenas SERVFAIL/NXDOMAIN) | **CORREÇÃO ao briefing**: o briefing afirmou "EDE já coletado — confirmar campo". Evidência: **EDE não é coletado**. Há agregação genérica de SERVFAIL/NXDOMAIN, sem `INFO-CODE` do EDE |
| **RFC 7766 / RFC 9210** — TCP obrigatório / fallback truncamento | `do-tcp`, `do-udp` | Não exposto (decisão arquitetural: ambos sempre on) | Sim, BE+FE emitem `do-udp: yes` / `do-tcp: yes` | Não há métrica separada por transporte (TCP vs UDP) | BE `unbound_generator.py:291-292`; FE `config-generator.ts:143-144` | Conformidade básica garantida; sem visibilidade operacional por transporte |
| **RFC 4033-4035 / RFC 5155** — validação DNSSEC | `module-config: "validator iterator"`, `auto-trust-anchor-file`, `trust-anchor-file` | Apenas `hardenDnssecStripped` (toggle) | **`module-config: "iterator"` — sem `validator`** nos `unboundXX.conf`. FE escreve drop-in `auto-trust-anchor-file` em `/etc/unbound/unbound.conf.d/root-auto-trust-anchor-file.conf`, mas esse drop-in **só é incluído na unit Debian padrão**, não nos `unboundXX.conf` por instância | Não há métrica AD-bit / validação | BE `unbound_generator.py:342` (`module-config: "iterator"`); FE `config-generator.ts:172` (idem); drop-in FE `config-generator.ts:1893-1900`; `hardenDnssecStripped` BE `:207, :338` / FE `:88, :168` / Wizard `:833` | **P1 funcional**: o multi-instance pipeline da carrier **não valida DNSSEC** (`module-config` sem `validator`). Trust anchor existe em drop-in mas não é consumido pelas instâncias |
| **RFC 7873 / RFC 9018** — DNS cookies | `answer-cookie`, `cookie-secret-file` | **Não exposto** | **Não emitido** | Não há métrica | `rg -ni "cookie" backend/app/generators/unbound_generator.py src/lib/config-generator.ts` → **vazio** (apenas comentários de sysctl `conntrack_sctp_timeout_cookie_*` em outro contexto) | **P3**: não suportado |
| **RFC 9076** — minimização para privacidade do log | `log-queries`, `log-replies` | Implícito (modo simples força `log-queries: yes` para Top Domains/Clients) | BE emite `use-syslog: yes` + `log-queries: yes` quando `query_logging_enabled` | Logs alimentam `collector.py` (Top Domains/Clients) e `dns_error_collector_service.py` | BE `unbound_generator.py:302-315`; collector `backend/collector/collector.py:857-1044` | **Conecta** com auditoria de rastreabilidade `docs/audits/2026-06_traceability-gap-analysis.md` (sem anonimização nem RBAC sobre `qname`/`client_ip`) |

---

## B. Seção OPEN-RESOLVER (RFC 5358) — afirmação explícita com evidência

**Afirmação:** o Unbound gerado pelo DNS Control **possui** diretiva `access-control:` que, quando `securityProfile === 'isp-hardened'`, restringe recursão à base do operador. **Porém, o default do Wizard é `securityProfile: 'legacy'`, que emite literalmente `access-control: 0.0.0.0/0 allow` — open resolver no plano de dados do Unbound.**

**Evidência literal (arquivo:linha):**

1. Default do Wizard / validator é `legacy`:
   - `src/lib/types.ts:854` — `securityProfile: 'legacy',`
   - `src/lib/config-validator.ts:532` — `securityProfile: config.securityProfile || 'legacy',`

2. Quando `legacy`, o gerador BE emite ACL aberta:
   - `backend/app/generators/unbound_generator.py:110-118`:
     ```
     if security_profile == "legacy":
         lines = [
             "    # ═══ OPEN RESOLVER — Sem Proteção (Legacy) ═══",
             "    # Segurança delegada ao firewall/perímetro de rede",
             "    access-control: 0.0.0.0/0 allow",
         ]
     ```
   - FE paralelo: `src/lib/config-generator.ts:244` — `'    access-control: 0.0.0.0/0 allow',`

3. Quando `isp-hardened`, o gerador BE constrói ACLs por CIDR do host + entradas do operador + CGNAT 100.64/10:
   - `backend/app/generators/unbound_generator.py:129-156`
   - FE espelhado em `src/lib/config-generator.ts:252-261`

4. UI do Wizard expõe a escolha:
   - `src/pages/Wizard.tsx:1207-1214` (cards `legacy` × `isp-hardened`)
   - `src/pages/Wizard.tsx:1263-1281` (editor de `accessControlIpv4`)

5. **ATENÇÃO (não-equivalência):** ACLs nftables de gerência **não** equivalem ao `access-control` do Unbound. A varredura `rg -n "access-control\|access_control" backend/app/generators/unbound_generator.py` confirma que o único lugar onde a recursão é controlada **no plano de dados do Unbound** é o bloco citado acima. Se `legacy` for selecionado e o firewall não tiver regras de origem para porta 53, o recursor responde a qualquer cliente.

**Classificação de risco:** **P1**. A capacidade existe e é correta; o **default** é inseguro para um carrier. Mitigação possível (fora do escopo desta tarefa): trocar o default do Wizard para `isp-hardened` e exigir reconfirmação explícita para selecionar `legacy`.

---

## C. Conexões com backlog — telemetria RFC já no backend não exibida

Itens em que o backend já possui dado e a UI ainda não expõe (oportunidades de FE puro, sem mexer em coleta):

1. **RFC 2308 — NXDOMAIN/SERVFAIL agregado por instância**
   - Backend: `backend/app/services/unbound_stats_service.py:68-69`, `backend/collector/collector.py:243-244, 943-947`.
   - UI: cards "honestos" do FIX-02 (`TelemetryHealthStrip`) **não** detalham rcode por instância; `Dashboard.tsx` mostra agregados.

2. **RFC 8767 — serve-stale ativo**
   - Backend: `backend/app/generators/unbound_generator.py:278-279` confirma emissão de `serve-expired: yes` + TTL, e o Wizard `Wizard.tsx:820-823` permite alterar.
   - **Não há contador de "hit a partir de cache expirado"** (Unbound expõe `num.query.serve_expired` quando habilitado — não confirmado no parser atual).

3. **RFC 8914 — EDE**
   - **Não coletado** (vide matriz). Backlog real: adicionar parse de `INFO-CODE` (correção do briefing).

4. **DNSSEC AD-bit / validation rate**
   - Sem dado no backend porque `module-config` não inclui `validator` (ver matriz). Backlog: decisão arquitetural antes de exibir.

---

## D. Resumo priorizado

### D.1. **Suportado, falta expor / governar** (Wizard ou FE)
- **Default seguro do Wizard** (`securityProfile` ← `isp-hardened`). **P1**.
- **Visibilidade da escolha aplicada** no Dashboard (faixa "este nó está em modo legacy/open"). **P1**.
- **Painel por instância** com `servfail`/`nxdomain`/`cache_miss` já coletados (`unbound_stats_service.py:65-69`). **P2**.
- **Toggle de `useCapsForId`** existe (`Wizard.tsx:833`) — UI sem nota explicando o trade-off RFC 5452. **P3**.
- **Toggle/TTL de serve-expired** existe — falta contador de cache stale na telemetria. **P3**.

### D.2. **Não suportado hoje** (requer geração + Wizard + telemetria)
- **DNSSEC validation real** nas instâncias (`module-config: "validator iterator"` + consumo de trust anchor pelo `unboundXX.conf`). **P1 funcional** (atualmente nenhum carrier-grade DNSSEC validation).
- **EDE (RFC 8914)** — `ede: yes` no gerador **e** parse de `INFO-CODE` no `dns_error_collector_service.py`. **P2**.
- **QNAME minimisation explícito (RFC 9156)** — diretiva `qname-minimisation: yes` no gerador para travar contra mudança de default do Unbound. **P2**.
- **Cache negativo governado (RFC 2308/9520)** — `cache-min-neg-ttl` / `cache-max-neg-ttl` no gerador e Wizard. **P3**.
- **DNS cookies (RFC 7873/9018)** — `answer-cookie: yes` + `cookie-secret-file`. **P3**.
- **Edns-buffer-size explícito (RFC 6891)** — hoje no default do Unbound; sem governança. **P3**.
- **Métrica por transporte UDP×TCP (RFC 7766/9210)** — depende de campos extra do `unbound-control stats`. **P3**.

---

## Arquivos inspecionados (read-only)

- Geradores: `backend/app/generators/unbound_generator.py`, `src/lib/config-generator.ts`
- Validador / tipos: `src/lib/config-validator.ts`, `src/lib/types.ts`
- Wizard UI: `src/pages/Wizard.tsx`
- Trust anchor / raiz: `src/lib/root-hints.ts`, drop-in em `config-generator.ts:1893-1900`
- Telemetria: `backend/collector/collector.py`, `backend/app/services/unbound_stats_service.py`, `backend/app/services/dns_error_collector_service.py`, `backend/collector/dnstap_collector.py`

## Restrições atendidas

- Nenhum gerador, .conf, Wizard, collector, paridade FE↔BE ou golden test alterado.
- Diff puramente aditivo (somente este `.md`).
- Nada autoritativo (zonas, AXFR/IXFR, assinatura DNSSEC, CRUD de RRs) foi tocado nem discutido.
- Toda afirmação de presença/ausência cita arquivo:linha real ou está explicitamente marcada como "não confirmável".
