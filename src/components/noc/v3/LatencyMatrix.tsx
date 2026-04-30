interface Resolver { name: string; ip?: string; latencyMs: number; }
interface Upstream { name: string; ip: string; latencyMs: number; }

interface Props {
  frontend: { name: string; qps: number; latencyMs: number };
  resolvers: Resolver[];
  upstreams: Upstream[];
}

export default function LatencyMatrix({ frontend, resolvers, upstreams }: Props) {
  const colorFor = (ms: number) =>
    ms < 30 ? 'hsl(var(--primary))' : ms < 100 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';

  return (
    <div className="relative min-h-[220px] flex items-center justify-between gap-2 py-4 font-mono text-[10px]">
      {/* Frontend node */}
      <div className="flex flex-col items-center gap-2 z-10">
        <div className="w-16 h-16 rounded-full bg-card border border-primary/50 flex flex-col items-center justify-center"
          style={{ boxShadow: '0 0 24px -4px hsl(var(--primary) / 0.5)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="hsl(var(--primary))">
            <path d="M13 2 L4 14 H11 L9 22 L20 10 H13 Z" />
          </svg>
        </div>
        <div className="text-[9px] font-bold text-primary uppercase">{frontend.name}</div>
        <div className="text-muted-foreground text-[9px]">{frontend.qps} qps</div>
        <div className="text-primary text-[10px] font-bold">{frontend.latencyMs}ms</div>
      </div>

      {/* Resolvers column */}
      <div className="flex flex-col gap-6 z-10">
        {resolvers.map((r, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] font-bold" style={{ color: colorFor(r.latencyMs) }}>
              {r.latencyMs}ms
            </div>
            <div className="w-14 h-14 rounded-full bg-card border-2 flex items-center justify-center"
              style={{ borderColor: colorFor(r.latencyMs), boxShadow: `0 0 20px -4px ${colorFor(r.latencyMs)}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={colorFor(r.latencyMs)} strokeWidth="2">
                <circle cx="12" cy="12" r="5" /><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22" />
              </svg>
            </div>
            <div className="text-[9px] font-bold uppercase" style={{ color: colorFor(r.latencyMs) }}>{r.name}</div>
            {r.ip && <div className="text-muted-foreground text-[8px]">{r.ip}</div>}
          </div>
        ))}
      </div>

      {/* Upstreams column */}
      <div className="flex flex-col gap-6 z-10">
        {upstreams.map((u, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] font-bold text-destructive">{u.latencyMs}ms</div>
            <div className="w-14 h-14 rounded-full bg-card border-2 border-destructive/60 flex items-center justify-center"
              style={{ boxShadow: '0 0 20px -4px hsl(var(--destructive) / 0.6)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--destructive))" strokeWidth="2">
                <circle cx="12" cy="12" r="9" /><path d="M3 12 H21 M12 3 C15 7 15 17 12 21 C9 17 9 7 12 3" />
              </svg>
            </div>
            <div className="text-[10px] font-bold text-foreground/90">{u.name}</div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-0 left-0 flex items-center gap-3 text-[9px]">
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-primary" /><span className="text-primary">&lt;30ms</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-warning" /><span className="text-warning">30-100ms</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-destructive" /><span className="text-destructive">&gt;100ms</span></span>
      </div>
    </div>
  );
}
