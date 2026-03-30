# DNS Control v2.1 — Tutorial Completo do Wizard de Configuração

## Visão Geral

O Wizard de Configuração do DNS Control é composto por **11 etapas** sequenciais que transformam parâmetros de rede em artefatos de produção (configs Unbound, units systemd, regras nftables, scripts de rede e tunnings sysctl). Este tutorial guia o preenchimento correto de cada campo usando como referência o ambiente de produção real.

**Rota de acesso:** Login → Menu lateral → **Wizard**

---

## Pré-requisitos Obrigatórios

Antes de abrir o Wizard, garanta que o host atende a estes requisitos:

### 1. Sistema Operacional
- **Debian 13 (Trixie)** com systemd
- Modelo de rede: `ifupdown` (`/etc/network/interfaces`)

### 2. Pacotes Instalados
```bash
apt-get install -y \
  unbound nftables iproute2 curl wget dnsutils bind9-utils \
  net-tools tcpdump rsync vim psmisc htop frr
```

### 3. Serviço Unbound Legado Desativado
```bash
systemctl disable unbound
systemctl stop unbound
systemctl mask unbound.service
```

### 4. Root Hints Baixado
```bash
wget -4 -O /etc/unbound/named.cache https://www.internic.net/domain/named.root
```

### 5. Diretórios Criados
```bash
mkdir -p /etc/nftables.d
mkdir -p /var/lib/dns-control/{backups,staging,deployments}
mkdir -p /var/log/dns-control
```

### 6. Informações Necessárias (levante antes)
```bash
ip -br addr          # Interface, IP e máscara
ip route             # Gateway padrão
ip -6 route          # Gateway IPv6 (se aplicável)
hostname -f          # FQDN do host
```

---

## Etapa 1 — Topologia do Host

**Objetivo:** Identificar o host na rede — IP privado, interface física, gateway.

| Campo | Obrigatório | Formato | Exemplo Produção | Descrição |
|-------|:-----------:|---------|-------------------|-----------|
| **Hostname** | ✅ | FQDN alfanumérico | `dnscontrol` | Nome do servidor. Aceita pontos e hífens. |
| **Organização** | ✅ | Texto livre | `MinhaOperadora` | Nome da empresa/operadora. |
| **Interface principal** | ✅ | Nome de NIC Linux | `ens192` | Obtido via `ip -br addr`. Exemplos: `ens192`, `enp6s18`, `eth0`. |
| **VLAN Tag** | ❌ | Número inteiro | *(vazio)* | Preencha apenas se a interface usa 802.1Q (ex: `100` gera `ens192.100`). |
| **Endereço IPv4 (CIDR)** | ✅ | `x.x.x.x/y` | `172.29.22.6/30` | IP privado do host **com máscara**. Obtido via `ip -br addr`. |
| **Gateway IPv4** | ✅ | `x.x.x.x` | `172.29.22.5` | Obtido via `ip route` (campo `default via`). |
| **Habilitar dual-stack IPv6** | ❌ | Toggle | `Habilitado` | Ative se o host possui conectividade IPv6. |
| **Endereço IPv6 (CIDR)** | Se IPv6 | `xxxx::x/y` | `2804:4AFC:8844::2/64` | IP IPv6 com prefixo. |
| **Gateway IPv6** | Se IPv6 | `xxxx::x` | `2804:4AFC:8844::1` | Gateway IPv6 padrão. |
| **Host atrás de firewall** | ❌ | Toggle | `Habilitado` | Marque se os IPs públicos são gerenciados por um equipamento de borda. |
| **Projeto** | ❌ | Texto livre | `DNS Recursivo Produção` | Nome descritivo do projeto. |
| **Timezone** | ❌ | Timezone IANA | `America/Sao_Paulo` | Já vem preenchido. |

