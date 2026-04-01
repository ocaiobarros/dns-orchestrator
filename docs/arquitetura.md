# DNS Control — Arquitetura

## Visão Geral

O DNS Control é uma plataforma de orquestração para infraestrutura DNS recursiva baseada em Unbound. Ele transforma parâmetros de rede em artefatos de produção (configurações Unbound, units systemd, regras nftables, scripts de rede) e fornece monitoramento operacional em tempo real.

---

## Fluxo de Tráfego DNS

### Modo Recursivo Simples

```
                          nftables PREROUTING
Cliente ──► IP do Host ──────────────────────► Unbound backend ──► Upstream (8.8.8.8)
             (53/UDP)     numgen random          (100.127.255.x)
                          DNAT
```

1. Cliente envia consulta DNS para o IP principal do host (ex: `172.250.40.100`)
2. nftables captura o pacote no hook PREROUTING
3. Regra `numgen random mod N` seleciona um backend Unbound
4. DNAT redireciona para o listener da instância (ex: `100.127.255.1:53`)
5. Unbound resolve recursivamente via upstream

### Modo Recursivo com Interceptação

```
                          nftables PREROUTING
Cliente ──► IP sequestrado ──────────────────► Unbound backend ──► Upstream
             (ex: 4.2.2.5)  sticky + nth
                             DNAT
```

1. Cliente envia consulta para um DNS público (ex: `4.2.2.5`)
2. Tráfego passa pelo provedor e chega ao host DNS Control
3. nftables verifica afinidade (sticky por IP de origem)
4. Se sem afinidade, `numgen inc mod N vmap` distribui uniformemente
5. DNAT redireciona para backend Unbound local

---

## Camadas de Endereçamento IP

O sistema distingue três camadas de IP, cada uma com função específica:

### 1. VIPs de Serviço

IPs que os clientes configuram como DNS (ex: `45.160.10.1`, `45.160.10.2`).

- **Modo border-routed**: VIPs residem no equipamento de borda, tráfego chega ao host via rotas estáticas
- **Modo local**: VIPs materializados na interface dummy `lo0`
- **Interceptados**: IPs públicos de terceiros sequestrados (ex: `4.2.2.5`)

### 2. Listeners (Backend IPs)

IPs onde as instâncias Unbound fazem bind (ex: `100.127.255.1` a `100.127.255.4`).

- Materializados na interface dummy `lo0` via `post-up.sh`
- Faixa privada (`100.127.255.0/24`) — não roteável externamente
- Cada instância escuta em um IP exclusivo na porta 53

### 3. IPs de Egress

Identidade pública de saída para consultas recursivas (ex: `191.243.128.205`).

- **Border-routed**: IP gerenciado pelo equipamento de borda via SNAT — **não** materializado no host
- **Host-owned**: IP adicionado à interface `lo` e declarado como `outgoing-interface` no Unbound

---

## Modelo de Rede — Dois Planos (lo / lo0)

```
Interface lo (loopback)           Interface lo0 (dummy)
├── 127.0.0.1                     ├── 100.127.255.1  ← Listener unbound01
├── 127.0.0.11 (control 01)       ├── 100.127.255.2  ← Listener unbound02
├── 127.0.0.12 (control 02)       ├── 100.127.255.3  ← Listener unbound03
├── 127.0.0.13 (control 03)       ├── 100.127.255.4  ← Listener unbound04
├── 127.0.0.14 (control 04)       └── (VIPs locais, se aplicável)
└── (IPs de egress host-owned)
```

A interface `lo0` é criada dinamicamente via:

```bash
ip link add lo0 type dummy
ip link set lo0 up
ip addr add 100.127.255.1/32 dev lo0
```

---

## Balanceamento de Carga (nftables)

### Estratégia Sticky + Nth

