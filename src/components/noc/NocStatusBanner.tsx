import { useEffect, useState } from 'react';
import { RefreshCw, Shield } from 'lucide-react';

interface NocStatusBannerProps {
  allHealthy: boolean;
  failedCount: number;
  totalInstances: number;
  onReconcile: () => void;
  reconciling: boolean;
}

export default function NocStatusBanner({ allHealthy, failedCount, totalInstances, onReconcile, reconciling }: NocStatusBannerProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const statusLabel = failedCount > 0
    ? `DEGRADADO — ${failedCount} instância${failedCount > 1 ? 's' : ''} com falha`
    : 'SYSTEM OPERATIONAL';

  const statusColor = failedCount > 0 ? 'bg-destructive' : 'bg-success';

  return (
    <div className="noc-banner animate-slide-in-up">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className={`noc-status-ring ${statusColor}`} />
          <div>
            <div className="text-sm font-semibold tracking-wide text-foreground">
              DNS CONTROL <span className="text-muted-foreground font-normal">— Carrier Edition</span>
            </div>
            <div className={`text-xs font-mono font-medium mt-0.5 ${failedCount > 0 ? 'text-destructive' : 'text-success'}`}>
              ● {statusLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield size={12} />
          <span className="font-mono">{totalInstances} resolvers</span>
        </div>

        <div className="text-xs font-mono text-muted-foreground tabular-nums">
          {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>

        <button
          onClick={onReconcile}
          disabled={reconciling}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
          Reconciliar
        </button>
      </div>
    </div>
  );
}
