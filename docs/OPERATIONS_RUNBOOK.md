# DNS Control v2.1 — Operations Runbook

## Quick Reference

| Service | Command |
|---------|---------|
| API status | `systemctl status dns-control-api` |
| API logs | `journalctl -u dns-control-api -f` |
| API restart | `systemctl restart dns-control-api` |
| Health check | `curl http://127.0.0.1:8000/api/health` |
| Prometheus | `curl http://127.0.0.1:8000/metrics` |
| Database | `sqlite3 /var/lib/dns-control/dns-control.db` |
| Config | `/etc/dns-control/env` |

---

## Procedure 1 — Instance Failure

### Symptoms

- Dashboard shows instance as `failed`
- Alert `DNSInstanceDown` fired
- Event `instance_failed` in event log

### Diagnosis

```bash
# Check instance service
sudo systemctl status unbound<NN>

# Check port binding
sudo ss -lunp | grep :53

# Test DNS resolution
dig @<INSTANCE_IP> google.com +short +time=2

# Check unbound config
sudo unbound-checkconf /etc/unbound/unbound<NN>.conf

# Check logs
journalctl -u unbound<NN> --since "10 minutes ago"
```

### Resolution

```bash
# If config error, fix and restart
sudo unbound-checkconf /etc/unbound/unbound<NN>.conf
sudo systemctl restart unbound<NN>

# Verify recovery via API
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Instance will auto-recover after 3 successful checks + 120s cooldown
```

---

## Procedure 2 — Backend Removed from Rotation

### Symptoms

- Dashboard shows `in_rotation = false`
- Event `backend_removed_from_dnat`
- Alert `DNSBackendOutOfRotation`

### Diagnosis

```bash
# Verify nftables state
sudo nft list ruleset | grep dns_backends

# Check which backends are active
sudo nft list set ip nat dns_backends

# Check instance health
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool
```

### Manual Restoration (if needed)

```bash
# Via API
curl -X POST http://127.0.0.1:8000/api/actions/restore-backend/<INSTANCE_ID> \
  -H "Authorization: Bearer <TOKEN>"

# Or via manual reconciliation
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Procedure 3 — Instance Recovery and Cooldown

### Symptoms

- Instance shows `healthy` but `in_rotation = false`
- Cooldown timer active

### Expected Behavior

1. Instance recovers → 3 consecutive health checks pass
2. Status changes to `healthy`
3. Cooldown starts (120 seconds default)
4. After cooldown → backend restored to DNAT

### If Cooldown Seems Stuck

```bash
# Check cooldown_until
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Force reconciliation
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Procedure 4 — Reconciliation Troubleshooting

### Symptoms

- Instance healthy but not being restored
- Backend removed but instance is actually working

### Diagnosis

```bash
# Check scheduler is running
journalctl -u dns-control-api | grep "Scheduler"

# Check lock file
ls -la /tmp/dns-control-scheduler.lock
cat /tmp/dns-control-scheduler.lock

# Check reconciliation logs
journalctl -u dns-control-api | grep "reconciliation"
```

### Resolution

```bash
# If scheduler stuck, restart API
systemctl restart dns-control-api

# If lock file stale, remove and restart
rm -f /tmp/dns-control-scheduler.lock
systemctl restart dns-control-api
```

---

## Procedure 5 — Metrics Validation

### Symptoms

- Dashboard shows no metrics
- Prometheus scrape failing

### Diagnosis

```bash
# Check metrics endpoint
curl -s http://127.0.0.1:8000/metrics | head -20

# Check unbound-control access
sudo unbound-control stats_noreset

# Check metrics worker logs
journalctl -u dns-control-api | grep "metrics"
```

### Resolution

```bash
# If unbound-control fails, check permissions
ls -la /etc/unbound/unbound_control.*
sudo unbound-control status

# If metrics endpoint empty, restart API
systemctl restart dns-control-api
```

---

## Procedure 6 — Service Restart

### Safe Restart Procedure

```bash
# 1. Check current state
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# 2. Restart API (scheduler lock auto-releases)
systemctl restart dns-control-api

# 3. Wait for startup
sleep 5

# 4. Verify
curl -s http://127.0.0.1:8000/api/health
systemctl status dns-control-api
```

### Full Stack Restart

```bash
systemctl restart dns-control-api
systemctl restart nginx
# Only if needed:
# systemctl restart unbound*
# systemctl restart frr
# systemctl restart nftables
```

---

## Procedure 7 — Database Backup

### Manual Backup

```bash
# Stop writes (optional, SQLite handles concurrent reads)
cp /var/lib/dns-control/dns-control.db \
   /var/lib/dns-control/backups/dns-control-$(date +%Y%m%d_%H%M%S).db
```

### Automated Backup (cron)

```bash
# Add to /etc/cron.d/dns-control-backup
0 */6 * * * dns-control cp /var/lib/dns-control/dns-control.db /var/lib/dns-control/backups/dns-control-$(date +\%Y\%m\%d_\%H\%M\%S).db
```

### Restore

```bash
systemctl stop dns-control-api
cp /var/lib/dns-control/backups/<BACKUP_FILE> /var/lib/dns-control/dns-control.db
chown dns-control:dns-control /var/lib/dns-control/dns-control.db
chmod 600 /var/lib/dns-control/dns-control.db
systemctl start dns-control-api
```

### Cleanup Old Backups

```bash
# Keep last 30 days
find /var/lib/dns-control/backups -name "*.db" -mtime +30 -delete
```

---

## Procedure 8 — Total DNS Failure

### Symptoms

- All instances show `failed`
- Alert `DNSAllInstancesDown`
- No DNS resolution on VIP

### Emergency Response

```bash
# 1. Check all Unbound instances
for i in 01 02 03 04; do
  echo "=== unbound$i ==="
  sudo systemctl status unbound$i
  dig @<IP_$i> google.com +short +time=1
done

# 2. Check system resources
free -h
df -h
top -bn1 | head -20

# 3. Check nftables
sudo nft list ruleset

# 4. Restart all instances
for i in 01 02 03 04; do
  sudo systemctl restart unbound$i
done

# 5. Force reconciliation
sleep 15
curl -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>"
```

---

## Log Locations

| Component | Location |
|-----------|----------|
| DNS Control API | `journalctl -u dns-control-api` |
| Nginx access | `/var/log/nginx/dns-control-access.log` |
| Nginx error | `/var/log/nginx/dns-control-error.log` |
| Unbound | `journalctl -u unbound<NN>` |
| FRR | `journalctl -u frr` |
| nftables | `journalctl -u nftables` |

---

## Useful Commands

```bash
# All instance states at a glance
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Recent events
curl -s "http://127.0.0.1:8000/api/events?limit=10" | python3 -m json.tool

# Recent actions
curl -s http://127.0.0.1:8000/api/actions | python3 -m json.tool

# Prometheus metrics
curl -s http://127.0.0.1:8000/metrics | grep -v "^#"

# Database query
sqlite3 /var/lib/dns-control/dns-control.db "SELECT instance_name, current_status, in_rotation FROM instance_state JOIN dns_instances ON instance_state.instance_id = dns_instances.id;"
```
