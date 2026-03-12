import { useEffect, useState } from 'react';
import { RefreshCw, Radio, Shield, Clock } from 'lucide-react';

interface NocStatusBannerProps {
  allHealthy: boolean;
  failedCount: number;
  totalInstances: number;
  healthyCount: number;
  onReconcile: () => void;
  reconciling: boolean;
}

export default function NocStatusBanner({
  allHealthy, failedCount, totalInstances, healthyCount,
  onReconcile, reconciling,
}: NocStatusBannerProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isCritical = failedCount > 0 && failedCount >= totalInstances;
  const isDegraded = failedCount > 0 && !isCritical;

  const statusLabel = isCritical
    ? 'CRITICAL — ALL RESOLVERS DOWN'
    : isDegraded
    ? `DEGRADED — ${failedCount} RESOLVER${failedCount > 1 ? 'S' : ''} FAILED`
    : 'SYSTEM OPERATIONAL';

  const bannerClass = isCritical
    ? 'noc-banner-critical'
    : isDegraded
    ? 'noc-banner-degraded'
    : 'noc-banner-operational';

  const statusColor = isCritical ? 'bg-destructive' : isDegraded ? 'bg-warning' : 'bg-success';
  const textColor = isCritical ? 'text-destructive' : isDegraded ? 'text-warning' : 'text-success';

  return (
    <div className={`noc-banner ${bannerClass} animate-slide-in-up`}>
      <div className="relative z-10 flex items-center justify-between w-full flex-wrap gap-4">
        {/* Left: status */}
        <div className="flex items-center gap-4">
          <div className={`noc-status-ring ${statusColor}`} />
          <div>
            <div className="flex items-center gap-2">
              <Radio size={12} className="text-muted-foreground" />
              <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                DNS CONTROL
              </span>
              <span className="text-[10px] text-muted-foreground/60 tracking-wider">
                CARRIER EDITION
              </span>
            </div>
            <div className={`text-sm font-mono font-bold mt-1 ${textColor} tracking-wide`}>
              {statusLabel}
            </div>
          </div>
        </div>

        {/* Right: metadata + actions */}
        <div className="flex items-center gap-5">
          <div className="hidden md:flex items-center gap-4 text-[10px] text-muted-foreground uppercase tracking-wider">
            <div className="flex items-center gap-1.5">
              <Shield size={11} />
              <span className="font-mono font-bold text-foreground">{healthyCount}/{totalInstances}</span>
              <span>resolvers</span>
            </div>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1.5">
              <Clock size={11} />
              <span className="font-mono tabular-nums text-foreground">
                {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          </div>

          <button
            onClick={onReconcile}
            disabled={reconciling}
            className="flex items-center gap-1.5 px-4 py-2 text-[11px] font-mono font-bold uppercase tracking-wider rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition-all"
          >
            <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
            Reconcile
          </button>
        </div>
      </div>
    </div>
  );
}
