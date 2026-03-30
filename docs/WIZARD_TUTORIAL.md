# DNS Control v2.1 — Tutorial Completo do Wizard de Configuração

## Visão Geral

O Wizard de Configuração do DNS Control é composto por **11 etapas** sequenciais que transformam parâmetros de rede em artefatos de produção (configs Unbound, units systemd, regras nftables, scripts de rede e tunnings sysctl). Este tutorial guia o preenchimento correto de cada campo usando como referência o ambiente de produção real.

**Rota de acesso:** Login → Menu lateral → **Wizard**

---

## Pré-Requisitos de Infraestrutura (OBRIGATÓRIO)

Antes de iniciar o wizard, o operador **DEVE** confirmar que a infraestrutura externa atende aos requisitos abaixo. Sem eles, o deploy resultará em **SERVFAIL global** — o DNS resolverá localmente mas falhará para queries externas.

### Checklist obrigatório:

| # | Requisito | Comando de verificação | Consequência se ausente |
|---|---|---|---|
| 1 | **SNAT funcional na borda** para IPs de egress | Verificar no equipamento de borda (MikroTik/Cisco/Juniper) | Queries recursivas saem com IP privado → respostas descartadas na internet |
| 2 | **Rota de saída válida para Internet** | `ip route get 8.8.8.8` — deve retornar `via <gateway>` | Host não alcança root servers → Unbound falha no priming |
| 3 | **Conectividade externa funcional** | `dig @8.8.8.8 google.com +short` | Sem DNS externo → Unbound não consegue resolver nada |
| 4 | **Portas UDP/TCP 53 liberadas** (entrada E saída) | `ss -lntup \| grep :53` (pós-deploy) + teste externo | Clientes não alcançam o serviço / Unbound não faz recursão |
| 5 | **Retorno assimétrico tratado** (se aplicável) | `traceroute -s <egress_ip> 8.8.8.8` | Respostas DNS chegam por caminho inesperado → descartadas por rp_filter |
| 6 | **Rotas estáticas na borda** para VIPs e listeners | Verificar tabela de rotas do gateway de borda | Tráfego para VIPs não chega ao host DNS Control |

### Validação mínima antes de prosseguir:

```bash
# 1. Rota default existe
ip route get 8.8.8.8
# Esperado: 8.8.8.8 via 172.29.22.5 dev ens192 src 172.29.22.6

# 2. Conectividade externa funciona
ping -c 3 8.8.8.8
# Esperado: 0% packet loss

# 3. DNS externo funciona (prova que porta 53 de saída está aberta)
dig @8.8.8.8 google.com +short +time=3
# Esperado: IP válido (ex: 142.250.79.46)
```

> ⛔ **Se qualquer validação acima falhar, NÃO prossiga com o wizard.** Corrija a infraestrutura de rede primeiro.

---

## Cenário de Referência

| Camada | IP | Descrição |
|---|---|---|
| Host privado | `172.29.22.6/30` | Interface física `ens192` |
| Gateway | `172.29.22.5` | Gateway do host |
| VIP de Serviço 1 | `45.160.10.1` | IP DNS que clientes configuram |
| VIP de Serviço 2 | `45.160.10.2` | IP DNS secundário |
| VIP Interceptado 1 | `4.2.2.5` | DNS Level3 sequestrado |
| VIP Interceptado 2 | `4.2.2.6` | DNS Level3 sequestrado |
| Listener 01 | `100.127.255.1` | unbound01 bind (loopback) |
| Listener 02 | `100.127.255.2` | unbound02 bind (loopback) |
| Listener 03 | `100.127.255.3` | unbound03 bind (loopback) |
| Listener 04 | `100.127.255.4` | unbound04 bind (loopback) |
| Egress 01 | `191.243.128.205` | IP público de saída (borda) |
| Egress 02 | `191.243.128.206` | IP público de saída (borda) |
| Egress 03 | `191.243.128.207` | IP público de saída (borda) |
| Egress 04 | `191.243.128.208` | IP público de saída (borda) |
| Control 01 | `127.0.0.11:8953` | unbound-control |
| Control 02 | `127.0.0.12:8953` | unbound-control |
| Control 03 | `127.0.0.13:8953` | unbound-control |
| Control 04 | `127.0.0.14:8953` | unbound-control |

---

## ETAPA 1 — Topologia do Host

**Tela no wizard:** `Topologia do Host`

