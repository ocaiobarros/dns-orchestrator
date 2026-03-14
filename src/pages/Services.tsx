import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useServices, useRestartService } from '@/lib/hooks';
import { toast } from 'sonner';

function formatMemory(svc: any): string {
  if (typeof svc.memory === 'string' && svc.memory) return svc.memory;
  const bytes = typeof svc.memoryBytes === 'number' ? svc.memoryBytes : 0;
  if (bytes <= 0) return svc.memory || 'N/A';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

function getServiceStatus(svc: any): string {
  if (svc.nftables_status === 'active') return 'running';
  if (svc.nftables_status === 'empty' || svc.nftables_status === 'unavailable') return 'stopped';
  if (svc.status) return svc.status;
  if (svc.active === true) return 'running';
  if (svc.active === false) return 'stopped';
  return 'unknown';
}

function getStatusLabel(svc: any): string {
  if (svc.nftables_status === 'active') return 'Ruleset ativo';
  if (svc.nftables_status === 'empty') return 'Sem ruleset';
  if (svc.nftables_status === 'unavailable') return 'Indisponível';
  const st = getServiceStatus(svc);
  if (st === 'running') return 'Ativo';
  if (st === 'active') return 'Ativo';
  if (st === 'stopped') return 'Parado';
  return st;
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
        <p className="text-sm text-muted-foreground">Estado real dos serviços do sistema</p>
      </div>

      <div className="grid gap-4">
        {services?.map((svc: any) => {
          const status = getServiceStatus(svc);
          const displayName = svc.display_name || svc.name;
          const isNft = svc.name === 'nftables';
          return (
            <div key={svc.name} className="noc-panel">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-mono font-medium">{displayName}</h3>
                  {svc.name.startsWith('unbound') && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 font-mono">
                      DNS Resolver
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{getStatusLabel(svc)}</span>
                  <StatusBadge status={status} />
                </div>
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
                  <p className="font-mono">{svc.cpu || 'N/A'}</p>
                </div>
                <div>
                  <span className="metric-label">Uptime</span>
                  <p className="font-mono">{svc.uptime || '—'}</p>
                </div>
                {isNft && svc.tables && (
                  <div>
                    <span className="metric-label">Tabelas</span>
                    <p className="font-mono text-xs">{svc.tables.length > 0 ? svc.tables.join(', ') : 'nenhuma'}</p>
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                {!isNft && (
                  <button onClick={() => handleRestart(svc.name)} disabled={restartMutation.isPending}
                    className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50">
                    Restart
                  </button>
                )}
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
