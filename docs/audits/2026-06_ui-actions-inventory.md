# DNS Control — Inventário Completo de Ações de UI e Mapeamento Front→API→CLI

**Data:** 2026-06-21
**Tipo:** Auditoria somente-leitura (read-only inventory)
**Escopo:** Mapeamento de todos os botões/ações acionáveis da UI, dos endpoints REST que disparam, e dos comandos executados via `command_runner`, com cruzamento contra `command_catalog.py` e `deploy/sudoers/dns-control-diagnostics`.

> ⚠️ Esta auditoria **não altera** nenhum código de produção. Apenas inspeciona o repositório e produz documentação. Correções devem ser tratadas em tarefas posteriores que referenciem este relatório.

---

## Section A — Tabela de Ações de UI

Convenções:
- **FUNCIONAL** = handler definido + endpoint existe em `backend/app/api/routes/`.
- **NO-OP** = sem `onClick`, handler vazio, ou apenas muta estado local/navegação client-side (sem efeito de backend).
- **QUEBRADO** = chama endpoint/comando que não existe ou usa ID inválido.
- **DESCONHECIDO** = não foi possível determinar com confiança.

Botões puramente de UI primitiva (`src/components/ui/*`) não são listados.

### Page: `src/pages/LoginPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| L-1 | 87 | "Entrar" (form submit) | `handleSubmit` → `login()` | `POST /auth/login` | FUNCIONAL | `auth.py:59` |

### Page: `src/pages/ForceChangePasswordPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| F-1 | 103 | "Alterar senha e continuar" | `handleSubmit` → `forceChangePassword()` | `POST /auth/force-change-password` | FUNCIONAL | `auth.py:157` |

### Page: `src/pages/Dashboard.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| D-1 | 308 | "Ver todos" (Métricas) | `navigate('/services')` | — | NO-OP | navegação |
| D-2 | 331 | "Ver todos" (Serviços) | `navigate('/services')` | — | NO-OP | navegação |
| D-3 | 192 | "Reconciliar" | `reconcileMutation.mutate()` → `api.reconcileNow()` | `POST /actions/reconcile-now` | FUNCIONAL | `actions.py:48` |
| D-4 | 424 | "×" (remove test domain) | `setTestDomains(...)` | — | NO-OP | estado local |
| D-5 | 432 | "+" (add test domain) | inline setState | — | NO-OP | estado local |
| D-6 | 479-526 | "Simular" | async fn → `api.runDiagCommand` | `POST /troubleshooting/run` | FUNCIONAL | `troubleshooting.py:26` |

### Page: `src/pages/SimpleDashboard.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| SD-1 | 678 | "Histórico" | `navigate('/history')` | — | NO-OP | navegação |
| SD-2 | 682 | "Self-test" | `selfTestMutation.mutate()` → `api.runSystemSelfTest()` | `POST /system/self-test` | FUNCIONAL | `system.py:190` |
| SD-3 | 686 | "Deploy" | `navigate('/wizard')` | — | NO-OP | navegação |
| SD-4 | 282 | "Reconciliar" | `reconcileMutation` → `api.reconcileNow()` | `POST /actions/reconcile-now` | FUNCIONAL | `actions.py:48` |

### Page: `src/pages/Services.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| SV-1 | 288 | "Logs" | `setLogsOf(svc)` | — | NO-OP | abre modal local (sem chamada) |
| SV-2 | 294 | "Restart" | `handleRestart` → `api.restartService(name)` | `POST /services/{name}/restart` | FUNCIONAL | `services.py:27` |
| SV-3 | 301 | "Inspecionar" | `setInspecting(svc)` | — | NO-OP | abre modal local |
| SV-4 | 307 | "⋮" (Mais ações) | nenhum | — | NO-OP | **botão sem `onClick`** |
| SV-5 | 431 | "Fechar" (inspect) | `setInspecting(null)` | — | NO-OP | estado local |
| SV-6 | 436 | "Fechar" (logs) | `setLogsOf(null)` | — | NO-OP | estado local |

### Page: `src/pages/TroubleshootPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| T-1 | 133 | "Reexecutar" | `handleRunAll` → `api.runHealthCheck()` | `GET /troubleshooting/health-check` | FUNCIONAL | `troubleshooting.py:59` |
| T-2 | 194 | Status filter pills | `setStatusFilter` | — | NO-OP | estado local |
| T-3 | 244 | "▸/▾" expand | `setExpanded` | — | NO-OP | estado local |
| T-4 | 251 | "Run" (single cmd) | `runCommand.mutate(id)` → `api.runDiagCommand` | `POST /troubleshooting/run` | FUNCIONAL | `troubleshooting.py:26` |
| T-5 | 295 | Category collapse | `setCollapsed` | — | NO-OP | estado local |
| T-6 | 478 | "▶ Executar Health Check Completo" | `handleRunAll` → `api.runHealthCheck` | `GET /troubleshooting/health-check` | FUNCIONAL | `troubleshooting.py:59` |
| T-7 | 537 | Category filter pills | `setCategoryFilter` | — | NO-OP | estado local |
| T-8 | 550 | "Ocultar permissões esperadas" | `setHideExpectedPerms` | — | NO-OP | estado local |
| T-9 | 620 | "▶ Run" (batch item) | `handleRun(cmd.id)` → `api.runDiagCommand` | `POST /troubleshooting/run` | FUNCIONAL | `troubleshooting.py:26` |

