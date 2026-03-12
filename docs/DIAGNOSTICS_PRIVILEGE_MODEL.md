# Diagnostics Privilege Model

## Overview

DNS Control diagnostics execute system commands to collect operational status.
Some commands require elevated privileges (root or specific group membership).

The system uses a **least-privilege model**: only explicitly allowlisted, read-only
diagnostic commands can be escalated via `sudo -n` (non-interactive).

## Architecture

```
Frontend → API → diagnostics_service.py → command_runner.py
                                              ↓
                                    requires_privilege?
                                    ├── No  → direct subprocess
                                    └── Yes → sudo -n subprocess
                                              (only if allowlisted + sudo available)
```

## Security Boundaries

### What CAN be escalated
- `unbound-control stats_noreset` / `status` / `dump_cache`
- `nft list tables` / `list ruleset` / `list counters`
- `vtysh -c "show ..."` (read-only FRR queries)
- `journalctl --no-pager -n ...`

### What CANNOT be escalated
- `systemctl restart/stop/start` — not in sudo allowlist
- Any command not in `ALLOWED_EXECUTABLES`
- Any arbitrary arguments — sanitized, no shell metacharacters
- `shell=True` — never used, enforced in code

### Enforcement layers
1. `ALLOWED_EXECUTABLES` — whitelist of binaries
2. `_SUDO_ALLOWED_COMMANDS` — strict (executable, args_prefix) tuples
3. `_sanitize_arg()` — strips shell metacharacters
4. `subprocess.run(shell=False)` — no shell injection
5. sudoers NOPASSWD — OS-level allowlist

## Privilege Detection

The backend detects at runtime:
- `is_sudo_available()` — checks `sudo -n true`
- Result cached for process lifetime
- Exposed via `/api/troubleshooting/privilege-status`
- Included in health check response as `privilege_status`

## Graceful Degradation

When sudo is NOT configured:
- Privileged commands run without sudo
- They fail with permission errors
- Results are classified as `permission_error`
- Frontend shows amber badge + remediation hint
- System remains fully functional for unprivileged commands

## Command Metadata

Each `CommandDefinition` declares:
- `requires_privilege: bool` — whether sudo should be attempted
- `expected_failure_unprivileged: str` — what happens without privilege
- `remediation_hint: str` — operator guidance