### Validações da Etapa 1
- ❌ Hostname vazio → erro
- ❌ Organização vazia → erro
- ❌ Interface com caracteres inválidos → erro
- ❌ IPv4 sem máscara CIDR (`172.29.22.6` sem `/30`) → erro
- ❌ Gateway IPv4 inválido → erro
- ❌ IPv6 habilitado sem endereço/gateway → erro

### Verificação
```bash
# Confirme que os valores conferem com o host real:
ip -br addr show ens192
# Esperado: ens192  UP  172.29.22.6/30 ...
ip route show default
# Esperado: default via 172.29.22.5 dev ens192
```

---

## Etapa 2 — Publicação DNS (Deployment Mode)

**Objetivo:** Definir como os clientes alcançam o serviço DNS.

| Modo | Quando Usar | Requer nftables | Requer FRR |
|------|-------------|:---------------:|:----------:|
| **DNS Recursivo Interno** | Resolvers acessíveis apenas na rede interna | Não | Não |
| **DNS Público Controlado** | IPs públicos atribuídos diretamente ao host | Não | Não |
| **Pseudo-Anycast com VIP Local** | VIP em dummy/loopback, DNAT via nftables | ✅ | Não |
| **VIP Roteado via Borda** ⭐ | VIP no firewall/router, host recebe via rota/NAT. **Recomendado para ISP** | ✅ | Não |
| **VIP Local em Dummy Interface** | VIP diretamente no host | ✅ | Não |
| **Anycast com FRR / OSPF** | VIPs anunciados via OSPF | ✅ | ✅ |

**Para o cenário de produção do tutorial:** Selecione **"VIP Roteado via Borda / Firewall"**.

### Validações
- ⚠️ Modos FRR com roteamento estático → warning
- Nenhum campo de preenchimento nesta etapa — apenas seleção.

---

## Etapa 3 — VIPs de Serviço

**Objetivo:** Configurar os IPs que os clientes usarão como servidor DNS.

Para cada VIP, preencha:

| Campo | Obrigatório | Formato | Exemplo | Descrição |
|-------|:-----------:|---------|---------|-----------|
| **IPv4** | ✅ | `x.x.x.x` | `4.2.2.5` | IP público do serviço DNS. |
| **IPv6** | Se ativado | `xxxx::x` | `2620:119:35::35` | IPv6 do VIP. Ative "VIPs IPv6" primeiro. |
| **Porta** | ❌ | Número | `53` | Sempre 53, exceto cenários especiais. |
| **Protocolo** | ❌ | Seleção | `UDP + TCP` | Padrão: ambos. |
| **Descrição** | ❌ | Texto | `DNS Público Level3` | Identificação humana. |
| **Modo de Entrega** | ❌ | Seleção | `Entregue via Firewall` | Como o tráfego chega ao host. |
| **Health Check** | ❌ | Toggle + config | `google.com / 30s` | Probe DNS ativo para monitorar o VIP. |

### Exemplo Produção — 2 VIPs

| # | IPv4 | IPv6 | Descrição | Entrega |
|---|------|------|-----------|---------|
| VIP 1 | `4.2.2.5` | `2620:119:35::35` | DNS Público Level3 #1 | Entregue via Firewall |
| VIP 2 | `4.2.2.6` | `2620:119:53::53` | DNS Público Level3 #2 | Entregue via Firewall |

### Validações
- ❌ IPv4 do VIP vazio ou inválido → erro
- ❌ VIP duplicado → erro
- ❌ VIP igual ao listener de alguma instância → erro
- ❌ VIP igual ao IP privado do host → erro

---

## Etapa 4 — Instâncias Resolver

**Objetivo:** Criar os processos Unbound individuais com listeners e controle independentes.

### Parâmetros Globais (aplicados a todas as instâncias)

