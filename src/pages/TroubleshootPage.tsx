import { useState } from 'react';
import { Play, Loader2, CheckCircle2, XCircle, ShieldAlert, AlertTriangle, RefreshCw } from 'lucide-react';
import CommandOutput from '@/components/CommandOutput';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useDiagCommands, useRunDiagCommand, useHealthCheck } from '@/lib/hooks';
import type { DiagResult } from '@/lib/types';

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
}

interface HealthBatchResponse {
  success: boolean;
  started_at: string;
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  results: HealthBatchResult[];
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'ok':
      return <CheckCircle2 size={14} className="text-green-500" />;
    case 'permission_error':
      return <ShieldAlert size={14} className="text-amber-500" />;
    case 'dependency_error':
    case 'timeout_error':
      return <AlertTriangle size={14} className="text-amber-500" />;
    default:
      return <XCircle size={14} className="text-destructive" />;
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case 'ok': return 'OK';
    case 'permission_error': return 'Sem permissão';
    case 'dependency_error': return 'Dependência';
    case 'timeout_error': return 'Timeout';
    case 'runtime_error': return 'Erro runtime';
    case 'error': return 'Erro';
    default: return status;
  }
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case 'ok':
      return 'bg-green-500/15 text-green-600 border-green-500/30';
    case 'permission_error':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
    case 'dependency_error':
    case 'timeout_error':
      return 'bg-amber-500/15 text-amber-600 border-amber-500/30';
    default:
      return 'bg-destructive/15 text-destructive border-destructive/30';
  }
}

export default function TroubleshootPage() {
  const { data: commands, isLoading, error } = useDiagCommands();
  const runCommand = useRunDiagCommand();
  const healthCheck = useHealthCheck();
  const [results, setResults] = useState<Record<string, DiagResult>>({});
  const [batchSummary, setBatchSummary] = useState<{ total: number; passed: number; failed: number } | null>(null);
  const [batchResults, setBatchResults] = useState<Record<string, HealthBatchResult>>({});
  const [filter, setFilter] = useState<string>('all');

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const categories = ['all', ...new Set(commands?.map(c => c.category) ?? [])];
  const filtered = filter === 'all' ? commands : commands?.filter(c => c.category === filter);

  const handleRun = (cmdId: string) => {
    runCommand.mutate(cmdId, {
      onSuccess: (result) => setResults(prev => ({ ...prev, [cmdId]: result })),
    });
  };

  const handleRunAll = () => {
    setBatchSummary(null);
    setBatchResults({});
    healthCheck.mutate(undefined, {
      onSuccess: (rawData: unknown) => {
        // The backend now returns a consolidated batch object, not a plain array
        const data = rawData as HealthBatchResponse;
        if (data && data.results && Array.isArray(data.results)) {
          // New consolidated format
          const map: Record<string, HealthBatchResult> = {};
          const diagMap: Record<string, DiagResult> = {};
          data.results.forEach((r: HealthBatchResult) => {
            const id = r.commandId || r.command_id || '';
            map[id] = r;
            // Also populate DiagResult for individual display compatibility
            diagMap[id] = {
              commandId: id,
              exitCode: r.exitCode ?? r.exit_code ?? -1,
              stdout: r.stdout || '',
              stderr: r.stderr || '',
              durationMs: r.durationMs ?? r.duration_ms ?? 0,
              timestamp: r.timestamp || new Date().toISOString(),
            };
          });
          setBatchResults(map);
          setResults(prev => ({ ...prev, ...diagMap }));
          setBatchSummary({ total: data.total, passed: data.passed, failed: data.failed });
        } else if (Array.isArray(rawData)) {
          // Legacy array format fallback
          const diagMap: Record<string, DiagResult> = {};
          (rawData as DiagResult[]).forEach((r: DiagResult) => {
            const id = r.commandId || (r as any).command_id || '';
            diagMap[id] = r;
          });
          setResults(prev => ({ ...prev, ...diagMap }));
          const passed = Object.values(diagMap).filter(r => r.exitCode === 0).length;
          setBatchSummary({ total: Object.keys(diagMap).length, passed, failed: Object.keys(diagMap).length - passed });
        }
      },
      onError: () => {
        // Even on network error, stop loading and show message
        setBatchSummary({ total: 0, passed: 0, failed: 0 });
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Troubleshooting</h1>
          <p className="text-sm text-muted-foreground">Testes e diagnóstico em tempo real</p>
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

      {/* Batch summary */}
      {batchSummary && (
        <div className="noc-panel flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Resultado do Health Check</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-secondary border border-border">
              Total: {batchSummary.total}
            </span>
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-green-500/15 text-green-600 border border-green-500/30">
              ✓ {batchSummary.passed}
            </span>
            {batchSummary.failed > 0 && (
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-destructive/15 text-destructive border border-destructive/30">
                ✗ {batchSummary.failed}
              </span>
            )}
          </div>
          <button
            onClick={handleRunAll}
            disabled={healthCheck.isPending}
            className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCw size={12} /> Reexecutar
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
              filter === cat
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered?.map(cmd => {
          const result = results[cmd.id];
          const batch = batchResults[cmd.id];
          return (
            <div key={cmd.id} className="noc-panel">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{cmd.category}</span>
                  <span className="text-sm font-medium">{cmd.label}</span>
                  {batch && (
                    <>
                      {getStatusIcon(batch.status)}
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${getStatusBadgeClass(batch.status)}`}>
                        {getStatusLabel(batch.status)}
                      </span>
                    </>
                  )}
                  {!batch && result && (
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
    </div>
  );
}
