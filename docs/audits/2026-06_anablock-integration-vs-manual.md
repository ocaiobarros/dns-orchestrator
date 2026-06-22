# Auditoria — Integração AnaBlock vs. Manual Oficial + Postura Desejada

**Data:** 2026-06-22  
**Escopo:** read-only. Nenhum código de runtime/gerador/resolução alterado.  
**Objetivo:** mapear o estado atual da integração AnaBlock contra (a) o manual da AnaBlock
e (b) a postura desejada (agendado + integridade + degradação honesta), com lista
priorizada de gaps.

> **Decisão de escopo (registrada também em
> `.lovable/memory/arquitetura/escopo-anablock-segue-manual.md`):**
> AnaBlock é ferramenta de terceiro e a integração segue o **manual oficial**, sem
> inventar mecanismos fora dele. **Não existe** "mirror" que ingere o conjunto judicial
> como regras layer-100 no DB de política. A precedência judicial é garantida pelo
> **include-order** (`anablock.conf` incluído por último em `unbound.conf`), já
> comprovada empiricamente contra Unbound 1.24.2 — ver
> `docs/audits/2026-06_judicial-precedence-real-unbound.md`. O validador-no-DB do POL-3a
> permanece como primeira-linha; o backstop definitivo é o include-order.
> Feeds genéricos (layer 300) **não são AnaBlock** e ficam fora desta auditoria
> (escopo de um POL-4 separado).

---

## 1. Matriz de auditoria (item-a-item)

Legenda: **OK** = aderente; **GAP** = não implementado/parcial; **DIVERGE** = implementado
fora do manual.

### 1.1 Detecção de mudança (`/api/version` vs. `/api/md5`)
- **Atual:** sync usa `GET {api}/api/version` e compara com `/var/lib/dns-control/anablock-version`.
  Se igual, sai cedo sem baixar.
  - `backend/app/generators/unbound_generator.py:505` (`VERSION_URL`)
  - `backend/app/generators/unbound_generator.py:539-547` (curto-circuito)
- **Manual:** `/api/version` (timestamp) **e/ou** `/api/md5` (hash do conteúdo).
- **Desejado:** ambos — version para decidir baixar; md5 para validar integridade do baixado.
- **Status:** **GAP** (md5 ausente — ver §1.5).

### 1.2 Download (`/domains/all?output=unbound`) e modo
- **Atual:** `GET {api}/domains/all?output=unbound[&cname=…|ipv4=…|ipv6=…]`, modo configurável
  via Wizard (`always_nxdomain` | `redirect_cname` | `redirect_ip` | `redirect_ip_dualstack`).
  - `backend/app/generators/unbound_generator.py:440-461`
- **Manual:** suporta `output=unbound` + parâmetros equivalentes.
- **Status:** **OK**.

### 1.3 Validação (`unbound-checkconf` + rollback)
- **Atual:** monta arquivo de teste concatenando `unbound.conf` + payload baixado e
  roda `unbound-checkconf`. Se falhar, rejeita; **não substitui** `anablock.conf` —
  o arquivo bom anterior permanece.
  - `backend/app/generators/unbound_generator.py:463-478`
- **Backup:** `anablock.conf` é copiado para `.bak` **antes** do `mv` final
  (`unbound_generator.py:559-562`). Não há rollback automático **pós-aplicação**
  caso o `unbound-control reload` falhe (reload tolera erro com `|| true`,
  `unbound_generator.py:485`).
- **Status:** **OK** para validação pré-apply; **GAP parcial** para rollback pós-reload.

### 1.4 Agendamento
- **Atual:** systemd `anablock-update.timer` (OnBootSec=2min, OnUnitActiveSec={N}h,
  RandomizedDelaySec=300, Persistent=true) executando `anablock-update.service` →
  `/etc/unbound/gen-anablock.sh`. Intervalo configurável (padrão 6h).
  - `backend/app/generators/unbound_generator.py:590-629`
- **Status:** **OK** (agendado, idempotente, com persistência se host estiver desligado).

### 1.5 Integridade (md5)
- **Atual:** **nenhuma verificação de md5** do payload baixado. `curl -sf` apenas garante
  HTTP 2xx + transferência sem erro de conexão; não detecta corrupção silenciosa,
  truncamento HTTP-200 ou MITM em caminho sem TLS-pinning.
- **Manual:** expõe `/api/md5`.
- **Desejado:** baixar `/api/md5`, calcular `md5sum` do `CONF_TMP`, comparar; se
  divergir → `write_status FAIL "md5 mismatch"`, abortar (mantém versão anterior).
- **Status:** **GAP — P1**.

### 1.6 Degradação honesta (indisponibilidade da API)
- **Atual:**
  - API indisponível → mantém arquivo `anablock.conf` anterior intacto, escreve
    `status=FAIL`, mensagem "falha ao baixar… mantendo versão anterior", log via
    `logger -t anablock-sync`. (`unbound_generator.py:552-557`)
  - Telemetria `/api/telemetry/anablock` expõe `last_update_timestamp`, `age_seconds`,
    `stale` (true se `age > 12h`), `last_status`, `conf_present`.
    (`backend/app/api/routes/telemetry.py:116-163`)
  - UI: `src/components/noc/NocAnablockStatus.tsx` mostra status, idade, contador,
    warning de `conf_present=false`, banner amarelo se `stale=true`.