| Campo | Default | Exemplo | Descrição |
|-------|---------|---------|-----------|
| **Threads por instância** | `4` | `4` | Número de threads do Unbound. |
| **Msg Cache** | `512m` | `512m` | Cache de mensagens. |
| **RRset Cache** | `32m` | `32m` | Cache de RRsets. |
| **Max TTL** | `7200` | `7200` | TTL máximo em cache (segundos). |
| **Root Hints** | `/etc/unbound/named.cache` | `/etc/unbound/named.cache` | Caminho do arquivo root hints. |
| **DNS Identity** | *(vazio)* | `67-DNS` | Valor do campo `identity` no Unbound. |
| **Logs detalhados** | Off | Off | `verbosity: 2` se ativado. |
| **Blocklist** | Off | Off | Habilita `unbound-block-domains.conf`. |

### Campos por Instância

| Campo | Obrigatório | Formato | Descrição |
|-------|:-----------:|---------|-----------|
| **Nome** | ✅ | Alfanumérico | Identificador único (ex: `unbound01`). Define o nome do systemd unit e do `.conf`. |
| **Listener Privado** | ✅ | IPv4 | IP interno no loopback onde o Unbound escuta (ex: `100.127.255.101`). |
| **Listener Público** | ❌ | IPv4 | IP público da instância para identidade (ex: `191.243.128.205`). |
| **Listener IPv6** | Se IPv6 | IPv6 | IP IPv6 de escuta (ex: `2001:db8:ffff:ffff:100:127:255:101`). |
| **Control Interface** | ✅ | IPv4 (127.x) | IP local para `unbound-control` (ex: `127.0.0.11`). |
| **Control Port** | ❌ | 1024-65535 | Porta do remote-control. Default: `8953`. |

### Exemplo Produção — 4 Instâncias

| # | Nome | Listener Privado | Listener IPv6 | Control Interface | Control Port |
|---|------|-----------------|---------------|-------------------|:------------:|
| 1 | `unbound01` | `100.127.255.101` | `2001:db8:ffff:ffff:100:127:255:101` | `127.0.0.11` | `8953` |
| 2 | `unbound02` | `100.127.255.102` | `2001:db8:ffff:ffff:100:127:255:102` | `127.0.0.12` | `8953` |
| 3 | `unbound03` | `100.127.255.103` | `2001:db8:ffff:ffff:100:127:255:103` | `127.0.0.13` | `8953` |
| 4 | `unbound04` | `100.127.255.104` | `2001:db8:ffff:ffff:100:127:255:104` | `127.0.0.14` | `8953` |

**Clique em "+ Adicionar instância" para criar as instâncias 3 e 4** (o wizard inicia com 2).

### Validações
- ❌ Nome vazio ou duplicado → erro
- ❌ Listener IPv4 vazio ou inválido → erro
- ❌ Listener duplicado entre instâncias → erro
- ❌ Control Interface vazia ou inválida → erro
- ❌ Control Interface:Port duplicada → erro
- ❌ Listener igual ao IP privado do host → erro
- ❌ Threads < 1 ou > 64 → erro
- ❌ Max TTL < Min TTL → erro

### Verificação Pós-Deploy
```bash
# Confirme que os IPs estão no loopback:
ip addr show lo | grep 100.127.255

# Confirme que o Unbound aceita o config:
unbound-checkconf /etc/unbound/unbound01.conf
unbound-checkconf /etc/unbound/unbound02.conf
unbound-checkconf /etc/unbound/unbound03.conf
unbound-checkconf /etc/unbound/unbound04.conf
```

---

## Etapa 5 — VIP Interception / DNS Seizure

**Objetivo:** Configurar o sequestro de IPs DNS públicos conhecidos para resolução local.

> **Esta é a feature principal do DNS Control.** Clientes pensam usar o DNS público (ex: 4.2.2.5), mas a resolução é feita localmente.