### Campos e valores:

| Campo na UI | Valor exemplo | Obrigatório | Formato/Validação | Arquivo gerado | Diretiva |
|---|---|---|---|---|---|
| **Hostname** | `dns-rec-01.example.com` | ✅ | FQDN (regex hostname) | metadados | — |
| **Organização** | `MinhaOperadora` | ✅ | Texto livre | metadados | — |
| **Interface principal** | `ens192` | ✅ | `^[a-zA-Z][a-zA-Z0-9\-_\.]*$` | `/etc/network/interfaces` | `iface ens192 inet static` |
| **Endereço IPv4 (CIDR)** | `172.29.22.6/30` | ✅ | `x.x.x.x/y` (0-32) | `/etc/network/interfaces` | `address 172.29.22.6/30` |
| **Gateway IPv4** | `172.29.22.5` | ✅ | IPv4 válido | `/etc/network/interfaces` | `gateway 172.29.22.5` |
| **VLAN Tag** | _(vazio)_ | ❌ | Numérico | Sufixo interface | — |
| **Habilitar IPv6** | `Desligado` | ❌ | Toggle | Habilita campos IPv6 | — |
| **Host atrás de firewall** | `Ligado` | ❌ | Toggle | Flag informativo | — |
| **Projeto** | `DNS Recursivo Produção` | ❌ | Texto livre | metadados | — |
| **Timezone** | `America/Sao_Paulo` | ❌ | — | metadados | — |

### Arquivo gerado — `/etc/network/interfaces`:

```ini
source /etc/network/interfaces.d/*

auto lo
iface lo inet loopback

allow-hotplug ens192
iface ens192 inet static
    address 172.29.22.6/30
    gateway 172.29.22.5
    dns-nameservers 8.8.8.8

post-up /etc/network/post-up.sh
```

> ⚠️ **CRÍTICO:** Sem o campo `gateway`, o host perde a rota default após reboot e fica inacessível remotamente.

---

## ETAPA 2 — Publicação DNS

**Tela no wizard:** `Publicação DNS`

### Modos disponíveis:

| Modo | Descrição | Usar quando |
|---|---|---|
| DNS Recursivo Interno | Sem VIP público | LAN only |
| DNS Público Controlado | IPs públicos diretos | Sem NAT |
| **VIP Roteado via Borda / Firewall** | VIPs no firewall, tráfego via rota/NAT | **ISP — recomendado** |
| VIP Local em Dummy Interface | VIPs em dummy local | Host autônomo |
| Anycast com FRR / OSPF | VIPs via OSPF | Multi-site |

**Valor recomendado:** `VIP Roteado via Borda / Firewall`

**Impacto:** Determina que VIPs de serviço são alcançados via DNAT no nftables. O `post-up.sh` NÃO materializa VIPs localmente (ficam no equipamento de borda).

---

## ETAPA 3 — VIPs de Serviço

**Tela no wizard:** `VIPs de Serviço`

Clique **"Adicionar VIP"** duas vezes.

### VIP 1:

| Campo | Valor | Validação |
|---|---|---|
| **IPv4** | `45.160.10.1` | IPv4 válido, único entre VIPs, ≠ listeners, ≠ IP do host |
| **Porta** | `53` | 1-65535 |
| **Protocolo** | `UDP + TCP` | — |
| **Descrição** | `DNS Público Primário` | Texto livre |
| **Modo de Entrega** | `Entregue via Firewall` | — |
| **Health check ativo** | `Ligado` | — |
| **Domínio de probe** | `google.com` | FQDN |
| **Intervalo (s)** | `30` | Numérico |

### VIP 2:

| Campo | Valor |
|---|---|
| **IPv4** | `45.160.10.2` |
| **Descrição** | `DNS Público Secundário` |
| _(demais idênticos ao VIP 1)_ | |

### nftables gerado:

```nft
# /etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft
define DNS_ANYCAST_IPV4 = {
    45.160.10.1,
    45.160.10.2,
    4.2.2.5,
    4.2.2.6
}

# PREROUTING captura
add rule ip nat PREROUTING ip daddr $DNS_ANYCAST_IPV4 udp dport 53 counter packets 0 bytes 0 jump ipv4_udp_dns
add rule ip nat PREROUTING ip daddr $DNS_ANYCAST_IPV4 tcp dport 53 counter packets 0 bytes 0 jump ipv4_tcp_dns
```

