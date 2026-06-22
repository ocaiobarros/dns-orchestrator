# Auditoria — Fundação para Detecção em Tempo Real de IPs Autoritativos Mudos

**Data:** 2026-06  
**Escopo:** READ-ONLY. Nenhuma alteração de runtime, generator, nftables, Unbound, collector ou UI.  
**Pergunta-chave:** existe fundação reutilizável para detectar, via kernel Linux, IPs autoritativos que não respondem às queries de recursão do Unbound? Qual caminho é viável — `nf_conntrack` (flag `[UNREPLIED]` em UDP :53) ou eBPF correlacionando query→resposta por timeout?

---

## 1. Collector — `backend/collector/collector.py`

**Status:** **OK-REUSÁVEL** como ponto de extensão.

- Arquivo: `backend/collector/collector.py` (1129 linhas).
- Modelo de execução: systemd **oneshot + timer** a cada 10s (`deploy/systemd/dns-control-collector.service`, `deploy/systemd/dns-control-collector.timer`).
- Saída: arquivos JSON em `/var/lib/dns-control/telemetry/` (`latest.json`, `recursive-simple.json` ou `recursive-interception.json`, `history.json`), escritos atomicamente via `tmp + rename` (collector.py:1086-1093).
- Diagnóstico embutido: bloco `diag` por fonte (unbound-control, nft, journalctl) com `exit_code` + `stderr` truncado — modelo já usado para "honest degradation" (ver `TelemetryHealthStrip`).
- **Ponto de extensão para uma nova fonte de eventos** (ex.: "upstream silent IPs"):
  1. Adicionar coleta nova (ex.: `conntrack -L -p udp --dport 53 -o extended` filtrada por `[UNREPLIED]`) como uma função `collect_upstream_silence()` análoga às coletas existentes.
  2. Acumular em `data["upstream_health"] = {...}` no dicionário escrito a `latest.json` (mesmo bloco onde hoje vai `resolver`, `traffic`, `top_domains`).
  3. Acrescentar entrada correspondente em `data["diag"]` com `exit_code/stderr` — invariante observado em todo o arquivo (collector.py:518-560 mostra o padrão).
  4. Não exige novo serviço/timer — basta caber dentro do orçamento dos 10s.

> **Não reescrever.** O collector é o lugar natural do detector quick-win; reusar o ciclo de 10s, o pipeline atomic-write e o bloco `diag`.

---

## 2. dnstap — disponibilidade e papel como ENRIQUECEDOR

**Status:** **GAP parcial / VERIFICAR-EM-PRODUÇÃO**.

- Coletor existe e está pronto: `backend/collector/dnstap_collector.py` (660 linhas), serviço systemd `deploy/systemd/dns-control-dnstap.service`, escuta `unix:/var/run/unbound/dnstap.sock`, parser Frame Streams + protobuf com fallback minimal.
- Validador operacional sabe checar: `deploy/validate-dns-observability.sh:308-316` procura `dnstap-enable` em `/etc/unbound` e o `dnstap-socket-path:`.
- **No repo, o `unbound_generator.py` NÃO emite `dnstap:` block.** Busca por `dnstap` em `backend/app/generators/unbound_generator.py` retorna zero ocorrências (rg -n). Logo, em instalação padrão o socket não existe e o `dns-control-dnstap.service` fica em backoff — é o ramo "skip" do validate.
- Build do Unbound: `install_debian13.sh` instala o pacote Debian `unbound` (não compila a partir do fonte). O `unbound` do Debian 13 **é compilado com `--enable-dnstap`** (default upstream); portanto, basta gerar o bloco de config para habilitar — **não há rebuild necessário**. Verificar em produção com `unbound -V | grep -i dnstap` antes de promover a recomendação.
- Message types relevantes do Unbound: `RESOLVER_QUERY` (saída ao autoritativo) e `RESOLVER_RESPONSE` (resposta recebida). Já são esses os tipos consumidos por `dnstap_collector.py` (vide enums no parser).
- **Viabilidade como enriquecedor (qname → IP mudo):** alta. A detecção kernel (conntrack/eBPF) entrega o IP autoritativo silencioso e, opcionalmente, a 5-tuple; o dnstap entrega `qname/qtype` correlacionável pela 5-tuple+timestamp. Sem dnstap, o operador vê "IP X não responde"; com dnstap, vê "IP X não respondeu para qname Y do domínio Z".

**Conclusão:** dnstap NÃO é pré-requisito do detector — é um enriquecedor opcional. Habilitá-lo é trabalho independente (gerar o bloco no `unbound_generator.py` + reload).

---

## 3. Telemetria/Painel — molde collector → API → UI

**Status:** **OK-REUSÁVEL.** O caminho está padronizado e é o que devemos copiar para um futuro painel "Saúde de Upstreams".