| Campo | Obrigatório | Formato | Exemplo | Descrição |
|-------|:-----------:|---------|---------|-----------|
| **VIP IP** | ✅ | IPv4 | `4.2.2.5` | IP DNS público a ser sequestrado. |
| **Tipo** | ❌ | Seleção | `Intercepted (sequestrado)` | `Intercepted` = IP que não é seu. `Owned` = IP que você controla. |
| **Modo de Captura** | ❌ | Seleção | `DNAT (nftables)` | Como o tráfego é capturado. **DNAT é o recomendado.** |
| **Backend Instance** | ✅ | Seleção | `unbound01` | Instância que atende **como ponto de entrada**. No modo sticky+nth, TODOS os backends atendem. |
| **Backend Target IP** | ✅ | IPv4 | `100.127.255.101` | Preenchido automaticamente ao selecionar a instância. |
| **Protocolo** | ❌ | Seleção | `UDP + TCP` | Sempre UDP + TCP para DNS. |
| **Latência esperada** | ❌ | Número (ms) | `1` | Threshold para health check. < 1ms = resolução local. |
| **Validação** | ❌ | Seleção | `Strict` | `Strict` = valida DNAT + rota + binding + DNS probe. |
| **Descrição** | ❌ | Texto | `Level3 DNS sequestrado` | Identificação humana. |

### Exemplo Produção — 2 VIPs Interceptados

> **Nota importante:** No modo **sticky-source + nth balancing** (Etapa 7), os VIPs interceptados são **balanceados entre TODOS os backends automaticamente**. O campo "Backend Instance" é apenas referência — não cria mapeamento 1:1.

| # | VIP IP | Tipo | Captura | Backend Ref | Descrição |
|---|--------|------|---------|-------------|-----------|
| 1 | `4.2.2.5` | Intercepted | DNAT | `unbound01` | Level3 DNS #1 sequestrado |
| 2 | `4.2.2.6` | Intercepted | DNAT | `unbound02` | Level3 DNS #2 sequestrado |

### Validações
- ❌ VIP IP vazio ou inválido → erro
- ❌ VIP duplicado → erro
- ❌ Backend Instance não selecionado → erro
- ❌ Backend Target IP vazio ou inválido → erro

---

## Etapa 6 — Egress Público

**Objetivo:** Definir o IP público de saída (outgoing-interface) que os servidores autoritativos verão.

### Modo de Entrega do Egress

| Modo | Quando Usar | outgoing-interface no Unbound | IP no host |
|------|-------------|:-----------------------------:|:----------:|
| **Host-Owned (IP Local)** ⭐ | IP público pertence ao host e está no loopback | ✅ Emitido | ✅ Presente |
| **Border-Routed (Lógico)** | IP público é imposto pelo equipamento de borda via SNAT | ❌ Suprimido | ❌ Ausente |

**Para o cenário do tutorial:** Selecione **"Host-Owned (IP Local)"** — os IPs de egress `45.232.215.20-23` estão materializados no loopback.

### Modo de Alocação

| Modo | Descrição |
|------|-----------|
| **Fixo por Instância** ⭐ | Cada instância usa 1 IP público fixo. Melhor rastreabilidade. |
| **Pool Compartilhado** | Todas compartilham um pool de IPs. |
| **Randomizado** | IP selecionado aleatoriamente por query. |

### Campos por Instância (modo Fixo)

| Campo | Obrigatório | Formato | Exemplo | Descrição |
|-------|:-----------:|---------|---------|-----------|
| **Egress IPv4** | ✅ | `x.x.x.x` | `45.232.215.20` | IP público de saída dedicado. |
| **Egress IPv6** | Se IPv6 | `xxxx::x` | `2804:4afc:8888::1000` | IPv6 de saída. |

### Exemplo Produção — 4 Instâncias

| Instância | Egress IPv4 | Egress IPv6 |
|-----------|-------------|-------------|
| `unbound01` | `45.232.215.20` | `2804:4afc:8888::1000` |
| `unbound02` | `45.232.215.21` | `2804:4afc:8888::1001` |
| `unbound03` | `45.232.215.22` | `2804:4afc:8888::1002` |
| `unbound04` | `45.232.215.23` | `2804:4afc:8888::1003` |

