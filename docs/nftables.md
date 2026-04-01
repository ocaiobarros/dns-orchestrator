# DNS Control — nftables

## Visão Geral

O DNS Control utiliza nftables para implementar o balanceamento de carga DNS via DNAT (Destination NAT). As regras são geradas automaticamente pelo Wizard de Configuração e aplicadas em `/etc/nftables.conf` e `/etc/nftables.d/`.

---

## Estrutura das Regras

### Definições

```nft
# VIPs de serviço + interceptados
define DNS_ANYCAST_IPV4 = {
    45.160.10.1,     # VIP primário
    45.160.10.2,     # VIP secundário
    4.2.2.5,         # DNS Level3 interceptado
    4.2.2.6          # DNS Level3 interceptado
}
```

### Cadeia de Captura (PREROUTING)

```nft
chain PREROUTING {
    type nat hook prerouting priority dstnat; policy accept;

    # Capturar tráfego DNS para VIPs
    ip daddr $DNS_ANYCAST_IPV4 udp dport 53 counter jump ipv4_udp_dns
    ip daddr $DNS_ANYCAST_IPV4 tcp dport 53 counter jump ipv4_tcp_dns
}
```

### Cadeia de Dispatch (ipv4_udp_dns)

```nft
chain ipv4_udp_dns {
    # 1. Clientes conhecidos (afinidade sticky)
    ip saddr @ipv4_users_unbound01 counter jump ipv4_dns_udp_unbound01
    ip saddr @ipv4_users_unbound02 counter jump ipv4_dns_udp_unbound02
    ip saddr @ipv4_users_unbound03 counter jump ipv4_dns_udp_unbound03
    ip saddr @ipv4_users_unbound04 counter jump ipv4_dns_udp_unbound04

    # 2. Novos clientes (distribuição uniforme)
    numgen inc mod 4 vmap {
        0 : jump ipv4_dns_udp_unbound01,
        1 : jump ipv4_dns_udp_unbound02,
        2 : jump ipv4_dns_udp_unbound03,
        3 : jump ipv4_dns_udp_unbound04
    }
}
```

### Cadeia de Backend (por instância)

```nft
chain ipv4_dns_udp_unbound01 {
    # Memorizar cliente neste backend
    add @ipv4_users_unbound01 { ip saddr }
    # Renovar timeout de afinidade
    set update ip saddr timeout 0s @ipv4_users_unbound01
    # DNAT para o listener
    dnat to 100.127.255.1:53
}
```

---

## Sets Dinâmicos (Sticky)

```nft
# Afinidade por IP de origem
set ipv4_users_unbound01 {
    type ipv4_addr
    counter
    size 8192
    flags dynamic, timeout
    timeout 20m           # Expira após 20 minutos sem tráfego
}
```

- **Tamanho**: 8192 entradas por set
- **Timeout**: configurável via Wizard (padrão 20 minutos)
- **Renovação**: cada consulta DNS renova o timer de afinidade

---

## Fluxo de Decisão

```
1. Consulta DNS chega no VIP (45.160.10.1:53)
2. PREROUTING → jump ipv4_udp_dns
3. Dispatch verifica: IP do cliente está em algum set sticky?
   ├── SIM → jump para backend memorizado (preserva afinidade)
   └── NÃO → numgen inc mod 4 vmap seleciona backend uniformemente
4. Backend chain:
   a. Memoriza IP do cliente no set sticky
   b. Renova timeout de afinidade
   c. DNAT para o listener Unbound
```

---

## Distribuição Uniforme

A implementação usa `numgen inc mod N vmap` para garantir distribuição uniforme:

```nft
# CORRETO — distribuição 25% por backend
numgen inc mod 4 vmap {
    0 : jump ipv4_dns_udp_unbound01,
    1 : jump ipv4_dns_udp_unbound02,
    2 : jump ipv4_dns_udp_unbound03,
    3 : jump ipv4_dns_udp_unbound04
}
```

> ⚠️ **ATENÇÃO**: Implementações anteriores que usavam `numgen inc mod N` decrescente (mod 4, mod 3, mod 2, mod 1) resultam em distribuição **desigual**. O padrão `vmap` é obrigatório para uniformidade.

---

## Modo Recursivo Simples

No modo simples, nftables também captura tráfego local via hook OUTPUT:

```nft
chain OUTPUT {
    type nat hook output priority -100; policy accept;

    # Capturar consultas locais para o IP do host
    ip daddr 172.250.40.100 udp dport 53 counter jump ipv4_udp_dns
    ip daddr 172.250.40.100 tcp dport 53 counter jump ipv4_tcp_dns
}
```

---

## Interceptação DNS (DNS Seizure)

IPs de DNS públicos interceptados são mesclados com VIPs próprios:

```nft
define DNS_ANYCAST_IPV4 = {
    45.160.10.1,   # VIP próprio
    45.160.10.2,   # VIP próprio
    4.2.2.5,       # Level3 interceptado
    4.2.2.6        # Level3 interceptado
}
```

Para funcionar, o equipamento de borda deve rotear o tráfego para esses IPs até o host DNS Control.

---

## Comandos de Diagnóstico

```bash
# Listar todas as regras
sudo nft list ruleset

# Listar contadores
sudo nft list counters

# Listar sets dinâmicos (entradas sticky)
sudo nft list sets

# Ver set específico
sudo nft list set ip nat ipv4_users_unbound01

# Verificar distribuição
sudo nft list ruleset | grep -A2 "counter packets"

# Recarregar regras
sudo nft -f /etc/nftables.conf
```

---

## Reconciliação Automática

O motor de reconciliação manipula os sets de backends via:

```bash
# Remover backend falho
nft delete element ip nat dns_backends { 100.127.255.3 }

# Restaurar backend recuperado
nft add element ip nat dns_backends { 100.127.255.3 }
```

Essas operações são executadas automaticamente pelo Health Engine quando uma instância falha ou se recupera (após cooldown).