### Regras de validação:
- ❌ VIP IPv4 duplicado entre VIPs
- ❌ VIP = listener de instância
- ❌ VIP = IP privado do host (`172.29.22.6`)

---

## ETAPA 4 — Instâncias Resolver

**Tela no wizard:** `Instâncias Resolver`

### Configurações globais (topo da tela):

| Campo | Valor | Diretiva Unbound |
|---|---|---|
| **Threads por instância** | `4` | `num-threads: 4` |
| **Msg Cache** | `512m` | `msg-cache-size: 512m` |
| **RRset Cache** | `32m` | `rrset-cache-size: 32m` |
| **Max TTL** | `7200` | `cache-max-ttl: 7200` |
| **Root Hints** | `/etc/unbound/named.cache` | `root-hints: /etc/unbound/named.cache` |
| **DNS Identity** | `67-DNS` | `identity: "67-DNS"` |
| **Logs detalhados** | Desligado | `log-queries: no` |
| **Blocklist** | Desligado | Omite includes blocklist |

### Instâncias (clique "Adicionar instância" até ter 4):

| # | Nome * | Listener Privado * | Listener Público | Control Interface * | Control Port |
|---|---|---|---|---|---|
| 1 | `unbound01` | `100.127.255.1` | _(vazio)_ | `127.0.0.11` | `8953` |
| 2 | `unbound02` | `100.127.255.2` | _(vazio)_ | `127.0.0.12` | `8953` |
| 3 | `unbound03` | `100.127.255.3` | _(vazio)_ | `127.0.0.13` | `8953` |
| 4 | `unbound04` | `100.127.255.4` | _(vazio)_ | `127.0.0.14` | `8953` |

> **Listener Público** fica vazio em modo border-routed — as instâncias não fazem bind em IPs públicos.

### Arquivo gerado — `/etc/unbound/unbound01.conf` (exemplo):

```yaml
# DNS Control — Unbound instance: unbound01
server:
    pidfile: "/var/run/unbound01.pid"
    interface: 100.127.255.1
    port: 53
    num-threads: 4
    msg-cache-size: 512m
    rrset-cache-size: 32m
    cache-max-ttl: 7200
    root-hints: /etc/unbound/named.cache
    identity: "67-DNS"

    # outgoing-interface: 191.243.128.205  # SUPPRESSED — border-routed mode
    # Egress identity enforced at border device

    access-control: 127.0.0.0/8 allow

remote-control:
    control-enable: yes
    control-interface: 127.0.0.11
    control-port: 8953
```

> ⚠️ Cada instância tem `pidfile: "/var/run/{name}.pid"` único. Sem isso, conflito de PID impede inicialização simultânea.

> ⛔ **ATENÇÃO — `outgoing-interface` SUPRIMIDO (border-routed):**
> No modo border-routed, o Unbound **NÃO** define `outgoing-interface`. A identidade pública de saída (egress) é imposta exclusivamente pelo equipamento de borda via SNAT ou policy routing. O Unbound utiliza o IP padrão do host (`172.29.22.6`) para enviar queries recursivas aos root servers.
>
> **Se o SNAT na borda NÃO estiver configurado**, as queries recursivas sairão com IP privado (`172.29.22.6`), que será descartado na internet → **falha total de resolução** (SERVFAIL em todas as queries).
>
> **Se `outgoing-interface` for declarado com um IP que não existe localmente no host**, o Unbound falha no priming do root com erro crítico: `could not send: Can't assign requested address` → **REFUSED/SERVFAIL para todas as queries**.

### Arquivo gerado — `/etc/network/post-up.sh` (materialização):

```bash
#!/bin/bash
# DNS Control — Network Post-Up (IP materialization)

# ── Listener IPs (bind) ──
ip addr add 100.127.255.1/32 dev lo 2>/dev/null || true
ip addr add 100.127.255.2/32 dev lo 2>/dev/null || true
ip addr add 100.127.255.3/32 dev lo 2>/dev/null || true
ip addr add 100.127.255.4/32 dev lo 2>/dev/null || true

# ── Egress IPs (border-routed — comentados) ──
# ip addr add 191.243.128.205/32 dev lo 2>/dev/null || true
# ip addr add 191.243.128.206/32 dev lo 2>/dev/null || true
# ip addr add 191.243.128.207/32 dev lo 2>/dev/null || true
# ip addr add 191.243.128.208/32 dev lo 2>/dev/null || true
```

