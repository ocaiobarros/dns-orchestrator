import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useServices, useRestartService } from '@/lib/hooks';
import { toast } from 'sonner';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

export default function Services() {
  const { data: services, isLoading, error, refetch } = useServices();
  const restartMutation = useRestartService();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  const handleRestart = (name: string) => {
    restartMutation.mutate(name, {
      onSuccess: () => toast.success(`${name} reiniciado com sucesso`),
      onError: (err) => toast.error(`Falha ao reiniciar ${name}: ${err.message}`),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Serviços</h1>
        <p className="text-sm text-muted-foreground">Estado dos serviços do sistema</p>
      </div>

      <div className="grid gap-4">
        {services?.map(svc => (
          <div key={svc.name} className="noc-panel">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono font-medium">{svc.name}</h3>
              <StatusBadge status={svc.status} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <span className="metric-label">PID</span>
                <p className="font-mono">{svc.pid ?? 'N/A'}</p>
              </div>
              <div>
                <span className="metric-label">Memória</span>
                <p className="font-mono">{formatBytes(svc.memoryBytes)}</p>
              </div>
              <div>
                <span className="metric-label">CPU</span>
                <p className="font-mono">{svc.cpuPercent !== null ? `${svc.cpuPercent}%` : 'N/A'}</p>
              </div>
              <div>
                <span className="metric-label">Restarts</span>
                <p className="font-mono">{svc.restartCount}</p>
              </div>
              <div>
                <span className="metric-label">Uptime</span>
                <p className="font-mono">{svc.uptime}</p>
              </div>
            </div>
            {svc.lastLog && (
              <div className="mt-2 text-xs text-muted-foreground font-mono truncate">
                Último log: {svc.lastLog}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button onClick={() => handleRestart(svc.name)} disabled={restartMutation.isPending}
                className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50">
                Restart
              </button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                Logs
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
