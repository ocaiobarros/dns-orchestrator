import { motion } from 'framer-motion';
import { Globe, Server, Wifi, Zap, AlertTriangle, ShieldOff } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  dnsAvailable?: boolean;
}

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

/** Animated packet dots — only when path is healthy */
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

/** Node with state-driven glow */
function TopoNode({ cx, cy, label, sublabel, healthy, icon: Icon, size = 'md', dimmed = false }: {
  cx: number; cy: number; label: string; sublabel?: string; healthy: boolean;
  icon: typeof Globe; size?: 'lg' | 'md'; dimmed?: boolean;
}) {
  const color = dimmed ? dimColor() : statusColor(healthy);
  const r = size === 'lg' ? 26 : 20;
  const iconSize = size === 'lg' ? 15 : 12;

  return (
    <g>
      {/* Glow ring — only for healthy active nodes */}
      {healthy && !dimmed && (
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={color} strokeWidth="0.5" opacity="0.12">
          <animate attributeName="r" values={`${r + 5};${r + 10};${r + 5}`} dur="4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.12;0.04;0.12" dur="4s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Main circle */}
      <circle cx={cx} cy={cy} r={r} fill={`${color.replace(')', ' / 0.06)')}`} stroke={color} strokeWidth={dimmed ? '0.8' : '1.2'} opacity={dimmed ? 0.5 : 1} />
      {/* Icon */}
      <foreignObject x={cx - iconSize / 2} y={cy - iconSize / 2} width={iconSize} height={iconSize}>
        <div className="flex items-center justify-center w-full h-full">
          <Icon size={iconSize} style={{ color, opacity: dimmed ? 0.5 : 1 }} />
        </div>
      </foreignObject>
      {/* Label */}
      <text x={cx} y={cy + r + 14} textAnchor="middle" fill="hsl(210, 25%, 95%)" fontSize="9" fontWeight="700" fontFamily="var(--font-mono)" opacity={dimmed ? 0.4 : 0.85}>
        {label}
      </text>
      {sublabel && (
        <text x={cx} y={cy + r + 25} textAnchor="middle" fill="hsl(218, 15%, 46%)" fontSize="7.5" fontFamily="var(--font-mono)" opacity={dimmed ? 0.3 : 0.6}>
          {sublabel}
        </text>
      )}
    </g>
  );
}

function LatencyBadge({ cx, cy, ms, dimmed = false }: { cx: number; cy: number; ms: number; dimmed?: boolean }) {
  const color = dimmed ? dimColor() : latencyColor(ms);
  return (
    <g opacity={dimmed ? 0.4 : 1}>
      <rect x={cx - 16} y={cy - 7} width="32" height="14" rx="7" fill="hsl(225, 25%, 7%)" stroke={color} strokeWidth="0.6" />
      <text x={cx} y={cy + 3} textAnchor="middle" fill={color} fontSize="7.5" fontWeight="700" fontFamily="var(--font-mono)">
        {ms}ms
      </text>
    </g>
  );
}

/** Full topology with data-driven states */
function TopologyView({ health, vipConfigured, vipAddress }: {
  health: InstanceHealthReport; vipConfigured?: boolean; vipAddress?: string | null;
}) {
  const instances = health.instances || [];
  // Always show VIP node — dimmed if not configured
  const vipHealthy = health.vip?.healthy ?? (vipConfigured ?? false);
  const vipDimmed = !vipConfigured && !health.vip;

  const svgW = 680;
  const svgH = instances.length <= 2 ? 180 : Math.min(50 + instances.length * 65, 320);

  const vipX = 90;
  const vipY = svgH / 2;
  const upstreamX = svgW - 90;
  const upstreamY = svgH / 2;

  const resolverX = svgW / 2;
  const resolverStartY = instances.length === 1 ? svgH / 2 : 35;
  const resolverSpacing = instances.length <= 1 ? 0 : (svgH - 70) / Math.max(instances.length - 1, 1);

  const anyHealthy = instances.some(i => i.healthy);

  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto" style={{ maxHeight: '320px' }}>
      <defs>
        <pattern id="topo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(225, 22%, 11%)" strokeWidth="0.3" />
        </pattern>
        <filter id="glow-sm">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <rect width={svgW} height={svgH} fill="url(#topo-grid)" opacity="0.25" />

      {/* Paths */}
      {instances.map((inst, i) => {
        const ry = instances.length === 1 ? svgH / 2 : resolverStartY + i * resolverSpacing;
        const pathId1 = `p-vip-${i}`;
        const pathId2 = `p-up-${i}`;
        const color = statusColor(inst.healthy);
        const isDegraded = !inst.healthy;

        return (
          <g key={inst.instance}>
            {/* VIP → Resolver */}
            {hasVip && (
              <>
                <path id={pathId1}
                  d={`M ${vipX + 28} ${vipY} Q ${(vipX + resolverX) / 2} ${(vipY + ry) / 2} ${resolverX - 22} ${ry}`}
                  fill="none" stroke={isDegraded ? dimColor() : color} strokeWidth="0.8"
                  opacity={isDegraded ? 0.2 : 0.25}
                  strokeDasharray={isDegraded ? '3 3' : 'none'}
                />
                {inst.healthy && <FlowParticles pathId={pathId1} color={color} count={2} duration={2.8 + i * 0.3} />}
              </>
            )}
            {/* Resolver → Upstream */}
            <path id={pathId2}
              d={`M ${resolverX + 22} ${ry} Q ${(resolverX + upstreamX) / 2} ${(ry + upstreamY) / 2} ${upstreamX - 28} ${upstreamY}`}
              fill="none" stroke={isDegraded ? dimColor() : color} strokeWidth="0.8"
              opacity={isDegraded ? 0.15 : 0.2}
              strokeDasharray={isDegraded ? '3 3' : 'none'}
            />
            {inst.healthy && <FlowParticles pathId={pathId2} color={color} count={2} duration={3.2 + i * 0.2} />}

            {/* Latency badge */}
            <LatencyBadge
              cx={(resolverX + upstreamX) / 2 + 8}
              cy={(ry + upstreamY) / 2 - 6}
              ms={inst.latency_ms ?? 0}
              dimmed={isDegraded}
            />
          </g>
        );
      })}

      {/* Nodes */}
      {hasVip && (
        <TopoNode cx={vipX} cy={vipY}
          label={vipConfigured ? 'VIP ANYCAST' : 'VIP'}
          sublabel={vipAddress || health.vip?.bind_ip || (vipConfigured ? undefined : 'Not configured')}
          healthy={vipHealthy || (vipConfigured ?? false)}
          icon={Zap} size="lg"
          dimmed={!vipConfigured && !health.vip}
        />
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
        healthy={anyHealthy} icon={Globe} size="lg"
        dimmed={!anyHealthy}
      />
    </svg>
  );
}

/** Empty/unavailable states */
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

export default function NocTopologyPanel({ health, vipConfigured, vipAddress, dnsAvailable }: NocTopologyPanelProps) {
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
          {hasData && (
            <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/30 uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success" /> healthy
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> failed
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: dimColor() }} /> inactive
              </span>
            </div>
          )}
        </div>
        <div className="noc-divider" />

        {hasData ? (
          <div className="mt-1">
            <TopologyView health={health!} vipConfigured={vipConfigured} vipAddress={vipAddress} />
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