### Relação bind ↔ post-up.sh:

O IP `100.127.255.1` (listener de `unbound01`) DEVE existir na interface `lo` ANTES de `systemctl restart unbound01`. O `post-up.sh` garante isso via `ip addr add X/32 dev lo 2>/dev/null || true`.

Se o IP não existir no kernel → `unbound-checkconf` **passa** (validação sintática), mas `systemctl restart unbound01` **falha** com:
```
bind: Cannot assign requested address
```

### Regras de validação:
- ❌ Nome de instância duplicado
- ❌ Listener IP duplicado entre instâncias
- ❌ Control Interface:Port duplicado
- ❌ Listener IP = IP privado do host
- ❌ Listener IP = VIP de serviço

---

## ETAPA 5 — VIP Interception / DNS Seizure

**Tela no wizard:** `VIP Interception`

> Esta é a **feature principal** do DNS Control. Permite "sequestrar" DNS públicos conhecidos para resolução local.

Clique **"Adicionar VIP Interceptado"** duas vezes.

### VIP Interceptado 1:

| Campo | Valor | Descrição |
|---|---|---|
| **VIP IP** | `4.2.2.5` | DNS público a ser sequestrado |
| **Tipo** | `Intercepted (sequestrado)` | Não é IP próprio |
| **Modo de Captura** | `DNAT (nftables)` | Via PREROUTING |
| **Backend Instance** | `unbound01` | Seletor — escolher instância |
| **Backend Target IP** | `100.127.255.1` | Auto-preenchido ao selecionar backend |
| **Protocolo** | `UDP + TCP` | — |
| **Latência esperada** | `1` | < 1ms = local |
| **Validação** | `Strict` | Todas as camadas verificadas |
| **Descrição** | `DNS Level3 sequestrado` | — |

### VIP Interceptado 2:

| Campo | Valor |
|---|---|
| **VIP IP** | `4.2.2.6` |
| **Backend Instance** | `unbound02` |
| **Backend Target IP** | `100.127.255.2` |

### Impacto no nftables:

IPs interceptados são **mesclados** com VIPs de serviço em `DNS_ANYCAST_IPV4`:
```nft
define DNS_ANYCAST_IPV4 = {
    45.160.10.1,
    45.160.10.2,
    4.2.2.5,      ← interceptado
    4.2.2.6       ← interceptado
}
```

Resultado: todo tráfego DNS (porta 53) para **qualquer** desses 4 IPs é capturado via PREROUTING e distribuído entre as 4 instâncias via sticky + nth.

### Validações:
- ❌ VIP interceptado duplicado
- ❌ VIP IP vazio
- ❌ Backend instance vazio
- ❌ Backend target IP inválido

---

## ETAPA 6 — Egress Público

**Tela no wizard:** `Egress Público`

### Modo de Entrega do Egress:

| Opção | Selecionar | Descrição |
|---|---|---|
| Host-Owned (IP Local) | ❌ | IP configurado localmente, Unbound emite `outgoing-interface` |
| **Border-Routed (Lógico)** | ✅ | IP NÃO configurado no host, sem `outgoing-interface` |

> **Border-Routed:** O Unbound usa o IP padrão do host para queries recursivas. A identidade pública é imposta pelo equipamento de borda (SNAT/policy routing).
>
> ⛔ **Dependência externa obrigatória:** O equipamento de borda (roteador/firewall) **DEVE** ter regras de SNAT que traduzam o IP privado do host (`172.29.22.6`) para o IP de egress público correspondente (`191.243.128.20X`). Adicionalmente, **rotas estáticas** devem existir na borda apontando cada IP de egress de volta para o host DNS Control, garantindo que o tráfego de resposta da internet retorne corretamente. **Se essa configuração não existir na borda → falha total de resolução DNS.**

### Modo de Alocação:

| Opção | Selecionar |
|---|---|
| **Fixo por Instância** | ✅ |
| Pool Compartilhado | ❌ |
| Randomizado | ❌ |

### Egress por instância:

| Instância | Egress IPv4 |
|---|---|
| `unbound01` | `191.243.128.205` |
| `unbound02` | `191.243.128.206` |
| `unbound03` | `191.243.128.207` |
| `unbound04` | `191.243.128.208` |

