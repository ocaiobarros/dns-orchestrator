import { CheckCircle, XCircle, Zap } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';

interface NocHealthPanelProps {
  health: InstanceHealthReport | null | undefined;
}

export default function NocHealthPanel({ health }: NocHealthPanelProps) {
  if (!health || !Array.isArray(health.instances) || !health.instances.length) return null;

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-section-title mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse-glow" />
        Health Check — dig @instância
      </div>

      {health.vip && (
        <div className="flex items-center justify-between py-2 px-3 mb-3 rounded-md bg-secondary/40 border border-border">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-primary" />
            <span className="text-sm font-mono font-semibold text-foreground">{health.vip.bind_ip}</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">VIP Anycast</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground">{health.vip.latency_ms ?? 0}ms</span>
            {health.vip.healthy ? (
              <span className="flex items-center gap-1 text-xs font-medium text-success"><CheckCircle size={12} /> OK</span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-medium text-destructive"><XCircle size={12} /> FAIL</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-0.5">
        {health.instances.map((inst, i) => (
          <div key={inst.instance} className="noc-health-row animate-slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center gap-2">
              {inst.healthy ?
                <CheckCircle size={13} className="text-success" /> :
                <XCircle size={13} className="text-destructive" />}
              <span className="text-sm font-mono text-foreground">{inst.instance}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{inst.bind_ip}:{inst.port}</span>
            </div>
            <div className="flex items-center gap-4">
              {inst.healthy && inst.resolved_ip && (
                <span className="text-[10px] text-muted-foreground font-mono">→ {inst.resolved_ip}</span>
              )}
              <span className={`text-xs font-mono font-medium ${
                (inst.latency_ms ?? 0) < 10 ? 'text-success' :
                (inst.latency_ms ?? 0) < 50 ? 'text-warning' : 'text-destructive'
              }`}>
                {inst.latency_ms ?? 0}ms
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
