import { motion } from 'framer-motion';
import type { MapNode } from './NocNetworkMap';

interface Props {
  node: MapNode;
  x: number;
  y: number;
  isHovered: boolean;
  onHover: () => void;
  onLeave: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  ok: 'hsl(152, 76%, 40%)',
  degraded: 'hsl(38, 95%, 50%)',
  failed: 'hsl(0, 76%, 50%)',
  inactive: 'hsl(215, 15%, 40%)',
  unknown: 'hsl(215, 15%, 30%)',
};

const TYPE_ICONS: Record<string, string> = {
  vip: '◆',
  resolver: '⬢',
  upstream: '●',
};

const TYPE_RADIUS: Record<string, number> = {
  vip: 28,
  resolver: 32,
  upstream: 26,
};

function formatQps(qps?: number): string {
  if (!qps) return '';
  if (qps >= 1000000) return `${(qps / 1000000).toFixed(1)}M qps`;
  if (qps >= 1000) return `${(qps / 1000).toFixed(0)}k qps`;
  return `${qps} qps`;
}

export default function NocNetworkNode({ node, x, y, isHovered, onHover, onLeave }: Props) {
  const color = STATUS_COLORS[node.status] ?? STATUS_COLORS.unknown;
  const radius = TYPE_RADIUS[node.type] ?? 28;
  const icon = TYPE_ICONS[node.type] ?? '●';

  const isAlertState = node.status === 'failed' || node.status === 'degraded';
  const pulseScale = isAlertState ? [1, 1.6, 1] : [1, 1.3, 1];
  const pulseDuration = isAlertState ? 1.5 : 3;

  return (
    <g
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{ cursor: 'pointer' }}
    >
      {/* Outer pulse ring */}
      <motion.circle
        cx={x}
        cy={y}
        r={radius + 8}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeOpacity={0.15}
        animate={{
          r: [radius + 8, radius + 18, radius + 8],
          strokeOpacity: [0.15, 0.05, 0.15],
        }}
        transition={{ duration: pulseDuration, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Glow ring */}
      {isAlertState && (
        <motion.circle
          cx={x}
          cy={y}
          r={radius + 4}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeOpacity={0.3}
          animate={{
            strokeOpacity: [0.3, 0.6, 0.3],
            r: [radius + 4, radius + 12, radius + 4],
          }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Main node circle */}
      <motion.circle
        cx={x}
        cy={y}
        r={radius}
        fill={`${color}15`}
        stroke={color}
        strokeWidth={isHovered ? 2.5 : 1.5}
        animate={isHovered ? { r: radius + 3 } : { r: radius }}
        transition={{ duration: 0.2 }}
        style={{
          filter: isAlertState
            ? `drop-shadow(0 0 12px ${color})`
            : `drop-shadow(0 0 6px ${color}40)`,
        }}
      />

      {/* Inner glow */}
      <circle
        cx={x}
        cy={y}
        r={radius * 0.6}
        fill={`${color}08`}
      />

      {/* Status dot */}
      <motion.circle
        cx={x}
        cy={y - radius + 6}
        r={3}
        fill={color}
        animate={isAlertState ? { scale: [1, 1.4, 1] } : {}}
        transition={{ duration: 1, repeat: Infinity }}
      />

      {/* Type icon */}
      <text
        x={x}
        y={y - 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={node.type === 'resolver' ? 16 : 14}
        fontFamily="monospace"
        style={{ opacity: 0.8 }}
      >
        {icon}
      </text>

      {/* Label */}
      <text
        x={x}
        y={y + radius + 16}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="hsl(var(--foreground))"
        fillOpacity={0.85}
        fontSize="11"
        fontWeight="700"
        fontFamily="'JetBrains Mono', monospace"
      >
        {node.label}
      </text>

      {/* Metrics below label */}
      {node.qps != null && (
        <text
          x={x}
          y={y + radius + 30}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="hsl(var(--primary))"
          fillOpacity={0.7}
          fontSize="9"
          fontFamily="'JetBrains Mono', monospace"
        >
          {formatQps(node.qps)}
        </text>
      )}

      {node.latency != null && (
        <text
          x={x}
          y={y + radius + 42}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={node.latency < 30 ? 'hsl(152, 76%, 50%)' : node.latency < 100 ? 'hsl(38, 95%, 55%)' : 'hsl(0, 76%, 55%)'}
          fillOpacity={0.8}
          fontSize="9"
          fontFamily="'JetBrains Mono', monospace"
        >
          {node.latency}ms
        </text>
      )}

      {node.cacheHit != null && (
        <text
          x={x}
          y={y + radius + 54}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="hsl(var(--foreground))"
          fillOpacity={0.4}
          fontSize="8"
          fontFamily="'JetBrains Mono', monospace"
        >
          cache {node.cacheHit}%
        </text>
      )}

      {/* Tooltip on hover */}
      {isHovered && (
        <foreignObject x={x + radius + 14} y={y - 50} width={180} height={130}>
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
                  <span className="text-foreground/70">{node.bindIp}</span>
                </div>
              )}
              {node.latency != null && (
                <div className="flex justify-between">
                  <span>Latency</span>
                  <span className="text-foreground/70">{node.latency}ms</span>
                </div>
              )}
              {node.qps != null && (
                <div className="flex justify-between">
                  <span>QPS</span>
                  <span className="text-foreground/70">{node.qps.toLocaleString()}</span>
                </div>
              )}
              {node.cacheHit != null && (
                <div className="flex justify-between">
                  <span>Cache Hit</span>
                  <span className="text-foreground/70">{node.cacheHit}%</span>
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
