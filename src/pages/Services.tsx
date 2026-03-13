import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useServices, useRestartService } from '@/lib/hooks';
import { toast } from 'sonner';

function safeNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatMemory(svc: any): string {
  // Handle real API: memory as string ("50.2M", "128K") or memoryBytes as number
  if (typeof svc.memory === 'string' && svc.memory) return svc.memory;
  const bytes = safeNum(svc.memoryBytes ?? svc.memory_bytes);
  if (bytes <= 0) return 'N/A';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function formatCpu(svc: any): string {
  // Handle real API: cpu as string ("1.2%") or cpuPercent as number
  if (typeof svc.cpu === 'string' && svc.cpu) return svc.cpu;
  const pct = svc.cpuPercent ?? svc.cpu_percent;
  if (pct == null || pct === undefined) return 'N/A';
  const n = safeNum(pct);
  return `${n.toFixed(1)}%`;
}

function getServiceStatus(svc: any): string {
  if (svc.status) return svc.status;
  if (svc.active === true) return 'running';
  if (svc.active === false) return 'stopped';
  return 'unknown';
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
        {services?.map((svc: any) => {
          const status = getServiceStatus(svc);
          const displayName = svc.display_name || svc.name;
          return (
            <div key={svc.name} className="noc-panel">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-mono font-medium">{displayName}</h3>
                <StatusBadge status={status} />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                <div>
                  <span className="metric-label">PID</span>
                  <p className="font-mono">{svc.pid ?? 'N/A'}</p>
                </div>
                <div>
                  <span className="metric-label">Memória</span>
                  <p className="font-mono">{formatMemory(svc)}</p>
                </div>
                <div>
                  <span className="metric-label">CPU</span>
                  <p className="font-mono">{formatCpu(svc)}</p>
                </div>
                <div>
                  <span className="metric-label">Restarts</span>
                  <p className="font-mono">{svc.restartCount ?? svc.restart_count ?? '—'}</p>
                </div>
                <div>
                  <span className="metric-label">Uptime</span>
                  <p className="font-mono">{svc.uptime || '—'}</p>
                </div>
              </div>
              {(svc.lastLog || svc.last_log) && (
                <div className="mt-2 text-xs text-muted-foreground font-mono truncate">
                  Último log: {svc.lastLog || svc.last_log}
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
          );
        })}
      </div>
    </div>
  );
}