### Validações
- ❌ Egress IPv4 vazio ou inválido → erro
- ❌ Egress duplicado com identidade fixa → erro
- ❌ Egress igual ao listener da mesma instância → erro
- ❌ Egress igual a um VIP de serviço → erro
- ⚠️ Border-routed: "IP público não estará no host" → warning (esperado)

### Verificação Pós-Deploy (Host-Owned)
```bash
# Confirme os IPs de egress no loopback:
ip addr show lo | grep 45.232.215

# Teste que o Unbound sai pelo IP correto:
# (De outro host, capture o source IP das queries recursivas)
```

---

## Etapa 7 — Mapeamento VIP → Instância

**Objetivo:** Definir como o tráfego DNS é distribuído entre as instâncias.

| Política | Descrição | nftables gerado |
|----------|-----------|:---------------:|
| **Mapeamento Fixo** | Cada VIP associado a 1 instância específica | Chains 1:1 |
| **Round Robin (numgen)** | Distribuição sequencial | `numgen inc mod N` |
| **Sticky por Origem** ⭐ | Memoriza resolver por IP do cliente. Fallback nth. **Recomendado.** | Sets dinâmicos + nth |
| **Nth Balancing** | Balanceamento nth com decrementação progressiva | `numgen inc mod N` decrescente |
| **Ativo / Passivo** | Primário + standby | Requer ≥ 2 instâncias |

**Para o cenário do tutorial:** Selecione **"Sticky por Origem (Recomendado)"**.

### Campo Adicional — Sticky Timeout

| Campo | Default | Exemplo | Descrição |
|-------|---------|---------|-----------|
| **Sticky Timeout (minutos)** | `20` | `20` | Tempo que a associação cliente→backend é mantida no set nftables. |

O tutorial original usa `timeout 20m` nos sets — mantenha 20 minutos.

### Validações
- ⚠️ Mapeamento fixo sem associações → warning
- ❌ Ativo/passivo com < 2 instâncias → erro

### Como Funciona na Prática
1. Cliente novo envia query DNS para VIP `4.2.2.5`
2. nftables PREROUTING captura o pacote
3. Verifica se IP do cliente já está em algum set `ipv4_users_unboundXX`
4. Se sim → encaminha para o backend memorizado (sticky)
5. Se não → `numgen inc mod N` distribui para o próximo backend (nth)
6. Backend adiciona IP do cliente ao seu set com timeout de 20min

---

## Etapa 8 — Roteamento

**Objetivo:** Definir como os VIPs são alcançáveis na rede.

| Modo | Quando Usar |
|------|-------------|
| **Sem Roteamento Dinâmico** ⭐ | VIPs alcançáveis via rotas estáticas no router de borda. |
| **FRR / OSPF** | VIPs anunciados via OSPF. Requer FRR instalado. |
| **FRR / BGP** | Em desenvolvimento. |

**Para o cenário do tutorial:** Selecione **"Sem Roteamento Dinâmico"** — as rotas estáticas são feitas no equipamento de borda.

### Se usar FRR / OSPF

| Campo | Obrigatório | Formato | Exemplo |
|-------|:-----------:|---------|---------|
| **Router ID** | ✅ | IPv4 | `172.29.22.6` |
| **Área OSPF** | ✅ | IPv4 (dotted) | `0.0.0.0` |
| **Custo OSPF** | ❌ | 1-65535 | `10` |
| **Network Type** | ❌ | Seleção | `Point-to-Point` |
| **Redistribuir connected** | ❌ | Toggle | Habilitado |
| **Interfaces OSPF** | ✅ | Lista | `lo`, `ens192` |

---

## Etapa 9 — Segurança

**Objetivo:** Controlar quem pode consultar o DNS e configurar o painel de gerenciamento.

### ACLs IPv4 (access-control do Unbound)

Adicione redes que podem fazer queries. Cada entrada possui:

