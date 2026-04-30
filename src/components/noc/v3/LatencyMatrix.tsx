interface Resolver { name: string; ip?: string; latencyMs: number; healthy?: boolean }
interface Upstream { name: string; ip: string; latencyMs: number; healthy?: boolean }

interface Props {
  frontend: { name: string; qps: number; latencyMs: number };
  resolvers: Resolver[];
  upstreams: Upstream[];
}

export default function LatencyMatrix({ frontend, resolvers, upstreams }: Props) {
  const colorFor = (ms: number, healthy = true) => {
    if (!healthy || ms <= 0) return 'hsl(var(--destructive))';
    return ms < 30 ? 'hsl(var(--primary))' : ms < 100 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
  };

  // Layout coordinates (percent-based) for SVG connector lines
  const FE = { x: 14, y: 50 };
  const resolverPositions = resolvers.map((_, i, arr) => ({
    x: 50,
    y: arr.length === 1 ? 50 : 25 + (50 / Math.max(arr.length - 1, 1)) * i,
  }));
  const upstreamPositions = upstreams.map((_, i, arr) => ({
    x: 86,
    y: arr.length === 1 ? 50 : 25 + (50 / Math.max(arr.length - 1, 1)) * i,
  }));

  return (
    <div className="relative min-h-[240px] py-3 font-mono text-[10px]">
      {/* Animated connector lines (SVG overlay) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="lat-line-mint" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.05" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="lat-line-red" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity="0.05" />
            <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity="0.5" />
          </linearGradient>
        </defs>

        {/* FE → Resolvers */}
        {resolvers.map((r, i) => {
          const p = resolverPositions[i];
          const c = colorFor(r.latencyMs, r.healthy);
          const isOk = r.healthy !== false && r.latencyMs > 0;
          return (
            <g key={`l-r-${i}`}>
              <line x1={FE.x} y1={FE.y} x2={p.x} y2={p.y}
                stroke={c} strokeWidth="0.3" strokeOpacity="0.5" strokeDasharray="1.5 1" />
              {isOk && (
                <circle r="0.7" fill={c}>
                  <animateMotion dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite"
                    path={`M ${FE.x} ${FE.y} L ${p.x} ${p.y}`} />
                  <animate attributeName="opacity" values="0;1;1;0" dur={`${1.5 + i * 0.3}s`} repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}

        {/* Resolvers → Upstreams (animated, same treatment as FE→Resolvers) */}
        {resolverPositions.map((rp, i) =>
          upstreamPositions.map((up, j) => {
            const u = upstreams[j];
            const c = colorFor(u.latencyMs, u.healthy);
            const isOk = u.healthy !== false && u.latencyMs > 0;
            const dur = `${1.8 + ((i + j) * 0.35)}s`;
            return (
              <g key={`l-u-${i}-${j}`}>
                <line x1={rp.x} y1={rp.y} x2={up.x} y2={up.y}
                  stroke={c} strokeWidth="0.3" strokeOpacity="0.55" strokeDasharray="1.5 1" />
                {isOk && (
                  <circle r="0.6" fill={c}>
                    <animateMotion dur={dur} repeatCount="indefinite"
                      path={`M ${rp.x} ${rp.y} L ${up.x} ${up.y}`} />
                    <animate attributeName="opacity" values="0;1;1;0" dur={dur} repeatCount="indefinite" />
                  </circle>
                )}
              </g>
            );
          })
        )}
      </svg>

      <div className="relative flex items-center justify-between gap-1 z-10 h-[200px]">
        {/* Frontend node */}
        <div className="flex flex-col items-center gap-1.5" style={{ width: '22%' }}>
          <div className="w-14 h-14 rounded-full bg-card border border-primary/60 flex items-center justify-center relative"
            style={{ boxShadow: '0 0 20px -2px hsl(var(--primary) / 0.6)' }}>
            <span className="absolute inset-0 rounded-full border border-primary/40 animate-ping" style={{ animationDuration: '2.4s' }} />
            <svg width="20" height="20" viewBox="0 0 24 24" fill="hsl(var(--primary))">
              <path d="M13 2 L4 14 H11 L9 22 L20 10 H13 Z" />
            </svg>
          </div>
          <div className="text-[9px] font-bold text-primary uppercase tracking-wider">{frontend.name}</div>
          <div className="text-muted-foreground text-[9px]">{frontend.qps} qps</div>
          <div className="text-primary text-[10px] font-bold">{frontend.latencyMs}ms</div>
        </div>

        {/* Resolvers column */}
        <div className="flex flex-col gap-2 items-center justify-around h-full" style={{ width: '32%' }}>
          {resolvers.map((r, i) => {
            const c = colorFor(r.latencyMs, r.healthy);
            const isOk = r.healthy !== false && r.latencyMs > 0;
            return (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className="text-[10px] font-bold" style={{ color: c }}>
                  {isOk ? `${r.latencyMs}ms` : 'down'}
                </div>
                <div className="w-11 h-11 rounded-full bg-card border-2 flex items-center justify-center relative"
                  style={{ borderColor: c, boxShadow: `0 0 14px -3px ${c}` }}>
                  {isOk && (
                    <span className="absolute inset-0 rounded-full border" style={{ borderColor: c, opacity: 0.5, animation: 'noc-ping 2s ease-out infinite' }} />
                  )}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2">
                    <circle cx="12" cy="12" r="5" /><path d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22" />
                  </svg>
                </div>
                <div className="text-[9px] font-bold uppercase" style={{ color: c }}>{r.name}</div>
                {r.ip && <div className="text-muted-foreground text-[8px]">{r.ip}</div>}
              </div>
            );
          })}
        </div>

        {/* Upstreams column */}
        <div className="flex flex-col gap-2 items-center justify-around h-full" style={{ width: '32%' }}>
          {upstreams.map((u, i) => {
            const c = colorFor(u.latencyMs, u.healthy);
            return (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div className="text-[10px] font-bold" style={{ color: c }}>{u.latencyMs}ms</div>
                <div className="w-11 h-11 rounded-full bg-card border-2 flex items-center justify-center"
                  style={{ borderColor: c, boxShadow: `0 0 14px -3px ${c}` }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2">
                    <circle cx="12" cy="12" r="9" /><path d="M3 12 H21 M12 3 C15 7 15 17 12 21 C9 17 9 7 12 3" />
                  </svg>
                </div>
                <div className="text-[10px] font-bold text-foreground/90">{u.name}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 text-[9px] px-1">
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-primary" /><span className="text-primary">&lt;30ms</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-warning" /><span className="text-warning">30-100ms</span></span>
        <span className="flex items-center gap-1"><span className="w-3 h-px bg-destructive" /><span className="text-destructive">&gt;100ms</span></span>
      </div>
    </div>
  );
}