Molde canônico (exemplificado pelo painel AnaBlock e pelo NocPoolOperationalState):

```
backend/collector/collector.py
   └─ escreve /var/lib/dns-control/telemetry/latest.json  (campo novo: upstream_health)
            │
backend/app/api/routes/telemetry.py
   └─ lê latest.json e expõe sub-recurso: GET /api/telemetry/upstreams
      (espelhar padrão de GET /api/telemetry/anablock e /api/telemetry/status)
            │
src/lib/api.ts
   └─ adicionar getUpstreamHealth() em api.telemetry, com mock paralelo
      (ver api.ts:316 getTelemetryStatus, :836 mock /api/telemetry/anablock)
            │
src/lib/hooks.ts
   └─ useUpstreamHealth() (espelhar useTelemetry/useTelemetryStatus)
            │
src/components/noc/NocUpstreamSilence.tsx  (novo, espelha NocAnablockStatus.tsx)
   └─ renderiza degradação honesta quando collector_status != 'ok' (mesmo padrão
      do TelemetryHealthStrip: chip "indisponível" em vez de verde fabricado).
```

Sem fastpath, sem websocket, sem novo storage. Tudo cabe no contrato JSON existente.

---

## 4. Conntrack vs NOTRACK no egress :53 — VEREDITO

**Status:** **OK quanto ao repo + VERIFICAR-EM-PRODUÇÃO quanto à caixa**.

O que o repo CONFIGURA:

- `backend/app/generators/nftables_generator.py` e `nftables_simple_generator.py` declaram **apenas** as tabelas `ip nat` / `ip6 nat` (chains `PREROUTING` e `OUTPUT` com hook `nat`, prioridade `dstnat`) e tabelas filter. Buscas por `table raw`, `notrack`, `NOTRACK` em todo `backend/app/generators/` e `backend/app/scripts/` retornam **zero** ocorrências.
- `backend/app/generators/sysctl_generator.py:112-178` configura **extensivamente** `nf_conntrack_*` (tamanho 8M, buckets 262144, timeouts UDP 30s/180s, fragmentação, etc.). Esses parâmetros só fazem sentido se o tráfego DO HOST passa por conntrack.
- Invariante de rede (memória `arquitetura/modelo-rede-dual-plane`): egress IPv4 + controle pela `lo`. Não há regra `notrack` para `oif "lo"` em nenhum gerador.

**Veredito:** no que o repo gera, o egress :53 do resolver **PASSA por conntrack normalmente** — não há regra NOTRACK em raw/PREROUTING/OUTPUT. Logo, o quick-win via `conntrack -L -p udp --dport 53` (ou `/proc/net/nf_conntrack`) lendo flag `[UNREPLIED]` é tecnicamente viável.

**Verificar em produção** (não determinado pelo repo, depende da caixa do operador):

- Se algum sysadmin local injetou regras em `/etc/nftables.d/local.nft` adicionando `table raw { chain output { ... udp dport 53 notrack } }` por razões de performance, o quick-win falha silenciosamente. Comando de verificação: `nft list table ip raw 2>/dev/null` e `nft list table ip6 raw 2>/dev/null`.
- Confirmar também que `nf_conntrack` está carregado e não esgotado: `cat /proc/sys/net/netfilter/nf_conntrack_count` vs `nf_conntrack_max` (sysctl gera 8M).

### Recomendação de caminho

**CONNTRACK-QUICK-WIN** (recomendado para POC e v1).

Justificativa:
1. **Esforço:** dezenas de linhas Python no collector existente; zero dependência nova; zero kernel module fora do `nf_conntrack` já carregado.
2. **Postura do repo é compatível:** sem NOTRACK; sysctl já dimensiona conntrack para a escala alvo.
3. **Sinal suficiente para o caso de uso "sites não abrindo":** fluxos UDP :53 com `[UNREPLIED]` após timeout = IP autoritativo silencioso. Tupla traz `dst_ip` (o autoritativo) e `dst_port=53`.
4. **eBPF tem benefícios reais — mas só justificam o custo na v2:** correlação fina query↔response (txid, qname extraído do payload), latência por par, observação mesmo com NOTRACK ativo, e contadores per-CPU. Requer toolchain (libbpf/bcc), CO-RE, autoridade root persistente e validação de kernel. Adequado quando a v1 provar o valor e o operador pedir granularidade.

Reavaliar eBPF se: (a) algum cliente confirmar NOTRACK no egress :53; (b) precisarmos de qname sem habilitar dnstap; (c) volume de fluxos derrubar o custo do `conntrack -L` periódico.

---

## 5. Ambiente — caminhos nftables por modo e detalhes que afetam o detector

**Status:** **OK-REUSÁVEL** (já documentado nas memórias).