| Campo | Formato | Exemplo | Descrição |
|-------|---------|---------|-----------|
| **Rede** | CIDR | `0.0.0.0/0` | Bloco de rede permitido/bloqueado. |
| **Ação** | Seleção | `allow` | `allow`, `refuse`, `deny`, `allow_snoop`. |
| **Label** | Texto | `Todos (open resolver)` | Identificação. |

### Exemplo Produção — Open Resolver (ISP)

| # | Rede | Ação | Label |
|---|------|------|-------|
| 1 | `127.0.0.0/8` | allow | Loopback |
| 2 | `0.0.0.0/0` | allow | Todos (open resolver) |

> ⚠️ **Open Resolver:** Se incluir `0.0.0.0/0` com `allow`, o wizard exige **confirmação explícita** ("Confirmo que quero operar como open resolver"). ISPs que sequestram DNS público geralmente operam como open resolver para seus clientes.

### Proteção

| Toggle | Descrição | Recomendação |
|--------|-----------|:------------:|
| **Rate limiting via nftables** | Limita UDP 100/s e TCP 50/s | ✅ Ativar |
| **Anti-amplificação DNS** | Proteção contra ataques de amplificação | ✅ Ativar |
| **Recursão permitida** | Permite queries recursivas | ✅ Ativar |

### Painel de Controle

| Campo | Default | Exemplo | Descrição |
|-------|---------|---------|-----------|
| **Usuário Admin** | `admin` | `admin` | Usuário do painel DNS Control. |
| **Senha Inicial** | *(vazio)* | *(definir)* | Senha inicial — será alterada no primeiro login. |
| **Bind do Painel** | `127.0.0.1` | `127.0.0.1` | `127.0.0.1` = local only (Nginx faz proxy). `0.0.0.0` = todas as interfaces. |
| **Porta** | `8443` | `8443` | Porta da API do painel. |
| **IPs Permitidos** | *(vazio)* | *(opcional)* | Restrição adicional de IPs para acesso ao painel. |

### Validações
- ❌ Nenhuma ACL → erro
- ❌ CIDR inválido → erro
- ❌ Open resolver sem confirmação → erro
- ⚠️ Open resolver → warning
- ⚠️ ACLs muito amplas (< /8) → warning
- ⚠️ Painel em 0.0.0.0 sem restrição de IPs → warning
- ❌ Usuário admin vazio → erro

---

## Etapa 10 — Observabilidade

**Objetivo:** Selecionar métricas e sinais operacionais a serem coletados.

Todos os toggles são opcionais e vêm ativados por padrão. **Recomendação: manter todos ativados.**

### Métricas de Tráfego
| Toggle | Descrição |
|--------|-----------|
| Métricas por VIP de serviço | Contadores de pacotes/bytes por VIP |
| Métricas por instância resolver | Queries, cache, latência por instância |
| Métricas por IP de saída (egress) | Rastreamento de tráfego por IP de egress |
| Counters nftables | Contadores de pacotes/bytes nas chains nftables |

### Saúde & Status
| Toggle | Descrição |
|--------|-----------|
| Status systemd por instância | Monitora `systemctl status unboundXX` |
| Health checks ativos | DNS probes periódicos nos VIPs/instâncias |

### Performance DNS
| Toggle | Descrição |
|--------|-----------|
| Latência média de resolução | Avg latency via `unbound-control stats` |
| Cache hit ratio | Taxa de acerto do cache |
| Recursion time | Tempo médio/mediana de recursão |

### Eventos
| Toggle | Descrição |
|--------|-----------|
| Eventos operacionais | Log de eventos de deploy, restart, falhas |

Sem validações bloqueantes nesta etapa.

---

## Etapa 11 — Revisão & Deploy

**Objetivo:** Auditar os artefatos gerados, executar dry-run e aplicar.

### Painel de Resumo

