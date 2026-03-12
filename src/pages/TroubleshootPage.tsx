import { useState, useMemo } from 'react';
import { Play, Loader2, CheckCircle2, XCircle, ShieldAlert, AlertTriangle, RefreshCw, ChevronDown, ChevronRight, Clock, Eye, EyeOff, Filter, Lock, MinusCircle } from 'lucide-react';
import CommandOutput from '@/components/CommandOutput';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useDiagCommands, useRunDiagCommand, useHealthCheck } from '@/lib/hooks';
import type { DiagResult } from '@/lib/types';

// ── Types ──

interface PrivilegeStatus {
  backend_running_as_user: string;
  backend_groups: string[];
  privilege_wrapper_available: boolean;
  privileged_commands_enabled: boolean;
}

interface HealthBatchResult {
  commandId: string;
  command_id?: string;
  label?: string;
  category?: string;
  exitCode: number;
  exit_code?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  duration_ms?: number;
  timestamp: string;
  success: boolean;
  status: string;
  summary?: string;
  remediation?: string;
  privileged?: boolean;
  requires_root?: boolean;
  expected_in_unprivileged_mode?: boolean;
  executed_privileged?: boolean;
  requires_privilege?: boolean;
}

interface HealthBatchResponse {
  success: boolean;
  started_at: string;
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  permission_limited?: number;
  inactive?: number;
  privilege_status?: PrivilegeStatus;
  results: HealthBatchResult[];
}

type StatusFilter = 'all' | 'ok' | 'permission_error' | 'inactive' | 'service_not_running' | 'failures';

