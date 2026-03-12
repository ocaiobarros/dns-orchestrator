import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import NocNetworkNode from './NocNetworkNode';
import NocNetworkLink from './NocNetworkLink';

export interface MapNode {
  id: string;
  label: string;
  type: 'vip' | 'resolver' | 'upstream';
  status: 'ok' | 'degraded' | 'failed' | 'inactive' | 'unknown';
  latency?: number;
  qps?: number;
  cacheHit?: number;
  bindIp?: string;
  extra?: string;
}

export interface MapEdge {
  from: string;
  to: string;
  latency?: number;
  qps?: number;
}

interface Props {
  nodes: MapNode[];
  edges: MapEdge[];
  title?: string;
}

export default function NocNetworkMap({ nodes, edges, title = 'DNS Network Map' }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Layout positions based on node types
  const positions = useMemo(() => {
    const vips = nodes.filter(n => n.type === 'vip');
    const resolvers = nodes.filter(n => n.type === 'resolver');
    const upstreams = nodes.filter(n => n.type === 'upstream');

    const pos: Record<string, { x: number; y: number }> = {};

    // VIP at top center
    vips.forEach((n, i) => {
      pos[n.id] = { x: 500, y: 60 + i * 80 };
    });

    // Resolvers in middle row, spread horizontally
    const rSpacing = 900 / (resolvers.length + 1);
    resolvers.forEach((n, i) => {
      pos[n.id] = { x: rSpacing * (i + 1) + 50, y: 220 };
    });

    // Upstreams at bottom, spread horizontally
    const uSpacing = 900 / (upstreams.length + 1);
    upstreams.forEach((n, i) => {
      pos[n.id] = { x: uSpacing * (i + 1) + 50, y: 400 };
    });

    return pos;
  }, [nodes]);

  // Max QPS for normalizing line widths
  const maxQps = useMemo(() => {
    const vals = edges.map(e => e.qps ?? 0);
    return Math.max(...vals, 1);
  }, [edges]);

  return (
    <div className="noc-surface overflow-hidden">
      <div className="noc-surface-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-foreground/80">{title}</span>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-widest">Live Topology</span>
      </div>

      <div className="relative w-full" style={{ minHeight: 480 }}>
        {/* Background grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]">
          <defs>
            <pattern id="noc-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--foreground))" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#noc-map-grid)" />
        </svg>

        {/* Radar rings */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]">
          {[120, 200, 300].map(r => (
            <circle key={r} cx="500" cy="240" r={r} fill="none" stroke="hsl(var(--primary))" strokeWidth="1" />
          ))}
        </svg>

        {/* Main SVG canvas */}
        <svg viewBox="0 0 1000 480" className="w-full h-full" style={{ minHeight: 480 }}>
          <defs>
            {/* Glow filters */}
            <filter id="map-glow-green">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="map-glow-amber">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="hsl(38, 95%, 50%)" floodOpacity="0.4" />
            </filter>
            <filter id="map-glow-red">
              <feDropShadow dx="0" dy="0" stdDeviation="8" floodColor="hsl(0, 76%, 50%)" floodOpacity="0.5" />
            </filter>

            {/* Flow particle gradient */}
            <linearGradient id="flow-particle" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              <stop offset="50%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* EDGES / LINKS */}
          {edges.map((edge, i) => {
            const fromPos = positions[edge.from];
            const toPos = positions[edge.to];
            if (!fromPos || !toPos) return null;
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            const isHighlighted = hoveredNode === edge.from || hoveredNode === edge.to;

            return (
              <NocNetworkLink
                key={`${edge.from}-${edge.to}`}
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                latency={edge.latency}
                qps={edge.qps ?? 0}
                maxQps={maxQps}
                fromStatus={fromNode?.status ?? 'unknown'}
                toStatus={toNode?.status ?? 'unknown'}
                highlighted={isHighlighted}
                index={i}
              />
            );
          })}

          {/* NODES */}
          {nodes.map(node => {
            const pos = positions[node.id];
            if (!pos) return null;
            return (
              <NocNetworkNode
                key={node.id}
                node={node}
                x={pos.x}
                y={pos.y}
                isHovered={hoveredNode === node.id}
                onHover={() => setHoveredNode(node.id)}
                onLeave={() => setHoveredNode(null)}
              />
            );
          })}

          {/* Direction label */}
          <text x="960" y="240" fill="hsl(var(--foreground))" fillOpacity="0.08" fontSize="10" fontFamily="monospace" textAnchor="end" dominantBaseline="middle">
            QUERY FLOW ↓
          </text>
        </svg>

        {/* Event overlay corner */}
        <AnimatePresence>
          {nodes.some(n => n.status === 'failed' || n.status === 'degraded') && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-3 right-3 z-10 px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/8 backdrop-blur-sm"
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                <span className="text-[10px] font-mono font-bold text-destructive/90">
                  {nodes.filter(n => n.status === 'failed').length > 0
                    ? `${nodes.filter(n => n.status === 'failed').length} node(s) failed`
                    : `${nodes.filter(n => n.status === 'degraded').length} node(s) degraded`
                  }
                </span>
              </div>
              {nodes.filter(n => n.status === 'degraded' || n.status === 'failed').slice(0, 2).map(n => (
                <div key={n.id} className="text-[9px] font-mono text-muted-foreground/50 mt-0.5">
                  {n.label} — {n.status === 'failed' ? 'down' : 'latency spike detected'}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-4 text-[9px] font-mono text-muted-foreground/30">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-success rounded" /> &lt;30ms</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning rounded" /> 30–100ms</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-destructive rounded" /> &gt;100ms</span>
          <span className="flex items-center gap-1"><span className="w-6 h-0.5 border-t border-dashed border-muted-foreground/30" /> degraded</span>
        </div>
      </div>
    </div>
  );
}