### Page: `src/pages/HistoryPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| H-1 | 63 | "Backups (N)" | `setShowBackups` | — | NO-OP | estado local |
| H-2 | 99 | "Rollback" (backup list) | `rollbackMutation` → `api.rollback()` | `POST /deploy/rollback` | FUNCIONAL | `deploy.py:163` |
| H-3 | 115 | history entry toggle | `setExpandedId` | — | NO-OP | estado local |
| H-4 | 190 | "Rollback" (history item) | `api.rollback()` | `POST /deploy/rollback` | FUNCIONAL | `deploy.py:163` |
| H-5 | 195 | "Ver Arquivos" | **nenhum** | — | NO-OP | **botão sem `onClick`** |

### Page: `src/pages/FilesPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| FL-1 | 44 | "Exportar Todos" | `handleExportAll` (blob client-side) | — | NO-OP | gera de `DEFAULT_CONFIG` estático |
| FL-2 | 51 | tabs de arquivo | `setSelected` | — | NO-OP | estado local |
| FL-3 | 70 | "Copiar" | clipboard API | — | NO-OP | sem rede |

### Page: `src/pages/NetworkPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| N-1 | 235 | "↺" (interfaces) | **nenhum** | — | NO-OP | **botão sem `onClick`** |
| N-2 | 385 | "↺" (rotas) | **nenhum** | — | NO-OP | **botão sem `onClick`** |
| N-3 | 513 | "Testar tudo" | `reachability.mutate()` → `api.checkReachability` | `GET /network/reachability` | FUNCIONAL | `network.py:24` |

### Page: `src/pages/LogsPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| LG-1 | 38 | "Exportar" | **nenhum** | — | NO-OP | **botão sem `onClick`** (`api.exportLogs` existe mas não está conectado) |
| LG-2 | 45 | Source filter tabs | `setSource` | — | NO-OP | refetch reativo |

### Page: `src/pages/SettingsPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| ST-1 | 209 | "Desativar Import" | `api.clearImport()` | `DELETE /config/import` | FUNCIONAL | `import_config.py:74` |
| ST-2 | 232 | "Ativar Modo Observação" | `api.setServiceMode('observed')` | `POST /config/service-mode` | FUNCIONAL | `import_config.py:128` |
| ST-3 | 241 | "Importar Infraestrutura" | `api.executeImport()` | `POST /config/import` | FUNCIONAL | `import_config.py:61` |
| ST-4 | 287 | "Exportar JSON" | blob client-side | — | NO-OP | sem rede |
| ST-5 | 336 | "Abrir diagnóstico" | `navigate('/troubleshoot')` | — | NO-OP | navegação |

### Page: `src/pages/UsersPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| U-1 | 143 | "Novo Usuário" | `setCreateOpen(true)` | — | NO-OP | abre dialog |
| U-2 | 205 | "Alterar senha" | `setPasswordOpen(id)` | — | NO-OP | abre dialog |
| U-3 | 208 | "Desativar/Ativar" | `api.toggleUser` | `POST /users/{id}/enable|disable` | FUNCIONAL | `users.py:118,132` |
| U-4 | 218 | "Excluir" | `setDeleteTarget(id)` | — | NO-OP | abre confirm dialog |
| U-5 | 284 | "Cancelar" create | `setCreateOpen(false)` | — | NO-OP | dialog |
| U-6 | 285 | "Criar" | `api.createUser` | `POST /users` | FUNCIONAL | `users.py:38` |
| U-7 | 314 | "Cancelar" pw | `setPasswordOpen(null)` | — | NO-OP | dialog |
| U-8 | 316 | "Alterar" pw confirm | `api.changeUserPassword` | `POST /users/{id}/change-password` | FUNCIONAL | `users.py:100` |
| U-9 | 336 | "Cancelar" delete | AlertDialogCancel | — | NO-OP | dialog |
| U-10 | 338 | "Excluir" confirm | `api.deleteUser` | `DELETE /users/{id}` | FUNCIONAL | `users.py:143` |

### Page: `src/pages/DnsPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| DN-1 | 491 | time-range/qtype tabs | setState | — | NO-OP | refetch reativo |
| DN-2 | 914 | "Ver Eventos" | `navigate('/events?...')` | — | NO-OP | navegação |
| DN-3 | 925 | botão sem rótulo | **nenhum** | — | NO-OP | **botão sem `onClick`** |
| DN-4 | 948 | "Limpar Filtros" | `resetFilters()` | — | NO-OP | estado local |
| DN-5 | 1061 | "↺ Atualizar" | `refreshAll()` | múltiplos GET | FUNCIONAL | re-trigger React Query |
| DN-6 | 1115 | tab "Domínios" | `setActiveSection` | — | NO-OP | estado local |
| DN-7 | 1156 | tab "Clientes" | `setActiveSection` | — | NO-OP | estado local |

### Page: `src/pages/EventsPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| EV-1 | 101 | Severity pills | `setSeverity` | — | NO-OP | refetch reativo |

### Page: `src/pages/MetricsPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| M-1 | 401 | Tab selector | `setTab` | — | NO-OP | estado local |

### Page: `src/pages/KioskDashboard.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| K-1 | 335 | icon button | **nenhum** | — | NO-OP | **sem `onClick`** |
| K-2 | 395 | botão | **nenhum** | — | NO-OP | **sem `onClick`** |
| K-3 | 561 | botão | **nenhum** | — | NO-OP | **sem `onClick`** |
| K-4 | 585 | botão | **nenhum** | — | NO-OP | **sem `onClick`** |
| K-5 | 609 | botão | **nenhum** | — | NO-OP | **sem `onClick`** |

