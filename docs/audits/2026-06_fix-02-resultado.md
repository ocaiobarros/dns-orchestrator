# FIX-02 — Resultado da Triagem de No-ops (UI)

**Data:** 2026-06-22
**Base:** `docs/audits/2026-06_ui-actions-inventory.md` (DISC-01)
**Escopo:** Religar no-ops de destino claro; triar o restante. ZERO mudança em
geradores/unbound/policy_d/nftables/apply/deploy. Nenhuma rota nova de backend criada.

## Reconciliação com o estado atual

Muitos no-ops da DISC-01 já foram religados em tarefas intermediárias (POL-*, AnaBlock,
upstream-silence, NocDeploySimulation fix). A varredura atual de `<button>` sem `onClick`
em `src/` retornou apenas 4 ocorrências, sendo 1 falso-positivo (DropdownMenuTrigger asChild).

## Tabela final por ação

| ID DISC-01 | Arquivo:linha atual | Estado anterior | Novo estado | Destino conectado / observação |
|---|---|---|---|---|
| LG-1 "Exportar" | `src/pages/LogsPage.tsx:81` | NO-OP | **RELIGADO (prévio)** | `handleExport` → `api.exportLogs(activeSource)` → `GET /logs/export` (`logs.py:54`). Já estava conectado. |
| H-5 "Ver Arquivos" | `src/pages/HistoryPage.tsx:198` | NO-OP | **RELIGADO (prévio)** | `navigate('/files')`. |
| N-1 "↺" interfaces | `src/pages/NetworkPage.tsx` | NO-OP | **REMOVIDO** | Substituído por auto-refresh 5s (`refetchInterval: 5000`, l.186). DECORATIVO eliminado. |
| N-2 "↺" rotas | `src/pages/NetworkPage.tsx` | NO-OP | **REMOVIDO** | Idem N-1. |
| N (novo) "Ver todas as rotas" | `src/pages/NetworkPage.tsx:389` | NO-OP | **PLACEHOLDER** | Sem destino claro; sinalizado: `disabled` + `title="Em breve"`. |
| K-1..K-5 KioskDashboard | `src/pages/KioskDashboard.tsx` | NO-OP | **RELIGADO (prévio)** | Varredura atual: 0 botões sem `onClick`. Todos religados. |
| SV-4 "⋮" Mais ações | `src/pages/Services.tsx:307` | NO-OP | **PLACEHOLDER** | Sem destino claro; sinalizado: `disabled` + `title="Em breve"`. |
| DN-3 botão sem rótulo | `src/pages/DnsPage.tsx` | NO-OP | **RELIGADO (prévio)** | Hoje é o sino (Bell) com `onClick={() => navigate('/events?severity=warning,critical')}` (l.993). |
| DN (novo) "Padrão" presets | `src/pages/DnsPage.tsx:1004` | NO-OP | **PLACEHOLDER** | Presets de filtro não implementados; sinalizado: `disabled` + `title="Presets de filtro — em breve"`. |
| DS-3 / DS-4 NocDeploySimulation | `src/components/noc/NocDeploySimulation.tsx:58-59` | QUEBRADO | **RELIGADO (prévio)** | Usa `dns-dig-listener-${ip.replace(/[.:]/g, '-')}` — id válido do catálogo. |
| FL-1 "Exportar Todos" / FL-3 "Copiar" / ST-4 "Exportar JSON" | FilesPage / SettingsPage | NO-OP | **FUNCIONAL (client-side)** | Blob/clipboard local — comportamento intencional, não exige backend. DECORATIVO de classificação. |
| Navegações (D-1, D-2, SD-1, SD-3, W-6, W-7, NQ-*, NH-4) | várias | NO-OP | **FUNCIONAL (navegação)** | `navigate(path)` — comportamento esperado. |
| Estado local (D-4, D-5, T-2/3/5/7/8, H-1/3, FL-2, LG-2, U-1/2/4/5/7/9, EV-1, M-1, W-1/4/5/8, DS-1/2, SV-1/3/5/6, etc.) | várias | NO-OP | **FUNCIONAL (estado local)** | Filtros, tabs, abertura de dialogs, refetch reativo — comportamento esperado. |
| **removeBackend** | `src/pages/Dashboard.tsx` / Services | n/a | **PLACEHOLDER (HOLD)** | **Permanece inerte por design** — aguarda anti-flap. Não religado. |
| **restoreBackend** | idem | n/a | **PLACEHOLDER (HOLD)** | **Permanece inerte por design** — aguarda anti-flap. Não religado. |

## BUGs identificados (não corrigidos — apenas classificados)

Nenhum BUG novo detectado nesta passada. NocDeploySimulation (antigo QUEBRADO) já foi corrigido.

## Mudanças concretas desta tarefa

Somente sinalização visual (`disabled` + `title`) de 3 botões que pareciam clicáveis e não tinham
destino:

1. `src/pages/Services.tsx:307` — botão "⋮ Mais ações" → `disabled` + `title="Em breve"`.
2. `src/pages/DnsPage.tsx:1004` — botão "Padrão" (presets) → `disabled` + `title="Presets de filtro — em breve"`.
3. `src/pages/NetworkPage.tsx:389` — botão "Ver todas as rotas" → `disabled` + `title="Em breve"`.

## Confirmações obrigatórias

- ✅ `removeBackend` / `restoreBackend` continuam **inertes** (PLACEHOLDER em HOLD).
- ✅ **Nenhuma rota nova de backend criada.**
- ✅ **Nenhum gerador tocado** (`unbound_generator`, `nftables_generator`, `policy_d_generator`, `frr_generator`, `sysctl_generator`, `ip_blocking_generator`, `network_generator`, `systemd_generator`, `organic_generator` — intactos).
- ✅ Resolução intocada (zero impacto em runtime DNS/nftables).
- ✅ Apenas mudanças de UI/apresentação em 3 arquivos.
