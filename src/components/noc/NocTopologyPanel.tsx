import { motion } from 'framer-motion';
import { Globe, Server, Wifi, Zap, Activity } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  dnsAvailable?: boolean;
  /** Aggregate DNS telemetry to display on nodes */
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatency?: number;
  dnsMetricsAvailable?: boolean;
}

/* ── Color helpers ── */
function statusColor(healthy: boolean) {
  return healthy ? 'hsl(152, 76%, 40%)' : 'hsl(0, 76%, 50%)';
}
function latencyColor(ms: number) {
  if (ms < 30) return 'hsl(152, 76%, 40%)';
  if (ms < 100) return 'hsl(38, 95%, 50%)';
  return 'hsl(0, 76%, 50%)';
}
function dimColor() {
  return 'hsl(218, 15%, 30%)';
}

/** Stroke width based on qps — thicker = more traffic */
function qpsStrokeWidth(qps: number): number {
  if (qps <= 0) return 0.8;
  if (qps < 1000) return 1;
  if (qps < 10000) return 1.6;
  if (qps < 50000) return 2.2;
  return 2.8;
}

/** Particle count based on qps */
function qpsParticleCount(qps: number): number {
  if (qps <= 0) return 1;
  if (qps < 1000) return 2;
  if (qps < 10000) return 3;
  return 4;
}

