import { motion } from 'framer-motion';
import { Globe, Server, Wifi, Zap, Activity, AlertTriangle } from 'lucide-react';
import { useState, forwardRef } from 'react';
import type { InstanceHealthReport } from '@/lib/types';
import { safeNum, safeR } from '@/lib/svg-utils';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  dnsAvailable?: boolean;
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatency?: number;
  dnsMetricsAvailable?: boolean;
}

/* ── Color helpers using CSS vars ── */
const C = {
  ok: 'hsl(152, 76%, 40%)',
  warn: 'hsl(38, 95%, 50%)',
  fail: 'hsl(0, 76%, 50%)',
  dim: 'hsl(218, 15%, 25%)',
  accent: 'hsl(190, 90%, 50%)',
  bg: 'hsl(225, 30%, 5%)',
  surface: 'hsl(225, 25%, 8%)',
  grid: 'hsl(225, 22%, 11%)',
  text: 'hsl(210, 25%, 95%)',
  textMuted: 'hsl(218, 15%, 46%)',
  textDim: 'hsl(218, 15%, 30%)',
};

function statusColor(healthy: boolean) {
  return healthy ? C.ok : C.fail;
}
function latencyColor(ms: number) {
  if (ms < 30) return C.ok;
  if (ms < 100) return C.warn;
  return C.fail;
}

function qpsStrokeWidth(qps: number): number {
  if (qps <= 0) return 1;
  if (qps < 1000) return 1.2;
  if (qps < 10000) return 1.8;
  if (qps < 50000) return 2.4;
  return 3;
}

function qpsParticleCount(qps: number): number {
  if (qps <= 0) return 1;
  if (qps < 1000) return 2;
  if (qps < 10000) return 3;
  return 4;
}

function formatQps(qps: number) {
  if (qps >= 1000000) return `${(qps / 1000000).toFixed(1)}M`;
  if (qps >= 1000) return `${(qps / 1000).toFixed(qps >= 10000 ? 0 : 1)}k`;
  return String(qps);
}

