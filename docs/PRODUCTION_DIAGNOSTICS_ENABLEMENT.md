# Production Diagnostics Enablement

## Prerequisites

- DNS Control backend running as a dedicated service user (e.g., `dns-control`)
- `sudo` installed on the system
- Root access to configure sudoers

## Step 1: Identify the service user

```bash
# Check which user the backend runs as
ps aux | grep uvicorn | grep -v grep
# Or check the systemd unit
grep "^User=" /etc/systemd/system/dns-control-api.service
```

## Step 2: Install the sudoers policy

```bash
# Copy the sudoers file
sudo cp /opt/dns-control/deploy/sudoers/dns-control-diagnostics \
        /etc/sudoers.d/dns-control-diagnostics

# Edit to match your actual service user (replace dns-control if different)
sudo nano /etc/sudoers.d/dns-control-diagnostics

# Set correct permissions (MUST be 0440)
sudo chmod 0440 /etc/sudoers.d/dns-control-diagnostics

# Validate syntax — CRITICAL, broken sudoers can lock you out
sudo visudo -cf /etc/sudoers.d/dns-control-diagnostics
# Expected output: "/etc/sudoers.d/dns-control-diagnostics: parsed OK"
```

## Step 3: Test manually

```bash
# Switch to the service user
sudo -u dns-control bash

# Test sudo access (should succeed silently)
sudo -n true && echo "sudo OK" || echo "sudo FAILED"

# Test individual commands
sudo -n unbound-control stats_noreset
sudo -n nft list tables
sudo -n vtysh -c "show ip ospf neighbor"
sudo -n journalctl --no-pager -n 5
```

## Step 4: Restart the backend

```bash
sudo systemctl restart dns-control-api
```

## Step 5: Verify via API

```bash
# Check privilege status
curl -s http://127.0.0.1:8000/api/troubleshooting/privilege-status \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Expected:
# {
#   "backend_running_as_user": "dns-control",
#   "backend_groups": ["dns-control", ...],
#   "privilege_wrapper_available": true,
#   "privileged_commands_enabled": true
# }

# Run full health check
curl -s http://127.0.0.1:8000/api/troubleshooting/health-check \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

## Step 6: Verify in UI

1. Open Troubleshooting page
2. Click "Health Check Completo"
3. Verify green banner: "Diagnósticos privilegiados habilitados"
4. Verify unbound-control, nft, vtysh, journalctl checks show "OK"

## Rollback

```bash
# Remove the sudoers policy
sudo rm /etc/sudoers.d/dns-control-diagnostics

# Restart backend (it will gracefully degrade to unprivileged mode)
sudo systemctl restart dns-control-api
```

## Security Audit Checklist

- [ ] sudoers file has 0440 permissions
- [ ] sudoers file passes `visudo -cf` validation
- [ ] Only read-only diagnostic commands are allowed
- [ ] No `systemctl restart/stop/start` in sudoers
- [ ] No wildcard `ALL=(ALL) NOPASSWD: ALL`
- [ ] Service user cannot escalate beyond the allowlist
- [ ] `shell=False` enforced in command_runner.py
- [ ] Arguments sanitized (no shell metacharacters)

## Troubleshooting

### sudo still fails after configuration
```bash
# Check if the service user matches
id dns-control

# Check sudoers syntax
sudo visudo -cf /etc/sudoers.d/dns-control-diagnostics

# Check if another sudoers file overrides
sudo grep -r dns-control /etc/sudoers.d/
```

### unbound-control still fails
```bash
# Check socket permissions
ls -la /run/unbound.ctl
# May also need: usermod -aG unbound dns-control
```

### vtysh still fails
```bash
# Check FRR config permissions
ls -la /etc/frr/vtysh.conf
# May also need: usermod -aG frrvty dns-control
```