// ── Status helpers ──

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; badgeClass: string }> = {
  ok: {
    icon: <CheckCircle2 size={14} className="text-green-500" />,
    label: 'OK',
    badgeClass: 'bg-green-500/15 text-green-400 border-green-500/30',
  },
  inactive: {
    icon: <MinusCircle size={14} className="text-muted-foreground" />,
    label: 'Inativo',
    badgeClass: 'bg-secondary text-muted-foreground border-border',
  },
  service_not_running: {
    icon: <MinusCircle size={14} className="text-amber-400" />,
    label: 'Não executando',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  permission_error: {
    icon: <ShieldAlert size={14} className="text-amber-500" />,
    label: 'Sem permissão',
    badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  degraded: {
    icon: <AlertTriangle size={14} className="text-yellow-500" />,
    label: 'Degradado',
    badgeClass: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  },
  dependency_error: {
    icon: <AlertTriangle size={14} className="text-muted-foreground" />,
    label: 'Dependência',
    badgeClass: 'bg-secondary text-muted-foreground border-border',
  },
  timeout_error: {
    icon: <Clock size={14} className="text-destructive" />,
    label: 'Timeout',
    badgeClass: 'bg-destructive/15 text-destructive border-destructive/30',
  },
  error: {
    icon: <XCircle size={14} className="text-destructive" />,
    label: 'Erro',
    badgeClass: 'bg-destructive/15 text-destructive border-destructive/30',
  },
  runtime_error: {
    icon: <XCircle size={14} className="text-destructive" />,
    label: 'Erro runtime',
    badgeClass: 'bg-destructive/15 text-destructive border-destructive/30',
  },
};

function getStatusConfig(status: string) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.error;
}

// ── Category labels ──

const CATEGORY_LABELS: Record<string, string> = {
  services: 'Serviços',
  network: 'Rede',
  dns: 'DNS',
  nftables: 'nftables',
  ospf: 'OSPF / FRR',
  system: 'Sistema',
  logs: 'Logs',
};

// ── Summary Panel ──

function BatchSummaryPanel({ summary, onRerun, isPending }: {
  summary: { total: number; passed: number; failed: number; permission_limited: number; inactive: number; service_not_running?: number; duration?: string };
  onRerun: () => void;
  isPending: boolean;
}) {
  return (
    <div className="noc-panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold">Resultado do Health Check</span>
        <button
          onClick={onRerun}
          disabled={isPending}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50"
        >
          {isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Reexecutar
        </button>
      </div>
      <div className="flex flex-wrap gap-3">
        <SummaryChip label="Total" value={summary.total} className="bg-secondary border-border text-foreground" />
        <SummaryChip label="OK" value={summary.passed} className="bg-green-500/15 text-green-400 border-green-500/30" />
        {summary.permission_limited > 0 && (
          <SummaryChip label="Sem permissão" value={summary.permission_limited} className="bg-amber-500/15 text-amber-400 border-amber-500/30" icon={<Lock size={10} />} />
        )}
        {summary.inactive > 0 && (
          <SummaryChip label="Inativos" value={summary.inactive} className="bg-secondary text-muted-foreground border-border" />
        )}
        {(summary.service_not_running ?? 0) > 0 && (
          <SummaryChip label="Não executando" value={summary.service_not_running!} className="bg-amber-500/10 text-amber-400 border-amber-500/20" />
        )}
        {summary.failed > 0 && (
          <SummaryChip label="Erros reais" value={summary.failed} className="bg-destructive/15 text-destructive border-destructive/30" />
        )}
        {summary.duration && (
          <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
            <Clock size={10} /> {summary.duration}
          </span>
        )}
      </div>
    </div>
  );
}

function SummaryChip({ label, value, className, icon }: { label: string; value: number; className: string; icon?: React.ReactNode }) {
  return (
    <span className={`text-xs font-mono px-2 py-1 rounded border flex items-center gap-1.5 ${className}`}>
      {icon}{label}: {value}
    </span>
  );
}

// ── Filter bar ──

function FilterBar({ active, onChange, counts }: {
  active: StatusFilter;
  onChange: (f: StatusFilter) => void;
  counts: Record<StatusFilter, number>;
}) {
  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'ok', label: 'OK' },
    { key: 'permission_error', label: 'Sem permissão' },
    { key: 'inactive', label: 'Inativos' },
    { key: 'service_not_running', label: 'Não executando' },
    { key: 'failures', label: 'Erros reais' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {filters.map(f => (
        <button
          key={f.key}
          onClick={() => onChange(f.key)}
          className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
            active === f.key
              ? 'bg-primary/15 text-primary border-primary/30'
              : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
          }`}
        >
          {f.label} ({counts[f.key]})
        </button>
      ))}
    </div>
  );
}

// ── Result Card ──

function ResultCard({ result, individualResult, onRun, isRunning }: {
  result: HealthBatchResult;
  individualResult?: DiagResult;
  onRun: () => void;
  isRunning: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = getStatusConfig(result.status);
  const displayResult = individualResult || result;
  const stdout = displayResult.stdout || '';
  const stderr = displayResult.stderr || '';
  const hasOutput = !!(stdout || stderr);
  const durationMs = result.durationMs ?? result.duration_ms ?? 0;

  return (
    <div className="noc-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {cfg.icon}
          <span className="text-sm font-medium truncate">{result.label}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded border shrink-0 ${cfg.badgeClass}`}>
            {cfg.label}
          </span>
          {result.privileged && (
            <span className="text-xs text-amber-500/70 flex items-center gap-0.5 shrink-0" title="Requer privilégio">
              <Lock size={10} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground font-mono">{durationMs}ms</span>
          {hasOutput && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          )}
          <button
            onClick={onRun}
            disabled={isRunning}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50"
          >
            <Play size={12} /> Run
          </button>
        </div>
      </div>

      {/* Summary + remediation */}
      {result.summary && (
        <p className="text-xs text-muted-foreground mt-1.5">{result.summary}</p>
      )}
      {result.status !== 'ok' && result.remediation && (
        <p className="text-xs text-amber-500/80 mt-1 font-mono">💡 {result.remediation}</p>
      )}

      {/* Expandable output */}
      {expanded && hasOutput && (
        <div className="mt-2">
          <CommandOutput content={stdout || stderr || '(no output)'} maxHeight="300px" />
        </div>
      )}
    </div>
  );
}

// ── Category Group ──

function CategoryGroup({ category, results, individualResults, onRun, isRunning }: {
  category: string;
  results: HealthBatchResult[];
  individualResults: Record<string, DiagResult>;
  onRun: (cmdId: string) => void;
  isRunning: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const okCount = results.filter(r => r.status === 'ok').length;
  const failCount = results.filter(r => !['ok', 'inactive', 'permission_error', 'service_not_running'].includes(r.status)).length;
  const permCount = results.filter(r => r.status === 'permission_error').length;

  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full text-left mb-2 group"
      >
        {collapsed ? <ChevronRight size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold">{CATEGORY_LABELS[category] || category}</span>
        <span className="text-xs text-muted-foreground font-mono">({results.length})</span>
        <div className="flex gap-1.5 ml-auto">
          {okCount > 0 && <span className="text-xs font-mono text-green-500">{okCount} ok</span>}
          {permCount > 0 && <span className="text-xs font-mono text-amber-500">{permCount} perm</span>}
          {failCount > 0 && <span className="text-xs font-mono text-destructive">{failCount} err</span>}
        </div>
      </button>
      {!collapsed && (
        <div className="space-y-2 ml-4">
          {results.map(r => (
            <ResultCard
              key={r.commandId || r.command_id}
              result={r}
              individualResult={individualResults[r.commandId || r.command_id || '']}
              onRun={() => onRun(r.commandId || r.command_id || '')}
              isRunning={isRunning}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──

export default function TroubleshootPage() {
  const { data: commands, isLoading, error } = useDiagCommands();
  const runCommand = useRunDiagCommand();
  const healthCheck = useHealthCheck();
  const [results, setResults] = useState<Record<string, DiagResult>>({});
  const [batchResults, setBatchResults] = useState<HealthBatchResult[]>([]);
  const [privilegeStatus, setPrivilegeStatus] = useState<PrivilegeStatus | null>(null);
  const [batchSummary, setBatchSummary] = useState<{
    total: number; passed: number; failed: number; permission_limited: number; inactive: number; service_not_running?: number; duration?: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [hideExpectedPerms, setHideExpectedPerms] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // ── ALL hooks must be above any early return ──

  const filteredBatch = useMemo(() => {
    let items = batchResults;
    if (hideExpectedPerms) {
      items = items.filter(r => !(r.status === 'permission_error' && r.expected_in_unprivileged_mode));
    }
    if (statusFilter === 'ok') items = items.filter(r => r.status === 'ok');
    else if (statusFilter === 'permission_error') items = items.filter(r => r.status === 'permission_error');
    else if (statusFilter === 'inactive') items = items.filter(r => r.status === 'inactive');
    else if (statusFilter === 'service_not_running') items = items.filter(r => r.status === 'service_not_running');
    else if (statusFilter === 'failures') items = items.filter(r => ['error', 'runtime_error', 'timeout_error', 'dependency_error'].includes(r.status));
    if (categoryFilter !== 'all') items = items.filter(r => r.category === categoryFilter);
    return items;
  }, [batchResults, statusFilter, categoryFilter, hideExpectedPerms]);

  const groupedBatch = useMemo(() => {
    const groups: Record<string, HealthBatchResult[]> = {};
    const order = ['services', 'network', 'dns', 'nftables', 'ospf', 'system', 'logs'];
    filteredBatch.forEach(r => {
      const cat = r.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });
    const sorted: [string, HealthBatchResult[]][] = [];
    order.forEach(cat => { if (groups[cat]) sorted.push([cat, groups[cat]]); });
    Object.keys(groups).forEach(cat => { if (!order.includes(cat)) sorted.push([cat, groups[cat]]); });
    return sorted;
  }, [filteredBatch]);

  const filterCounts: Record<StatusFilter, number> = useMemo(() => {
    const src = hideExpectedPerms
      ? batchResults.filter(r => !(r.status === 'permission_error' && r.expected_in_unprivileged_mode))
      : batchResults;
    return {
      all: src.length,
      ok: src.filter(r => r.status === 'ok').length,
      permission_error: src.filter(r => r.status === 'permission_error').length,
      inactive: src.filter(r => r.status === 'inactive').length,
      service_not_running: src.filter(r => r.status === 'service_not_running').length,
      failures: src.filter(r => ['error', 'runtime_error', 'timeout_error', 'dependency_error'].includes(r.status)).length,
    };
  }, [batchResults, hideExpectedPerms]);

  const categories = useMemo(() => {
    const cats = new Set(batchResults.map(r => r.category || 'other'));
    return ['all', ...cats];
  }, [batchResults]);

  const commandCategories = useMemo(() =>
    ['all', ...new Set(commands?.map(c => c.category) ?? [])],
  [commands]);

  const filteredCommands = useMemo(() =>
    categoryFilter === 'all' ? (commands ?? []) : (commands ?? []).filter(c => c.category === categoryFilter),
  [commands, categoryFilter]);

  // ── Early returns AFTER all hooks ──

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const handleRun = (cmdId: string) => {
    runCommand.mutate(cmdId, {
      onSuccess: (result) => setResults(prev => ({ ...prev, [cmdId]: result })),
    });
  };

  const handleRunAll = () => {
    setBatchSummary(null);
    setBatchResults([]);
    healthCheck.mutate(undefined, {
      onSuccess: (rawData: unknown) => {
        const data = rawData as HealthBatchResponse;
        if (data && data.results && Array.isArray(data.results)) {
          setBatchResults(data.results);
          if (data.privilege_status) setPrivilegeStatus(data.privilege_status);
          const diagMap: Record<string, DiagResult> = {};
          data.results.forEach((r: HealthBatchResult) => {
            const id = r.commandId || r.command_id || '';
            diagMap[id] = {
              commandId: id,
              exitCode: r.exitCode ?? r.exit_code ?? -1,
              stdout: r.stdout || '',
              stderr: r.stderr || '',
              durationMs: r.durationMs ?? r.duration_ms ?? 0,
              timestamp: r.timestamp || new Date().toISOString(),
            };
          });
          setResults(prev => ({ ...prev, ...diagMap }));

          const permLimited = data.permission_limited ?? data.results.filter(r => r.status === 'permission_error').length;
          const inactiveCount = data.inactive ?? data.results.filter(r => r.status === 'inactive').length;
          const passedCount = data.passed ?? data.results.filter(r => r.status === 'ok').length;
          const failedCount = data.failed ?? data.results.filter(r => ['error', 'runtime_error', 'timeout_error', 'dependency_error'].includes(r.status)).length;

          let duration: string | undefined;
          if (data.started_at && data.finished_at) {
            const ms = new Date(data.finished_at).getTime() - new Date(data.started_at).getTime();
            duration = ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
          }

          setBatchSummary({
            total: data.total ?? data.results.length,
            passed: passedCount,
            failed: failedCount,
            permission_limited: permLimited,
            inactive: inactiveCount,
            duration,
          });
        } else if (Array.isArray(rawData)) {
          const diagMap: Record<string, DiagResult> = {};
          (rawData as DiagResult[]).forEach((r: DiagResult) => {
            const id = r.commandId || (r as any).command_id || '';
            diagMap[id] = r;
          });
          setResults(prev => ({ ...prev, ...diagMap }));
          const passed = Object.values(diagMap).filter(r => r.exitCode === 0).length;
          setBatchSummary({ total: Object.keys(diagMap).length, passed, failed: Object.keys(diagMap).length - passed, permission_limited: 0, inactive: 0 });
        }
      },
      onError: () => {
        setBatchSummary({ total: 0, passed: 0, failed: 0, permission_limited: 0, inactive: 0 });
      },
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Troubleshooting</h1>
          <p className="text-sm text-muted-foreground">Diagnóstico operacional em tempo real</p>
        </div>
        <button
          onClick={handleRunAll}
          disabled={healthCheck.isPending}
          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-60"
        >
          {healthCheck.isPending ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          Health Check Completo
        </button>
      </div>

      {/* Privilege warning banner */}
      {privilegeStatus && !privilegeStatus.privileged_commands_enabled && batchSummary && batchSummary.permission_limited > 0 && (
        <div className="noc-panel border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-400">Diagnósticos avançados limitados por privilégio</p>
              <p className="text-xs text-muted-foreground mt-1">
                Backend executando como <code className="text-xs font-mono bg-secondary px-1 rounded">{privilegeStatus.backend_running_as_user}</code>.
                {' '}{batchSummary.permission_limited} checks requerem sudo controlado.
                Consulte a documentação de habilitação de privilégios.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Privilege status indicator when enabled */}
      {privilegeStatus && privilegeStatus.privileged_commands_enabled && (
        <div className="noc-panel border-green-500/30 bg-green-500/5">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-500" />
            <span className="text-xs text-green-400 font-medium">Diagnósticos privilegiados habilitados</span>
            <span className="text-xs text-muted-foreground font-mono ml-auto">
              user: {privilegeStatus.backend_running_as_user}
            </span>
          </div>
        </div>
      )}

      {/* Batch summary */}
      {batchSummary && (
        <BatchSummaryPanel
          summary={batchSummary}
          onRerun={handleRunAll}
          isPending={healthCheck.isPending}
        />
      )}

      {/* Batch results */}
      {batchResults.length > 0 && (
        <>
          {/* Filters */}
          <div className="space-y-3">
            <FilterBar active={statusFilter} onChange={setStatusFilter} counts={filterCounts} />

            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                      categoryFilter === cat
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
                    }`}
                  >
                    {CATEGORY_LABELS[cat] || cat}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setHideExpectedPerms(!hideExpectedPerms)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded"
              >
                {hideExpectedPerms ? <Eye size={12} /> : <EyeOff size={12} />}
                {hideExpectedPerms ? 'Mostrar privilege-limited' : 'Ocultar privilege-limited esperados'}
              </button>
            </div>
          </div>

          {/* Grouped results */}
          <div className="space-y-6">
            {groupedBatch.map(([category, items]) => (
              <CategoryGroup
                key={category}
                category={category}
                results={items}
                individualResults={results}
                onRun={handleRun}
                isRunning={runCommand.isPending}
              />
            ))}
          </div>

          {filteredBatch.length === 0 && (
            <div className="noc-panel text-center text-sm text-muted-foreground py-8">
              Nenhum resultado corresponde aos filtros selecionados.
            </div>
          )}
        </>
      )}

      {/* Pre-batch: individual command list */}
      {batchResults.length === 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {commandCategories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
                  categoryFilter === cat
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
                }`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filteredCommands?.map(cmd => {
              const result = results[cmd.id];
              return (
                <div key={cmd.id} className="noc-panel">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">
                        {CATEGORY_LABELS[cmd.category] || cmd.category}
                      </span>
                      <span className="text-sm font-medium">{cmd.label}</span>
                      {result && (
                        result.exitCode === 0
                          ? <CheckCircle2 size={14} className="text-green-500" />
                          : <XCircle size={14} className="text-destructive" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {result && <span className="text-xs text-muted-foreground font-mono">{result.durationMs}ms</span>}
                      <button
                        onClick={() => handleRun(cmd.id)}
                        disabled={runCommand.isPending}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50"
                      >
                        <Play size={12} /> Run
                      </button>
                    </div>
                  </div>
                  <code className="text-xs text-muted-foreground font-mono">$ {cmd.command}</code>
                  {result && (
                    <div className="mt-2">
                      <CommandOutput content={result.stdout || result.stderr || '(no output)'} maxHeight="300px" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