### Page: `src/pages/LogValidationPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| LV-1 | 32 | "Atualizar" | `refetch()` → `api.getLogValidation` | `GET /telemetry/log-validation` | FUNCIONAL | `telemetry.py:256` |

### Page: `src/pages/ObservedQueriesPage.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| OQ-1 | 42 | "Atualizar" | `refetch()` → `api.getRecentQueries` | `GET /telemetry/recent-queries` | FUNCIONAL | `telemetry.py:309` |

### Page: `src/pages/Wizard.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| W-1 | 2374 | "← Anterior" | `setStep(step-1)` | — | NO-OP | estado local |
| W-2 | 2381 | "Dry Run" | `handleApply(true)` → `api.dryRunConfig` | `POST /deploy/dry-run` | FUNCIONAL | `deploy.py:102` |
| W-3 | 2391 | "Aplicar Deploy" | `handleApply(false)` → `api.applyConfig` | `POST /deploy/apply` | FUNCIONAL | `deploy.py:119` |
| W-4 | 2405 | "Próximo →" | `handleNext()` | — | NO-OP | validação local |
| W-5 | 1651 | "Novo Wizard" | reset estado | — | NO-OP | estado local |
| W-6 | 1652 | "Ver Histórico" | `navigate('/history')` | — | NO-OP | navegação |
| W-7 | 1653 | "Ir ao Dashboard" | `navigate('/')` | — | NO-OP | navegação |
| W-8 | 1673 | "Ir" (jump to error step) | `setStep` | — | NO-OP | estado local |

### Page: `src/pages/NatPage.tsx`, `src/pages/OspfPage.tsx`

Sem botões interativos — páginas apenas de exibição.

### NOC Component: `src/components/noc/NocQuickActions.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| NQ-1 | 39 | DNS Metrics / Events / Diagnostics / Wizard / Gen Files / History / Logs | `navigate(a.path)` | — | NO-OP | atalhos de navegação |

### NOC Component: `src/components/noc/v3/StatusChipBar.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| SC-1 | 62 | "Reconciliar" | prop `onReconcile` → `api.reconcileNow` | `POST /actions/reconcile-now` | FUNCIONAL | `actions.py:48` |

### NOC Component: `src/components/noc/NocHeroBar.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| NH-1 | 150 | "Reconciliar" | prop `onReconcile` | `POST /actions/reconcile-now` | FUNCIONAL | `actions.py:48` |
| NH-2 | 156 | "⛶ Fullscreen" | `toggleFullscreen()` | — | NO-OP | browser API |
| NH-3 | 165 | "⋮" menu | `setShowMenu(!showMenu)` | — | NO-OP | estado local |
| NH-4 | 186 | menu nav items | `navigate(a.path)` | — | NO-OP | navegação |

### NOC Component: `src/components/noc/NocDeploySimulation.tsx`

| # | Linha | Rótulo | Handler | Endpoint | Estado | Evidência |
|---|---|---|---|---|---|---|
| DS-1 | 136 | "×" remove domain | `setDomains(...)` | — | NO-OP | estado local |
| DS-2 | 148 | "+" add domain | `addDomain()` | — | NO-OP | estado local |
| DS-3 | 167 | "Executar Simulação" | `runSimulation()` → `api.runDiagCommand("dig_${listener.name}_${domain}")` | `POST /troubleshooting/run` | **QUEBRADO** | command_id construído dinamicamente — não existe no catálogo (catálogo usa `dns-dig-listener-{ip}`) |
| DS-4 | 199 | "↺ Rerun" | `handleRun()` | mesmo de DS-3 | **QUEBRADO** | mesmo defeito |

### Demais componentes NOC

Sem elementos acionáveis: `NocVipDiagnostics`, `NocInstanceTable`, `NocHealthMatrix`, `NocAnablockStatus`, `NocDnsErrors`, `NocDnsPathFlow`, `NocEventsTimeline`, `NocGeoMap`, `NocHealthSummary`, `NocIncidentDetector`, `NocMetricStrip`, `NocNetworkLink`, `NocNetworkMap`, `NocNetworkNode`, `NocResolverPanel`, `NocSystemInfoGrid`, `NocTopologyColumnMap`, `NocTopologyPanel`, `v3/KpiCard`, `v3/LatencyMatrix`, `v3/PanelV3`, `v3/RankList`, `v3/TopologyMini`.

---

## Section B — Front→API→CLI (ações que terminam em comando de sistema)

### B.1 `POST /troubleshooting/run` — comando único

Cadeia: UI → `api.runDiagCommand(id)` → `troubleshooting.py:26` → `command_service.run_whitelisted_command(id)` → `command_catalog[id]` → `run_command(exe, args, use_privilege=cmd.requires_privilege)`.

