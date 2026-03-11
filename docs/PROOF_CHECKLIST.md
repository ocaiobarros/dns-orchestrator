# DNS Control v2.1 — Production Readiness Checklist

## Deployment Verification

| # | Item | Command | Expected | ☐ |
|---|------|---------|----------|---|
| 1 | API running | `systemctl status dns-control-api` | active (running) | ☐ |
| 2 | API health | `curl http://127.0.0.1:8000/api/health` | 200 OK | ☐ |
| 3 | Frontend | `curl -o /dev/null -w "%{http_code}" http://172.250.40.100` | 200 | ☐ |
| 4 | Nginx | `systemctl status nginx` | active | ☐ |
| 5 | Prometheus | `curl http://127.0.0.1:8000/metrics \| head` | metrics output | ☐ |
| 6 | Login | Browser → admin login | success | ☐ |
| 7 | Password change | First login forces change | prompted | ☐ |
| 8 | Scheduler lock | `ls /tmp/dns-control-scheduler.lock` | exists | ☐ |
| 9 | Workers running | `journalctl -u dns-control-api \| grep Scheduler` | started | ☐ |
| 10 | TLS | `curl -I https://dns-control.domain` | 200 + HSTS | ☐ |

## Health Engine Verification

| # | Test | Expected | ☐ |
|---|------|----------|---|
| 1 | Stop instance | status → failed in 30s | ☐ |
| 2 | Backend removed | nft list shows removal | ☐ |
| 3 | Event logged | `instance_failed` critical | ☐ |
| 4 | Start instance | status → healthy in 30s | ☐ |
| 5 | Cooldown active | 120s before restoration | ☐ |
| 6 | Backend restored | nft list shows restoration | ☐ |
| 7 | Manual reconcile | POST returns summary | ☐ |

## Metrics Verification

| # | Metric | Source | ☐ |
|---|--------|--------|---|
| 1 | dns_qps | /metrics | ☐ |
| 2 | dns_cache_hit_ratio | /metrics | ☐ |
| 3 | dns_latency_ms | /metrics | ☐ |
| 4 | dns_instance_health | /metrics | ☐ |
| 5 | dns_backend_in_rotation | /metrics | ☐ |
| 6 | Dashboard renders | Browser | ☐ |

## Security

| # | Item | ☐ |
|---|------|---|
| 1 | API requires auth (401 without token) | ☐ |
| 2 | /etc/dns-control/env chmod 600 | ☐ |
| 3 | DB file chmod 600 | ☐ |
| 4 | Sudoers restricted | ☐ |
| 5 | Nginx security headers | ☐ |
| 6 | /metrics restricted by IP | ☐ |
