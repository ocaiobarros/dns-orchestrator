# Health Engine

## Overview

The Health Engine performs continuous health monitoring of all DNS instances every 10 seconds.

## Check Types

### 1. Process Check (systemd)
```
systemctl is-active unboundXX
```
Verifies the Unbound service unit is active.

### 2. Port Check (ss)
```
ss -lunp | grep :53
```
Verifies port 53 is bound on the instance's bind IP.

### 3. Functional DNS Check (dig)
```
dig @<bind_ip> -p <port> google.com +short +time=2 +tries=1
```
Verifies the instance can resolve DNS queries. Measures latency.

### 4. Unbound Control Check (optional)
```
unbound-control -c <config> status
```
Non-fatal check for unbound-control accessibility.

## Health Classification (Quorum)

```
┌─────────────────────────────────────┐
│          All 3 critical OK?         │
│     systemd ✓  port ✓  dig ✓       │
│              ↓ YES                  │
│     dig latency > threshold?        │
│       ↓ NO          ↓ YES           │
│    HEALTHY        DEGRADED          │
└─────────────────────────────────────┘
          ↓ Any critical FAIL
        FAILED
```

## State Transitions

```
healthy ──[3 failures]──→ failed ──[withdraw]──→ withdrawn
    ↑                                                │
    └──────[3 successes + cooldown elapsed]───────────┘
```

## Configurable Thresholds

| Setting | Default | Description |
|---------|---------|-------------|
| DNS_HEALTH_DIG_TIMEOUT_MS | 2000 | dig command timeout |
| DNS_HEALTH_LATENCY_WARN_MS | 50 | Latency threshold for degraded |
| DNS_HEALTH_CONSECUTIVE_FAILURES | 3 | Failures before marking failed |
| DNS_HEALTH_CONSECUTIVE_SUCCESSES | 3 | Successes before marking healthy |
| DNS_HEALTH_COOLDOWN_SECONDS | 120 | Cooldown after recovery |

## Data Flow

1. `health_worker.py` runs every 10s
2. For each enabled instance, calls `run_health_checks_for_instance()`
3. Persists individual check results to `health_checks` table
4. Updates consolidated state in `instance_state` table
5. Emits events on state transitions
