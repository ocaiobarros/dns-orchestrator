// ============================================================
// DNS Control — DNS Path Visualization
// Real query flow: CLIENT → VIP → Resolver → Upstream
// Shows QPS, latency, cache hit, failures per path
// ============================================================

import { motion } from 'framer-motion';
import { safeNum, safeR, safeSW } from '@/lib/svg-utils';

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

const STATUS_COLORS = {
  ok: 'hsl(var(--success))',
  degraded: 'hsl(var(--warning))',
  failed: 'hsl(var(--destructive))',
  unknown: 'hsl(var(--muted-foreground))',
};

const TYPE_LABELS: Record<string, string> = {
  client: 'CLIENTES',
  vip: 'VIP DE SERVIÇO',
  resolver: 'RESOLVER',
  upstream: 'UPSTREAM',
};

function formatQps(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export default function NocDnsPathFlow({ nodes, edges }: Props) {
  // Group nodes by type in flow order
  const layers: PathNode[][] = [
    nodes.filter(n => n.type === 'client'),
    nodes.filter(n => n.type === 'vip'),
    nodes.filter(n => n.type === 'resolver'),
    nodes.filter(n => n.type === 'upstream'),
  ].filter(l => l.length > 0);

  // If no client node, prepend a synthetic one
  if (!nodes.some(n => n.type === 'client')) {
    layers.unshift([{ id: 'clients', label: 'Clientes DNS', type: 'client', status: 'ok' }]);
  }

  const maxQps = Math.max(...edges.map(e => safeNum(e.qps, 0)), 1);

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">DNS Query Path Flow</span>
      </div>
      <div className="noc-surface-body">
        <div className="relative">
          <svg className="w-full" viewBox="0 0 900 320" preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="pathGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                <path d="M 30 0 L 0 0 0 30" fill="none" stroke="hsl(var(--border))" strokeWidth="0.3" opacity="0.3" />
              </pattern>
              <linearGradient id="flowGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.6" />
                <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.3" />
              </linearGradient>
              <filter id="pathGlow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <rect width="900" height="320" fill="url(#pathGrid)" rx="8" />

            {/* Draw edges between layers */}
            {edges.map((edge, i) => {
              const fromNode = nodes.find(n => n.id === edge.from) || layers.flat().find(n => n.id === edge.from);
              const toNode = nodes.find(n => n.id === edge.to) || layers.flat().find(n => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const fromLayerIdx = layers.findIndex(l => l.some(n => n.id === fromNode.id));
              const toLayerIdx = layers.findIndex(l => l.some(n => n.id === toNode.id));
              if (fromLayerIdx < 0 || toLayerIdx < 0) return null;

              const fromPosInLayer = layers[fromLayerIdx]?.indexOf(fromNode) ?? 0;
              const toPosInLayer = layers[toLayerIdx]?.indexOf(toNode) ?? 0;
              const fromLayerCount = Math.max(layers[fromLayerIdx]?.length ?? 1, 1);
              const toLayerCount = Math.max(layers[toLayerIdx]?.length ?? 1, 1);

              const x1 = safeNum(100 + fromLayerIdx * 200);
              const y1 = safeNum(60 + (fromPosInLayer + 0.5) * (200 / fromLayerCount));
              const x2 = safeNum(100 + toLayerIdx * 200);
              const y2 = safeNum(60 + (toPosInLayer + 0.5) * (200 / toLayerCount));

              const thickness = safeSW(Math.max(1.5, (safeNum(edge.qps, 0) / maxQps) * 6), 1.5);
              const hasFailures = safeNum(edge.failures, 0) > 0;

              return (
                <g key={i}>
                  <line
                    x1={x1 + 40} y1={y1}
                    x2={x2 - 40} y2={y2}
                    stroke={hasFailures ? 'hsl(var(--destructive))' : 'url(#flowGrad)'}
                    strokeWidth={thickness}
                    strokeLinecap="round"
                    opacity={0.7}
                  />
                  {/* Animated flow particle */}
                  <motion.circle
                    r={safeR(3, 3)}
                    fill={hasFailures ? 'hsl(var(--destructive))' : 'hsl(var(--primary))'}
                    filter="url(#pathGlow)"
                    initial={{ cx: x1 + 40, cy: y1 }}
                    animate={{ cx: x2 - 40, cy: y2 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear', delay: i * 0.3 }}
                  />
                  {/* Edge label */}
                  <text
                    x={safeNum((x1 + 40 + x2 - 40) / 2)}
                    y={safeNum((y1 + y2) / 2 - 8)}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {formatQps(edge.qps)} QPS
                    {edge.latencyMs != null && Number.isFinite(edge.latencyMs) ? ` · ${edge.latencyMs}ms` : ''}
                  </text>
                </g>
              );
            })}

            {/* Draw nodes */}
            {layers.map((layer, li) => (
              <g key={li}>
                <text
                  x={safeNum(100 + li * 200)}
                  y={40}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="bold"
                  letterSpacing="1.5"
                >
                  {TYPE_LABELS[layer[0]?.type] || ''}
                </text>

                {layer.map((node, ni) => {
                  const x = safeNum(100 + li * 200);
                  const y = safeNum(60 + (ni + 0.5) * (200 / Math.max(layer.length, 1)));
                  const color = STATUS_COLORS[node.status] || STATUS_COLORS.unknown;

                  return (
                    <g key={node.id}>
                      <rect
                        x={x - 38} y={y - 28}
                        width={76} height={56}
                        rx={6}
                        fill="hsl(var(--card))"
                        stroke={color}
                        strokeWidth={node.status === 'failed' ? 2 : 1}
                        opacity={0.95}
                      />
                      <circle cx={x - 28} cy={y - 18} r={safeR(3, 3)} fill={color}>
                        {node.status === 'ok' && (
                          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
                        )}
                      </circle>
                      <text x={x} y={y - 12} textAnchor="middle" className="fill-foreground" fontSize="10" fontFamily="monospace" fontWeight="600">
                        {node.label.length > 12 ? node.label.slice(0, 11) + '…' : node.label}
                      </text>
                      {node.ip && (
                        <text x={x} y={y + 2} textAnchor="middle" className="fill-muted-foreground" fontSize="8" fontFamily="monospace">
                          {node.ip}
                        </text>
                      )}
                      <text x={x} y={y + 16} textAnchor="middle" className="fill-muted-foreground" fontSize="8" fontFamily="monospace">
                        {[
                          node.latencyMs != null && Number.isFinite(node.latencyMs) ? `${node.latencyMs}ms` : null,
                          node.cacheHit != null && Number.isFinite(node.cacheHit) ? `${node.cacheHit}%` : null,
                          node.qps != null && Number.isFinite(node.qps) ? `${formatQps(node.qps)}q` : null,
                        ].filter(Boolean).join(' · ') || (node.extra || '')}
                      </text>
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