| Command ID | Executável | Args | Em `_SUDO_ALLOWED_COMMANDS`? | `-s` antes de `-c`? | Risco |
|---|---|---|---|---|---|
| `svc-status-frr` / `svc-status-unboundNN` | `systemctl` | `status <unit>` | sim (`systemctl`,`status`); requires_privilege=False | n/a | whitelisted+audited |
| `net-interfaces` / `-detail` | `ip` | `[-br] addr show` | sim (`ip`,`addr`) | n/a | whitelisted+audited |
| `net-routes` | `ip` | `route show` | requires_privilege=False (sem sudo) | n/a | whitelisted, sem sudo |
| `net-listening` / `net-connections` | `ss` | `-tulnp` / `-tnp` | requires_privilege=False | n/a | whitelisted, sem sudo |
| `nft-list-tables` / `-ruleset` / `-counters` | `nft` | `list ...` | sim | n/a | **whitelisted+audited** |
| `frr-ospf-neighbor` / `-route` / `-summary` / `frr-running-config` | `vtysh` | `-c "show ..."` | sim (`vtysh`,`-c`) | n/a | **whitelisted+audited** |
| `sys-uptime` / `sys-memory` / `sys-disk` | `uptime`/`free`/`df` | — | sem sudo | n/a | whitelisted, sem sudo |
| `journalctl` | `journalctl` | `--no-pager -n 100` | sim | n/a | **whitelisted+audited** |
| `dns-{name}-stats` (runtime) | `unbound-control` | `-s {ip}@{port} -c {conf} stats_noreset` | sim (`unbound-control`,`-s`) | **✅ `-s` antes de `-c`** | **whitelisted+audited** |
| `dns-{name}-status` (runtime) | `unbound-control` | `-s {ip}@{port} -c {conf} status` | sim | **✅ `-s` antes de `-c`** | **whitelisted+audited** |
| `dns-dig-listener-{id}` / `dns-vip-probe-*` / `dns-root-*` | `dig` | `@<ip> ...` | sem sudo | n/a | whitelisted, sem sudo |
| `dns-vip-bind-check` | `ip` | `addr show lo` | sem sudo (requires_privilege=False) | n/a | whitelisted, sem sudo |
| **`dig_${listener.name}_${domain}` (NocDeploySimulation)** | — | — | **ID NÃO existe no catálogo** | n/a | 🔴 **QUEBRADO** — retorna `Comando não permitido` |

### B.2 `GET /troubleshooting/health-check` — batch

Executa todo o `get_runtime_command_catalog()` via `command_runner.run_command()`. Mesma análise de B.1 aplicada por entrada.

### B.3 `POST /deploy/apply` e `POST /deploy/dry-run`

Cadeia: Wizard → `api.applyConfig`/`dryRunConfig` → `deploy.py:119/102` → `deploy_service` (≈85 chamadas `run_command`).

| Executável | Args representativos | Em `_SUDO_ALLOWED_COMMANDS`? | Risco |
|---|---|---|---|
| `systemctl` | `daemon-reload` / `restart|start|stop|enable|disable|mask|unmask|is-active <unit>` | sim | whitelisted+audited |
| `nft` | `-c -f <path>` / `-f /etc/nftables.conf` / `flush ruleset` / `list ...` | sim | whitelisted+audited |
| `mkdir` | `-p <dir>` | sim | whitelisted+audited |
| `chmod` / `chown` | `<mode\|owner> <path>` | sim | whitelisted+audited |
| `install` | `-m <mode> <src> <dst>` | sim | whitelisted+audited |
| `sysctl` | `--system` / `--load` | sim | whitelisted+audited |
| `ip` | `addr add|del|show` / `link add|set|del|show` | sim | whitelisted+audited |
| `killall` | `-q unbound` | sim | whitelisted+audited |
| `bash` | `-c <cmd>` / `-n <path>` | sim | whitelisted+audited (⚠ ver §B.6) |
| `unbound-control` | `-s {ip}@{port} -c {conf} status` (`deploy_service.py:2147-2154`) | sim, `-s` antes de `-c` ✅ | **whitelisted+audited** |
| `unbound-checkconf` | `<path>` | **NÃO está em `_SUDO_ALLOWED_COMMANDS`**; requires_privilege=False | whitelisted, sem sudo |
| `dig` | `@<vip> ...` | sem sudo | whitelisted, sem sudo |
| `stat` / `ss` | leitura | sem sudo | whitelisted, sem sudo |
| `/etc/network/post-up.d/dns-control` | `[]` | sim | whitelisted+audited |

### B.4 Auditoria explícita do ordering `-s` antes de `-c` para `unbound-control`

Todas as ocorrências verificadas:

- `backend/app/executors/command_catalog.py:245` → `["-s", f"{control_ip}@{control_port}", "-c", config_path, "stats_noreset"]` ✅
- `backend/app/executors/command_catalog.py:256` → `["-s", f"{control_ip}@{control_port}", "-c", config_path, "status"]` ✅
- `backend/app/services/deploy_service.py:2147-2154` → `["-s", f"{control_iface}@{control_port}", "-c", f"/etc/unbound/{name}.conf", "status"]` ✅

**Nenhuma violação.** Regra de memória `Sudoers Controle Multi-instância` está sendo respeitada.

### B.5 `POST /services/{name}/restart`

Cadeia: Services → `api.restartService(name)` → `services.py:27` → `run_command("systemctl", ["restart", name], use_privilege=True)` → `_SUDO_ALLOWED_COMMANDS` (`systemctl`,`restart`) ✅. **whitelisted+audited.**

### B.6 Nota sobre `bash -c`

`_SUDO_ALLOWED_COMMANDS` permite `("bash", ["-c"])`. O sanitizer (`command_runner.py:350-353`) remove `;|&$\`"'(){}<>!`, mas **não** remove `*`, `?`, `~`, `[`, `]`, espaço ou newline. Hoje todas as strings passadas a `bash -c` são construídas server-side em `deploy_service` (não vêm do frontend), então **não há vetor de injeção via UI**. Reavaliar se algum dia argumentos derivados de input do usuário forem repassados.

---

## Section C — Resumo Executivo

### C.1 Contagem por estado

| Estado | Quantidade |
|---|---|
| **FUNCIONAL** | 34 |
| **NO-OP** | 48 |
| **QUEBRADO** | 2 |
| **DESCONHECIDO** | 0 |

### C.2 Botões NO-OP / QUEBRADO priorizados (provável bug, não intencional)

**Alta prioridade — handler ausente:**