O wizard mostra:
1. **Sumário de Validação** — erros (bloqueantes) e warnings por etapa
2. **Topologia Visual** — diagrama das camadas (VIPs → nftables → Instâncias → Egress)
3. **Arquivos Gerados** — agrupados por categoria:
   - **Unbound:** `unbound01.conf` ... `unbound04.conf` + blocklist
   - **Systemd:** `unbound01.service` ... `unbound04.service` + `dns-control-api.service`
   - **Network:** `interfaces`, `post-up.sh`, `dns-control-lo.conf`
   - **NFTables:** `nftables.conf` + ~30-50 arquivos modulares em `/etc/nftables.d/`
   - **Sysctl:** ~20 arquivos em `/etc/sysctl.d/`
   - **FRR:** `frr.conf` (se OSPF ativado)

### Ações Disponíveis

| Botão | O que faz |
|-------|-----------|
| **Dry Run** | Envia config para o backend, gera artefatos em staging, executa `unbound-checkconf` e `nft -c -f` sem aplicar. |
| **Aplicar (Deploy)** | Executa o pipeline completo: backup → staging → validação → apply → restart serviços → health checks. |
| **Exportar JSON** | Baixa a configuração completa como arquivo `.json` para versionamento. |
| **Ver Arquivos** | Expande a preview de todos os artefatos gerados. |

### Painel de Diagnóstico (se erro)

| Botão | O que faz |
|-------|-----------|
| **Testar Conectividade** | `GET /api/deploy/state` — verifica se a API responde. |
| **Copiar Payload JSON** | Copia o JSON completo para debug manual via `curl`. |
| **Forçar Dry-Run** | Executa dry-run mesmo com warnings (bypass validação). |

---

## Checklist Final — Antes de Clicar "Aplicar"

### No Wizard
- [ ] Etapa 1: Hostname, interface e IP conferem com `ip -br addr`
- [ ] Etapa 2: Modo de publicação correto para a arquitetura
- [ ] Etapa 3: VIPs de serviço preenchidos (ex: `4.2.2.5`, `4.2.2.6`)
- [ ] Etapa 4: 4 instâncias com listeners, controls únicos e sem colisões
- [ ] Etapa 5: VIPs interceptados configurados com modo DNAT
- [ ] Etapa 6: Egress IPv4 de cada instância preenchido (ex: `45.232.215.20-23`)
- [ ] Etapa 7: Sticky por origem selecionado com timeout 20min
- [ ] Etapa 8: Roteamento estático (ou OSPF se aplicável)
- [ ] Etapa 9: ACLs corretas + open resolver confirmado (se ISP)
- [ ] Etapa 10: Observabilidade toda ativada
- [ ] Etapa 11: Dry-run executado com sucesso

### No Host (antes do deploy)
- [ ] `unbound.service` desativado e mascarado
- [ ] `/etc/unbound/named.cache` baixado
- [ ] `/etc/nftables.d/` existe
- [ ] Pacotes `unbound`, `nftables`, `iproute2` instalados
- [ ] API DNS Control rodando e acessível

### Após o Deploy
```bash
# 1. Verificar IPs no loopback
ip addr show lo | grep -E '100.127|45.232'

# 2. Verificar Unbound configs
unbound-checkconf /etc/unbound/unbound01.conf
unbound-checkconf /etc/unbound/unbound02.conf
unbound-checkconf /etc/unbound/unbound03.conf
unbound-checkconf /etc/unbound/unbound04.conf

# 3. Verificar nftables
nft -c -f /etc/nftables.conf

# 4. Iniciar serviços
systemctl daemon-reload
systemctl start unbound01 unbound02 unbound03 unbound04
systemctl restart nftables

# 5. Verificar escuta na porta 53
ss -lntup | grep ':53'

# 6. Testar DNS nos listeners
dig @100.127.255.101 google.com A +short
dig @100.127.255.102 google.com A +short
dig @100.127.255.103 google.com A +short
dig @100.127.255.104 google.com A +short

# 7. Testar DNS nos VIPs (após descomentar no post-up.sh e aplicar)
dig @4.2.2.5 google.com A +short
dig @4.2.2.6 google.com A +short

# 8. Verificar counters nftables
nft list counters
```

---

