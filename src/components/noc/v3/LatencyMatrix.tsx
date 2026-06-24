import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface Resolver { name: string; ip?: string; latencyMs: number; healthy?: boolean }
interface Upstream { name: string; ip: string; latencyMs: number; healthy?: boolean }

interface Props {
  frontend: { name: string; qps: number; latencyMs: number };
  resolvers: Resolver[];
  upstreams: Upstream[];
}

/**
 * Latency map for DNS recursive resolver.
 *
 * Context (CRITICAL — a number without context misleads operators):
 *   - Frontend → Resolvers: internal hop over the loopback plane (lo/lo0).
 *     Expected ~0–1 ms. Anything else is a host-internal problem.
 *   - Resolvers → Upstreams: **recursive resolution latency** on cache MISS
 *     (the resolver had to walk the internet to fetch a fresh name).
 *     Typical real-world range is 100–200 ms; >400 ms is worth investigating.
 *     The vast majority of queries hit the cache and answer in <1 ms — those
 *     do NOT appear here.
 *
 * Color bands are tuned for INTERNET RECURSION, not LAN ping. Using
 * <30/30-100/>100 ms (LAN bands) would paint a healthy resolver red.
 */
export default function LatencyMatrix({ frontend, resolvers, upstreams }: Props) {
  // Bands for INTERNAL hops (loopback): sub-millisecond is normal.
  const colorForInternal = (ms: number, healthy = true) => {
    if (!healthy || ms < 0) return 'hsl(var(--destructive))';
    return ms <= 5 ? 'hsl(var(--primary))' : ms <= 20 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
  };

  // Bands for RECURSIVE resolution (internet cache-miss).
  // Normal: ≤200ms · Atenção: 200–400ms · Lento: >400ms.
  const colorForRecursive = (ms: number, healthy = true) => {
    if (!healthy || ms <= 0) return 'hsl(var(--destructive))';
    return ms <= 200 ? 'hsl(var(--primary))' : ms <= 400 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
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
    <TooltipProvider delayDuration={150}>
      <div className="relative w-full min-w-0 overflow-hidden py-3 font-mono text-[10px]">
        {/* Column context headers — explica O QUE é cada número */}
        <div className="relative z-10 grid grid-cols-3 gap-1 text-[9px] uppercase tracking-wider mb-1">
          <div className="text-center text-muted-foreground/80">
            <div className="font-bold text-primary/90">Frontend</div>
            <div className="normal-case tracking-normal text-[8.5px] text-muted-foreground/60">
              rede interna (loopback)
            </div>
          </div>
          <div className="text-center text-muted-foreground/80">
            <div className="font-bold text-primary/90">Resolvers</div>
            <div className="normal-case tracking-normal text-[8.5px] text-muted-foreground/60">
              backends locais (loopback)
            </div>
          </div>
          <div className="text-center text-muted-foreground/80">
            <div className="font-bold text-primary/90 flex items-center justify-center gap-1">
              Recursão (internet)
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="O que é latência de recursão?"
                    className="inline-flex items-center text-muted-foreground/70 hover:text-primary"
                  >
                    <HelpCircle size={10} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-[11px] leading-snug">
                  Tempo para o resolver buscar um nome <strong>não cacheado</strong> na
                  internet (cache miss). Com ~92% de cache hit, a maioria das consultas é
                  respondida em &lt;1 ms a partir do cache e NÃO aparece aqui. 100–200 ms
                  é normal para recursão real.
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="normal-case tracking-normal text-[8.5px] text-muted-foreground/60">
              cache miss — resolver nome novo
            </div>
          </div>
        </div>

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

          {/* FE → Resolvers (loopback hop — internal bands) */}
          {resolvers.map((r, i) => {
            const p = resolverPositions[i];
            const c = colorForInternal(r.latencyMs, r.healthy);
            const isOk = r.healthy !== false && r.latencyMs >= 0;
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

          {/* Resolvers → Upstreams (recursão internet — recursive bands) */}
          {resolverPositions.map((rp, i) =>
            upstreamPositions.map((up, j) => {
              const u = upstreams[j];
              const c = colorForRecursive(u.latencyMs, u.healthy);
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

        <div className="relative flex items-stretch justify-between gap-1 z-10 h-[280px]">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-primary text-[10px] font-bold cursor-help">{frontend.latencyMs}ms</div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px] max-w-[240px]">
                Latência interna do frontend (loopback). Espera-se ~0–1 ms.
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Resolvers column (internal — loopback bands) */}
          <div className="flex flex-col gap-2 items-center justify-around h-full" style={{ width: '32%' }}>
            {resolvers.map((r, i) => {
              const c = colorForInternal(r.latencyMs, r.healthy);
              const isOk = r.healthy !== false && r.latencyMs >= 0;
              return (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-[10px] font-bold cursor-help" style={{ color: c }}>
                        {isOk ? `${r.latencyMs}ms` : 'down'}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] max-w-[240px]">
                      Hop interno frontend → resolver via loopback. Esperado ~0–1 ms.
                    </TooltipContent>
                  </Tooltip>
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

          {/* Upstreams column (recursive — internet bands) */}
          <div className="flex flex-col gap-2 items-center justify-around h-full" style={{ width: '32%' }}>
            {upstreams.map((u, i) => {
              const c = colorForRecursive(u.latencyMs, u.healthy);
              return (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="text-[10px] font-bold cursor-help" style={{ color: c }}>{u.latencyMs}ms</div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px] max-w-[260px]">
                      Latência de <strong>recursão</strong> (cache miss): tempo de resolver um
                      nome NOVO na internet. 100–200 ms é normal; &gt;400 ms é lento.
                    </TooltipContent>
                  </Tooltip>
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

        {/* Legend — bands REAIS de DNS recursivo + nota explicativa */}
        <div className="mt-3 space-y-1.5 text-[10px] leading-snug">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" />
              <span className="text-foreground/85">
                <strong className="text-primary">Normal</strong> — recursão típica (≤200 ms)
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-warning" />
              <span className="text-foreground/85">
                <strong className="text-warning">Atenção</strong> — recursão lenta (200–400 ms)
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive" />
              <span className="text-foreground/85">
                <strong className="text-destructive">Lento</strong> — investigar (&gt;400 ms)
              </span>
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-snug">
            Recursão é o tempo de buscar um nome <strong>não cacheado</strong> na internet —
            100–200 ms é normal. A maioria das respostas vem do cache (instantâneas, &lt;1 ms)
            e não aparece neste mapa.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
