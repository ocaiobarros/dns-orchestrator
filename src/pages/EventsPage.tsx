import { useState } from 'react';
import { AlertTriangle, Info, AlertCircle, Search, Clock } from 'lucide-react';
import { LoadingState } from '@/components/DataStates';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';

export default function EventsPage() {
  const [severity, setSeverity] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState('all');

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

  // Collect unique event types for filter
  const eventTypes = Array.from(new Set(events.map(e => e.event_type)));

  const filtered = events.filter(e => {
    if (eventTypeFilter !== 'all' && e.event_type !== eventTypeFilter) return false;
    if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.event_type.includes(search.toLowerCase())) return false;
    return true;
  });

  // Summary counts
  const criticalCount = events.filter(e => e.severity === 'critical').length;
  const warningCount = events.filter(e => e.severity === 'warning').length;
  const infoCount = events.filter(e => e.severity === 'info').length;

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
        <p className="text-sm text-muted-foreground">Histórico de eventos do motor de saúde e reconciliação — v2.1</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="noc-panel flex items-center gap-3 py-3">
          <AlertCircle size={18} className="text-destructive" />
          <div>
            <div className="text-lg font-mono font-semibold text-destructive">{criticalCount}</div>
            <div className="text-xs text-muted-foreground">Críticos</div>
          </div>
        </div>
        <div className="noc-panel flex items-center gap-3 py-3">
          <AlertTriangle size={18} className="text-yellow-500" />
          <div>
            <div className="text-lg font-mono font-semibold text-yellow-500">{warningCount}</div>
            <div className="text-xs text-muted-foreground">Warnings</div>
          </div>
        </div>
        <div className="noc-panel flex items-center gap-3 py-3">
          <Info size={18} className="text-muted-foreground" />
          <div>
            <div className="text-lg font-mono font-semibold">{infoCount}</div>
            <div className="text-xs text-muted-foreground">Info</div>
          </div>
        </div>
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
        {/* Event type filter */}
        <select
          value={eventTypeFilter}
          onChange={e => setEventTypeFilter(e.target.value)}
          className="px-2 py-1.5 text-xs rounded border border-border bg-background text-foreground"
        >
          <option value="all">Todos os tipos</option>
          {eventTypes.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
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
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                  {ev.event_type}
                </span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  ev.severity === 'critical' ? 'bg-destructive/10 text-destructive' :
                  ev.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-500' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {ev.severity}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={10} />
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
