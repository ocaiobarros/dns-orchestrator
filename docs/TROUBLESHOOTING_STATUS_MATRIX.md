# Troubleshooting — Status Classification Matrix

## Status Types

| Status | Cor | Significado | Ação necessária |
|---|---|---|---|
| `ok` | 🟢 Verde | Comando executou com sucesso, exit code 0 | Nenhuma |
| `inactive` | ⚪ Cinza | Serviço inativo (systemctl exit code 3 + "inactive (dead)") | Verificar se o serviço deveria estar ativo neste ambiente |
| `permission_error` | 🟡 Amber | Comando falhou por falta de permissão do processo backend | Ajustar permissões/sudo ou considerar esperado |
| `degraded` | 🟡 Amarelo | Comando executou mas resultado indica estado subótimo | Investigar causa da degradação |
| `dependency_error` | ⚪ Neutro | Binário ou dependência não encontrada | Instalar pacote necessário |
| `timeout_error` | 🔴 Vermelho | Comando excedeu tempo limite de execução | Verificar se serviço está responsivo |
| `error` | 🔴 Vermelho | Falha real de execução | Investigar — indica problema operacional |
| `runtime_error` | 🔴 Vermelho | Exceção interna do backend ao executar | Verificar logs do backend |

## Classification Logic

### 1. Exit code 0 → `ok`
Comando executou sem erros.

### 2. Exit code 3 + stdout contém "inactive" → `inactive`
Específico para `systemctl status`. Serviço existe mas não está rodando.
**Não é erro.** Pode ser intencional (ex: nftables sem regras persistentes).

### 3. stderr contém padrões de permissão → `permission_error`
Padrões detectados:
- `Permission denied`
- `Operation not permitted`
- `must be root`
- `insufficient permissions`
- `failed to connect to any daemons`
- `access denied`

### 4. stderr contém padrões de dependência → `dependency_error`
- `not found`
- `no such file`
- `command not found`

### 5. stderr/stdout contém padrões de timeout → `timeout_error`
- `timeout` / `timed out` / `expirou`

### 6. Qualquer outro exit code != 0 → `error`

## Enrichment Fields

Each result object includes:

| Campo | Tipo | Descrição |
|---|---|---|
| `summary` | string | Linha curta legível explicando o resultado |
| `remediation` | string | Dica operacional para resolver (vazio se ok) |
| `privileged` | boolean | Se o comando é conhecido por requerer privilégio |
| `requires_root` | boolean | Se precisa de root especificamente |
| `expected_in_unprivileged_mode` | boolean | Se a falha é esperada quando backend roda sem sudo |

## Expected Permission Failures in Unprivileged Mode

These checks are **expected to fail** when the backend runs as a non-root user without sudo wrappers:

| Comando | Motivo | Remediação |
|---|---|---|
| `unbound-control` | Socket `/run/unbound.ctl` requer permissão | sudo controlado ou ajustar permissões do socket |
| `nft` | Requer CAP_NET_ADMIN / root | sudo restrito para operações de leitura |
| `vtysh` | `/etc/frr/vtysh.conf` permissão negada | Grupo `frrvty` ou sudo |
| `journalctl` | Journal requer grupo `systemd-journal` | Adicionar usuário ao grupo |

These are **not outages**. They indicate the backend service user lacks specific privileges.
The UI renders them distinctly from real failures.

## Real Failure vs Expected Limitation

| Cenário | Status | É problema real? |
|---|---|---|
| unbound rodando, dig funciona, unbound-control sem permissão | `permission_error` | ❌ Não — serviço está saudável |
| unbound parado, dig falha | `error` | ✅ Sim — serviço down |
| nftables inativo no systemctl | `inactive` | ⚠️ Depende — pode ser intencional |
| nft sem permissão para listar regras | `permission_error` | ❌ Não — limitação de privilégio |
| dig timeout para resolver DNS | `error` / `timeout_error` | ✅ Sim — DNS não resolve |
| FRR rodando mas vtysh sem permissão | `permission_error` | ❌ Não — serviço está saudável |