## Troubleshooting

### Erro: "Hostname é obrigatório"
**Causa:** Campo hostname vazio na Etapa 1.
**Solução:** Preencha com o FQDN do servidor (ex: `dnscontrol`).

### Erro: "Endereço IPv4/CIDR inválido"
**Causa:** IP sem máscara (ex: `172.29.22.6` em vez de `172.29.22.6/30`).
**Solução:** Sempre inclua a máscara CIDR no endereço.

### Erro: "Listener IPs duplicados"
**Causa:** Duas instâncias com o mesmo IP de bind.
**Solução:** Cada instância precisa de um IP de listener único.

### Erro: "VIP conflita com listener da instância"
**Causa:** VIP de serviço (ex: `4.2.2.5`) é igual ao listener de uma instância.
**Solução:** VIPs de serviço e listeners devem ser IPs distintos. VIPs são os endereços de entrada; listeners são os IPs internos de bind.

### Erro: "Open resolver requer confirmação explícita"
**Causa:** ACL `0.0.0.0/0 allow` sem toggle de confirmação.
**Solução:** Na Etapa 9, marque "Confirmo que quero operar como open resolver".

### Erro: "Deploy bloqueado: N erro(s) de validação"
**Causa:** Há erros bloqueantes em alguma etapa.
**Solução:** Clique nas etapas com indicador vermelho no stepper e corrija os campos destacados.

### Erro: "API inacessível"
**Causa:** Backend DNS Control não está rodando ou Nginx não está fazendo proxy.
**Solução:**
```bash
systemctl status dns-control-api
curl -s http://127.0.0.1:8000/api/health
```

### Problema: "unbound-checkconf invalid option -- 'c'"
**Causa:** O binário espera o arquivo como argumento posicional.
**Solução:** Use `unbound-checkconf /etc/unbound/unbound01.conf` (sem `-c`).

### Problema: DNS não responde no VIP anycast
**Checklist:**
```bash
ip -br addr                          # IPs presentes?
ss -lntup | grep ':53'               # Unbound escutando?
nft list ruleset | grep DNAT         # Regras de DNAT existem?
nft list counters                    # Counters incrementando?
journalctl -u unbound01 -n 50       # Erros no log?
```

### Problema: Ping no VIP com latência > 100ms
**Causa:** O VIP não está materializado no loopback do host — o tráfego está indo para a internet.
**Solução:**
```bash
# Descomente as linhas no post-up.sh:
vim /etc/network/post-up.sh
# Remova o # das linhas com /usr/sbin/ip addr add 4.2.2.5/32 dev lo
# Execute:
/etc/network/post-up.sh
# Verifique:
ip addr show lo | grep 4.2.2
```

---

## Referência Rápida — Valores do Cenário de Produção

| Parâmetro | Valor |
|-----------|-------|
| Hostname | `dnscontrol` |
| Interface | `ens192` |
| IP Privado | `172.29.22.6/30` |
| Gateway | `172.29.22.5` |
| IPv6 | `2804:4AFC:8844::2/64` → gw `2804:4AFC:8844::1` |
| Deployment Mode | VIP Roteado via Borda |
| VIPs Serviço | `4.2.2.5`, `4.2.2.6` |
| VIPs IPv6 | `2620:119:35::35`, `2620:119:53::53` |
| Instâncias | 4 (`unbound01`..`unbound04`) |
| Listeners | `100.127.255.101`..`.104` |
| Egress IPv4 | `45.232.215.20`..`.23` |
| Egress IPv6 | `2804:4afc:8888::1000`..`::1003` |
| Controls | `127.0.0.11`..`.14` porta `8953` |
| Distribuição | Sticky por origem (20min timeout) |
| Egress Mode | Host-Owned |
| Roteamento | Estático |
| ACL | `0.0.0.0/0 allow` (open resolver confirmado) |
| DNS Identity | `67-DNS` |
| Threads | 4 |
| Cache | `512m` msg / `32m` rrset |
