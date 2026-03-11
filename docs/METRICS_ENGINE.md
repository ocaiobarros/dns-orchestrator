# Metrics Engine

## Overview

The Metrics Engine collects DNS performance data from Unbound instances every 30 seconds.

## Data Source

```
unbound-control -c /etc/unbound/unbound.conf.d/<instance>.conf stats_noreset
```

## Collected Metrics

| Unbound Stat | Metric Name | Type |
|-------------|-------------|------|
| total.num.queries | dns_queries_total | counter |
| total.num.cachehits | dns_cache_hits | counter |
| total.num.cachemiss | dns_cache_misses | counter |
| total.recursion.time.avg | dns_recursion_avg_sec | gauge |
| num.answer.rcode.SERVFAIL | dns_servfail_total | counter |
| num.answer.rcode.NXDOMAIN | dns_nxdomain_total | counter |
| num.answer.rcode.NOERROR | dns_noerror_total | counter |
| total.num.queries_ip_ratelimited | dns_ratelimited_total | counter |
| mem.cache.rrset | dns_cache_rrset_bytes | gauge |
| mem.cache.message | dns_cache_msg_bytes | gauge |

## Derived Metrics

| Metric | Formula |
|--------|---------|
| dns_cache_hit_ratio | cachehits / total_queries |
| dns_latency_ms | recursion_avg_sec × 1000 |

## Prometheus Export

`GET /metrics` exposes all metrics in Prometheus text format including:
- Per-instance health, rotation, failures, cooldown
- Per-instance DNS metrics
- Global counters (active/failed instances, event totals, action totals)

## Pipeline

```
unbound-control stats_noreset
        ↓
  metrics_worker.py (every 30s)
        ↓
  metrics_samples table (time-series)
        ↓
  ┌─────────────────┬──────────────┐
  │ /api/metrics/dns │ GET /metrics │
  │  (JSON for UI)   │ (Prometheus) │
  └─────────────────┴──────────────┘
```
