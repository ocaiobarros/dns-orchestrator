interface Backend { name: string; ip: string; cacheHit?: number; qps?: number; healthy?: boolean }
interface Props {
  clientLabel?: string;
  frontendIp?: string | null;
  frontendQps?: number;
  backends: Backend[];
  upstreamLabel?: string;
}

export default function TopologyMini({
  clientLabel = 'CLIENTES DNS', frontendIp, frontendQps = 0, backends, upstreamLabel = 'UPSTREAM',
}: Props) {
  // Frontend may be a single IP or a comma-separated list (Simple mode = multiple listeners).
  const frontendIps = (frontendIp || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const primaryIp = frontendIps[0] || '—';
  const extraCount = Math.max(frontendIps.length - 1, 0);
  const allIpsTitle = frontendIps.length > 1 ? frontendIps.join('\n') : undefined;

  return (
    <div className="relative flex items-center justify-between gap-1.5 py-4 px-1 min-h-[220px] w-full min-w-0 overflow-hidden font-mono text-[9px]">
      {/* Clients */}
      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
        <div className="w-11 h-11 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center"
          style={{ boxShadow: '0 0 14px -4px hsl(var(--primary) / 0.5)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(var(--primary))" strokeWidth="1.6">
            <circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" />
            <path d="M3 20 c0-3 3-5 6-5 s6 2 6 5" /><path d="M14 20 c0-2.5 2-4 4-4 s4 1.5 4 4" />
          </svg>
        </div>
        <div className="text-[8px] font-bold uppercase tracking-wider text-primary text-center leading-tight">{clientLabel}</div>
      </div>

      <AnimatedEdge />

      {/* Frontend DNS */}
      <div className="flex flex-col items-center gap-1.5 flex-shrink min-w-0">
        <div className="px-2 py-1.5 rounded-lg bg-card border border-primary/40 text-center min-w-0 w-full max-w-[clamp(96px,11vw,160px)]"
          style={{ boxShadow: '0 0 18px -4px hsl(var(--primary) / 0.4)' }}
          title={allIpsTitle}>
          <div className="text-[8px] font-bold text-primary uppercase tracking-wider">Frontend DNS</div>
          <div className="flex items-center justify-center gap-1 mt-0.5 min-w-0">
            <span className="text-foreground font-mono text-[9.5px] leading-tight truncate">{primaryIp}</span>
            {extraCount > 0 && (
              <span className="flex-shrink-0 px-1 rounded bg-primary/15 text-primary text-[8px] font-bold leading-tight">
                +{extraCount}
              </span>
            )}
          </div>
          <div className="text-muted-foreground text-[8px] mt-0.5">{frontendQps} q/s</div>
        </div>
      </div>


      <AnimatedEdge multiple={Math.min(backends.length, 4)} />

      {/* Backends */}
      <div className="flex flex-col gap-1.5 flex-shrink min-w-0">
        {backends.length === 0 && (
          <div className="text-muted-foreground text-[10px]">Sem backends</div>
        )}
        {backends.slice(0, 4).map((b) => {
          const ok = b.healthy !== false;
          return (
            <div key={b.name} className="px-2 py-0.5 rounded-md bg-card border min-w-0 w-full max-w-[clamp(96px,11vw,160px)]"
              style={{
                borderColor: ok ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--destructive) / 0.4)',
                boxShadow: ok ? '0 0 10px -5px hsl(var(--primary) / 0.4)' : '0 0 10px -5px hsl(var(--destructive) / 0.4)',
              }}>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-destructive'}`}
                  style={{
                    boxShadow: ok ? '0 0 5px hsl(var(--primary))' : '0 0 5px hsl(var(--destructive))',
                    animation: 'noc-pulse 1.6s ease-in-out infinite',
                  }} />
                <span className={`text-[9px] font-bold ${ok ? 'text-primary' : 'text-destructive'}`}>{b.name}</span>
              </div>
              <div className="text-foreground/90 text-[9px] font-mono truncate">{b.ip}</div>
              <div className="text-muted-foreground text-[8px]">
                {b.qps ?? 0} q/s · {b.cacheHit ?? 0}%
              </div>
            </div>
          );
        })}
        {backends.length > 4 && (
          <div className="text-[9px] font-mono text-muted-foreground/70 text-center">
            +{backends.length - 4} backend(s)
          </div>
        )}
      </div>

      <AnimatedEdge />

      {/* Upstream */}
      <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
        <div className="px-2 py-1.5 rounded-lg bg-warning/10 border border-warning/40 text-center"
          style={{ boxShadow: '0 0 14px -5px hsl(var(--warning) / 0.5)' }}>
          <div className="flex items-center justify-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-warning"
              style={{ animation: 'noc-pulse 1.6s ease-in-out infinite' }} />
            <span className="text-warning text-[8px] font-bold uppercase tracking-wider">{upstreamLabel}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnimatedEdge({ multiple = 1 }: { multiple?: number }) {
  const lines = Math.max(multiple, 1);
  return (
    <svg width="28" height={Math.max(20, lines * 16)} className="flex-shrink-0" viewBox={`0 0 28 ${Math.max(20, lines * 16)}`}>
      {Array.from({ length: lines }).map((_, i) => {
        const y = lines === 1 ? 10 : 8 + (i * (Math.max(20, lines * 16) - 16) / Math.max(lines - 1, 1));
        return (
          <g key={i}>
            <line x1="0" y1={y} x2="28" y2={y}
              stroke="hsl(var(--primary) / 0.4)" strokeWidth="1" strokeDasharray="2 2" />
            <circle cx="0" cy={y} r="1.4" fill="hsl(var(--primary))">
              <animate attributeName="cx" from="0" to="28" dur={`${1.2 + i * 0.2}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;1;1;0" dur={`${1.2 + i * 0.2}s`} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