### Validações:
- ❌ Egress IPv4 vazio
- ❌ Egress = Listener (devem ser distintos)
- ❌ Egress = VIP de serviço
- ❌ Egress duplicado com identidade fixa
- ⚠️ Warning informativo: "border-routed: IP não estará no host"

---

## ETAPA 7 — Mapeamento VIP → Instância

**Tela no wizard:** `Mapeamento VIP→Instância`

### Política de distribuição:

| Opção | Selecionar | Descrição |
|---|---|---|
| Mapeamento Fixo | ❌ | 1 VIP → 1 instância |
| Round Robin | ❌ | numgen sequencial |
| **Sticky por Origem (Recomendado)** | ✅ | Memoriza origem + nth fallback |
| Nth Balancing | ❌ | Apenas nth |
| Ativo/Passivo | ❌ | 1 primário + standby |

### Sticky Timeout:

| Campo | Valor |
|---|---|
| **Sticky Timeout (minutos)** | `20` |

> Armazenado como 1200 segundos. Cada query renova o timer. Após 20 min sem tráfego, afinidade expira.

### nftables gerado:

```nft
# Sets dinâmicos (afinidade por origem)
add set ip nat ipv4_users_unbound01 { type ipv4_addr; counter; size 8192; flags dynamic, timeout; timeout 20m; }
add set ip nat ipv4_users_unbound02 { ... timeout 20m; }
add set ip nat ipv4_users_unbound03 { ... timeout 20m; }
add set ip nat ipv4_users_unbound04 { ... timeout 20m; }

# Regras memorized-source (clientes conhecidos)
add rule ip nat ipv4_udp_dns ip saddr @ipv4_users_unbound01 counter jump ipv4_dns_udp_unbound01
add rule ip nat ipv4_udp_dns ip saddr @ipv4_users_unbound02 counter jump ipv4_dns_udp_unbound02
add rule ip nat ipv4_udp_dns ip saddr @ipv4_users_unbound03 counter jump ipv4_dns_udp_unbound03
add rule ip nat ipv4_udp_dns ip saddr @ipv4_users_unbound04 counter jump ipv4_dns_udp_unbound04

# Fallback nth (novos clientes — distribuição uniforme via vmap)
add rule ip nat ipv4_udp_dns numgen inc mod 4 vmap {
    0 : jump ipv4_dns_udp_unbound01,
    1 : jump ipv4_dns_udp_unbound02,
    2 : jump ipv4_dns_udp_unbound03,
    3 : jump ipv4_dns_udp_unbound04
}
```

> ⚠️ **IMPORTANTE — Distribuição uniforme com `vmap`:**
> A implementação anterior usava `numgen inc mod N` decrescente (mod 4, mod 3, mod 2, mod 1), que resultava em distribuição **desigual** entre backends (unbound04 recebia 100% do tráfego residual). A implementação correta usa `numgen inc mod 4 vmap { ... }`, que garante distribuição **uniforme 25%** para cada instância. O mesmo padrão é aplicado para TCP (`ipv4_tcp_dns`).

### Fluxo de decisão:
1. Query de `10.0.0.1` chega no VIP (`45.160.10.1`)
2. PREROUTING → `jump ipv4_udp_dns`
3. Dispatch chain verifica: `10.0.0.1` está em algum `ipv4_users_*`?
   - **Sim** → jump para backend memorizado
   - **Não** → `numgen inc mod 4 vmap` seleciona backend uniformemente
4. Backend chain (ex: `ipv4_dns_udp_unbound02`):
   - `add @ipv4_users_unbound02 { ip saddr }` — memoriza
   - `set update ip saddr timeout 0s @ipv4_users_unbound02` — renova timer
   - `dnat to 100.127.255.2:53` — redireciona

---

## ETAPA 8 — Roteamento

**Tela no wizard:** `Roteamento`

| Modo | Selecionar |
|---|---|
| **Sem Roteamento Dinâmico** | ✅ |
| FRR / OSPF | ❌ (usar se multi-site) |

VIPs alcançáveis via rotas estáticas configuradas nos roteadores de borda.

---

## ETAPA 9 — Segurança

**Tela no wizard:** `Segurança`

### ACLs IPv4 obrigatórias:

| # | Rede | Ação | Label |
|---|---|---|---|
| 1 | `127.0.0.0/8` | `allow` | Loopback |
| 2 | `100.127.0.0/16` | `allow` | Listeners internos |
| 3 | `172.16.0.0/12` | `allow` | Rede privada |
| 4 | `10.0.0.0/8` | `allow` | Clientes internos |
| 5 | `0.0.0.0/0` | `allow` | Todos _(se open resolver)_ |

