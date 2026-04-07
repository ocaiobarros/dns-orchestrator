import { motion } from 'framer-motion';
import type { MapNode } from './NocNetworkMap';
import { safeNum, safeR, safeSW, safeOpacity } from '@/lib/svg-utils';

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

const TYPE_RADIUS: Record<string, number> = {
  vip: 24,
  resolver: 18,
  upstream: 22,
};

function formatQps(qps?: number): string {
  if (!qps) return '';
  if (qps >= 1000000) return `${(qps / 1000000).toFixed(1)}M qps`;
  if (qps >= 1000) return `${(qps / 1000).toFixed(0)}k qps`;
  return `${qps} qps`;
}

export default function NocNetworkNode({ node, x, y, isHovered, onHover, onLeave, compact = false }: Props) {
  const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.unknown;
  const radius = safeR(compact ? Math.round(TYPE_RADIUS[node.type] * 0.85) : TYPE_RADIUS[node.type], 18);
  const icon = TYPE_ICONS[node.type] ?? '●';
  const sx = safeNum(x, 100);
  const sy = safeNum(y, 100);

  const isAlertState = node.status === 'failed' || node.status === 'degraded';

  return (
    <g
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
    >
      {/* Outer pulse ring - only for VIP/upstream or alert */}
      {(isAlertState || node.type !== 'resolver') && (
        <motion.circle
          cx={sx} cy={sy}
          fill="none" stroke={color}
          strokeWidth={safeSW(1, 1)}
          initial={{ r: safeR(radius + 6, 24), strokeOpacity: 0.12 }}
          animate={{
            r: [safeR(radius + 6, 24), safeR(radius + 14, 32), safeR(radius + 6, 24)],
            strokeOpacity: [0.12, 0.04, 0.12],
          }}
          transition={{ duration: isAlertState ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Main node circle */}
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

      {/* Type icon */}
      <text
        x={sx} y={sy + 1}
        textAnchor="middle" dominantBaseline="middle"
        fill={color}
        fontSize={compact ? 12 : 14}
        fontFamily="monospace"
        style={{ opacity: 0.9 }}
      >
        {icon}
      </text>

      {/* Label - always show */}
      <text
        x={sx}
        y={sy + radius + (compact ? 11 : 14)}
        textAnchor="middle" dominantBaseline="middle"
        fill="hsl(var(--foreground))"
        fillOpacity={0.85}
        fontSize={compact ? '8' : '10'}
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
      >
        {node.label}
      </text>

      {/* Bind IP - compact: show truncated, full: show full */}
      {node.bindIp && (
        <text
          x={sx}
          y={sy + radius + (compact ? 21 : 27)}
          textAnchor="middle" dominantBaseline="middle"
          fill="hsl(var(--muted-foreground))"
          fillOpacity={0.4}
          fontSize={compact ? '6' : '8'}
          fontFamily="'JetBrains Mono', monospace"
        >
          {compact && node.bindIp.length > 18 ? node.bindIp.slice(0, 16) + '…' : node.bindIp}
        </text>
      )}

      {/* Latency badge - only for non-compact or VIP/upstream */}
      {!compact && node.latency != null && Number.isFinite(node.latency) && (
        <text
          x={sx}
          y={sy + radius + 39}
          textAnchor="middle" dominantBaseline="middle"
          fill={node.latency < 30 ? 'hsl(152, 76%, 50%)' : node.latency < 100 ? 'hsl(38, 95%, 55%)' : 'hsl(0, 76%, 55%)'}
          fillOpacity={0.8}
          fontSize="9"
          fontFamily="'JetBrains Mono', monospace"
        >
          {node.latency}ms
        </text>
      )}

      {/* QPS - only for VIP node */}
      {node.type === 'vip' && node.qps != null && Number.isFinite(node.qps) && node.qps > 0 && (
        <text
          x={sx}
          y={sy + radius + (node.latency != null ? 51 : 39)}
          textAnchor="middle" dominantBaseline="middle"
          fill="hsl(var(--primary))"
          fillOpacity={0.7}
          fontSize="9"
          fontFamily="'JetBrains Mono', monospace"
        >
          {formatQps(node.qps)}
        </text>
      )}

      {/* Tooltip on hover */}
      {isHovered && (
        <foreignObject x={sx + radius + 10} y={sy - 60} width={200} height={140}>
          <div className="bg-card/95 backdrop-blur-md border border-border/40 rounded-lg px-3 py-2.5 shadow-xl">
            <div className="text-[10px] font-mono font-bold text-foreground/90 mb-1.5">{node.label}</div>
            <div className="space-y-1 text-[9px] font-mono text-muted-foreground/60">
              <div className="flex justify-between">
                <span>Status</span>
                <span style={{ color }}>{node.status.toUpperCase()}</span>
              </div>
              {node.bindIp && (
                <div className="flex justify-between">
                  <span>Bind IP</span>
                  <span className="text-foreground/70 text-[8px]">{node.bindIp}</span>
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
