# DNS Control v2.1 — Prometheus Alert Rules

## Overview

Alert rules for monitoring DNS Control infrastructure.

Save as `/etc/prometheus/rules/dns-control.yml`.

---

## Alert Rules

```yaml
groups:
  - name: dns_control_health
    rules:

      # ---- Health Alerts ----

      - alert: DNSInstanceDown
        expr: dns_instance_health == 0
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "DNS instance {{ $labels.instance }} is down"
          description: "Instance {{ $labels.instance }} has been unhealthy for 30 seconds. Health engine has marked it as failed."
          runbook: "docs/OPERATIONS_RUNBOOK.md#instance-failure"

      - alert: DNSAllInstancesDown
        expr: count(dns_instance_health == 1) == 0
        for: 10s
        labels:
          severity: critical
        annotations:
          summary: "All DNS instances are down"
          description: "No healthy DNS instances detected. DNS resolution is completely unavailable."
          runbook: "docs/OPERATIONS_RUNBOOK.md#total-failure"

      - alert: DNSInstanceInCooldown
        expr: dns_instance_cooldown_seconds > 0
        for: 0s
        labels:
          severity: info
        annotations:
          summary: "DNS instance {{ $labels.instance }} is in cooldown"
          description: "Instance recovered but is waiting {{ $value }}s before re-entering rotation."

      # ---- Performance Alerts ----

      - alert: DNSLatencyHigh
        expr: dns_latency_ms > 50
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "High DNS latency on {{ $labels.instance }}"
          description: "DNS resolution latency is {{ $value }}ms (threshold: 50ms)."
          runbook: "docs/OPERATIONS_RUNBOOK.md#high-latency"

      - alert: DNSLatencyCritical
        expr: dns_latency_ms > 200
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Critical DNS latency on {{ $labels.instance }}"
          description: "DNS resolution latency is {{ $value }}ms. Service is severely degraded."

      - alert: DNSCacheHitLow
        expr: dns_cache_hit_ratio < 0.6
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low DNS cache hit ratio on {{ $labels.instance }}"
          description: "Cache hit ratio is {{ $value }} (threshold: 0.6). Check upstream connectivity or TTL configuration."
          runbook: "docs/OPERATIONS_RUNBOOK.md#low-cache-hit"

      # ---- Error Alerts ----

      - alert: DNSServfailHigh
        expr: rate(dns_servfail_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High SERVFAIL rate on {{ $labels.instance }}"
          description: "SERVFAIL rate is {{ $value }}/s. Check upstream resolvers and network connectivity."

      # ---- Infrastructure Alerts ----

      - alert: DNSBackendOutOfRotation
        expr: dns_backend_in_rotation == 0
        for: 30s
        labels:
          severity: warning
        annotations:
          summary: "DNS backend {{ $labels.instance }} removed from rotation"
          description: "Instance is no longer in DNAT rotation. Reconciliation engine has withdrawn it."

      - alert: DNSHighConsecutiveFailures
        expr: dns_instance_consecutive_failures >= 3
        for: 0s
        labels:
          severity: critical
        annotations:
          summary: "DNS instance {{ $labels.instance }} has {{ $value }} consecutive failures"
          description: "Health checks are consistently failing. Automatic backend removal triggered."

      # ---- Scheduler Alerts ----

      - alert: DNSSchedulerDown
        expr: up{job="dns-control"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "DNS Control API is unreachable"
          description: "Prometheus cannot scrape DNS Control metrics. The API may be down."
```

---

## Prometheus Configuration

Add to `/etc/prometheus/prometheus.yml`:

```yaml
rule_files:
  - "rules/dns-control.yml"

scrape_configs:
  - job_name: 'dns-control'
    scrape_interval: 15s
    metrics_path: '/metrics'
    static_configs:
      - targets: ['172.250.40.100:8000']
```

---

## Alertmanager Integration

Example alertmanager route for DNS Control alerts:

```yaml
# /etc/alertmanager/alertmanager.yml
route:
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'dns-critical'
      repeat_interval: 5m
    - match:
        severity: warning
      receiver: 'dns-warning'
      repeat_interval: 15m

receivers:
  - name: 'dns-critical'
    webhook_configs:
      - url: 'http://your-webhook/critical'
    # Or email:
    # email_configs:
    #   - to: 'noc@example.com'

  - name: 'dns-warning'
    webhook_configs:
      - url: 'http://your-webhook/warning'
```

---

## Testing Alerts

```bash
# Verify rules syntax
promtool check rules /etc/prometheus/rules/dns-control.yml

# Simulate instance failure
sudo systemctl stop unbound03
# Wait 30s, check Alertmanager UI for DNSInstanceDown
```