> Se usar `0.0.0.0/0 allow`, deve marcar **"Confirmo que quero operar como open resolver"**.

### Painel de Controle:

| Campo | Valor |
|---|---|
| **Usuário Admin** | `admin` |
| **Senha Inicial** | _(vazio — definida no primeiro acesso)_ |
| **Bind do Painel** | `127.0.0.1 (local only)` |
| **Porta** | `8443` |

### Proteção (toggles):

| Toggle | Valor |
|---|---|
| Rate limiting via nftables | ✅ |
| Anti-amplificação DNS | ✅ |
| Recursão permitida | ✅ |

---

## ETAPA 10 — Observabilidade

**Tela no wizard:** `Observabilidade`

Todos os toggles **ligados** (padrão recomendado):

| Métrica | Ativo |
|---|---|
| Métricas por VIP | ✅ |
| Métricas por instância | ✅ |
| Métricas por egress | ✅ |
| Counters nftables | ✅ |
| Status systemd | ✅ |
| Health checks ativos | ✅ |
| Latência de resolução | ✅ |
| Cache hit ratio | ✅ |
| Recursion time | ✅ |
| Eventos operacionais | ✅ |

---

## ETAPA 11 — Revisão & Deploy

**Tela no wizard:** `Revisão & Deploy`

### Ações disponíveis:

| Botão | Função |
|---|---|
| **Testar conectividade** | `GET /api/deploy/state` — verifica API acessível |
| **Preview arquivos** | Mostra todos os arquivos que serão gerados |
| **Copiar payload** | Copia JSON do wizard para clipboard |
| **Dry-Run** | Valida sem aplicar (staging + validações) |
| **Deploy** | Aplica configuração completa |

### Validações executadas automaticamente (Staging):

| # | Validação | Comando | Bloqueia deploy |
|---|---|---|---|
| 1 | Sintaxe Unbound | `unbound-checkconf <staged_file>` | ✅ se falhar |
| 2 | Sintaxe nftables | `nft -c -f <nftables.validate.conf>` | ✅ se falhar |
| 3 | Estrutura network | Verificação estática (iface/address/gateway) | ✅ se falhar |
| 4 | **Sintaxe bash** | `bash -n <post-up.sh>` | ✅ se falhar |
| 5 | Colisão de IPs | Cruzamento entre todas as camadas | ✅ se colisão |

### Validação manual obrigatória (ANTES do deploy):

Mesmo com staging automático, o operador **DEVE** executar validação manual após o preview e antes de confirmar o deploy:

```bash
# Validar cada instância Unbound individualmente
unbound-checkconf /etc/unbound/unbound01.conf
unbound-checkconf /etc/unbound/unbound02.conf
unbound-checkconf /etc/unbound/unbound03.conf
unbound-checkconf /etc/unbound/unbound04.conf

# Validar ruleset nftables completo
nft -c -f /etc/nftables.conf

# Validar sintaxe do script de materialização
bash -n /etc/network/post-up.sh
```

> ⚠️ O staging automático valida os arquivos em `/var/lib/dns-control/staging/`. A validação manual acima verifica os arquivos **já instalados em produção** após o deploy. Ambas são necessárias.

### Pipeline de execução:

```
 1. Validar modelo ─────────────────── bloqueia se inválido
 2. Gerar arquivos ─────────────────── unbound, nftables, network, systemd
 3. Gravar em staging ──────────────── /var/lib/dns-control/staging/
 4. Validar staging ────────────────── unbound-checkconf + nft -c + bash -n
 5. Backup configuração atual ──────── /var/lib/dns-control/backups/
 6. Aplicar arquivos ───────────────── staging → produção (sudo install)
 7. systemctl daemon-reload
 8. sysctl (se aplicável)
 9. post-up.sh ←────────────────────── materializa IPs PRIMEIRO
10. nft -f /etc/nftables.conf ←─────── carrega DNAT depois dos IPs
11. systemctl restart unbound01..04 ── bind nos IPs já existentes
12. systemctl restart frr (se OSPF)
13. Verificação pós-deploy ─────────── dig, ss, systemctl, nft counters
```

> ⚠️ **Ordem 9→10→11 é INVIOLÁVEL.** Se Unbound iniciar antes do `post-up.sh` → falha de bind. Se nftables carregar antes dos IPs → regras DNAT pendentes.

