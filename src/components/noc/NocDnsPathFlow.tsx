// ============================================================
// DNS Control — DNS Path Flow Visualization
// Real query flow: CLIENT → VIP → Resolver → Upstream
// Premium NOC-grade layout with animated traffic particles
// ============================================================

import { motion } from 'framer-motion';
import { safeNum, safeR } from '@/lib/svg-utils';

interface PathNode {
  id: string;
  label: string;
  type: 'client' | 'vip' | 'resolver' | 'upstream';
  qps?: number;
  latencyMs?: number;
  cacheHit?: number;
  status: 'ok' | 'degraded' | 'failed' | 'unknown';
  ip?: string;
  extra?: string;
}

interface PathEdge {
  from: string;
  to: string;
  qps: number;
  latencyMs?: number;
  failures?: number;
}

interface Props {
  nodes: PathNode[];
  edges: PathEdge[];
}

const STATUS_COLORS: Record<string, string> = {
  ok: '#10b981',
  degraded: '#f59e0b',
  failed: '#ef4444',
  unknown: '#6b7280',
};

const STATUS_GLOW: Record<string, string> = {
  ok: 'rgba(16,185,129,0.25)',
  degraded: 'rgba(245,158,11,0.25)',
  failed: 'rgba(239,68,68,0.3)',
  unknown: 'rgba(107,114,128,0.15)',
};

const TYPE_ICONS: Record<string, string> = {
  client: '👤',
  vip: '◆',
  resolver: '⚙',
  upstream: '☁',
};

const TYPE_LABELS: Record<string, string> = {
  client: 'CLIENTES',
  vip: 'VIP DE SERVIÇO',
  resolver: 'RESOLVERS',
  upstream: 'UPSTREAM',
};