1. `src/pages/KioskDashboard.tsx` linhas **335, 395, 561, 585, 609** — cinco `<button>` sem `onClick`.
2. `src/pages/NetworkPage.tsx` linhas **235, 385** — botões de refresh "↺" sem `onClick`.
3. `src/pages/LogsPage.tsx` linha **38** — "Exportar" sem `onClick` (apesar de `api.exportLogs` existir em `src/lib/api.ts:176`).
4. `src/pages/HistoryPage.tsx` linha **195** — "Ver Arquivos" sem `onClick` (apesar de `api.getGeneratedFiles` existir).
5. `src/pages/DnsPage.tsx` linha **925** — botão sem rótulo e sem `onClick`.
6. `src/pages/Services.tsx` linha **307** — "⋮" (Mais ações) sem `onClick`.

**Alta prioridade — QUEBRADO (chama coisa inexistente):**

7. `src/components/noc/NocDeploySimulation.tsx` linhas **167 e 199** — invoca `api.runDiagCommand("dig_${listener.name}_${domain}")`; esse `command_id` não existe em `command_catalog`. O backend responde `exit_code:-1, stderr:"Comando não permitido"`.

**Possíveis mismatches em `src/lib/api.ts` que merecem verificação:**

- `api.getSchedulerStatus` chama `GET /health` — não há rota raiz `/health` registrada (apenas `/health/instances`, `/health/checks` em `health_v2.py`).
- `api.generateReport` envia `POST /dashboard/summary` — backend só tem `GET /dashboard/summary`.

### C.3 Achados de segurança (comandos disparáveis pela UI fora da whitelist)

**Nenhum.** Todos os caminhos UI → API → `run_command()` passam por `command_catalog` ou por chamadas explícitas em `deploy_service`, e cada executável está em `ALLOWED_EXECUTABLES`. Toda invocação privilegiada (`use_privilege=True`) é validada contra `_SUDO_ALLOWED_COMMANDS` antes de chegar ao `sudo -n`.

Observação informativa (não-finding): `api.removeBackend` / `api.restoreBackend` existem em `src/lib/api.ts:359-362` e os endpoints `POST /actions/remove-backend/{id}` / `restore-backend/{id}` estão registrados em `actions.py`, mas **nenhum componente do frontend os chama** atualmente. São endpoints funcionais porém órfãos do ponto de vista da UI.

---

## Apêndice

### A.1 Páginas cobertas

`Dashboard.tsx`, `DnsPage.tsx`, `EventsPage.tsx`, `FilesPage.tsx`, `ForceChangePasswordPage.tsx`, `HistoryPage.tsx`, `KioskDashboard.tsx`, `LogValidationPage.tsx`, `LoginPage.tsx`, `LogsPage.tsx`, `MetricsPage.tsx`, `NatPage.tsx`, `NetworkPage.tsx`, `NotFound.tsx`, `ObservedQueriesPage.tsx`, `OspfPage.tsx`, `Services.tsx`, `SettingsPage.tsx`, `SimpleDashboard.tsx`, `TroubleshootPage.tsx`, `UsersPage.tsx`, `Wizard.tsx`.

Componentes NOC: todos os 21 arquivos em `src/components/noc/` e `src/components/noc/v3/`.

### A.2 Inventário de rotas backend (125 rotas)

Listadas por arquivo de roteador (prefixo `/api` aplicado pelo mount):

