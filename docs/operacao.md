# DNS Control — Operação

## Referência Rápida

| Ação | Comando |
|---|---|
| Status da API | `systemctl status dns-control-api` |
| Logs da API | `journalctl -u dns-control-api -f` |
| Reiniciar API | `systemctl restart dns-control-api` |
| Saúde da API | `curl http://127.0.0.1:8000/api/health` |
| Status do collector | `systemctl status dns-control-collector.timer` |
| Telemetria atual | `curl http://127.0.0.1:8000/api/telemetry/latest` |
| Banco de dados | `sqlite3 /var/lib/dns-control/dns-control.db` |
| Configuração | `/etc/dns-control/env` |

---

## Validação do Funcionamento

### Resolução DNS

```bash
# Testar pelo VIP de serviço
dig @45.160.10.1 google.com +short +time=2

# Testar diretamente em cada backend
dig @100.127.255.1 google.com +short +time=2
dig @100.127.255.2 google.com +short +time=2
dig @100.127.255.3 google.com +short +time=2
dig @100.127.255.4 google.com +short +time=2

# Testar VIP interceptado
dig @4.2.2.5 google.com +short +time=2
```

### Captura de Tráfego

```bash
# Capturar tráfego DNS na interface principal
tcpdump -i ens192 port 53 -nn -c 20

# Capturar no listener de um backend
tcpdump -i lo0 host 100.127.255.1 and port 53 -nn -c 20

# Verificar distribuição entre backends
tcpdump -i lo0 port 53 -nn -c 100 | grep -oP '100\.127\.255\.\d+' | sort | uniq -c
```

### Estado do Unbound

```bash
# Status das instâncias
for i in 01 02 03 04; do
  echo "=== unbound$i ==="
  systemctl is-active unbound$i
  sudo unbound-control -s 127.0.0.$((10+${i#0}))@8953 stats_noreset | grep -E 'total.num|cache'
done
```

### Balanceamento nftables

```bash
# Verificar regras ativas
sudo nft list ruleset | head -80

# Contadores por backend
sudo nft list counters

# Sets de afinidade (sticky)
sudo nft list sets
```

---

## Interpretação do Dashboard

### Painel de Métricas

| Métrica | Significado | Valor Normal |
|---|---|---|
| QPS | Consultas por segundo (total) | Varia com tráfego |
| Latência | Tempo médio de resolução recursiva | < 50ms |
| Cache Hit | Taxa de acerto de cache | > 70% |
| SERVFAIL | Falhas de resolução | < 1% do total |
| NXDOMAIN | Domínios inexistentes | Varia |

### Status das Instâncias

| Status | Cor | Significado |
|---|---|---|
| Saudável | 🟢 Verde | Processo OK, porta OK, dig OK |
| Degradado | 🟡 Amarelo | Funcionando mas com latência alta |
| Falho | 🔴 Vermelho | Falha em verificação crítica |
| Cooldown | 🟡 Amarelo | Recuperado, aguardando reintegração |

### Status do Collector

| Status | Significado |
|---|---|
| Collector ativo | Dados atualizados a cada 10s |
| Collector inativo | Sem dados — verificar timer do systemd |
| Dados obsoletos | Arquivo > 60s sem atualização |

---

## Procedimentos Operacionais

### Procedimento 1 — Instância Falha

**Sintomas**: Dashboard mostra instância como `failed`, evento `instance_failed` no log.

```bash
# Diagnóstico
sudo systemctl status unbound<NN>
sudo ss -lunp | grep :53
dig @<IP_INSTANCIA> google.com +short +time=2
sudo unbound-checkconf /etc/unbound/unbound<NN>.conf
journalctl -u unbound<NN> --since "10 minutes ago"

# Resolução
sudo unbound-checkconf /etc/unbound/unbound<NN>.conf
sudo systemctl restart unbound<NN>

# A instância será reintegrada automaticamente após:
# 3 verificações consecutivas bem-sucedidas + 120s de cooldown
```

### Procedimento 2 — Backend Removido da Rotação

**Sintomas**: Dashboard mostra `in_rotation = false`.

```bash
# Verificar estado do nftables
sudo nft list ruleset | grep dns_backends

# Verificar saúde via API
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Forçar reconciliação
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"
```

### Procedimento 3 — Falha Total de DNS

**Sintomas**: Todas as instâncias falhas, sem resolução no VIP.

```bash
# 1. Verificar todas as instâncias
for i in 01 02 03 04; do
  echo "=== unbound$i ==="
  sudo systemctl status unbound$i
  dig @100.127.255.$((${i#0})) google.com +short +time=1
done

# 2. Verificar recursos do sistema
free -h
df -h
top -bn1 | head -20

# 3. Verificar nftables
sudo nft list ruleset

# 4. Reiniciar todas as instâncias
for i in 01 02 03 04; do
  sudo systemctl restart unbound$i
done

# 5. Forçar reconciliação após 15s
sleep 15
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"
```

### Procedimento 4 — Reinicialização Segura

```bash
# 1. Verificar estado atual
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# 2. Reiniciar API (lock do scheduler é liberado automaticamente)
systemctl restart dns-control-api

# 3. Aguardar inicialização
sleep 5

# 4. Verificar
curl -s http://127.0.0.1:8000/api/health
systemctl status dns-control-api
```

### Procedimento 5 — Backup do Banco de Dados

```bash
# Backup manual
cp /var/lib/dns-control/dns-control.db \
   /var/lib/dns-control/backups/dns-control-$(date +%Y%m%d_%H%M%S).db

# Restauração
systemctl stop dns-control-api
cp /var/lib/dns-control/backups/<ARQUIVO_BACKUP> /var/lib/dns-control/dns-control.db
chown dns-control:dns-control /var/lib/dns-control/dns-control.db
chmod 600 /var/lib/dns-control/dns-control.db
systemctl start dns-control-api

# Limpeza de backups antigos (manter últimos 30 dias)
find /var/lib/dns-control/backups -name "*.db" -mtime +30 -delete
```

### Procedimento 6 — Reset de Senha do Admin

```bash
cd /opt/dns-control/backend
source venv/bin/activate
python app/scripts/create_admin.py admin NovaSenhaSegura123
```

---

## Localização de Logs

| Componente | Localização |
|---|---|
| API DNS Control | `journalctl -u dns-control-api` |
| Collector | `journalctl -u dns-control-collector` |
| Nginx (acesso) | `/var/log/nginx/dns-control-access.log` |
| Nginx (erros) | `/var/log/nginx/dns-control-error.log` |
| Unbound | `journalctl -u unbound<NN>` |
| FRR | `journalctl -u frr` |
| nftables | `journalctl -u nftables` |

---

## Comandos Úteis

```bash
# Estado de todas as instâncias
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Eventos recentes
curl -s "http://127.0.0.1:8000/api/events?limit=10" | python3 -m json.tool

# Telemetria completa
curl -s http://127.0.0.1:8000/api/telemetry/latest | python3 -m json.tool

# Histórico de séries temporais
curl -s http://127.0.0.1:8000/api/telemetry/history | python3 -m json.tool | head -50

# Consulta direta ao banco
sqlite3 /var/lib/dns-control/dns-control.db \
  "SELECT instance_name, current_status, in_rotation FROM instance_state JOIN dns_instances ON instance_state.instance_id = dns_instances.id;"

# Portas em uso
ss -lntup | grep -E ':80|:443|:8000|:53'
```
