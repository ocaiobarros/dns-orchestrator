import { CheckCircle, XCircle, Zap, Activity } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';

interface NocHealthPanelProps {
  health: InstanceHealthReport | null | undefined;
}

function latencyColor(ms: number): string {
  if (ms < 30) return 'text-success';
  if (ms < 100) return 'text-warning';
  return 'text-destructive';
}

function latencyBarColor(ms: number): string {
  if (ms < 30) return 'bg-success';
  if (ms < 100) return 'bg-warning';
  return 'bg-destructive';
}

function latencyBarWidth(ms: number): string {
  const pct = Math.min((ms / 200) * 100, 100);
  return `${Math.max(pct, 4)}%`;
}

export default function NocHealthPanel({ health }: NocHealthPanelProps) {
  if (!health || !Array.isArray(health.instances) || !health.instances.length) return null;

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title">
          <Activity size={12} className="text-accent" />
          DNS RESOLUTION HEALTH
        </div>

        {/* VIP Anycast row */}
        {health.vip && (
          <div className="flex items-center justify-between py-3 mt-3 px-3 rounded border border-border/60 bg-secondary/20">
            <div className="flex items-center gap-3">
              <Zap size={14} className="text-primary" />
              <div>
                <span className="text-sm font-mono font-bold text-foreground">{health.vip.bind_ip}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider ml-2">VIP ANYCAST</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm font-mono font-bold ${latencyColor(health.vip.latency_ms ?? 0)}`}>
                {health.vip.latency_ms ?? 0}ms
              </span>
              {health.vip.healthy ? (
                <span className="flex items-center gap-1 text-[11px] font-mono font-bold text-success">
                  <CheckCircle size={13} /> OK
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] font-mono font-bold text-destructive">
                  <XCircle size={13} /> FAIL
                </span>
              )}
            </div>
          </div>
        )}

        {/* Instance rows with latency bars */}
        <div className="mt-3 space-y-0">
          {health.instances.map((inst, i) => {
            const ms = inst.latency_ms ?? 0;
            return (
              <div
                key={inst.instance}
                className="noc-health-row animate-slide-in-up"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {inst.healthy ?
                    <span className="noc-dot-running" /> :
                    <span className="noc-dot-error" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium text-foreground">{inst.instance}</span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">{inst.bind_ip}:{inst.port}</span>
                    </div>
                    {inst.healthy && inst.resolved_ip && (
                      <span className="text-[10px] text-muted-foreground font-mono">→ {inst.resolved_ip}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* Latency bar */}
                  <div className="w-16 h-1 bg-border/40 rounded-full overflow-hidden">
                    <div
                      className={`noc-latency-bar ${latencyBarColor(ms)}`}
                      style={{ width: latencyBarWidth(ms) }}
                    />
                  </div>
                  <span className={`text-xs font-mono font-bold tabular-nums min-w-[40px] text-right ${latencyColor(ms)}`}>
                    {ms}ms
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