- **Modo Interceptação:** `/etc/network/nftables.d/` (memória `arquitetura/layout-homologado-paths`).
- **Modo Simples:** `/etc/nftables.d/`.
- Resolver origina o egress :53 pela **interface `lo`** (IPv4) — invariante dual-plane. Logo, um filtro do detector deve considerar `oif lo` e `saddr` ∈ pool de egress (ver `network_generator.py`).
- IPv6: o egress de recursão tipicamente sai pela `lo0` (memória dual-plane). Se o detector ler `/proc/net/nf_conntrack`, filtrar `udp` + `dport=53` cobre v4 e v6; se usar `conntrack -L`, rodar duas vezes (`-f ipv4`, `-f ipv6`) ou parsing único.
- O detector NÃO deve depender da família NAT (o tráfego de recursão Unbound→autoritativo não é NATeado; ele sai já com o IP da `lo`). Logo, basta o conntrack na ORIGEM (host), não nas chains NAT.

---

## 6. Lista priorizada do que falta (sem implementar)

| # | Item | Custo | Observação |
|---|------|-------|------------|
| 1 | Função `collect_upstream_silence()` no `collector.py` lendo `/proc/net/nf_conntrack` (ou `conntrack -L -p udp --dport 53 -o extended`) e agregando IPs com `[UNREPLIED]` há mais de N segundos | baixo | sudoers já permite leitura de conntrack ou caminho via /proc é world-readable; confirmar |
| 2 | Janela deslizante + threshold (ex.: ≥K fluxos UNREPLIED em T segundos) para evitar falso positivo de pacote único perdido | baixo | reaproveitar `deque`/`Counter` (já uso pesado no collector) |
| 3 | Campo `upstream_health` em `latest.json` + bloco `diag.upstream_health` | baixo | invariante existente |
| 4 | Endpoint `GET /api/telemetry/upstreams` em `routes/telemetry.py` (espelhar `/anablock`) | baixo | sem RBAC novo — viewer pode ler |
| 5 | `api.telemetry.getUpstreamHealth()` em `src/lib/api.ts` + mock + hook `useUpstreamHealth()` | baixo | molde estabelecido |
| 6 | Painel `NocUpstreamSilence` com degradação honesta (chip "indisponível" quando `collector_status!='ok'`) | médio | espelhar `NocAnablockStatus` |
| 7 | (opcional) habilitar dnstap no `unbound_generator.py` (bloco `dnstap:` + `dnstap-enable: yes`, `dnstap-socket-path:`, message types `RESOLVER_QUERY/RESOLVER_RESPONSE: yes`) para enriquecer com `qname` | médio | exige `unbound -V` confirmando `--enable-dnstap`; o serviço `dns-control-dnstap` já existe |
| 8 | (v2) detector eBPF correlacionando query↔response por timeout | alto | só justificado se (1) provar limitação ou (2) cliente com NOTRACK |
| 9 | Tabela `dns_upstream_failures` (modelo análogo a `DnsEvent` em `backend/app/models/dns_events.py`) caso queiram histórico longo + correlação SQL | médio | reusar o pipeline `persist + cleanup` de `dns_error_worker.py` |
| 10 | Sudoers: garantir leitura de `/proc/net/nf_conntrack` para usuário `dns-control` (provavelmente já OK; `conntrack -L` exige root → adicionar entrada NOPASSWD se for o caminho) | baixo | seguir padrão restrito de `deploy/sudoers/dns-control-diagnostics` |

---

## 7. Confirmação de invariantes

- **Zero alteração de código de runtime/gerador/resolução.** Esta entrega é só este `.md`.
- **Nenhum dnstap habilitado.** A análise é apenas de viabilidade.
- **Nenhuma regra nftables/raw adicionada.** A leitura do repo confirma ausência de NOTRACK.
- **Precedência judicial (POL-2b/3b)** não é afetada — assunto ortogonal.

---

## 8. Resumo executivo

1. **Conntrack-quick-win é o caminho recomendado** para v1. O repo não impõe NOTRACK no egress :53; o sysctl dimensiona `nf_conntrack` para a escala alvo.
2. **Verificação obrigatória em produção:** `nft list table ip raw` e `nft list table ip6 raw` devem ser vazios (ou não conter `notrack` em udp :53). Documentar como passo de pré-instalação do detector.
3. **Collector é o encaixe natural** — basta uma função + campo JSON + bloco `diag`. Sem novo serviço/timer.
4. **Molde collector→API→UI já existe** (AnaBlock, telemetry status). Copiar.
5. **dnstap fica como ENRIQUECEDOR opcional**, não dependência: traz `qname`/contexto sem trocar o caminho de detecção. Habilitação é trabalho independente no `unbound_generator.py`.
6. **eBPF fica reservado para v2**, condicionado a evidência (NOTRACK em campo, necessidade de qname sem dnstap, ou pressão de volume).
