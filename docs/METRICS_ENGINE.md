# Metrics Engine

## Overview

The Metrics Engine collects DNS performance data from multiple sources and exposes it via a unified telemetry API.

## Architecture

```
┌──────────────────────────────────────────────────┐
│          collector.py (systemd timer, 10s)        │
│                                                    │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ unbound-     │  │ nftables │  │ query logs   │ │
│  │ control      │  │ counters │  │ (journalctl) │ │
│  │ stats_noreset│  │ nft list │  │              │ │
│  └──────┬───────┘  └────┬─────┘  └──────┬───────┘ │
│         └───────┬───────┴───────────────┘         │
│                 ▼                                   │
│      /var/lib/dns-control/telemetry/latest.json    │
└──────────────────────────────────────────────────┘
                  ▼
        GET /api/telemetry/latest
                  ▼
    ┌─────────────────────────────┐
    │  Frontend (React Dashboard) │
    │  - SimpleDashboard          │
    │  - MetricsPage              │
    │  - DnsPage                  │
    └─────────────────────────────┘
```

## Data Sources

### Source A: Unbound Metrics (PRIMARY for resolver stats)
```
sudo unbound-control -s <ctrl_ip>@<port> -c /etc/unbound/<instance>.conf stats_noreset
```

| Unbound Stat | Metric Name | Type |
|---|---|---|
| total.num.queries | total_queries | counter |
| total.num.cachehits | cache_hits | counter |
| total.num.cachemiss | cache_misses | counter |
| total.recursion.time.avg | recursion_avg_ms | gauge |
| num.answer.rcode.SERVFAIL | servfail | counter |
| num.answer.rcode.NXDOMAIN | nxdomain | counter |
| num.answer.rcode.NOERROR | noerror | counter |
| msg.cache.count | msg_cache_count | gauge |
| rrset.cache.count | rrset_cache_count | gauge |
| mem.cache.message | mem_cache_msg | gauge |
| mem.cache.rrset | mem_cache_rrset | gauge |
| time.up | uptime_seconds | gauge |

### Source B: nftables Counters (PRIMARY for traffic distribution)
```
sudo nft list ruleset
```
Extracts: packets, bytes, per-backend distribution, share percentages.

### Source C: Query Logs (for top domains/clients)
```
journalctl -u unbound01 -u unbound02 --grep "query:"
```
Extracts: domain, client IP, query type, timestamp.

## Derived Metrics

| Metric | Formula |
|---|---|
| cache_hit_ratio | cache_hits / (cache_hits + cache_misses) × 100 |
| qps | Δ(total_queries) / Δ(time) |
| nft_qps | Δ(total_packets) / Δ(time) |
| backend_share | backend_packets / total_packets × 100 |

## Collector Service

- Script: `/opt/dns-control/collector/collector.py`
- Timer: `dns-control-collector.timer` (10s interval)
- Output: `/var/lib/dns-control/telemetry/latest.json`
- Modes: `recursive_simple` / `recursive_interception` (auto-detected)

### Enable
```bash
systemctl enable --now dns-control-collector.timer
```

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/telemetry/latest` | Full collector snapshot |
| `GET /api/telemetry/status` | Collector health check |
| `GET /api/telemetry/simple` | Simple mode data |
| `GET /api/telemetry/interception` | Interception mode data |

## Telemetry Integrity

- **Zero values are never shown** when the collector is inactive
- Frontend displays "Collector inativo" or "Telemetria indisponível"
- Each metric shows its data source (unbound-control / nftables / query log)
- Collector staleness is detected (>60s since last update)
- Dashboard shows: last collection timestamp, duration, source status

## Prometheus Export

`GET /metrics` exposes all metrics in Prometheus text format (unchanged).