---

## VALIDAÇÃO PÓS-DEPLOY — Checklist Obrigatório

### 1. Rota de saída funcional (CRÍTICO)

```bash
ip route get 8.8.8.8
```

Esperado:
```
8.8.8.8 via 172.29.22.5 dev ens192 src 172.29.22.6
```

> ⛔ Se não retornar rota válida → Unbound não consegue fazer recursão → SERVFAIL para todas as queries externas. Corrija a rota default antes de prosseguir.

### 2. IPs materializados no loopback

```bash
ip addr show dev lo | grep "100.127.255"
```

Esperado:
```
    inet 100.127.255.1/32 scope global lo
    inet 100.127.255.2/32 scope global lo
    inet 100.127.255.3/32 scope global lo
    inet 100.127.255.4/32 scope global lo
```

### 3. Instâncias Unbound ativas

```bash
systemctl status unbound01 unbound02 unbound03 unbound04
```

Esperado: todas `active (running)`

### 4. Portas DNS abertas (8 sockets)

```bash
ss -lntup | grep :53
```

Esperado (4 instâncias × 2 protocolos = **8 linhas**):
```
udp  UNCONN  0  0  100.127.255.1:53   *:*  users:(("unbound",pid=...))
tcp  LISTEN  0  0  100.127.255.1:53   *:*  users:(("unbound",pid=...))
udp  UNCONN  0  0  100.127.255.2:53   *:*  ...
tcp  LISTEN  0  0  100.127.255.2:53   *:*  ...
udp  UNCONN  0  0  100.127.255.3:53   *:*  ...
tcp  LISTEN  0  0  100.127.255.3:53   *:*  ...
udp  UNCONN  0  0  100.127.255.4:53   *:*  ...
tcp  LISTEN  0  0  100.127.255.4:53   *:*  ...
```

> Cada listener IP (`100.127.255.X`) deve aparecer exatamente **2 vezes** (UDP + TCP). Se aparecer menos → instância não subiu ou bind falhou.

### 5. nftables ruleset carregado

```bash
nft list ruleset | head -50
```

Verificar:
- ✅ `define DNS_ANYCAST_IPV4` com 4 IPs (2 VIPs + 2 interceptados)
- ✅ Chains `ipv4_udp_dns` e `ipv4_tcp_dns`
- ✅ Sets `ipv4_users_unbound01..04`
- ✅ Backend chains com DNAT para `100.127.255.X:53`
- ✅ Regras memorized-source e nth balancing via `vmap`

### 6. DNS direto por instância

```bash
dig @100.127.255.1 google.com A +short
dig @100.127.255.2 google.com A +short
dig @100.127.255.3 google.com A +short
dig @100.127.255.4 google.com A +short
```

Esperado: cada instância retorna IP válido (ex: `142.250.79.46`)

### 7. DNS via VIP de serviço

```bash
dig @45.160.10.1 google.com A +short
dig @45.160.10.2 google.com A +short
```

Esperado: resposta DNS — tráfego capturado por PREROUTING e redirecionado via sticky/nth

### 8. DNS via VIP interceptado

```bash
dig @4.2.2.5 google.com A +short
dig @4.2.2.6 google.com A +short
```

Esperado: resposta local (latência < 1ms) — prova que o sequestro DNS funciona

### 9. Distribuição uniforme entre backends

```bash
for i in $(seq 1 100); do dig @45.160.10.1 example$i.com A +short > /dev/null 2>&1; done
nft list chain ip nat ipv4_udp_dns
```

Verificar: counters distribuídos **uniformemente** (~25% cada) entre as 4 backend chains. Se uma chain tiver significativamente mais tráfego → problema na distribuição nth.

### 10. Teste de idempotência do ruleset

```bash
nft -f /etc/nftables.conf
nft -f /etc/nftables.conf
nft list ruleset | wc -l
```

Executar `nft -f` duas vezes consecutivas. O número de linhas do ruleset **DEVE ser idêntico** nas duas execuções. Se o número cresce → regras estão sendo duplicadas em vez de substituídas (batch não é atômico).

> Este teste garante que re-deploys e reconciliações não acumulam regras espúrias.

### 11. Teste de resiliência (auto-healing)

