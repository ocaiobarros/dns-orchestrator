# DNS Control — Unbound

## Visão Geral

O DNS Control gerencia múltiplas instâncias Unbound como backends de resolução DNS recursiva. Cada instância opera de forma independente com configuração, PID, listener e control socket próprios.

---

## Arquitetura Multi-Instância

```
/etc/unbound/
├── unbound01.conf        # Instância 01
├── unbound02.conf        # Instância 02
├── unbound03.conf        # Instância 03
├── unbound04.conf        # Instância 04
├── named.cache           # Root hints compartilhado
└── unbound_control.pem   # Certificados de controle
```

Cada instância:
- Escuta em um IP exclusivo (ex: `100.127.255.1:53`)
- Usa um PID file exclusivo (`/var/run/unboundNN.pid`)
- Tem um control socket exclusivo (`127.0.0.NN:8953`)
- É gerenciada por um unit systemd independente (`unboundNN.service`)

---

## Configuração de Exemplo

```yaml
# /etc/unbound/unbound01.conf
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

    # ACLs
    access-control: 127.0.0.0/8 allow
    access-control: 10.0.0.0/8 allow
    access-control: 172.16.0.0/12 allow
    access-control: 192.168.0.0/16 allow
    access-control: 100.64.0.0/10 allow

    # Segurança
    hide-identity: yes
    hide-version: yes
    harden-glue: yes
    harden-dnssec-stripped: yes
    use-caps-for-id: yes

remote-control:
    control-enable: yes
    control-interface: 127.0.0.11
    control-port: 8953
```

---

## Parâmetros de Tuning

| Parâmetro | Padrão | Descrição |
|---|---|---|
| `num-threads` | 4 | Threads por instância (≤ núcleos de CPU) |
| `msg-cache-size` | 512m | Cache de mensagens DNS |
| `rrset-cache-size` | 32m | Cache de RRsets |
| `cache-max-ttl` | 7200 | TTL máximo em cache (segundos) |
| `cache-min-ttl` | 0 | TTL mínimo (0 = respeitar upstream) |

### Dimensionamento de Cache

Recomendação para produção:

| Tráfego | msg-cache | rrset-cache | Threads |
|---|---|---|---|
| < 10k QPS | 256m | 16m | 2 |
| 10k-50k QPS | 512m | 32m | 4 |
| > 50k QPS | 1024m | 64m | 4-8 |

---

## Egress (Identidade de Saída)

### Modo Border-Routed (recomendado para ISP)

O Unbound **NÃO** declara `outgoing-interface`. As consultas recursivas saem com o IP padrão do host (ex: `172.29.22.6`). A identidade pública é imposta pelo equipamento de borda via SNAT.

```yaml
# outgoing-interface: SUPRIMIDO — modo border-routed
# Egress controlado pela borda (SNAT para 191.243.128.205)
```

> ⛔ **CRÍTICO**: Se o SNAT na borda **não** estiver configurado, as consultas saem com IP privado e são descartadas na internet → **SERVFAIL em todas as consultas**.

### Modo Host-Owned

O Unbound declara `outgoing-interface` com o IP de egress materializado localmente:

```yaml
server:
    outgoing-interface: 191.243.128.205
```

O IP deve estar materializado na interface `lo`:

```bash
ip addr add 191.243.128.205/32 dev lo
```

> ⛔ **ATENÇÃO**: Se `outgoing-interface` referenciar um IP que não existe no host, o Unbound falha com: `could not send: Can't assign requested address` → **SERVFAIL total**.

---

## Materialização de IPs (post-up.sh)

O script `/etc/network/post-up.sh` materializa os IPs de listener na interface dummy `lo0`:

```bash
#!/bin/bash
# Criar interface dummy
ip link add lo0 type dummy 2>/dev/null || true
ip link set lo0 up

# Listeners (bind)
ip addr add 100.127.255.1/32 dev lo0 2>/dev/null || true
ip addr add 100.127.255.2/32 dev lo0 2>/dev/null || true
ip addr add 100.127.255.3/32 dev lo0 2>/dev/null || true
ip addr add 100.127.255.4/32 dev lo0 2>/dev/null || true
```

> ⚠️ **OBRIGATÓRIO**: Os IPs de listener devem existir no kernel **antes** do `systemctl restart unboundNN`. Caso contrário: `bind: Cannot assign requested address`.

---

## Units Systemd

Cada instância tem um unit independente:

```ini
# /etc/systemd/system/unbound01.service
[Unit]
Description=Unbound DNS Resolver - Instance 01
After=network.target

[Service]
Type=notify
ExecStart=/usr/sbin/unbound -d -c /etc/unbound/unbound01.conf
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### Comandos de gerenciamento

```bash
# Status de todas as instâncias
for i in 01 02 03 04; do
  echo "=== unbound$i ==="
  systemctl status unbound$i --no-pager
done

# Reiniciar instância específica
sudo systemctl restart unbound01

# Verificar configuração antes de reiniciar
sudo unbound-checkconf /etc/unbound/unbound01.conf
```

---

## Unbound-Control

Canal de controle para métricas e gerenciamento operacional:

```bash
# Estatísticas (sem resetar contadores)
sudo unbound-control -s 127.0.0.11@8953 stats_noreset

# Status
sudo unbound-control -s 127.0.0.11@8953 status

# Limpar cache
sudo unbound-control -s 127.0.0.11@8953 flush_zone example.com

# Dump de cache
sudo unbound-control -s 127.0.0.11@8953 dump_cache
```

### Métricas disponíveis

| Estatística | Significado |
|---|---|
| `total.num.queries` | Total de consultas recebidas |
| `total.num.cachehits` | Consultas respondidas pelo cache |
| `total.num.cachemiss` | Consultas que necessitaram recursão |
| `total.recursion.time.avg` | Latência média de recursão (segundos) |
| `num.answer.rcode.SERVFAIL` | Respostas SERVFAIL |
| `num.answer.rcode.NXDOMAIN` | Respostas NXDOMAIN |
| `num.answer.rcode.NOERROR` | Respostas bem-sucedidas |
| `msg.cache.count` | Entradas ativas no cache de mensagens |
| `rrset.cache.count` | Entradas ativas no cache de RRsets |
| `mem.cache.message` | Memória utilizada pelo cache de mensagens |
| `time.up` | Tempo ativo (uptime) da instância |

---

## Troubleshooting

### Instância não inicia

```bash
# Verificar configuração
sudo unbound-checkconf /etc/unbound/unbound01.conf

# Verificar se o IP de listener existe
ip addr show dev lo0 | grep 100.127.255

# Se não existir, materializar
sudo ip addr add 100.127.255.1/32 dev lo0

# Verificar conflito de porta
ss -lunp | grep :53

# Verificar conflito de PID
ls -la /var/run/unbound*.pid
```

### Cache hit baixo

- Verificar se `cache-max-ttl` não está muito baixo
- Verificar se `msg-cache-size` é suficiente para o volume
- Verificar se os clientes estão usando o cache corretamente (não fazendo bypass)

### Latência alta

- Verificar conectividade com upstream: `dig @8.8.8.8 google.com +time=2`
- Verificar carga do sistema: `top`, `free -h`
- Verificar se `num-threads` é adequado para o hardware
- Verificar se o resolver está fazendo priming corretamente: `unbound-control stats_noreset | grep num.query.type.NS`

### SERVFAIL persistente

- Verificar conectividade de saída: `dig @8.8.8.8 google.com +short`
- Verificar SNAT na borda (modo border-routed)
- Verificar root hints: `ls -la /etc/unbound/named.cache`
- Atualizar root hints: `curl -o /etc/unbound/named.cache https://www.internic.net/domain/named.cache`