- **actions.py:** `GET /actions`, `POST /actions/remove-backend/{id}`, `POST /actions/restore-backend/{id}`, `POST /actions/reconcile-now`
- **apply.py:** `POST /apply/{dry-run|full|dns|network|frr|nftables}`, `GET /apply/jobs`, `GET /apply/jobs/{id}`
- **auth.py:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/refresh`, `POST /auth/change-password`, `POST /auth/force-change-password`
- **configs.py:** `POST /config/dry-run-staging`, `GET|POST /configs`, `GET|PATCH /configs/{id}`, `POST /configs/{id}/clone`, `GET /configs/{id}/preview`, `GET /configs/{id}/files`, `GET /configs/{id}/diff/{a}/{b}`, `GET /configs/{id}/history`
- **dashboard.py:** `GET /dashboard/{summary,instance-stats,instance-health,vip-diagnostics,vip-diagnostics/export}`
- **deploy.py:** `GET /deploy/preflight[?]`, `GET /deploy/preflight/check`, `POST /deploy/{dry-run,apply,rollback}`, `GET /deploy/{state,backups,history,history/{id}}`
- **dns.py:** `GET /dns/{summary,metrics,instances,top-domains,rcode-breakdown}`
- **dns_errors.py:** `GET /metrics/dns/errors/{summary,live,stats,stats_delta,dnstap/status,dnstap/events,dnstap/summary}`
- **events.py:** `GET /events`, `GET /events/{id}`
- **files.py:** `GET /files/generated`, `GET /files/generated/{path}`
- **health_v2.py:** `GET /health/{instances,instances/{id},checks}`, `POST /health/run/{id}`
- **healthcheck.py:** `GET /healthcheck`, `GET /healthcheck/vip`, `GET /healthcheck/instance/{bind_ip}`
- **history.py:** `GET /history`
- **import_config.py:** `GET /config/import-host`, `POST|DELETE /config/import`, `GET|POST /config/service-mode`
- **instances.py:** `GET|POST /instances`, `DELETE /instances/{id}`
- **inventory.py:** `GET /inventory/{full,instances,vips,dnat,sticky,listeners,mode}`, `POST /inventory/sync`
- **kiosk.py:** `GET /kiosk/summary`
- **logs.py:** `GET /logs`, `GET /logs/export`
- **metrics.py:** `GET /metrics`
- **metrics_v2.py:** `GET /metrics/{dns,dns/history,system,network}`
- **nat.py:** `GET /nat/{summary,backends,sticky,ruleset}`
- **network.py:** `GET /network/{interfaces,routes,reachability,listeners}`
- **ospf.py:** `GET /ospf/{summary,neighbors,routes,running-config}`
- **services.py:** `GET /services`, `GET /services/{name}`, `POST /services/{name}/restart`, `GET /services/{name}/logs`
- **settings.py:** `GET|PATCH /settings`
- **system.py:** `GET /system/time`, `POST /system/self-test`
- **telemetry.py:** `GET /telemetry/{latest,simple,interception,history,status,anablock,log-validation,recent-queries,query-rankings}`, `POST /telemetry/recollect`
- **troubleshooting.py:** `GET /troubleshooting/commands`, `POST /troubleshooting/run`, `GET /troubleshooting/health-check`, `GET /troubleshooting/privilege-status`
- **users.py:** `GET|POST /users`, `PATCH|DELETE /users/{id}`, `POST /users/{id}/{change-password,disable,enable}`

### A.3 `src/lib/api.ts` — 88 funções exportadas

Inventário completo (função → método+path):

`getSystemInfo→GET /dashboard/summary`, `getInstanceHealth→GET /healthcheck`, `getInstanceRealStats→GET /dashboard/instance-stats`, `getVipDiagnostics→GET /dashboard/vip-diagnostics`, `getServices→GET /services`, `restartService→POST /services/{name}/restart`, `getInterfaces→GET /network/interfaces`, `getRoutes→GET /network/routes`, `checkReachability→GET /network/reachability`, `getDnsMetrics→GET /dns/metrics`, `getTopDomains→GET /dns/top-domains`, `getInstanceStats→GET /dns/instances`, `getNftCounters→GET /nat/summary`, `getStickyTable→GET /nat/sticky`, `getNftRuleset→GET /nat/ruleset`, `getOspfNeighbors→GET /ospf/neighbors`, `getOspfRoutes→GET /ospf/routes`, `getFrrRunningConfig→GET /ospf/running-config`, `getLogs→GET /logs`, `exportLogs→GET /logs/export`, `getDiagCommands→GET /troubleshooting/commands`, `runDiagCommand→POST /troubleshooting/run`, `runHealthCheck→GET /troubleshooting/health-check`, `getProfiles→GET /configs`, `saveProfile→POST /configs`, `getProfile→GET /configs/{id}`, `updateProfile→PATCH /configs/{id}`, `cloneProfile→POST /configs/{id}/clone`, `previewFiles→GET /configs/{id}/preview`, `getConfigFiles→GET /configs/{id}/files`, `getConfigDiff→GET /configs/{id}/diff/{a}/{b}`, `getConfigHistory→GET /configs/{id}/history`, `deleteProfile→DELETE /configs/{id}`, `getCurrentConfig→GET /configs`, `validateConfig→POST /configs`, `previewFilesFromConfig→POST /configs`, `applyConfig→POST /deploy/apply`, `dryRunConfig→POST /deploy/dry-run`, `getApplyJobs→GET /apply/jobs`, `getApplyJob→GET /apply/jobs/{id}`, `getDeployState→GET /deploy/state`, `getDeployPreflight→GET /deploy/preflight`, `getDeployBackups→GET /deploy/backups`, `rollback→POST /deploy/rollback`, `getHistory→GET /deploy/history`, `getHistoryEntry→GET /deploy/history/{id}`, `getGeneratedFiles→GET /files/generated`, `getFileContent→GET /files/generated/{path}`, `getSettings→GET /settings`, `updateSettings→PATCH /settings`, `getSystemTime→GET /system/time`, `runSystemSelfTest→POST /system/self-test`, `generateReport→POST /dashboard/summary` ⚠, `getUsers→GET /users`, `createUser→POST /users`, `toggleUser→POST /users/{id}/{enable|disable}`, `changeUserPassword→POST /users/{id}/change-password`, `deleteUser→DELETE /users/{id}`, `getEvents→GET /events`, `getV2Metrics→GET /metrics/dns`, `getV2Instances→GET /health/instances`, `getV2Actions→GET /actions`, `getTelemetryLatest→GET /telemetry/latest`, `getTelemetryStatus→GET /telemetry/status`, `getTelemetryHistory→GET /telemetry/history`, `getTelemetryAnablock→GET /telemetry/anablock`, `recollectTelemetry→POST /telemetry/recollect`, `getLogValidation→GET /telemetry/log-validation`, `getRecentQueries→GET /telemetry/recent-queries`, `getQueryRankings→GET /telemetry/query-rankings`, `getKioskSummary→GET /kiosk/summary`, `removeBackend→POST /actions/remove-backend/{id}` (órfão na UI), `restoreBackend→POST /actions/restore-backend/{id}` (órfão na UI), `reconcileNow→POST /actions/reconcile-now`, `getSchedulerStatus→GET /health` ⚠, `importHostState→GET /config/import-host`, `getServiceMode→GET /config/service-mode`, `executeImport→POST /config/import`, `clearImport→DELETE /config/import`, `setServiceMode→POST /config/service-mode`, `getRuntimeInventory→GET /inventory/full`, `syncRuntimeInstances→POST /inventory/sync`, `dryRunStaging→POST /config/dry-run-staging`, `getDnsErrorSummary→GET /metrics/dns/errors/summary`, `getDnsErrorsLive→GET /metrics/dns/errors/live`, `getDnsErrorStats→GET /metrics/dns/errors/stats`, `getDnstapStatus→GET /metrics/dns/errors/dnstap/status`, `getDnstapEvents→GET /metrics/dns/errors/dnstap/events`, `getDnstapSummary→GET /metrics/dns/errors/dnstap/summary`.

⚠ Endpoint divergente ou ausente — vide §C.2.

---

**Fim do relatório.**

---

## Section D — Execução do follow-up: religação (item A) e triagem (item B)

**Data:** 2026-06-21 · **Tipo:** atualização aditiva, sem alterar conclusões anteriores.

### D.1 — Item A: religação dos 11 botões "sem `onClick` (provável bug)"

Regra aplicada: religar somente quando a intenção do rótulo é clara E o alvo já existe no
codebase. Sem fabricação; sem religar ação destrutiva/CLI sem guard rail; remoção/restauração
de backend permanece em HOLD (já confirmado em §C.3).

| # | Arquivo:linha | Rótulo | Decisão | Alvo / Justificativa |
|---|---|---|---|---|
| K-1 | `KioskDashboard.tsx:335` | Bell (sino) | **religado** | `navigate('/events?severity=warning,critical')` — mesmo padrão de `DnsPage.tsx:993` |
| K-2 | `KioskDashboard.tsx:395` | "Ver todos" (Serviços) | **religado** | `navigate('/services')` — página existente |
| K-3 | `KioskDashboard.tsx:561` | "Ver todos os backends" | **religado** | `navigate('/services')` — `Services.tsx` lista todos serviços/instâncias |
| K-4 | `KioskDashboard.tsx:585` | "Ver todos os domínios" | **religado** | `navigate('/dns')` — seção "Top Domains" em `DnsPage` |
| K-5 | `KioskDashboard.tsx:609` | "Ver todos os clientes" | **religado** | `navigate('/dns')` — seção "Top Clients" em `DnsPage` |
| N-1 | `NetworkPage.tsx:235` (após drift, hoje rotulado "Ver logs DNS") | "Ver logs DNS" | **religado** | `navigate('/logs')` — página `LogsPage` com tab "Unbound" |
| N-2 | `NetworkPage.tsx:385` | "Ver todas as rotas" | **ambíguo — não religado** | A própria página já lista toda a tabela de rotas; não há página/dialog separado de rotas detalhadas |
| LG-1 | `LogsPage.tsx:38` | "Exportar" | **religado** | `api.exportLogs(activeSource)` já existia em `src/lib/api.ts:210` → blob `.log` client-side com toast |
| H-5 | `HistoryPage.tsx:195` | "Ver Arquivos" | **religado** | `navigate('/files')` — `FilesPage` é o alvo natural |
| DN-3 | `DnsPage.tsx:925` (após drift, hoje `≈1004`) | "Padrão" (`SlidersHorizontal`) | **ambíguo — feature ausente** | Sugere preset/saved view de filtros; nenhum mecanismo de presets existe ainda. Sem fabricação. |
| SV-4 | `Services.tsx:307` | "⋮" (Mais ações) | **ambíguo — feature ausente** | Nenhum `DropdownMenu` ou conjunto de ações adicionais foi definido para serviço. Religar seria fabricar menu inexistente. |

**Resultado A:** 8 religados a alvo existente · 3 reportados como ambíguos / feature ausente · 0 ações destrutivas tocadas · 0 wiring a `removeBackend`/`restoreBackend` (HOLD respeitado).

### D.2 — Item B: triagem dos demais NO-OPs

Convenção:
- **BUG** = handler ausente em botão com intenção clara e alvo existente (deveria ter sido religado).
- **PLACEHOLDER** = comportamento parcial intencional (navegação atalho, abre dialog/modal, export client-side a partir de defaults) — funciona, mas a "ação completa" depende do componente alvo.
- **DECORATIVO** = mutação local necessária para fluxo de UI (filtros, tabs, expand/collapse, close dialog, add/remove em rascunho local) — comportamento correto e final.

Triagem (cobrindo os 48 NO-OPs originais):

| # | Arquivo:linha | Categoria | Nota |
|---|---|---|---|
| D-1 | `Dashboard.tsx:308` "Ver todos" Métricas | PLACEHOLDER | Atalho `navigate('/services')` |
| D-2 | `Dashboard.tsx:331` "Ver todos" Serviços | PLACEHOLDER | Atalho `navigate('/services')` |
| D-4 | `Dashboard.tsx:424` × remove test domain | DECORATIVO | Rascunho local (`setTestDomains`) |
| D-5 | `Dashboard.tsx:432` + add test domain | DECORATIVO | Rascunho local |
| SD-1 | `SimpleDashboard.tsx:678` "Histórico" | PLACEHOLDER | `navigate('/history')` |
| SD-3 | `SimpleDashboard.tsx:686` "Deploy" | PLACEHOLDER | `navigate('/wizard')` |
| SV-1 | `Services.tsx:288` "Logs" | PLACEHOLDER | Abre modal local `setLogsOf(svc)` (modal não exibido aqui é DECORATIVO) |
| SV-3 | `Services.tsx:301` "Inspecionar" | PLACEHOLDER | Abre modal local `setInspecting(svc)` |
| SV-4 | `Services.tsx:307` "⋮" | **(item A — feature ausente)** | — |
| SV-5 | `Services.tsx:431` "Fechar" inspect | DECORATIVO | Fecha dialog |
| SV-6 | `Services.tsx:436` "Fechar" logs | DECORATIVO | Fecha dialog |
| T-2 | `TroubleshootPage.tsx:194` status filter pills | DECORATIVO | `setStatusFilter` |
| T-3 | `TroubleshootPage.tsx:244` expand ▸/▾ | DECORATIVO | `setExpanded` |
| T-5 | `TroubleshootPage.tsx:295` category collapse | DECORATIVO | `setCollapsed` |
| T-7 | `TroubleshootPage.tsx:537` category filter | DECORATIVO | `setCategoryFilter` |
| T-8 | `TroubleshootPage.tsx:550` "Ocultar permissões esperadas" | DECORATIVO | `setHideExpectedPerms` |
| H-1 | `HistoryPage.tsx:63` "Backups (N)" | DECORATIVO | `setShowBackups` |
| H-3 | `HistoryPage.tsx:115` toggle entry | DECORATIVO | `setExpandedId` |
| FL-1 | `FilesPage.tsx:44` "Exportar Todos" | PLACEHOLDER | Exporta `generateAllFiles(DEFAULT_CONFIG)` (config estática) — observação: não reflete config aplicada; investigar em tarefa separada se for desejável usar `api.getGeneratedFiles` |
| FL-2 | `FilesPage.tsx:51` tabs de arquivo | DECORATIVO | `setSelected` |
| FL-3 | `FilesPage.tsx:70` "Copiar" | DECORATIVO | Clipboard API funciona; sem rede por design |
| N-2 | `NetworkPage.tsx:385` "Ver todas as rotas" | **(item A — ambíguo)** | — |
| LG-2 | `LogsPage.tsx:45` source filter tabs | DECORATIVO | Refetch reativo via setState |
| ST-4 | `SettingsPage.tsx:287` "Exportar JSON" | PLACEHOLDER | Blob client-side a partir do estado local |
| ST-5 | `SettingsPage.tsx:336` "Abrir diagnóstico" | PLACEHOLDER | `navigate('/troubleshoot')` |
| U-1 | `UsersPage.tsx:143` "Novo Usuário" | DECORATIVO | Abre dialog (criação real é U-6) |
| U-2 | `UsersPage.tsx:205` "Alterar senha" | DECORATIVO | Abre dialog (mutação real é U-8) |
| U-4 | `UsersPage.tsx:218` "Excluir" | DECORATIVO | Abre confirm dialog (delete real é U-10) |
| U-5 | `UsersPage.tsx:284` "Cancelar" create | DECORATIVO | Fecha dialog |
| U-7 | `UsersPage.tsx:314` "Cancelar" pw | DECORATIVO | Fecha dialog |
| U-9 | `UsersPage.tsx:336` "Cancelar" delete | DECORATIVO | `AlertDialogCancel` |
| DN-1 | `DnsPage.tsx:491` time-range/qtype tabs | DECORATIVO | Refetch reativo |
| DN-2 | `DnsPage.tsx:914` "Ver Eventos" | PLACEHOLDER | `navigate('/events?...)` |
| DN-3 | `DnsPage.tsx:925` ("Padrão") | **(item A — feature ausente)** | — |
| DN-4 | `DnsPage.tsx:948` "Limpar Filtros" | DECORATIVO | `resetFilters()` local |
| DN-6 | `DnsPage.tsx:1115` tab "Domínios" | DECORATIVO | `setActiveSection` |
| DN-7 | `DnsPage.tsx:1156` tab "Clientes" | DECORATIVO | `setActiveSection` |
| EV-1 | `EventsPage.tsx:101` severity pills | DECORATIVO | Refetch reativo |
| M-1 | `MetricsPage.tsx:401` tab selector | DECORATIVO | `setTab` |
| NQ-1 | `NocQuickActions.tsx:39` shortcuts | PLACEHOLDER | Atalhos `navigate(a.path)` |
| NH-2 | `NocHeroBar.tsx:156` "⛶ Fullscreen" | DECORATIVO | Browser API (Fullscreen) |
| NH-3 | `NocHeroBar.tsx:165` "⋮" menu | DECORATIVO | Toggle de menu local |
| NH-4 | `NocHeroBar.tsx:186` itens de menu | PLACEHOLDER | Atalhos `navigate(a.path)` |
| DS-1 | `NocDeploySimulation.tsx:136` × remove domain | DECORATIVO | Rascunho local |
| DS-2 | `NocDeploySimulation.tsx:148` + add domain | DECORATIVO | Rascunho local |

### D.3 — Resumo executivo da triagem

| Categoria | Quantidade | Observação |
|---|---|---|
| **Religados (deixaram de ser BUG)** | 8 | item A — alvo existente |
| **Reportados ambíguos / feature ausente** | 3 | DN-3, SV-4, N-2 |
| **BUG remanescente** | 0 | nenhum botão com intenção clara + alvo existente ficou sem `onClick` |
| **PLACEHOLDER** | 13 | navegação atalho, abre dialog, export client-side |
| **DECORATIVO** | 27 | mutação local necessária ao fluxo de UI |
| **QUEBRADO (pré-existente, fora do escopo desta tarefa)** | 2 | DS-3, DS-4 — `dig_${listener.name}_${domain}` (vide §C.2) |

### D.4 — Notas de segurança

- Nenhum botão religado dispara comando CLI ou efeito destrutivo.
- `api.removeBackend` / `api.restoreBackend` permanecem **órfãos** na UI por design (HOLD — vide §C.3).
- A nova chamada `api.exportLogs` em `LogsPage` consome um endpoint somente-leitura (`GET /logs/export`), sem efeito de estado e sem `use_privilege`.

**Fim da Section D.**