/* ── Animated flow particles ── */
function FlowParticles({ pathId, color, count = 2, duration = 3 }: { pathId: string; color: string; count?: number; duration?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r="2" fill={color} opacity="0">
          <animateMotion dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`}>
            <mpath href={`#${pathId}`} />
          </animateMotion>
          <animate attributeName="opacity" values="0;0.7;0.7;0" dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`} />
        </circle>
      ))}
    </>
  );
}

/* ── Network Map Node ── */
function MapNode({ cx, cy, label, sublabel, healthy, icon: Icon, size = 'md', dimmed = false, metrics, onHover }: {
  cx: number; cy: number; label: string; sublabel?: string; healthy: boolean;
  icon: typeof Globe; size?: 'lg' | 'md'; dimmed?: boolean;
  metrics?: { line1?: string; line2?: string; line3?: string };
  onHover?: (entering: boolean) => void;
}) {
  const color = dimmed ? C.dim : statusColor(healthy);
  const r = safeR(size === 'lg' ? 32 : 24, 24);
  const iconSize = size === 'lg' ? 18 : 14;
  const scx = safeNum(cx, 100);
  const scy = safeNum(cy, 100);

  return (
    <g
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      style={{ cursor: 'pointer' }}
    >
      {/* Outer radar ring — healthy nodes */}
      {healthy && !dimmed && (
        <>
          <circle cx={scx} cy={scy} r={r + 12} fill="none" stroke={color} strokeWidth="0.3" opacity="0.06">
            <animate attributeName="r" values={`${r + 10};${r + 16};${r + 10}`} dur="6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.06;0.02;0.06" dur="6s" repeatCount="indefinite" />
          </circle>
          <circle cx={scx} cy={scy} r={r + 6} fill="none" stroke={color} strokeWidth="0.5" opacity="0.08">
            <animate attributeName="r" values={`${r + 5};${r + 9};${r + 5}`} dur="4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.08;0.03;0.08" dur="4s" repeatCount="indefinite" />
          </circle>
        </>
      )}

      {/* Failing node alert pulse */}
      {!healthy && !dimmed && (
        <circle cx={scx} cy={scy} r={r + 4} fill="none" stroke={C.fail} strokeWidth="1" opacity="0">
          <animate attributeName="opacity" values="0;0.3;0" dur="2s" repeatCount="indefinite" />
          <animate attributeName="r" values={`${r + 2};${r + 10};${r + 2}`} dur="2s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Node background — glass effect */}
      <circle cx={scx} cy={scy} r={r} fill={C.surface} stroke={color} strokeWidth={dimmed ? '0.6' : '1.5'} opacity={dimmed ? 0.4 : 1} />
      <circle cx={scx} cy={scy} r={safeR(r - 1, 20)} fill={`${color.replace(')', ' / 0.06)')}`} opacity={dimmed ? 0.2 : 0.8} />

      {/* Status dot */}
      <circle cx={scx + r - 5} cy={scy - r + 5} r="3.5" fill={color} opacity={dimmed ? 0.3 : 0.9} />
      {healthy && !dimmed && (
        <circle cx={scx + r - 5} cy={scy - r + 5} r="3.5" fill={color} opacity="0">
          <animate attributeName="opacity" values="0;0.4;0" dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="r" values="3.5;6;3.5" dur="2.5s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Icon */}
      <foreignObject x={scx - iconSize / 2} y={scy - iconSize / 2} width={iconSize} height={iconSize}>
        <div className="flex items-center justify-center w-full h-full">
          <Icon size={iconSize} style={{ color, opacity: dimmed ? 0.4 : 1 }} />
        </div>
      </foreignObject>

      {/* Label */}
      <text x={scx} y={scy + r + 14} textAnchor="middle" fill={C.text} fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.3 : 0.85} letterSpacing="0.5">
        {label}
      </text>
      {sublabel && (
        <text x={scx} y={scy + r + 25} textAnchor="middle" fill={C.textMuted} fontSize="7.5" fontFamily="var(--font-mono)" opacity={dimmed ? 0.2 : 0.45}>
          {sublabel}
        </text>
      )}

      {/* Metric lines */}
      {metrics && (
        <g>
          {metrics.line1 && (
            <text x={scx} y={scy + r + (sublabel ? 37 : 27)} textAnchor="middle" fill={color} fontSize="8.5" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.25 : 0.8}>
              {metrics.line1}
            </text>
          )}
          {metrics.line2 && (
            <text x={scx} y={scy + r + (sublabel ? 48 : 38)} textAnchor="middle" fill={C.textMuted} fontSize="7" fontFamily="var(--font-mono)" opacity={dimmed ? 0.2 : 0.5}>
              {metrics.line2}
            </text>
          )}
          {metrics.line3 && (
            <text x={scx} y={scy + r + (sublabel ? 58 : 48)} textAnchor="middle" fill={C.textDim} fontSize="7" fontFamily="var(--font-mono)" opacity={dimmed ? 0.15 : 0.4}>
              {metrics.line3}
            </text>
          )}
        </g>
      )}
    </g>
  );
}

/* ── Latency badge ── */
function LatencyBadge({ cx, cy, ms, dimmed = false }: { cx: number; cy: number; ms: number; dimmed?: boolean }) {
  const color = dimmed ? C.dim : latencyColor(safeNum(ms, 0));
  const scx = safeNum(cx);
  const scy = safeNum(cy);
  return (
    <g opacity={dimmed ? 0.3 : 1}>
      <rect x={scx - 20} y={scy - 9} width="40" height="18" rx="9" fill={C.bg} stroke={color} strokeWidth="0.6" />
      <text x={scx} y={scy + 4} textAnchor="middle" fill={color} fontSize="8" fontWeight="700" fontFamily="var(--font-mono)">
        {safeNum(ms, 0)}ms
      </text>
    </g>
  );
}

/* ── QPS badge ── */
function QpsBadge({ cx, cy, qps, dimmed = false }: { cx: number; cy: number; qps: number; dimmed?: boolean }) {
  if (safeNum(qps, 0) <= 0) return null;
  const scx = safeNum(cx);
  const scy = safeNum(cy);
  return (
    <g opacity={dimmed ? 0.2 : 0.7}>
      <rect x={scx - 22} y={scy - 8} width="44" height="16" rx="8" fill={C.bg} stroke={C.dim} strokeWidth="0.4" />
      <text x={scx} y={scy + 3.5} textAnchor="middle" fill={C.accent} fontSize="7.5" fontWeight="600" fontFamily="var(--font-mono)">
        {formatQps(safeNum(qps, 0))} qps
      </text>
    </g>
  );
}

/* ── Tooltip overlay ── */
function NodeTooltip({ cx, cy, data }: { cx: number; cy: number; data: { title: string; lines: string[] } }) {
  const w = 140;
  const lineH = 13;
  const h = 22 + data.lines.length * lineH;
  const tx = cx - w / 2;
  const ty = cy - h - 45;

  return (
    <g>
      <rect x={tx} y={ty} width={w} height={h} rx="6" fill="hsl(225, 25%, 10%)" stroke={C.accent} strokeWidth="0.6" opacity="0.95" />
      <text x={cx} y={ty + 14} textAnchor="middle" fill={C.accent} fontSize="8" fontWeight="700" fontFamily="var(--font-mono)">
        {data.title}
      </text>
      {data.lines.map((line, i) => (
        <text key={i} x={tx + 8} y={ty + 27 + i * lineH} fill={C.textMuted} fontSize="7" fontFamily="var(--font-mono)">
          {line}
        </text>
      ))}
    </g>
  );
}

/* ── Full topology visualization ── */
function TopologyView({ health, vipConfigured, vipAddress, totalQueries, cacheHitRatio, avgLatency, dnsMetricsAvailable }: {
  health: InstanceHealthReport; vipConfigured?: boolean; vipAddress?: string | null;
  totalQueries?: number; cacheHitRatio?: number; avgLatency?: number; dnsMetricsAvailable?: boolean;
}) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const instances = health.instances || [];
  const vipHealthy = health.vip?.healthy ?? (vipConfigured ?? false);
  const vipDimmed = !vipConfigured && !health.vip;

  const svgW = 860;
  const svgH = Math.max(280, Math.min(100 + instances.length * 80, 440));

  const vipX = 110;
  const vipY = svgH / 2;
  const upstreamX = svgW - 110;
  const upstreamY = svgH / 2;

  const resolverX = svgW / 2;
  const resolverStartY = instances.length === 1 ? svgH / 2 : 65;
  const resolverSpacing = instances.length <= 1 ? 0 : (svgH - 130) / Math.max(instances.length - 1, 1);

  const anyHealthy = instances.some(i => i.healthy);
  const qps = totalQueries ?? 0;
  const sw = qpsStrokeWidth(qps);
  const pCount = qpsParticleCount(qps);

  const upstreamIp = instances.find(i => i.healthy)?.resolved_ip || '—';
  const upstreamLatency = instances.length > 0
    ? Math.round(instances.reduce((a, b) => a + (b.latency_ms ?? 0), 0) / instances.length) : 0;

  const instCacheHit = cacheHitRatio ?? 0;

  // Tooltip data
  const tooltipData: Record<string, { title: string; lines: string[] }> = {
    vip: {
      title: 'VIP ANYCAST',
      lines: [
        `Address: ${vipAddress || health.vip?.bind_ip || 'N/A'}`,
        `Status: ${vipConfigured ? (vipHealthy ? 'Active' : 'Degraded') : 'Not configured'}`,
        `Throughput: ${dnsMetricsAvailable ? `${formatQps(qps)} qps` : 'N/A'}`,
      ],
    },
    upstream: {
      title: 'UPSTREAM DNS',
      lines: [
        `Resolved: ${upstreamIp}`,
        `Avg Latency: ${upstreamLatency}ms`,
        `Status: ${anyHealthy ? 'Reachable' : 'Unreachable'}`,
      ],
    },
  };

  instances.forEach(inst => {
    tooltipData[inst.instance] = {
      title: inst.instance,
      lines: [
        `Bind: ${inst.bind_ip}:${inst.port}`,
        `Latency: ${inst.latency_ms ?? 0}ms`,
        `Cache Hit: ${instCacheHit.toFixed(1)}%`,
        `Status: ${inst.healthy ? 'Healthy' : inst.error || 'Failed'}`,
      ],
    };
  });

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" style={{ minHeight: '280px', maxHeight: '440px' }}>
      <defs>
        {/* Grid pattern */}
        <pattern id="noc-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={C.grid} strokeWidth="0.25" />
        </pattern>
        {/* Radar circles */}
        <radialGradient id="radar-fade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={C.accent} stopOpacity="0.03" />
          <stop offset="70%" stopColor={C.accent} stopOpacity="0.01" />
          <stop offset="100%" stopColor={C.accent} stopOpacity="0" />
        </radialGradient>
        {/* Path gradients */}
        <linearGradient id="path-ok" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.ok} stopOpacity="0.12" />
          <stop offset="50%" stopColor={C.ok} stopOpacity="0.3" />
          <stop offset="100%" stopColor={C.ok} stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="path-warn" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.warn} stopOpacity="0.12" />
          <stop offset="50%" stopColor={C.warn} stopOpacity="0.3" />
          <stop offset="100%" stopColor={C.warn} stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="path-fail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={C.fail} stopOpacity="0.1" />
          <stop offset="50%" stopColor={C.fail} stopOpacity="0.25" />
          <stop offset="100%" stopColor={C.fail} stopOpacity="0.1" />
        </linearGradient>
        <filter id="glow-node">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background layers */}
      <rect width={svgW} height={svgH} fill="transparent" />
      <rect width={svgW} height={svgH} fill="url(#noc-grid)" opacity="0.25" />
      <ellipse cx={svgW / 2} cy={svgH / 2} rx={svgW * 0.4} ry={svgH * 0.4} fill="url(#radar-fade)" />

      {/* Concentric radar rings */}
      {[0.15, 0.25, 0.38].map((r, i) => (
        <ellipse key={i} cx={svgW / 2} cy={svgH / 2} rx={svgW * r} ry={svgH * r}
          fill="none" stroke={C.accent} strokeWidth="0.2" opacity="0.04" strokeDasharray="4 6" />
      ))}

      {/* ── Connection Paths ── */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        const pathId1 = `p-vip-${i}`;
        const pathId2 = `p-up-${i}`;
        const color = statusColor(inst.healthy);
        const isDegraded = !inst.healthy;
        const pathLatColor = latencyColor(inst.latency_ms ?? 0);

        // Curved paths
        const cp1x = (vipX + resolverX) / 2;
        const cp1y = (vipY + ry) / 2;
        const cp2x = (resolverX + upstreamX) / 2;
        const cp2y = (ry + upstreamY) / 2;

        return (
          <g key={inst.instance}>
            {/* VIP → Resolver */}
            <path id={pathId1}
              d={`M ${vipX + 34} ${vipY} Q ${cp1x} ${cp1y} ${resolverX - 26} ${ry}`}
              fill="none"
              stroke={vipDimmed ? C.dim : (isDegraded ? C.dim : color)}
              strokeWidth={vipDimmed || isDegraded ? 0.8 : sw}
              opacity={vipDimmed ? 0.08 : isDegraded ? 0.12 : 0.25}
              strokeDasharray={vipDimmed || isDegraded ? '4 4' : 'none'}
            />
            {inst.healthy && !vipDimmed && (
              <FlowParticles pathId={pathId1} color={color} count={pCount} duration={2.5 + i * 0.3} />
            )}

            {/* Resolver → Upstream */}
            <path id={pathId2}
              d={`M ${resolverX + 26} ${ry} Q ${cp2x} ${cp2y} ${upstreamX - 34} ${upstreamY}`}
              fill="none"
              stroke={isDegraded ? C.dim : pathLatColor}
              strokeWidth={isDegraded ? 0.8 : sw}
              opacity={isDegraded ? 0.1 : 0.25}
              strokeDasharray={isDegraded ? '4 4' : 'none'}
            />
            {inst.healthy && (
              <FlowParticles pathId={pathId2} color={pathLatColor} count={pCount} duration={3 + i * 0.2} />
            )}

            {/* Latency badge */}
            <LatencyBadge cx={cp2x + 15} cy={cp2y - 12} ms={inst.latency_ms ?? 0} dimmed={isDegraded} />
          </g>
        );
      })}

      {/* ── Nodes ── */}

      {/* VIP Anycast */}
      <MapNode cx={vipX} cy={vipY}
        label="VIP ANYCAST"
        sublabel={vipAddress || health.vip?.bind_ip || (vipConfigured ? undefined : 'Not configured')}
        healthy={vipHealthy} icon={Zap} size="lg" dimmed={vipDimmed}
        onHover={(e) => setHoveredNode(e ? 'vip' : null)}
        metrics={vipConfigured ? {
          line1: dnsMetricsAvailable ? `${formatQps(qps)} qps` : undefined,
        } : { line1: 'Inactive' }}
      />

      {/* Resolvers */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        return (
          <MapNode key={inst.instance} cx={resolverX} cy={ry}
            label={inst.instance}
            sublabel={`${inst.bind_ip}:${inst.port}`}
            healthy={inst.healthy} icon={Server}
            onHover={(e) => setHoveredNode(e ? inst.instance : null)}
            metrics={inst.healthy ? {
              line1: `${inst.latency_ms ?? 0}ms`,
              line2: dnsMetricsAvailable ? `cache ${instCacheHit.toFixed(0)}%` : undefined,
            } : { line1: inst.error ? 'Error' : 'Down' }}
          />
        );
      })}

      {/* Upstream */}
      <MapNode cx={upstreamX} cy={upstreamY}
        label="UPSTREAM"
        sublabel={upstreamIp}
        healthy={anyHealthy} icon={Globe} size="lg" dimmed={!anyHealthy}
        onHover={(e) => setHoveredNode(e ? 'upstream' : null)}
        metrics={anyHealthy ? {
          line1: `${upstreamLatency}ms avg`,
          line2: 'Reachable',
        } : { line1: 'Unreachable' }}
      />

      {/* QPS badge on VIP→Resolver aggregate */}
      {dnsMetricsAvailable && qps > 0 && instances.length > 0 && (
        <QpsBadge cx={(vipX + resolverX) / 2} cy={vipY - 18} qps={qps} dimmed={vipDimmed} />
      )}

      {/* Flow direction arrows */}
      <g opacity="0.15">
        <text x={(vipX + resolverX) / 2} y={svgH - 14} textAnchor="middle" fill={C.textMuted} fontSize="7" fontFamily="var(--font-mono)" letterSpacing="2">
          QUERY FLOW →
        </text>
      </g>

      {/* Tooltips */}
      {hoveredNode && tooltipData[hoveredNode] && (() => {
        let tx = resolverX, ty = svgH / 2;
        if (hoveredNode === 'vip') { tx = vipX; ty = vipY; }
        else if (hoveredNode === 'upstream') { tx = upstreamX; ty = upstreamY; }
        else {
          const idx = instances.findIndex(i => i.instance === hoveredNode);
          if (idx >= 0) ty = instances.length === 1 ? svgH / 2 : resolverStartY + idx * resolverSpacing;
        }
        return <NodeTooltip cx={tx} cy={ty} data={tooltipData[hoveredNode]} />;
      })()}
    </svg>
  );
}

/* ── Unavailable state ── */
function UnavailableState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/10 flex items-center justify-center border border-border/10">
        <Wifi size={18} className="text-muted-foreground/15" />
      </div>
      <p className="text-[11px] font-mono text-muted-foreground/25">{message}</p>
      <p className="text-[9px] font-mono text-muted-foreground/15">{sub}</p>
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
      className="noc-surface-elevated h-full"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-2">
          <div className="noc-section-head">
            <Wifi size={12} className="text-accent/70" />
            DNS NETWORK MAP
          </div>
          <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/25 uppercase tracking-wider">
            {hasData && (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.ok }} /> healthy
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.fail }} /> failed
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.dim }} /> inactive
                </span>
                {dnsMetricsAvailable && (
                  <span className="flex items-center gap-1.5">
                    <Activity size={8} style={{ color: C.textDim }} /> traffic
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="noc-divider" />

        {hasData ? (
          <div className="mt-2">
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
          <UnavailableState message="Network map unavailable" sub="DNS health data requires privileged access" />
        ) : (
          <UnavailableState message="Awaiting health telemetry" sub="Waiting for instance probe results" />
        )}
      </div>
    </motion.div>
  );
}