- **Postura desejada:** manter ativo o último bom conhecido (✓), marcar stale (✓),
  expor timestamp/md5 do último sync (timestamp ✓ / **md5 ausente**), alertar em
  defasagem prolongada (parcial — só badge UI, **sem evento operacional**).
- **Status:**
  - Fail-safe judicial: **OK** (último bom conhecido permanece em vigor).
  - Stale marker: **OK** (limiar 12h; cabe revisar para 2× `sync_hours`).
  - Surface de md5: **GAP — P1** (depende de §1.5).
  - Evento/alerta operacional em defasagem prolongada: **GAP — P2**
    (nenhum `operational_event` é emitido por `gen-anablock.sh`; observabilidade
    é puramente pull-based via UI).

### 1.7 Bloqueio de IPs (`/ipv4/block`, `/ipv4/unblock`, blackhole)
- **Atual:** `backend/app/generators/ip_blocking_generator.py` baixa
  `${api}/ipv4/block` (lista íntegra), compara com `anablock-ipv4-current.list`,
  e aplica via `ip -batch` com `route add blackhole` (para entradas novas) **e**
  `route del blackhole` (para entradas que saíram da lista). IPv6 análogo se habilitado.
  Versão controlada via `/api/version`. Backup + rollback se `ip -batch` falhar.
  - `backend/app/generators/ip_blocking_generator.py:107-189`
- **Manual:** endpoints `/ipv4/block` e `/ipv4/unblock` (e `/ipv6/...`); padrão é
  blackhole.
- **Análise do desbloqueio:** o desbloqueio de IPs cuja janela expirou é tratado
  **implicitamente** pelo `comm -23` (IPs que saíram da nova lista são `route del`).
  Isso é correto **se** o `/ipv4/block` retorna o conjunto **ativo atual**
  (snapshot). O endpoint `/ipv4/unblock` do manual **não é consumido**.
- **Status:**
  - Blackhole + IPv6 + rollback: **OK**.
  - Desbloqueio por expiração: **OK funcional** (via diff), mas **DIVERGE-DO-MANUAL**
    em estilo (não usa `/ipv4/unblock` explicitamente). É equivalente
    funcionalmente desde que a API exponha snapshot — vale **documentar a
    suposição** e considerar consumir `/ipv4/unblock` para reconciliação
    cross-check (P3).
  - Integridade da lista de IPs (md5): mesmo **GAP — P2** de §1.5, em escala menor
    (impacto: rota errada pode ser instalada ou removida).

### 1.8 Precedência judicial (contexto)
- **Atual:** `anablock.conf` é incluído **após** `policy.d/*.conf` em `unbound.conf`
  (`backend/app/generators/unbound_generator.py:359-363`). Comprovado contra
  Unbound real 1.24.2 (`docs/audits/2026-06_judicial-precedence-real-unbound.md`).
- **Status:** **OK** — fora do escopo desta auditoria, registrado para completude.

---

## 2. Lista priorizada de gaps

### P1 — segurança/integridade
1. **Verificação de md5** do payload baixado (`/api/md5` + `md5sum` local; mismatch =
   abort + status FAIL). Aplica-se a `gen-anablock.sh` (domínios) e
   `anablock-ip-sync.sh` (IPs). Sem isso, corrupção silenciosa pode instalar
   regras erradas ou esvaziar a lista judicial.
2. **Surface do md5 no telemetria/UI** (`anablock_last_md5`) — operador precisa
   ver "última versão íntegra confirmada".

### P2 — observabilidade/operação
3. **Evento operacional em defasagem prolongada** — `gen-anablock.sh` deveria
   emitir `operational_event` (ou um arquivo lido pelo collector) quando
   `age > 2 × sync_hours` ou após N falhas consecutivas. Hoje só há badge UI.
4. **Stale threshold parametrizado** — hoje hard-coded `12 * 3600` em
   `telemetry.py:158`; deveria derivar de `sync_hours` configurado pelo operador.
5. **Rollback pós-reload** — se `unbound-control … reload` falhar após `mv`,
   reverter para `anablock.conf.bak` automaticamente (hoje o `reload` é
   tolerado com `|| true`).

### P3 — paridade com manual
6. **Consumir `/ipv4/unblock` (e v6)** como reconciliação cross-check, mesmo que
   o diff sobre `/ipv4/block` já cubra o caso comum. Reduz risco se um dia o
   endpoint `/block` mudar a semântica de "snapshot" para "delta".
7. **Documentar suposição** "snapshot completo" do endpoint `/block` no script
   gerado, em comentário.

---

## 3. Confirmação de não-mudança de runtime

Esta auditoria criou apenas dois arquivos `.md`
(`docs/audits/2026-06_anablock-integration-vs-manual.md` e
`.lovable/memory/arquitetura/escopo-anablock-segue-manual.md`). Nenhum gerador,
serviço, executor, schema, rota, script de deploy, UI ou teste foi tocado.
Resolução, geração de configuração e pipeline apply/preview permanecem
inalterados. Não há regressão possível.
