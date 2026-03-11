import StatusBadge from '@/components/StatusBadge';
import ApplyStepsViewer from '@/components/ApplyStepsViewer';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useHistory } from '@/lib/hooks';

export default function HistoryPage() {
  const { data, isLoading, error, refetch } = useHistory();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (!data?.items.length) return <EmptyState title="Nenhuma aplicação registrada" description="Execute o wizard para criar a primeira configuração" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Histórico de Aplicações</h1>
        <p className="text-sm text-muted-foreground">{data.total} registros</p>
      </div>

      <div className="space-y-4">
        {data.items.map(h => (
          <div key={h.id} className="noc-panel">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{h.id}</span>
                <StatusBadge status={h.status} />
                {h.dryRun && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">dry-run</span>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{h.scope}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-muted-foreground font-mono block">{new Date(h.timestamp).toLocaleString('pt-BR')}</span>
                <span className="text-xs text-muted-foreground">{h.duration}ms · {h.user}</span>
              </div>
            </div>

            {h.comment && (
              <p className="text-sm text-muted-foreground mb-3">"{h.comment}"</p>
            )}

            <div className="mb-3">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Etapas de Execução</span>
              <div className="mt-1">
                <ApplyStepsViewer steps={h.steps} showCommands={false} />
              </div>
            </div>

            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Reaplicar</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Ver Diff</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Ver Arquivos</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Exportar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