function formatQps(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '0';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function latencyColor(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '#6b7280';
  if (ms < 30) return '#10b981';
  if (ms < 100) return '#f59e0b';
  return '#ef4444';
}

// SVG dimensions
const W = 960;
const H = 280;
const NODE_W = 130;
const NODE_H = 64;
const PADDING_X = 60;

export default function NocDnsPathFlow({ nodes, edges }: Props) {
  // Build 4 ordered layers
  const layerTypes: Array<PathNode['type']> = ['client', 'vip', 'resolver', 'upstream'];
  const layers: PathNode[][] = layerTypes.map(t => nodes.filter(n => n.type === t));

  // Ensure at least a synthetic client
  if (layers[0].length === 0) {
    layers[0] = [{ id: 'clients', label: 'Clientes DNS', type: 'client', status: 'ok' }];
  }

  // Filter out empty layers for spacing but keep indices for positioning
  const activeLayerIndices = layers.map((l, i) => l.length > 0 ? i : -1).filter(i => i >= 0);
  const numLayers = activeLayerIndices.length;

  // Center-based X position per layer
  const layerX = (layerIndex: number) => {
    const pos = activeLayerIndices.indexOf(layerIndex);
    if (pos < 0) return PADDING_X;
    const usableW = W - PADDING_X * 2;
    return PADDING_X + (pos / Math.max(numLayers - 1, 1)) * usableW;
  };

  // Y position for a node within its layer
  const nodeY = (nodeIndex: number, layerLen: number) => {
    const totalH = layerLen * NODE_H + (layerLen - 1) * 16;
    const startY = (H - totalH) / 2 + 20;
    return startY + nodeIndex * (NODE_H + 16) + NODE_H / 2;
  };

  const maxQps = Math.max(...edges.map(e => safeNum(e.qps, 0)), 1);

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          DNS Query Path Flow
        </span>
      </div>
      <div className="noc-surface-body p-0">
        <svg
          className="w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* Subtle grid */}
            <pattern id="dpf-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="0.5" fill="hsl(var(--muted-foreground))" opacity="0.15" />
            </pattern>

            {/* Edge gradients per status */}
            <linearGradient id="dpf-edge-ok" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="dpf-edge-warn" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="dpf-edge-fail" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
            </linearGradient>

            {/* Glow filter */}
            <filter id="dpf-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="dpf-node-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(0,0,0,0.4)" />
            </filter>
          </defs>

          {/* Background */}
          <rect width={W} height={H} fill="url(#dpf-grid)" rx="8" />

          {/* Column labels */}
          {activeLayerIndices.map((li) => {
            const x = layerX(li);
            const typeKey = layerTypes[li];
            return (
              <text
                key={`label-${li}`}
                x={x}
                y={18}
                textAnchor="middle"
                fill="hsl(var(--muted-foreground))"
                fontSize="9"
                fontFamily="monospace"
                fontWeight="700"
                letterSpacing="2"
                opacity="0.6"
              >
                {TYPE_LABELS[typeKey] || ''}
              </text>
            );
          })}

          {/* Edges with animated particles */}
          {edges.map((edge, ei) => {
            const fromNode = layers.flat().find(n => n.id === edge.from);
            const toNode = layers.flat().find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;

            const fromLi = layers.findIndex(l => l.some(n => n.id === fromNode.id));
            const toLi = layers.findIndex(l => l.some(n => n.id === toNode.id));
            if (fromLi < 0 || toLi < 0) return null;

            const fromNi = layers[fromLi].indexOf(fromNode);
            const toNi = layers[toLi].indexOf(toNode);

            const x1 = layerX(fromLi) + NODE_W / 2;
            const y1 = nodeY(fromNi, layers[fromLi].length);
            const x2 = layerX(toLi) - NODE_W / 2;
            const y2 = nodeY(toNi, layers[toLi].length);

            const hasFailures = safeNum(edge.failures, 0) > 0;
            const edgeColor = hasFailures ? '#ef4444' : latencyColor(edge.latencyMs);
            const gradientId = hasFailures ? 'dpf-edge-fail' : (edge.latencyMs && edge.latencyMs >= 100 ? 'dpf-edge-warn' : 'dpf-edge-ok');
            const thickness = Math.max(1.5, (safeNum(edge.qps, 0) / maxQps) * 4);

            // Bezier control points for smooth curve
            const midX = (x1 + x2) / 2;
            const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

            // Particle count based on QPS ratio
            const particleCount = Math.max(1, Math.min(3, Math.ceil((safeNum(edge.qps, 0) / maxQps) * 3)));

            return (
              <g key={`edge-${ei}`}>
                {/* Edge glow */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={edgeColor}
                  strokeWidth={thickness + 4}
                  strokeLinecap="round"
                  opacity={0.08}
                />
                {/* Edge line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={`url(#${gradientId})`}
                  strokeWidth={thickness}
                  strokeLinecap="round"
                  strokeDasharray={hasFailures ? '6 4' : 'none'}
                />

                {/* Animated particles along the curve */}
                {Array.from({ length: particleCount }).map((_, pi) => (
                  <motion.circle
                    key={`particle-${ei}-${pi}`}
                    r={safeR(2.5, 2.5)}
                    fill={edgeColor}
                    filter="url(#dpf-glow)"
                    initial={{ offsetDistance: '0%', opacity: 0.9 }}
                    animate={{ offsetDistance: '100%', opacity: [0, 0.9, 0.9, 0] }}
                    transition={{
                      duration: Math.max(1.5, 3 - (safeNum(edge.qps, 0) / maxQps) * 1.5),
                      repeat: Infinity,
                      ease: 'linear',
                      delay: pi * (1.2 / particleCount) + ei * 0.2,
                    }}
                    style={{ offsetPath: `path('${pathD}')` } as any}
                  />
                ))}

                {/* Edge metric label */}
                <g transform={`translate(${midX}, ${(y1 + y2) / 2})`}>
                  <rect
                    x={-30} y={-18}
                    width={60} height={20}
                    rx={4}
                    fill="hsl(var(--background))"
                    stroke="hsl(var(--border))"
                    strokeWidth={0.5}
                    opacity={0.85}
                  />
                  <text
                    x={0} y={-5}
                    textAnchor="middle"
                    fill={edgeColor}
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {formatQps(edge.qps)} q/s
                  </text>
                </g>
              </g>
            );
          })}

          {/* Nodes */}
          {activeLayerIndices.map(li => {
            const layer = layers[li];
            const cx = layerX(li);
            const typeKey = layerTypes[li];

            return layer.map((node, ni) => {
              const cy = nodeY(ni, layer.length);
              const color = STATUS_COLORS[node.status] || STATUS_COLORS.unknown;
              const glow = STATUS_GLOW[node.status] || STATUS_GLOW.unknown;
              const icon = TYPE_ICONS[typeKey] || '';
              const halfW = NODE_W / 2;
              const halfH = NODE_H / 2;

              return (
                <g key={node.id} filter="url(#dpf-node-shadow)">
                  {/* Node background */}
                  <rect
                    x={cx - halfW} y={cy - halfH}
                    width={NODE_W} height={NODE_H}
                    rx={8}
                    fill="hsl(var(--card))"
                    stroke={color}
                    strokeWidth={1.2}
                  />

                  {/* Top accent line */}
                  <rect
                    x={cx - halfW + 1} y={cy - halfH}
                    width={NODE_W - 2} height={2.5}
                    rx={1}
                    fill={color}
                    opacity={0.8}
                  />

                  {/* Status indicator with pulse */}
                  <circle cx={cx - halfW + 14} cy={cy - halfH + 16} r={safeR(4, 4)} fill={glow} />
                  <circle cx={cx - halfW + 14} cy={cy - halfH + 16} r={safeR(3, 3)} fill={color}>
                    {node.status === 'ok' && (
                      <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
                    )}
                  </circle>

                  {/* Icon + Label */}
                  <text
                    x={cx - halfW + 24} y={cy - halfH + 19}
                    fill="hsl(var(--foreground))"
                    fontSize="11"
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {icon} {node.label.length > 11 ? node.label.slice(0, 10) + '…' : node.label}
                  </text>

                  {/* IP / sub-label */}
                  {node.ip && (
                    <text
                      x={cx} y={cy + 4}
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      fontSize="8.5"
                      fontFamily="monospace"
                      opacity={0.8}
                    >
                      {node.ip}
                    </text>
                  )}

                  {/* Metrics row */}
                  <text
                    x={cx} y={cy + halfH - 6}
                    textAnchor="middle"
                    fill="hsl(var(--muted-foreground))"
                    fontSize="8"
                    fontFamily="monospace"
                    opacity={0.7}
                  >
                    {[
                      node.latencyMs != null && Number.isFinite(node.latencyMs) ? `${node.latencyMs}ms` : null,
                      node.cacheHit != null && Number.isFinite(node.cacheHit) ? `${node.cacheHit}% hit` : null,
                      node.qps != null && Number.isFinite(node.qps) ? `${formatQps(node.qps)} q/s` : null,
                    ].filter(Boolean).join(' · ') || (node.extra || '')}
                  </text>
                </g>
              );
            });
          })}
        </svg>
      </div>
    </div>
  );
}
