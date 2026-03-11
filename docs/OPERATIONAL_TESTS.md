# DNS Control v2.1 — Operational Test Suite

## Overview

Step-by-step procedures to validate DNS Control v2.1 in production.
Run these tests after deployment and after any major upgrade.

---

## Test 1 — Instance Failure Detection

**Objective**: Verify the Health Engine detects a stopped Unbound instance and triggers backend removal.

### Procedure

```bash
# 1. Stop one instance
sudo systemctl stop unbound03

# 2. Wait 30 seconds (3 health cycles × 10s)
sleep 30
```

### Expected Results

| Check | Expected |
|-------|----------|
| Health Engine | Instance marked `failed` |
| Event created | `instance_failed`, severity `critical` |
| DNAT | Backend IP removed from nftables |
| Prometheus | `dns_instance_health{instance="unbound03"} 0` |

### Verification Commands

```bash
# API: instance health
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# nftables: confirm backend removed
sudo nft list ruleset | grep dns_backends

# Prometheus: instance health metric
curl -s http://127.0.0.1:8000/metrics | grep dns_instance_health

# Events: confirm event logged
curl -s http://127.0.0.1:8000/api/events?event_type=instance_failed | python3 -m json.tool
```

---

## Test 2 — Instance Recovery (Cooldown Active)

**Objective**: Verify recovered instance enters cooldown and is NOT immediately restored.

### Procedure

```bash
# 1. Restart the stopped instance
sudo systemctl start unbound03

# 2. Wait 30 seconds (3 health cycles)
sleep 30
```

### Expected Results

| Check | Expected |
|-------|----------|
| Health Engine | Instance marked `healthy` |
| Cooldown | `cooldown_until` set to now + 120s |
| DNAT | Backend NOT yet restored |
| Prometheus | `dns_instance_cooldown_seconds > 0` |

### Verification Commands

```bash
# API: check cooldown status
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# Prometheus: cooldown metric
curl -s http://127.0.0.1:8000/metrics | grep dns_instance_cooldown
```

---

## Test 3 — Cooldown Expiry and Backend Restoration

**Objective**: Verify backend is restored to DNAT after cooldown expires.

### Procedure

```bash
# Wait for cooldown to expire (default 120s from recovery)
sleep 120
```

### Expected Results

| Check | Expected |
|-------|----------|
| DNAT | Backend IP restored to nftables set |
| Event | `backend_restored_to_dnat`, severity `info` |
| State | `in_rotation = true` |
| Prometheus | `dns_backend_in_rotation{instance="unbound03"} 1` |

### Verification Commands

```bash
# nftables: confirm backend restored
sudo nft list ruleset | grep dns_backends

# Events
curl -s http://127.0.0.1:8000/api/events?event_type=backend_restored_to_dnat | python3 -m json.tool

# Full instance state
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool
```

---

## Test 4 — Manual Reconciliation

**Objective**: Verify on-demand reconciliation via API.

### Procedure

```bash
# Trigger manual reconciliation (requires authentication)
curl -s -X POST http://127.0.0.1:8000/api/actions/reconcile-now \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" | python3 -m json.tool
```

### Expected Response

```json
{
  "instances_checked": 4,
  "instances_failed": 0,
  "backends_removed": 0,
  "backends_restored": 0
}
```

### Verification

- All instances re-checked
- Any pending state transitions executed
- Event `manual_reconciliation` logged

---

## Test 5 — Metrics Collection Verification

**Objective**: Verify Unbound metrics are collected and exposed.

### Procedure

```bash
# 1. Verify Unbound stats source
sudo unbound-control stats_noreset

# 2. Check Prometheus endpoint
curl -s http://127.0.0.1:8000/metrics | grep dns_

# 3. Check API metrics endpoint
curl -s http://127.0.0.1:8000/api/metrics/dns | python3 -m json.tool
```

### Expected Metrics

| Metric | Description |
|--------|-------------|
| `dns_qps` | Queries per second |
| `dns_cache_hit_ratio` | Cache hit ratio (0-1) |
| `dns_latency_ms` | Average resolution latency |
| `dns_servfail_total` | Total SERVFAIL responses |
| `dns_nxdomain_total` | Total NXDOMAIN responses |

---

## Test 6 — Full Cycle (End-to-End)

**Objective**: Validate the complete failure → detection → removal → recovery → cooldown → restoration cycle.

### Procedure

```bash
# 1. Confirm all instances healthy
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# 2. Stop instance
sudo systemctl stop unbound02

# 3. Wait for detection (30s)
sleep 30

# 4. Verify failure detected and backend removed
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool
sudo nft list ruleset | grep dns_backends

# 5. Restart instance
sudo systemctl start unbound02

# 6. Wait for recovery detection (30s)
sleep 30

# 7. Verify cooldown active, backend NOT restored
curl -s http://127.0.0.1:8000/api/health/instances | python3 -m json.tool

# 8. Wait for cooldown (120s)
sleep 120

# 9. Verify backend restored
sudo nft list ruleset | grep dns_backends
curl -s http://127.0.0.1:8000/api/events | python3 -m json.tool
```

### Expected Event Sequence

1. `instance_failed` (critical)
2. `backend_removed_from_dnat` (warning)
3. `instance_recovered` (warning)
4. `backend_restored_to_dnat` (info)

---

## Test 7 — API Authentication

**Objective**: Verify all API endpoints require authentication.

```bash
# Should return 401
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/api/health/instances

# Should return 200 with valid token
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer <TOKEN>" \
  http://127.0.0.1:8000/api/health/instances
```

---

## Test 8 — Scheduler Singleton Protection

**Objective**: Verify only one scheduler runs across multiple workers.

```bash
# Check lock file
ls -la /tmp/dns-control-scheduler.lock

# Check process
cat /tmp/dns-control-scheduler.lock

# Verify logs show lock acquisition
journalctl -u dns-control-api | grep "Scheduler lock"
```

---

## Checklist Summary

| # | Test | Status |
|---|------|--------|
| 1 | Instance Failure Detection | ☐ |
| 2 | Instance Recovery (Cooldown) | ☐ |
| 3 | Cooldown Expiry | ☐ |
| 4 | Manual Reconciliation | ☐ |
| 5 | Metrics Verification | ☐ |
| 6 | Full End-to-End Cycle | ☐ |
| 7 | API Authentication | ☐ |
| 8 | Scheduler Singleton | ☐ |
