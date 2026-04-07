import { useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import NocNetworkNode from './NocNetworkNode';
import NocNetworkLink from './NocNetworkLink';
import { safeNum, safeR } from '@/lib/svg-utils';

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

  const { positions, viewWidth, viewHeight, isCompact } = useMemo(() => {
    const vips = nodes.filter(n => n.type === 'vip');
    const resolvers = nodes.filter(n => n.type === 'resolver');
    const upstreams = nodes.filter(n => n.type === 'upstream');

    const resolverCount = Math.max(resolvers.length, 1);
    const compact = resolverCount > 4;

    // Each resolver needs space for label + 2 IPs + latency ≈ 80-100px
    const nodeSpacing = compact
      ? Math.max(70, Math.round(420 / resolverCount))
      : Math.max(90, Math.round(500 / resolverCount));

    const resolverColumnHeight = (resolverCount - 1) * nodeSpacing;
    const padding = 80;
    const totalHeight = Math.max(resolverColumnHeight + padding * 2, 280);
    const centerY = totalHeight / 2;

    const w = 960;
    const vipX = 120;
    const resolverX = w / 2;
    const upstreamX = w - 120;

    const pos: Record<string, { x: number; y: number }> = {};

    // VIPs centered left
    const vipSpacing = 70;
    const vipHeight = (vips.length - 1) * vipSpacing;
    vips.forEach((n, i) => {
      pos[n.id] = { x: vipX, y: centerY - vipHeight / 2 + i * vipSpacing };
    });

    // Resolvers center column
    const resolverStartY = centerY - resolverColumnHeight / 2;
    resolvers.forEach((n, i) => {
      pos[n.id] = { x: resolverX, y: resolverStartY + i * nodeSpacing };
    });

    // Upstreams centered right
    const upSpacing = 70;
    const upHeight = (upstreams.length - 1) * upSpacing;
    upstreams.forEach((n, i) => {
      pos[n.id] = { x: upstreamX, y: centerY - upHeight / 2 + i * upSpacing };
    });

    return { positions: pos, viewWidth: w, viewHeight: totalHeight, isCompact: compact };
  }, [nodes]);

  const maxQps = useMemo(() => {
    const vals = edges.map(e => safeNum(e.qps, 0));
    return Math.max(...vals, 1);
  }, [edges]);

  return (
    <div className="noc-surface overflow-hidden">
      <div className="noc-surface-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-foreground/80">{title}</span>
        </div>
        <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/40">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-success" /> HEALTHY</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive" /> FAILED</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40" /> INACTIVE</span>
          <span className="flex items-center gap-1"><span className="text-warning">✦</span> TRAFFIC</span>
        </div>
      </div>

      <div className="relative w-full" style={{ minHeight: Math.max(viewHeight + 20, 280) }}>
        {/* Background grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.04]">
          <defs>
            <pattern id="noc-map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="hsl(var(--foreground))" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#noc-map-grid)" />
        </svg>

        {/* Main SVG canvas */}
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="w-full h-full"
          style={{ minHeight: Math.max(viewHeight + 20, 280) }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <filter id="map-glow-green">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
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
                x1={safeNum(fromPos.x)}
                y1={safeNum(fromPos.y)}
                x2={safeNum(toPos.x)}
                y2={safeNum(toPos.y)}
                latency={edge.latency}
                qps={safeNum(edge.qps, 0)}
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
                x={safeNum(pos.x)}
                y={safeNum(pos.y)}
                isHovered={hoveredNode === node.id}
                onHover={() => setHoveredNode(node.id)}
                onLeave={() => setHoveredNode(null)}
                compact={isCompact && node.type === 'resolver'}
              />
            );
          })}
        </svg>

        {/* Event overlay */}
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-4 text-[9px] font-mono text-muted-foreground/30">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-success rounded" /> &lt;30ms</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-warning rounded" /> 30–100ms</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-destructive rounded" /> &gt;100ms</span>
        </div>
      </div>
    </div>
  );
}
