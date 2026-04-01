# DNS Control — Troubleshooting

## Problemas Comuns

### 1. Dashboard sem dados (gráficos vazios)

**Causa provável**: Collector de telemetria não está ativo.

```bash
# Verificar timer
systemctl status dns-control-collector.timer

# Verificar se o arquivo de telemetria existe
ls -lh /var/lib/dns-control/telemetry/latest.json

# Verificar conteúdo
cat /var/lib/dns-control/telemetry/latest.json | python3 -m json.tool | head -30

# Verificar erros do collector
journalctl -u dns-control-collector --since "5 minutes ago"

# Ativar o collector se necessário
systemctl enable --now dns-control-collector.timer
```

**Se o arquivo existe mas os gráficos de séries temporais estão vazios**:

```bash
# Verificar histórico
ls -lh /var/lib/dns-control/telemetry/history.json
cat /var/lib/dns-control/telemetry/history.json | python3 -m json.tool | head -50

# O histórico leva ~30 segundos para começar a popular (3 ciclos de 10s)
# Aguardar e verificar novamente
```

### 2. nftables sem contadores

**Causa provável**: Regras nftables não possuem diretiva `counter`, ou o serviço está inativo.

```bash
# Verificar se nftables está carregado
sudo nft list tables

# Verificar contadores
sudo nft list counters

# Verificar regras com counter
sudo nft list ruleset | grep counter

# Se sem contadores, reaplicar configuração via Wizard
```

### 3. Unbound sem resposta

```bash
# Verificar processo
systemctl status unbound01

# Verificar porta
ss -lunp | grep :53

# Testar diretamente
dig @100.127.255.1 google.com +short +time=2

# Verificar configuração
sudo unbound-checkconf /etc/unbound/unbound01.conf

# Verificar logs
journalctl -u unbound01 --since "5 minutes ago"

# Erros comuns:
# "bind: Cannot assign requested address" → IP do listener não existe no kernel
#   → Verificar: ip addr show dev lo0 | grep 100.127.255
#   → Corrigir: ip addr add 100.127.255.1/32 dev lo0

# "could not send: Can't assign requested address" → outgoing-interface inválida
#   → Em modo border-routed, outgoing-interface NÃO deve ser declarado
```

### 4. SERVFAIL em todas as consultas

**Causa provável**: Problema de conectividade com upstream ou SNAT ausente na borda.

```bash
# Testar conectividade com upstream
dig @8.8.8.8 google.com +short +time=3

# Verificar rota de saída
ip route get 8.8.8.8

# Testar SNAT (a resposta deve vir)
dig @8.8.8.8 whoami.akamai.net +short

# Se dig falha:
# → Verificar SNAT no equipamento de borda
# → Verificar regras de firewall (porta 53 de saída)
# → Verificar rotas estáticas para VIPs na borda
```

### 5. API inacessível

```bash
# Verificar serviço
systemctl status dns-control-api

# Verificar porta
ss -lntup | grep :8000

# Verificar logs
journalctl -u dns-control-api --since "5 minutes ago" --no-pager

# Verificar nginx (se acesso externo)
systemctl status nginx
nginx -t
tail -20 /var/log/nginx/dns-control-error.log
```

### 6. Eventos vazios na página de Eventos

**Causa provável**: Workers de saúde não estão gerando eventos de transição.

```bash
# Verificar se o scheduler está rodando
journalctl -u dns-control-api | grep "Scheduler"

# Verificar lock do scheduler
ls -la /tmp/dns-control-scheduler.lock

# Se o lock está travado, reiniciar
rm -f /tmp/dns-control-scheduler.lock
systemctl restart dns-control-api
```

### 7. Instância saudável mas fora de rotação

**Causa provável**: Cooldown ativo ou reconciliação travada.

```bash
# Verificar estado com cooldown
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Forçar reconciliação
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"

# Se cooldown_until está no passado mas backend não foi restaurado:
systemctl restart dns-control-api
```

---

## Diagnósticos Privilegiados

Alguns comandos de diagnóstico requerem privilégios elevados. O sistema usa sudoers com escopo restrito.

### Verificar status de privilégios

```bash
# Via API
curl -s http://127.0.0.1:8000/api/troubleshooting/privilege-status \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool
```

### Classificação de resultados de diagnóstico

| Status | Cor | Significado | É problema real? |
|---|---|---|---|
| `ok` | 🟢 Verde | Comando executou com sucesso | Não |
| `inactive` | ⚪ Cinza | Serviço inativo (pode ser intencional) | Depende |
| `permission_error` | 🟡 Âmbar | Sem privilégio para executar | Não — limitação de permissão |
| `degraded` | 🟡 Amarelo | Funcionando mas em estado subótimo | Investigar |
| `dependency_error` | ⚪ Cinza | Binário ou dependência ausente | Instalar pacote |
| `timeout_error` | 🔴 Vermelho | Comando excedeu tempo limite | Verificar responsividade |
| `error` | 🔴 Vermelho | Falha real de execução | ✅ Sim — investigar |

### Falhas de permissão esperadas em modo não privilegiado

| Comando | Motivo | Remediação |
|---|---|---|
| `unbound-control` | Socket requer permissão | Ajustar permissões ou usar sudo |
| `nft` | Requer CAP_NET_ADMIN | Sudo restrito para leitura |
| `vtysh` | Permissão do FRR | Grupo `frrvty` ou sudo |
| `journalctl` | Requer grupo `systemd-journal` | Adicionar usuário ao grupo |

---

## Comandos de Diagnóstico Rápido

```bash
# Saúde completa de todas as instâncias
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Status do collector
curl -s http://127.0.0.1:8000/api/telemetry/status | python3 -m json.tool

# Verificação completa de saúde via API
curl -s http://127.0.0.1:8000/api/troubleshooting/health-check \
  -H "Authorization: Bearer <TOKEN>" | python3 -m json.tool

# Todos os serviços de uma vez
systemctl status dns-control-api dns-control-collector.timer nginx unbound01 unbound02 unbound03 unbound04 frr nftables

# Verificar conectividade DNS end-to-end
for vip in 45.160.10.1 45.160.10.2 4.2.2.5 4.2.2.6; do
  echo "=== $vip ==="
  dig @$vip google.com +short +time=2
done
```
