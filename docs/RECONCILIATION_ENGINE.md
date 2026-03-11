# Reconciliation Engine

## Overview

The Reconciliation Engine maintains DNS availability by automatically managing nftables DNAT backend rotation based on instance health state.

## Decision Flow

```
┌──────────────────────────────┐
│  reconciliation_worker (10s)  │
└──────────────┬───────────────┘
               ↓
    ┌──────────────────────┐
    │ For each DNS instance │
    └──────────┬───────────┘
               ↓
    ┌──────────────────────────────┐
    │ status=failed AND in_rotation │──→ REMOVE from DNAT
    └──────────────────────────────┘
               ↓
    ┌──────────────────────────────────────────┐
    │ status=healthy AND NOT in_rotation        │
    │ AND now >= cooldown_until                 │──→ RESTORE to DNAT
    └──────────────────────────────────────────┘
```

## Anti-Flap Cooldown

When an instance transitions from `failed` → `healthy`, the Health Engine sets:

```
cooldown_until = now + DNS_HEALTH_COOLDOWN_SECONDS (default: 120s)
```

The Reconciliation Engine will NOT restore the backend until `now >= cooldown_until`.

This prevents rapid oscillation (flapping) when an unstable DNS process keeps cycling between up and down states.

## DNAT Commands

### Remove backend
```
nft delete element ip nat dns_backends { <bind_ip> }
```

### Restore backend
```
nft add element ip nat dns_backends { <bind_ip> }
```

## Manual Override

### Remove
```
POST /api/actions/remove-backend/{instance_id}
```

### Restore
```
POST /api/actions/restore-backend/{instance_id}
```

### Force reconcile
```
POST /api/actions/reconcile-now
```
Runs health checks + reconciliation immediately. Returns:
```json
{
  "instances_checked": 4,
  "instances_failed": 1,
  "backends_removed": 1,
  "backends_restored": 0
}
```

## Safety Rules

1. Only manipulates DNAT rules — does NOT remove VIP
2. Does NOT modify OSPF routes
3. All actions logged to `actions` table with structured details
4. All state transitions logged to `events` table
5. File-lock protects against duplicate scheduler instances

## Event Types

| Event | Severity | Trigger |
|-------|----------|---------|
| backend_removed_from_dnat | warning | Reconciliation or manual |
| backend_restored_to_dnat | info | Reconciliation or manual |
| instance_failed | critical | Health engine |
| instance_recovered | warning | Health engine |
| instance_degraded | warning | Health engine |
