import { motion } from 'framer-motion';
import type { MapNode } from './NocNetworkMap';
import { safeNum, safeR, safeSW } from '@/lib/svg-utils';

interface Props {
  node: MapNode;
  x: number;
  y: number;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
  compact?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'hsl(152, 76%, 40%)',
  degraded: 'hsl(38, 95%, 50%)',
  failed: 'hsl(0, 76%, 50%)',
  inactive: 'hsl(215, 15%, 40%)',
  unknown: 'hsl(215, 15%, 30%)',
};

const TYPE_ICONS: Record<string, string> = {
  vip: '⚡',
  resolver: '≡',
  upstream: '⊕',
};

function formatQps(qps?: number): string {
  if (!qps) return '';
  if (qps >= 1000000) return `${(qps / 1000000).toFixed(1)}M`;
  if (qps >= 1000) return `${(qps / 1000).toFixed(0)}k`;
  return `${qps}`;
}

export default function NocNetworkNode({ node, x, y, isHovered, onHover, onLeave, compact = false }: Props) {
  const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.unknown;
  const radius = safeR(compact ? 16 : 22, 18);
  const icon = TYPE_ICONS[node.type] ?? '●';
  const sx = safeNum(x, 100);
  const sy = safeNum(y, 100);
  const isAlertState = node.status === 'failed' || node.status === 'degraded';

  // For upstream nodes, use the IP as label directly
  const displayLabel = node.label;
  // Show bind IP below label for resolvers
  const showBindIp = node.type === 'resolver' && node.bindIp;

  return (
    <g onMouseEnter={onHover} onMouseLeave={onLeave} style={{ cursor: 'pointer' }}>
      {/* Outer pulse ring */}
      {(isAlertState || node.type !== 'resolver') && (
        <motion.circle
          cx={sx} cy={sy}
          fill="none" stroke={color}
          strokeWidth={safeSW(1, 1)}
          initial={{ r: safeR(radius + 5, 23), strokeOpacity: 0.12 }}
          animate={{
            r: [safeR(radius + 5, 23), safeR(radius + 12, 30), safeR(radius + 5, 23)],
            strokeOpacity: [0.12, 0.04, 0.12],
          }}
          transition={{ duration: isAlertState ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Main circle */}
      <motion.circle
        cx={sx} cy={sy}
        fill={`${color}15`}
        stroke={color}
        strokeWidth={safeSW(isHovered ? 2 : 1.5, 1.5)}
        initial={{ r: safeR(radius, 18) }}
        animate={{ r: isHovered ? safeR(radius + 2, 20) : safeR(radius, 18) }}
        transition={{ duration: 0.2 }}
        style={{
          filter: isAlertState
            ? `drop-shadow(0 0 8px ${color})`
            : `drop-shadow(0 0 4px ${color}40)`,
        }}
      />

      {/* Status dot */}
      <circle cx={sx + radius - 2} cy={sy - radius + 2} r={safeR(3, 3)} fill={color} />

      {/* Icon */}
      <text
        x={sx} y={sy + 1}
        textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={compact ? 11 : 13} fontFamily="monospace"
        style={{ opacity: 0.9 }}
      >
        {icon}
      </text>

      {/* Label (name) */}
      <text
        x={sx} y={sy + radius + 13}
        textAnchor="middle" dominantBaseline="middle"
        fill="hsl(var(--foreground))" fillOpacity={0.9}
        fontSize={compact ? '9' : '10'} fontWeight="800"
        fontFamily="'JetBrains Mono', monospace"
      >
        {displayLabel}
      </text>

      {/* Bind IP(s) */}
      {showBindIp && (
        <>
          {node.bindIp!.split(', ').slice(0, 2).map((ip, i) => (
            <text
              key={ip}
              x={sx} y={sy + radius + 25 + i * 11}
              textAnchor="middle" dominantBaseline="middle"
              fill="hsl(var(--foreground))" fillOpacity={0.55}
              fontSize="8" fontFamily="'JetBrains Mono', monospace"
            >
              {ip}
            </text>
          ))}
          {node.bindIp!.split(', ').length > 2 && (
            <text
              x={sx} y={sy + radius + 25 + 2 * 11}
              textAnchor="middle" dominantBaseline="middle"
              fill="hsl(var(--muted-foreground))" fillOpacity={0.35}
              fontSize="7" fontFamily="'JetBrains Mono', monospace"
            >
              +{node.bindIp!.split(', ').length - 2} IPs
            </text>
          )}
        </>
      )}

      {/* Latency badge */}
      {node.latency != null && Number.isFinite(node.latency) && (
        <text
          x={sx}
          y={sy - radius - 10}
          textAnchor="middle" dominantBaseline="middle"
          fill={node.latency < 30 ? 'hsl(152, 76%, 50%)' : node.latency < 100 ? 'hsl(38, 95%, 55%)' : 'hsl(0, 76%, 55%)'}
          fillOpacity={0.85} fontSize="9"
          fontFamily="'JetBrains Mono', monospace" fontWeight="700"
        >
          {node.latency}ms
        </text>
      )}

      {/* QPS for VIP */}
      {node.type === 'vip' && node.qps != null && Number.isFinite(node.qps) && node.qps > 0 && (
        <text
          x={sx} y={sy - radius - 22}
          textAnchor="middle" dominantBaseline="middle"
          fill="hsl(var(--primary))" fillOpacity={0.7}
          fontSize="9" fontFamily="'JetBrains Mono', monospace"
        >
          {formatQps(node.qps)} qps
        </text>
      )}

      {/* Tooltip on hover */}
      {isHovered && (
        <foreignObject x={sx + radius + 10} y={sy - 70} width={220} height={160}>
          <div className="bg-card/95 backdrop-blur-md border border-border/40 rounded-lg px-3 py-2.5 shadow-xl">
            <div className="text-[10px] font-mono font-bold text-foreground/90 mb-1.5">{node.label}</div>
            <div className="space-y-1 text-[9px] font-mono text-muted-foreground/60">
              <div className="flex justify-between">
                <span>Status</span>
                <span style={{ color }}>{node.status.toUpperCase()}</span>
              </div>
              {node.bindIp && (
                <div>
                  <span className="text-muted-foreground/40">IPs:</span>
                  <div className="text-foreground/70 text-[8px] mt-0.5 break-all">{node.bindIp}</div>
                </div>
              )}
              {node.latency != null && (
                <div className="flex justify-between">
                  <span>Latency</span>
                  <span className="text-foreground/70">{safeNum(node.latency, 0)}ms</span>
                </div>
              )}
              {node.qps != null && (
                <div className="flex justify-between">
                  <span>QPS</span>
                  <span className="text-foreground/70">{safeNum(node.qps, 0).toLocaleString()}</span>
                </div>
              )}
              {node.cacheHit != null && (
                <div className="flex justify-between">
                  <span>Cache Hit</span>
                  <span className="text-foreground/70">{safeNum(node.cacheHit, 0)}%</span>
                </div>
              )}
              {node.extra && (
                <div className="text-[8px] text-muted-foreground/40 pt-1 border-t border-border/20">{node.extra}</div>
              )}
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}
