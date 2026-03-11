import { useState } from 'react';
import { Play, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import CommandOutput from '@/components/CommandOutput';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useDiagCommands, useRunDiagCommand, useHealthCheck } from '@/lib/hooks';
import type { DiagResult } from '@/lib/types';

export default function TroubleshootPage() {
  const { data: commands, isLoading, error } = useDiagCommands();
  const runCommand = useRunDiagCommand();
  const healthCheck = useHealthCheck();
  const [results, setResults] = useState<Record<string, DiagResult>>({});
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
    healthCheck.mutate(undefined, {
      onSuccess: (results) => {
        const map: Record<string, DiagResult> = {};
        results.forEach(r => { map[r.commandId] = r; });
        setResults(prev => ({ ...prev, ...map }));
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
          return (
            <div key={cmd.id} className="noc-panel">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{cmd.category}</span>
                  <span className="text-sm font-medium">{cmd.label}</span>
                  {result && (
                    result.exitCode === 0
                      ? <CheckCircle2 size={14} className="text-success" />
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
