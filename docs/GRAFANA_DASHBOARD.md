# DNS Control v2.1 — Grafana Dashboard Template

## Overview

This document describes the recommended Grafana dashboard layout for DNS Control v2.1.

**Data source**: Prometheus scraping `http://<dns-control-host>:8000/metrics`

---

## Dashboard: DNS Control Operations

### Row 1 — Health Overview

| Panel | Type | Query |
|-------|------|-------|
| Healthy Instances | Stat | `count(dns_instance_health == 1)` |
| Failed Instances | Stat (red) | `count(dns_instance_health == 0)` |
| Instances In Rotation | Stat | `count(dns_backend_in_rotation == 1)` |
| Instances In Cooldown | Stat (yellow) | `count(dns_instance_cooldown_seconds > 0)` |

### Row 2 — DNS Performance

| Panel | Type | Query |
|-------|------|-------|
| QPS per Instance | Time series | `dns_qps` |
| Total QPS | Stat | `sum(dns_qps)` |
| Cache Hit Ratio | Gauge (0-1) | `dns_cache_hit_ratio` |
| Average Latency | Time series | `dns_latency_ms` |

### Row 3 — DNS Errors

| Panel | Type | Query |
|-------|------|-------|
| SERVFAIL Rate | Time series | `rate(dns_servfail_total[5m])` |
| NXDOMAIN Rate | Time series | `rate(dns_nxdomain_total[5m])` |
| Error Ratio | Gauge | `dns_servfail_total / dns_queries_total` |

### Row 4 — Infrastructure

| Panel | Type | Query |
|-------|------|-------|
| Backend Rotation Status | Table | `dns_backend_in_rotation` |
| Health Check Failures | Time series | `dns_healthcheck_failures` |
| Consecutive Failures | Table | `dns_instance_consecutive_failures` |
| Cooldown Timers | Table | `dns_instance_cooldown_seconds` |

### Row 5 — Operational Events

| Panel | Type | Query |
|-------|------|-------|
| Total Events | Stat | `dns_events_total` |
| Critical Events | Stat (red) | `dns_events_total{severity="critical"}` |
| Reconciliation Actions | Counter | `dns_reconciliation_actions_total` |

---

## Prometheus Scrape Configuration

Add to `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'dns-control'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['172.250.40.100:8000']
        labels:
          environment: 'production'
          node: 'dns-node-01'
```

---

## Grafana Provisioning

### Data Source

```yaml
# /etc/grafana/provisioning/datasources/dns-control.yml
apiVersion: 1
datasources:
  - name: DNS Control Prometheus
    type: prometheus
    access: proxy
    url: http://localhost:9090
    isDefault: false
    editable: true
```

---

## Dashboard JSON Import

To create the dashboard manually in Grafana:

1. Go to **Dashboards → New → Import**
2. Create panels using the queries above
3. Set refresh interval to **15s**
4. Set time range to **Last 1 hour**

### Recommended Variables

| Variable | Query | Description |
|----------|-------|-------------|
| `$instance` | `label_values(dns_instance_health, instance)` | Filter by instance |
| `$node` | `label_values(dns_instance_health, node)` | Filter by node |

---

## Panel Alert Annotations

Enable annotations from Prometheus alerts to overlay alert events on dashboard panels:

```
Annotations → Add → Prometheus alerts
Filter: DNSInstanceDown, DNSLatencyHigh, DNSCacheHitLow
```
