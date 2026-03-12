# Troubleshooting — Status Semantics Reference

## Status Classification Rules

### `ok` (Green)
- Exit code 0
- Command completed successfully
- No action needed

### `inactive` (Gray)
- **Trigger**: `systemctl status` output contains `inactive (dead)` or `Active: inactive`
- **Also**: exit code 3 with "inactive" in output
- **Example**: nftables.service not running
- **Not an error** — may be intentional depending on environment
- Summary: "Serviço inativo"
- Remediation: "Validar se este serviço deve estar ativo neste host"

### `permission_error` (Amber)
- **Trigger**: stdout/stderr contains any of:
  - `Permission denied`
  - `Operation not permitted`
  - `must be root`
  - `insufficient permissions`
  - `failed to connect to any daemons`
  - `access denied`
  - `No journal files were opened due to insufficient permissions`
  - `Users in groups ... can see all messages`
- **Not a real outage** — indicates the backend user lacks privilege
- Expected in unprivileged mode for: `unbound-control`, `nft`, `vtysh`, `journalctl`

#### Specific summaries per executable:
| Executable | Summary | Remediation |
|---|---|---|
| `unbound-control` | Sem acesso ao socket do unbound-control | Ajustar permissão do socket ou usar execução controlada |
| `nft` | Leitura de nftables requer privilégio administrativo | Executar diagnóstico via sudo restrito |
| `vtysh` | Acesso ao FRR exige permissão adicional | Ajustar grupo/permissão do backend ou usar wrapper privilegiado |
| `journalctl` | Usuário do backend sem acesso ao journal | Adicionar o usuário ao grupo systemd-journal ou usar wrapper controlado |

### `degraded` (Yellow)
- Command succeeded but output indicates non-ideal state
- Example: service disabled but present, missing expected counters

### `dependency_error` (Neutral/Gray)
- stderr contains: `not found`, `no such file`, `command not found`
- Binary or dependency is missing from the system

### `timeout_error` (Red)
- stderr/stdout contains: `timeout`, `timed out`, `expirou`
- Command exceeded execution time limit

### `error` (Red)
- Any exit code != 0 that doesn't match above patterns
- **This is a real operational failure** requiring investigation
- Summary extracted from first line of stderr

### `runtime_error` (Red)
- Internal backend exception during command execution
- Check backend logs for full stack trace

## Operator Decision Matrix

| Scenario | Status | Real problem? | Action |
|---|---|---|---|
| nftables service inactive | `inactive` | ⚠️ Depends | Check if nftables should be active |
| unbound running, dig works, unbound-control denied | `permission_error` | ❌ No | Service is healthy, just socket permission |
| nft operation not permitted | `permission_error` | ❌ No | Backend lacks CAP_NET_ADMIN |
| vtysh can't read config | `permission_error` | ❌ No | Backend not in frrvty group |
| journalctl insufficient permissions | `permission_error` | ❌ No | Backend not in systemd-journal group |
| dig timeout resolving DNS | `error`/`timeout_error` | ✅ Yes | DNS resolution is broken |
| unbound service stopped | `inactive` or `error` | ✅ Yes | Core service is down |
| FRR service stopped | `inactive` or `error` | ✅ Yes | Routing service is down |

## Summary Panel Counters

The top summary separates results into operationally distinct categories:
- **Total**: all checks executed
- **OK**: exit code 0, healthy
- **Sem permissão**: privilege-limited, expected in unprivileged mode
- **Inativos**: services that exist but aren't running
- **Erros reais**: actual failures requiring attention
