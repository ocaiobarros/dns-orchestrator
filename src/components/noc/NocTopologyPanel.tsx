import { motion } from 'framer-motion';
import { Globe, Server, Wifi, CheckCircle, XCircle, Zap } from 'lucide-react';
import type { InstanceHealthReport, InstanceHealthResult } from '@/lib/types';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
}

/** Color helpers */
function statusColor(healthy: boolean) {
  return healthy ? 'hsl(152, 76%, 40%)' : 'hsl(0, 76%, 50%)';
}
function latencyColor(ms: number) {
  if (ms < 30) return 'hsl(152, 76%, 40%)';
  if (ms < 100) return 'hsl(38, 95%, 50%)';
  return 'hsl(0, 76%, 50%)';
}
function latencyClass(ms: number) {
  if (ms < 30) return 'text-success';
  if (ms < 100) return 'text-warning';
  return 'text-destructive';
}

/** Animated packet dots traveling along a path */
function FlowParticles({ pathId, color, count = 3, duration = 3 }: { pathId: string; color: string; count?: number; duration?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r="2.5" fill={color} opacity="0">
          <animateMotion dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`}>
            <mpath href={`#${pathId}`} />
          </animateMotion>
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`} />
          <animate attributeName="r" values="1.5;3;1.5" dur={`${duration}s`} repeatCount="indefinite" begin={`${(i * duration) / count}s`} />
        </circle>
      ))}
    </>
  );
}

/** Node with animated ring */
function TopoNode({ cx, cy, label, sublabel, healthy, icon: Icon, size = 'md' }: {
  cx: number; cy: number; label: string; sublabel?: string; healthy: boolean;
  icon: typeof Globe; size?: 'lg' | 'md';
}) {
  const color = statusColor(healthy);
  const r = size === 'lg' ? 28 : 22;
  const iconSize = size === 'lg' ? 16 : 13;

  return (
    <g>
      {/* Outer glow ring */}
      <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke={color} strokeWidth="0.5" opacity="0.15">
        <animate attributeName="r" values={`${r + 6};${r + 12};${r + 6}`} dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.15;0.05;0.15" dur="3s" repeatCount="indefinite" />
      </circle>
      {/* Mid ring */}
      <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={color} strokeWidth="0.8" opacity="0.2" />
      {/* Main circle */}
      <circle cx={cx} cy={cy} r={r} fill={`${color.replace(')', ' / 0.08)')}`} stroke={color} strokeWidth="1.5" />
      {/* Inner highlight */}
      <circle cx={cx} cy={cy} r={r - 4} fill="none" stroke={color} strokeWidth="0.3" opacity="0.3" />
      {/* Icon placeholder - foreignObject for React icons */}
      <foreignObject x={cx - iconSize / 2} y={cy - iconSize / 2} width={iconSize} height={iconSize}>
        <div className="flex items-center justify-center w-full h-full">
          <Icon size={iconSize} style={{ color }} />
        </div>
      </foreignObject>
      {/* Label */}
      <text x={cx} y={cy + r + 16} textAnchor="middle" fill="hsl(210, 25%, 95%)" fontSize="10" fontWeight="700" fontFamily="var(--font-mono)">
        {label}
      </text>
      {sublabel && (
        <text x={cx} y={cy + r + 28} textAnchor="middle" fill="hsl(218, 15%, 46%)" fontSize="8" fontFamily="var(--font-mono)">
          {sublabel}
        </text>
      )}
    </g>
  );
}

function LatencyBadge({ cx, cy, ms }: { cx: number; cy: number; ms: number }) {
  const color = latencyColor(ms);
  return (
    <g>
      <rect x={cx - 18} y={cy - 8} width="36" height="16" rx="8" fill="hsl(225, 25%, 8%)" stroke={color} strokeWidth="0.8" />
      <text x={cx} y={cy + 3.5} textAnchor="middle" fill={color} fontSize="8.5" fontWeight="700" fontFamily="var(--font-mono)">
        {ms}ms
      </text>
    </g>
  );
}

/** Full topology visualization */
function TopologyView({ health }: { health: InstanceHealthReport }) {
  const instances = health.instances || [];
  const hasVip = !!health.vip;
  const totalNodes = instances.length + (hasVip ? 1 : 0);

  // Layout calculations
  const svgW = 720;
  const svgH = totalNodes <= 2 ? 200 : Math.min(60 + totalNodes * 70, 360);

  const vipX = 100;
  const vipY = svgH / 2;
  const upstreamX = svgW - 100;
  const upstreamY = svgH / 2;

  // Resolver positions — evenly spaced vertically in the middle
  const resolverX = svgW / 2;
  const resolverStartY = instances.length === 1 ? svgH / 2 : 40;
  const resolverSpacing = instances.length <= 1 ? 0 : (svgH - 80) / Math.max(instances.length - 1, 1);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" style={{ maxHeight: '360px' }}>
      <defs>
        {/* Flow gradient */}
        <linearGradient id="flow-ok" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.05" />
          <stop offset="50%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="hsl(152, 76%, 40%)" stopOpacity="0.05" />
        </linearGradient>
        <linearGradient id="flow-fail" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(0, 76%, 50%)" stopOpacity="0.05" />
          <stop offset="50%" stopColor="hsl(0, 76%, 50%)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="hsl(0, 76%, 50%)" stopOpacity="0.05" />
        </linearGradient>
        {/* Glow filter */}
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background grid */}
      <defs>
        <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(225, 22%, 13%)" strokeWidth="0.3" opacity="0.4" />
        </pattern>
      </defs>
      <rect width={svgW} height={svgH} fill="url(#topo-grid)" opacity="0.3" />

      {/* Connection paths */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        const pathId1 = `path-vip-${i}`;
        const pathId2 = `path-up-${i}`;
        const color = statusColor(inst.healthy);

        return (
          <g key={inst.instance}>
            {/* VIP → Resolver */}
            {hasVip && (
              <>
                <path id={pathId1}
                  d={`M ${vipX + 30} ${vipY} Q ${(vipX + resolverX) / 2} ${(vipY + ry) / 2} ${resolverX - 24} ${ry}`}
                  fill="none" stroke={color} strokeWidth="1" opacity="0.2"
                  strokeDasharray={inst.healthy ? 'none' : '4 3'}
                />
                {inst.healthy && <FlowParticles pathId={pathId1} color={color} count={2} duration={2.5 + i * 0.3} />}
              </>
            )}
            {/* Resolver → Upstream */}
            <path id={pathId2}
              d={`M ${resolverX + 24} ${ry} Q ${(resolverX + upstreamX) / 2} ${(ry + upstreamY) / 2} ${upstreamX - 30} ${upstreamY}`}
              fill="none" stroke={color} strokeWidth="1" opacity="0.15"
              strokeDasharray={inst.healthy ? 'none' : '4 3'}
            />
            {inst.healthy && <FlowParticles pathId={pathId2} color={color} count={2} duration={3 + i * 0.2} />}

            {/* Latency badge on resolver→upstream path */}
            <LatencyBadge cx={(resolverX + upstreamX) / 2 + 10} cy={(ry + upstreamY) / 2 - 8} ms={inst.latency_ms ?? 0} />
          </g>
        );
      })}

      {/* Nodes */}
      {hasVip && (
        <TopoNode cx={vipX} cy={vipY} label="VIP ANYCAST" sublabel={health.vip?.bind_ip}
          healthy={health.vip?.healthy ?? false} icon={Zap} size="lg" />
      )}

      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        return (
          <TopoNode key={inst.instance} cx={resolverX} cy={ry}
            label={inst.instance} sublabel={`${inst.bind_ip}:${inst.port}`}
            healthy={inst.healthy} icon={Server} />
        );
      })}

      <TopoNode cx={upstreamX} cy={upstreamY} label="UPSTREAM"
        sublabel={instances.find(i => i.healthy)?.resolved_ip || '—'}
        healthy={instances.some(i => i.healthy)} icon={Globe} size="lg" />
    </svg>
  );
}

export default function NocTopologyPanel({ health }: NocTopologyPanelProps) {
  const hasData = health && Array.isArray(health.instances) && health.instances.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      className="noc-surface-elevated"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-1">
          <div className="noc-section-head">
            <Wifi size={12} className="text-accent" />
            DNS RESOLUTION TOPOLOGY
          </div>
          {hasData && (
            <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> healthy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> failed
              </span>
            </div>
          )}
        </div>
        <div className="noc-divider" />

        {hasData ? (
          <div className="mt-2">
            <TopologyView health={health!} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <motion.div
              animate={{ scale: [1, 1.05, 1], opacity: [0.15, 0.25, 0.15] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Wifi size={32} className="text-muted-foreground/15" />
            </motion.div>
            <p className="text-[11px] font-mono text-muted-foreground/25">
              Awaiting health telemetry…
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
