interface Backend { name: string; ip: string; cacheHit?: number; qps?: number; }
interface Props {
  clientLabel?: string;
  frontendIp?: string | null;
  frontendQps?: number;
  backends: Backend[];
  upstreamLabel?: string;
}

export default function TopologyMini({
  clientLabel = 'CLIENTES DNS', frontendIp, frontendQps = 0, backends, upstreamLabel = 'UPSTREAM DNS',
}: Props) {
  return (
    <div className="flex items-center justify-between gap-4 py-6 px-2 min-h-[220px] font-mono text-[10px]">
      {/* Clients */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center"
          style={{ boxShadow: '0 0 18px -4px hsl(var(--primary) / 0.5)' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.6">
            <circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" />
            <path d="M3 20 c0-3 3-5 6-5 s6 2 6 5" /><path d="M14 20 c0-2.5 2-4 4-4 s4 1.5 4 4" />
          </svg>
        </div>
        <div className="text-[9px] font-bold uppercase tracking-wider text-primary">{clientLabel}</div>
      </div>

      {/* Edge → Frontend */}
      <Edge />

      {/* Frontend DNS */}
      <div className="flex flex-col items-center gap-2">
        <div className="px-3 py-2.5 rounded-lg bg-card border border-primary/40 text-center min-w-[140px]"
          style={{ boxShadow: '0 0 22px -4px hsl(var(--primary) / 0.4)' }}>
          <div className="text-[9px] font-bold text-primary uppercase tracking-wider">Frontend DNS</div>
          <div className="text-foreground font-mono text-[11px] mt-0.5">{frontendIp || '—'}</div>
          <div className="text-muted-foreground text-[9px] mt-0.5">{frontendQps} q/s</div>
        </div>
      </div>

      {/* Edge → Backends */}
      <div className="flex flex-col gap-2">
        {backends.map(() => <Edge key={Math.random()} />)}
      </div>

      {/* Backends */}
      <div className="flex flex-col gap-2">
        {backends.length === 0 && (
          <div className="text-muted-foreground text-[10px]">Nenhum backend</div>
        )}
        {backends.map((b) => (
          <div key={b.name} className="px-3 py-2 rounded-md bg-card border border-primary/25 min-w-[140px]"
            style={{ boxShadow: '0 0 14px -6px hsl(var(--primary) / 0.4)' }}>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary"
                style={{ boxShadow: '0 0 6px hsl(var(--primary))' }} />
              <span className="text-primary text-[10px] font-bold">{b.name}</span>
            </div>
            <div className="text-foreground/90 text-[10px] font-mono mt-0.5">{b.ip}</div>
            <div className="text-muted-foreground text-[9px] mt-0.5">
              {b.qps ?? 0} q/s · {b.cacheHit ?? 0}% cache
            </div>
          </div>
        ))}
      </div>

      {/* Edge → Upstream */}
      <Edge />

      {/* Upstream */}
      <div className="flex flex-col items-center gap-2">
        <div className="px-3 py-2.5 rounded-lg bg-warning/10 border border-warning/40 text-center min-w-[120px]"
          style={{ boxShadow: '0 0 18px -6px hsl(var(--warning) / 0.5)' }}>
          <div className="flex items-center justify-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            <span className="text-warning text-[9px] font-bold uppercase tracking-wider">{upstreamLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Edge() {
  return (
    <svg width="40" height="2" className="flex-shrink-0">
      <line x1="0" y1="1" x2="40" y2="1" stroke="hsl(var(--primary) / 0.5)" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}
