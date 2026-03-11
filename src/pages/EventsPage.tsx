import { useState } from 'react';
import { AlertTriangle, Info, AlertCircle, Search, Filter } from 'lucide-react';
import { LoadingState } from '@/components/DataStates';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';

export default function EventsPage() {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['events', severity],
    queryFn: async () => {
      const r = await api.getEvents(severity === 'all' ? undefined : severity);
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 5000,
  });

  if (isLoading) return <LoadingState />;

  const events = data?.items ?? [];
  const filtered = search
    ? events.filter(e => e.message.toLowerCase().includes(search.toLowerCase()) || e.event_type.includes(search.toLowerCase()))
    : events;

  const severityIcon = (s: string) => {
    if (s === 'critical') return <AlertCircle size={14} className="text-destructive" />;
    if (s === 'warning') return <AlertTriangle size={14} className="text-yellow-500" />;
    return <Info size={14} className="text-muted-foreground" />;
  };

  const severityBg = (s: string) => {
    if (s === 'critical') return 'border-l-destructive bg-destructive/5';
    if (s === 'warning') return 'border-l-yellow-500 bg-yellow-500/5';
    return 'border-l-muted-foreground';
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Eventos Operacionais</h1>
        <p className="text-sm text-muted-foreground">Histórico de eventos do motor de saúde e reconciliação</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar eventos..."
            className="w-full pl-8 pr-3 py-2 text-sm rounded border border-border bg-background text-foreground"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'critical', 'warning', 'info'] as SeverityFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                severity === s
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
              }`}
            >
              {s === 'all' ? 'Todos' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} eventos</span>
      </div>

      {/* Events list */}
      <div className="space-y-1">
        {filtered.length === 0 && (
          <div className="noc-panel text-center py-8 text-muted-foreground text-sm">
            Nenhum evento encontrado
          </div>
        )}
        {filtered.map(ev => (
          <div
            key={ev.id}
            className={`flex items-start gap-3 px-3 py-2.5 rounded border-l-2 border border-border ${severityBg(ev.severity)}`}
          >
            <div className="mt-0.5">{severityIcon(ev.severity)}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                  {ev.event_type}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.created_at).toLocaleString('pt-BR')}
                </span>
              </div>
              <p className="text-sm mt-1 text-foreground">{ev.message}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
