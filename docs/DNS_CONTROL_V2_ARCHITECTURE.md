# DNS Control v2.1 Architecture

## Overview

DNS Control v2.1 (Carrier Edition) is a DNS operations control plane for carrier-grade recursive DNS infrastructure.
It transforms a configuration panel into a resilient, observable, and self-healing platform.

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│  Dashboard · Events · Metrics · Instances        │
├─────────────────────────────────────────────────┤
│                  FastAPI Backend                 │
│  REST API · Auth · Sessions · CORS               │
├──────────┬──────────┬──────────┬────────────────┤
│  Health  │ Metrics  │ Decision │  Prometheus     │
│  Engine  │ Engine   │ Engine   │  Exporter       │
├──────────┴──────────┴──────────┴────────────────┤
│              APScheduler (file-lock)             │
│  health_worker(10s) metrics(30s) reconcile(10s)  │
├─────────────────────────────────────────────────┤
│         SQLite (operational + config)            │
│  dns_instances · health_checks · instance_state  │
│  metrics_samples · events · actions              │
├─────────────────────────────────────────────────┤
│        Whitelist Command Executor                │
│  systemctl · nft · dig · ss · unbound-control    │
└─────────────────────────────────────────────────┘
```

## v2.1 Stability Improvements

### 1. Anti-Flap Cooldown
When an instance recovers (failed → healthy), it enters a configurable cooldown period (default 120s) before being restored to DNAT rotation. This prevents oscillation from unstable DNS processes.

### 2. Quorum Health Check
Health decisions use multiple signals (systemd, port, dig) instead of a single check. Classification:
- **Healthy**: process OK + port bound + dig OK
- **Degraded**: process OK + port OK + dig latency > threshold
- **Failed**: dig timeout OR process inactive OR port not listening

### 3. Configurable Thresholds
All health engine parameters are stored in the `settings` table:
- `DNS_HEALTH_DIG_TIMEOUT_MS` (default: 2000)
- `DNS_HEALTH_LATENCY_WARN_MS` (default: 50)
- `DNS_HEALTH_CONSECUTIVE_FAILURES` (default: 3)
- `DNS_HEALTH_CONSECUTIVE_SUCCESSES` (default: 3)
- `DNS_HEALTH_COOLDOWN_SECONDS` (default: 120)

### 4. Worker Safety
APScheduler uses a file lock (`/tmp/dns-control-scheduler.lock`) to prevent duplicate workers in multi-process deployments.

### 5. Manual Reconciliation
`POST /api/actions/reconcile-now` runs health checks + reconciliation immediately and returns a summary.

### 6. Structured Event Logging
All automated actions produce structured events with severity classification (info, warning, critical) and JSON details including action source, reason, and context.

## NOT Implemented (v3 scope)
- Automatic VIP removal
- OSPF route withdrawal
- Multi-node cluster coordination
- Cross-node health decisions
