import { useState } from 'react';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useLogs } from '@/lib/hooks';
import type { LogSource } from '@/lib/types';
import { Download } from 'lucide-react';

const logSources: { value: LogSource | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'apply', label: 'Apply' },
  { value: 'unbound', label: 'Unbound' },
  { value: 'frr', label: 'FRR' },
  { value: 'nftables', label: 'nftables' },
  { value: 'system', label: 'Sistema' },
];

const levelColors: Record<string, string> = {
  ok: 'text-success',
  info: '',
  warn: 'text-warning',
  error: 'text-destructive',
  debug: 'text-muted-foreground',
};

export default function LogsPage() {
  const [source, setSource] = useState<LogSource | 'all'>('all');
  const [search, setSearch] = useState('');
  const activeSource = source === 'all' ? undefined : source;

  const { data, isLoading, error, refetch } = useLogs(activeSource, search || undefined);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Logs</h1>
          <p className="text-sm text-muted-foreground">Logs do sistema e dos serviços</p>
        </div>
        <button className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
          <Download size={12} /> Exportar
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {logSources.map(s => (
          <button
            key={s.value}
            onClick={() => setSource(s.value)}
            className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
              source === s.value
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Buscar nos logs..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {isLoading ? <LoadingState /> :
       error ? <ErrorState message={error.message} onRetry={() => refetch()} /> :
       !data?.items.length ? <EmptyState title="Nenhum log encontrado" description="Ajuste os filtros ou aguarde novos eventos" /> : (
        <div className="terminal-output max-h-[500px]">
          {data.items.map(entry => (
            <div key={entry.id} className={`py-0.5 flex gap-2 ${levelColors[entry.level] || ''}`}>
              <span className="text-muted-foreground shrink-0">{new Date(entry.timestamp).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              <span className={`shrink-0 w-12 text-right ${levelColors[entry.level]}`}>[{entry.level.toUpperCase()}]</span>
              {entry.service && <span className="text-accent shrink-0">{entry.service}</span>}
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div className="text-xs text-muted-foreground">
          Mostrando {data.items.length} de {data.total} registros
        </div>
      )}
    </div>
  );
}