```bash
# Parar uma instância
systemctl stop unbound03

# Aguardar 35s (3 ciclos de health check × 10s + margem)
sleep 35

# DNS continua respondendo via VIP
dig @45.160.10.1 google.com A +short

# Dispatch chains reconstruídas sem unbound03
nft list chain ip nat ipv4_udp_dns | grep -c "jump"
# Esperado: 6 (3 memorized + 3 nth — sem unbound03)

# Verificar limpeza dos sticky sets (unbound03 não deve receber tráfego)
nft list set ip nat ipv4_users_unbound03
# Esperado: set existe mas não recebe novos membros (sem regra de dispatch apontando para ele)

# Verificar que sets das instâncias ativas continuam funcionando
nft list set ip nat ipv4_users_unbound01
nft list set ip nat ipv4_users_unbound02
nft list set ip nat ipv4_users_unbound04
# Esperado: sets com membros ativos (IPs de clientes recentes)

# Restaurar instância
systemctl start unbound03

# Aguardar cooldown (120s) + health checks
sleep 150

# Verificar reintegração
nft list chain ip nat ipv4_udp_dns | grep -c "jump"
# Esperado: 8 (4 memorized + 4 nth — unbound03 de volta)

# Confirmar que unbound03 volta a receber tráfego
for i in $(seq 1 40); do dig @45.160.10.1 test$i.com A +short > /dev/null 2>&1; done
nft list set ip nat ipv4_users_unbound03
# Esperado: set com novos membros — prova de reintegração
```

---

## REGRAS CRÍTICAS — O QUE NUNCA PODE ACONTECER

| Violação | Consequência |
|---|---|
| Listener IP duplicado entre instâncias | Apenas uma instância sobe; demais falham com `bind error` |
| Listener IP não presente no loopback | `systemctl restart` falha: `Cannot assign requested address` |
| `outgoing-interface` em border-routed | Unbound falha no priming: `SERVFAIL` para todas as queries |
| Gateway ausente em `/etc/network/interfaces` | Host perde rota default no próximo reboot |
| VIP não incluído em `DNS_ANYCAST_IPV4` | Tráfego para esse VIP não é capturado pelo nftables |
| Control interface:port duplicado | `unbound-control` retorna dados da instância errada |
| Egress IP = Listener IP | Conflito de identidade — resolução pode falhar |
| `nft -f` com erro de sintaxe | Ruleset inteiro falha — DNS para de funcionar |
| PID file compartilhado | Instâncias sobrescrevem PID — `systemctl stop` mata instância errada |
| `bash -n post-up.sh` com erro | Script de materialização falha — IPs não aparecem |
| **SNAT ausente na borda (border-routed)** | Queries recursivas saem com IP privado → respostas descartadas → SERVFAIL global |
| **Rota default ausente** | Unbound não alcança root servers → falha no priming → nenhuma query resolve |
| **Rotas estáticas ausentes na borda** | Tráfego de retorno da internet não chega ao host → timeout → SERVFAIL |
| **`numgen inc mod` decrescente (sem vmap)** | Distribuição desigual — última instância recebe 100% do tráfego residual |

---

## CRITÉRIO FINAL DE SUCESSO

O wizard está corretamente preenchido **se e somente se**:

- [ ] `ip route get 8.8.8.8` → rota default válida via gateway
- [ ] `ip addr show dev lo` → 4 IPs listener presentes
- [ ] `ss -lntup | grep :53` → 8 linhas (4 × UDP + TCP)
- [ ] `systemctl status unbound01..04` → todos `active (running)`
- [ ] `nft list ruleset` → `DNS_ANYCAST_IPV4` com 4 IPs
- [ ] `nft list chain ip nat ipv4_udp_dns` → distribuição via `vmap` (não `mod` decrescente)
- [ ] `dig @<VIP> google.com` → responde
- [ ] `dig @<VIP_interceptado> google.com` → responde com latência local
- [ ] `dig @<Listener> google.com` → cada instância responde
- [ ] Counters nftables mostram distribuição **uniforme** (~25%) entre backends
- [ ] `nft -f /etc/nftables.conf` × 2 → ruleset idêntico (idempotência)
- [ ] Parar uma instância → DNS continua respondendo
- [ ] Instância volta → reintegrada automaticamente após cooldown (120s)
- [ ] Sticky sets da instância removida param de receber membros
- [ ] Reconciliação não depende de parsing textual do nftables
- [ ] Re-deploy não altera estado funcional (idempotência)