/* ── Animated packet dots ── */
function FlowParticles({ pathId, color, count = 2, duration = 3 }: { pathId: string; color: string; count?: number; duration?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r="2.5" fill={color} opacity="0">
          <animateMotion dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`}>
            <mpath href={`#${pathId}`} />
          </animateMotion>
          <animate attributeName="opacity" values="0;0.6;0.6;0" dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`} />
        </circle>
      ))}
    </>
  );
}

/* ── Rich data node ── */
function TopoNode({ cx, cy, label, sublabel, healthy, icon: Icon, size = 'md', dimmed = false, metrics }: {
  cx: number; cy: number; label: string; sublabel?: string; healthy: boolean;
  icon: typeof Globe; size?: 'lg' | 'md'; dimmed?: boolean;
  metrics?: { line1?: string; line2?: string; line3?: string };
}) {
  const color = dimmed ? dimColor() : statusColor(healthy);
  const r = size === 'lg' ? 28 : 22;
  const iconSize = size === 'lg' ? 16 : 13;

  return (
    <g>
      {/* Glow ring — healthy active nodes */}
      {healthy && !dimmed && (
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={color} strokeWidth="0.5" opacity="0.10">
          <animate attributeName="r" values={`${r + 5};${r + 9};${r + 5}`} dur="5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.10;0.03;0.10" dur="5s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Background disc */}
      <circle cx={cx} cy={cy} r={r} fill={`${color.replace(')', ' / 0.08)')}`} stroke={color} strokeWidth={dimmed ? '0.8' : '1.4'} opacity={dimmed ? 0.45 : 1} />
      {/* Icon */}
      <foreignObject x={cx - iconSize / 2} y={cy - iconSize / 2} width={iconSize} height={iconSize}>
        <div className="flex items-center justify-center w-full h-full">
          <Icon size={iconSize} style={{ color, opacity: dimmed ? 0.5 : 1 }} />
        </div>
      </foreignObject>
      {/* Label below node */}
      <text x={cx} y={cy + r + 13} textAnchor="middle" fill="hsl(210, 25%, 95%)" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.35 : 0.85}>
        {label}
      </text>
      {sublabel && (
        <text x={cx} y={cy + r + 24} textAnchor="middle" fill="hsl(218, 15%, 46%)" fontSize="7.5" fontFamily="var(--font-mono)" opacity={dimmed ? 0.25 : 0.5}>
          {sublabel}
        </text>
      )}
      {/* Rich metric lines below label */}
      {metrics && (
        <g>
          {metrics.line1 && (
            <text x={cx} y={cy + r + (sublabel ? 36 : 26)} textAnchor="middle" fill={color} fontSize="8" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.3 : 0.75}>
              {metrics.line1}
            </text>
          )}
          {metrics.line2 && (
            <text x={cx} y={cy + r + (sublabel ? 47 : 37)} textAnchor="middle" fill="hsl(218, 15%, 55%)" fontSize="7" fontFamily="var(--font-mono)" opacity={dimmed ? 0.2 : 0.5}>
              {metrics.line2}
            </text>
          )}
          {metrics.line3 && (
            <text x={cx} y={cy + r + (sublabel ? 57 : 47)} textAnchor="middle" fill="hsl(218, 15%, 50%)" fontSize="7" fontFamily="var(--font-mono)" opacity={dimmed ? 0.2 : 0.45}>
              {metrics.line3}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/* ── Latency badge on path ── */
function LatencyBadge({ cx, cy, ms, dimmed = false }: { cx: number; cy: number; ms: number; dimmed?: boolean }) {
  const color = dimmed ? dimColor() : latencyColor(ms);
  return (
    <g opacity={dimmed ? 0.35 : 1}>
      <rect x={cx - 18} y={cy - 8} width="36" height="16" rx="8" fill="hsl(225, 25%, 7%)" stroke={color} strokeWidth="0.6" />
      <text x={cx} y={cy + 3.5} textAnchor="middle" fill={color} fontSize="8" fontWeight="700" fontFamily="var(--font-mono)">
        {ms}ms
      </text>
    </g>
  );
}

/* ── QPS badge on path ── */
function QpsBadge({ cx, cy, qps, dimmed = false }: { cx: number; cy: number; qps: number; dimmed?: boolean }) {
  if (qps <= 0) return null;
  const label = qps >= 1000 ? `${(qps / 1000).toFixed(qps >= 10000 ? 0 : 1)}k` : String(qps);
  return (
    <g opacity={dimmed ? 0.25 : 0.7}>
      <rect x={cx - 16} y={cy - 7} width="32" height="14" rx="7" fill="hsl(225, 25%, 7%)" stroke="hsl(218, 15%, 30%)" strokeWidth="0.4" />
      <text x={cx} y={cy + 3} textAnchor="middle" fill="hsl(210, 40%, 70%)" fontSize="7" fontWeight="600" fontFamily="var(--font-mono)">
        {label} qps
      </text>
    </g>
  );
}

/* ── Full topology visualization ── */
function TopologyView({ health, vipConfigured, vipAddress, totalQueries, cacheHitRatio, avgLatency, dnsMetricsAvailable }: {
  health: InstanceHealthReport; vipConfigured?: boolean; vipAddress?: string | null;
  totalQueries?: number; cacheHitRatio?: number; avgLatency?: number; dnsMetricsAvailable?: boolean;
}) {
  const instances = health.instances || [];
  const vipHealthy = health.vip?.healthy ?? (vipConfigured ?? false);
  const vipDimmed = !vipConfigured && !health.vip;

  const svgW = 780;
  const svgH = instances.length <= 2 ? 240 : Math.min(80 + instances.length * 75, 400);

  const vipX = 100;
  const vipY = svgH / 2;
  const upstreamX = svgW - 100;
  const upstreamY = svgH / 2;

  const resolverX = svgW / 2;
  const resolverStartY = instances.length === 1 ? svgH / 2 : 55;
  const resolverSpacing = instances.length <= 1 ? 0 : (svgH - 110) / Math.max(instances.length - 1, 1);

  const anyHealthy = instances.some(i => i.healthy);
  const qps = totalQueries ?? 0;
  const perInstanceQps = instances.length > 0 ? Math.round(qps / instances.length) : 0;
  const sw = qpsStrokeWidth(qps);
  const pCount = qpsParticleCount(qps);

  // Upstream resolved IP from first healthy instance
  const upstreamIp = instances.find(i => i.healthy)?.resolved_ip || '—';
  const upstreamLatency = instances.length > 0
    ? Math.round(instances.reduce((a, b) => a + (b.latency_ms ?? 0), 0) / instances.length)
    : 0;

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" style={{ maxHeight: '400px' }}>
      <defs>
        <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(225, 22%, 11%)" strokeWidth="0.3" />
        </pattern>
        <filter id="glow-sm">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Gradient for healthy paths */}
        <linearGradient id="path-healthy" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.15" />
          <stop offset="50%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.15" />
        </linearGradient>
      </defs>

      <rect width={svgW} height={svgH} fill="url(#topo-grid)" opacity="0.2" />

      {/* ── Paths ── */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        const pathId1 = `p-vip-${i}`;
        const pathId2 = `p-up-${i}`;
        const color = statusColor(inst.healthy);
        const isDegraded = !inst.healthy;
        const pathLatColor = latencyColor(inst.latency_ms ?? 0);

        return (
          <g key={inst.instance}>
            {/* VIP → Resolver */}
            <path id={pathId1}
              d={`M ${vipX + 30} ${vipY} Q ${(vipX + resolverX) / 2} ${(vipY + ry) / 2} ${resolverX - 24} ${ry}`}
              fill="none"
              stroke={vipDimmed ? dimColor() : (isDegraded ? dimColor() : color)}
              strokeWidth={vipDimmed || isDegraded ? 0.8 : sw}
              opacity={vipDimmed ? 0.1 : isDegraded ? 0.15 : 0.3}
              strokeDasharray={vipDimmed || isDegraded ? '3 3' : 'none'}
            />
            {inst.healthy && !vipDimmed && (
              <FlowParticles pathId={pathId1} color={color} count={pCount} duration={2.8 + i * 0.3} />
            )}

            {/* Resolver → Upstream */}
            <path id={pathId2}
              d={`M ${resolverX + 24} ${ry} Q ${(resolverX + upstreamX) / 2} ${(ry + upstreamY) / 2} ${upstreamX - 30} ${upstreamY}`}
              fill="none"
              stroke={isDegraded ? dimColor() : pathLatColor}
              strokeWidth={isDegraded ? 0.8 : sw}
              opacity={isDegraded ? 0.12 : 0.3}
              strokeDasharray={isDegraded ? '3 3' : 'none'}
            />
            {inst.healthy && (
              <FlowParticles pathId={pathId2} color={pathLatColor} count={pCount} duration={3.2 + i * 0.2} />
            )}

            {/* Latency badge on resolver→upstream path */}
            <LatencyBadge
              cx={(resolverX + upstreamX) / 2 + 10}
              cy={(ry + upstreamY) / 2 - 10}
              ms={inst.latency_ms ?? 0}
              dimmed={isDegraded}
            />
          </g>
        );
      })}

      {/* ── Nodes ── */}

      {/* VIP */}
      <TopoNode cx={vipX} cy={vipY}
        label="VIP ANYCAST"
        sublabel={vipAddress || health.vip?.bind_ip || (vipConfigured ? undefined : 'Not configured')}
        healthy={vipHealthy}
        icon={Zap} size="lg"
        dimmed={vipDimmed}
        metrics={vipConfigured ? {
          line1: dnsMetricsAvailable ? `${qps >= 1000 ? `${(qps / 1000).toFixed(1)}k` : qps} qps` : undefined,
        } : { line1: 'Inactive' }}
      />

      {/* Resolvers */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        const instCacheHit = cacheHitRatio ?? 0;
        return (
          <TopoNode key={inst.instance} cx={resolverX} cy={ry}
            label={inst.instance}
            sublabel={`${inst.bind_ip}:${inst.port}`}
            healthy={inst.healthy}
            icon={Server}
            metrics={inst.healthy ? {
              line1: `${inst.latency_ms ?? 0}ms`,
              line2: dnsMetricsAvailable ? `cache ${instCacheHit.toFixed(0)}%` : undefined,
            } : { line1: inst.error ? 'Error' : 'Down' }}
          />
        );
      })}

      {/* Upstream */}
      <TopoNode cx={upstreamX} cy={upstreamY}
        label="UPSTREAM"
        sublabel={upstreamIp}
        healthy={anyHealthy}
        icon={Globe} size="lg"
        dimmed={!anyHealthy}
        metrics={anyHealthy ? {
          line1: `${upstreamLatency}ms avg`,
          line2: 'Reachable',
        } : { line1: 'Unreachable' }}
      />

      {/* QPS badge on VIP→Resolver mid-path (aggregate) */}
      {dnsMetricsAvailable && qps > 0 && instances.length > 0 && (
        <QpsBadge
          cx={(vipX + resolverX) / 2}
          cy={vipY - 16}
          qps={qps}
          dimmed={vipDimmed}
        />
      )}
    </svg>
  );
}

/* ── Unavailable state ── */
function UnavailableState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-3">
      <div className="w-10 h-10 rounded-full bg-muted/20 flex items-center justify-center border border-border/15">
        <Wifi size={16} className="text-muted-foreground/20" />
      </div>
      <p className="text-[11px] font-mono text-muted-foreground/30">{message}</p>
      <p className="text-[9px] font-mono text-muted-foreground/18">{sub}</p>
    </div>
  );
}

/* ── Main export ── */
export default function NocTopologyPanel({ health, vipConfigured, vipAddress, dnsAvailable, totalQueries, cacheHitRatio, avgLatency, dnsMetricsAvailable }: NocTopologyPanelProps) {
  const hasData = health && Array.isArray(health.instances) && health.instances.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="noc-surface-elevated"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-1">
          <div className="noc-section-head">
            <Wifi size={12} className="text-accent/70" />
            DNS RESOLUTION TOPOLOGY
          </div>
          <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider">
            {hasData && (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> healthy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> failed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: dimColor() }} /> inactive
                </span>
                {dnsMetricsAvailable && (
                  <span className="flex items-center gap-1.5">
                    <Activity size={8} className="text-muted-foreground/30" /> line = volume
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="noc-divider" />

        {hasData ? (
          <div className="mt-1">
            <TopologyView
              health={health!}
              vipConfigured={vipConfigured}
              vipAddress={vipAddress}
              totalQueries={totalQueries}
              cacheHitRatio={cacheHitRatio}
              avgLatency={avgLatency}
              dnsMetricsAvailable={dnsMetricsAvailable}
            />
          </div>
        ) : !dnsAvailable ? (
          <UnavailableState message="Telemetry unavailable" sub="DNS health data requires privileged access" />
        ) : (
          <UnavailableState message="Awaiting health telemetry" sub="Waiting for instance probe results" />
        )}
      </div>
    </motion.div>
  );
}