```
Consulta DNS chega
    │
    ▼
┌─────────────────────────────┐
│ Cliente conhecido?          │
│ (está em algum set sticky?) │
├─────┬───────────────────────┘
│ SIM │ → Direciona para backend memorizado
│     │   (renova timeout de afinidade)
│ NÃO │
│     ▼
│ numgen inc mod N vmap { ... }
│ → Distribui uniformemente entre backends
│ → Memoriza escolha no set sticky
└─────────────────────────────┘
```

- **Timeout de afinidade**: configurável (padrão: 20 minutos)
- **Distribuição**: uniforme via `vmap` (25% por backend com 4 instâncias)
- **Protocolos**: UDP e TCP tratados separadamente

---

## Motor de Saúde (Health Engine)

Executa verificações a cada 10 segundos por instância:

| Verificação | Comando | Critério |
|---|---|---|
| Processo | `systemctl is-active unboundXX` | Serviço ativo |
| Porta | `ss -lunp \| grep :53` | Porta 53 escutando no IP |
| Funcional | `dig @<IP> google.com +short +time=2` | Resposta válida |

### Classificação (Quorum)

- **Saudável**: processo OK + porta OK + dig OK
- **Degradado**: processo OK + porta OK + latência > limiar
- **Falho**: qualquer verificação crítica falha

### Transições de Estado

```
saudável ──[3 falhas]──► falho ──[remoção DNAT]──► retirado
    ↑                                                  │
    └──────[3 sucessos + cooldown expirado]─────────────┘
```

- **Anti-flap**: cooldown de 120 segundos após recuperação antes de restaurar ao DNAT

---

## Motor de Reconciliação

Mantém a disponibilidade DNS gerenciando automaticamente o pool DNAT:

- **Instância falha + em rotação** → Remove do DNAT (`nft delete element`)
- **Instância saudável + fora de rotação + cooldown expirado** → Restaura ao DNAT (`nft add element`)
- **Reconciliação manual**: `POST /api/actions/reconcile-now`

---

## Motor de Telemetria (Collector)

Coletor Python executado via systemd timer a cada 10 segundos:

```
┌──────────────────────────────────────┐
│        collector.py (10s)            │
│                                      │
│  unbound-control → métricas DNS      │
│  nft list ruleset → contadores       │
│  journalctl → top domains/clients    │
│                                      │
│  Saída: /var/lib/dns-control/        │
│         telemetry/latest.json        │
│         telemetry/history.json       │
└──────────────────────────────────────┘
         │
         ▼
    GET /api/telemetry/latest
    GET /api/telemetry/history
         │
         ▼
    Dashboard (React)
```

- **Snapshot atual**: `latest.json` — dados completos da última coleta
- **Histórico**: `history.json` — buffer circular de 300 pontos (~50 min)

---

## Estrutura de Diretórios no Sistema

```
/opt/dns-control/              # Código-fonte e binários
├── backend/                   # API FastAPI
├── collector/                 # Coletor de telemetria
├── dist/                      # Build do frontend
└── deploy/                    # Arquivos de deploy

/var/lib/dns-control/          # Dados persistentes
├── dns-control.db             # Banco SQLite
├── backups/                   # Backups de configuração
├── deployments/               # Deploys versionados
├── staging/                   # Validação pré-apply
└── telemetry/                 # Saída do collector
    ├── latest.json
    └── history.json

/etc/dns-control/              # Configuração global
└── env                        # Variáveis de ambiente
```

---

## Banco de Dados (SQLite)

| Tabela | Função |
|---|---|
| `users` | Contas locais com hash bcrypt |
| `sessions` | Sessões server-side com expiração |
| `config_profiles` | Configurações de infraestrutura salvas |
| `config_revisions` | Histórico de versões por perfil |
| `apply_jobs` | Histórico de execução de deploys |
| `log_entries` | Logs de auditoria estruturados |
| `settings` | Configurações chave-valor da aplicação |
| `dns_instances` | Instâncias DNS registradas |
| `instance_state` | Estado consolidado de saúde |
| `health_checks` | Resultados individuais de verificação |
| `operational_events` | Eventos operacionais estruturados |
