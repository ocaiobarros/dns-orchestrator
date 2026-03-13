// ============================================================
// DNS Control — DNS Path Flow Visualization
// 4-layer symmetric flow: CLIENT → VIP → RESOLVER → UPSTREAM
// NOC-grade SVG with animated Bezier traffic lines
// ============================================================

import { useEffect, useRef, useState } from 'react';
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
  unknown: '#4b5563',
};

const LAYER_LABELS = ['CLIENTES', 'VIP DE SERVIÇO', 'RESOLVERS', 'UPSTREAM'];
const LAYER_TYPES: Array<PathNode['type']> = ['client', 'vip', 'resolver', 'upstream'];

function fmtQps(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function latColor(ms?: number): string {
  if (ms == null) return '#6b7280';
  if (ms < 30) return '#10b981';
  if (ms < 100) return '#f59e0b';
  return '#ef4444';
}

// ── Animated particle along a bezier path ──
function AnimatedParticle({
  pathD,
  color,
  duration,
  delay,
  r = 3,
}: {
  pathD: string;
  color: string;
  duration: number;
  delay: number;
  r?: number;
}) {
  const ref = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let raf: number;
    let start: number | null = null;
    const totalLen = (() => {
      try {
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('d', pathD);
        return tmp.getTotalLength();
      } catch { return 0; }
    })();
    if (totalLen === 0) return;

    const tmpPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmpPath.setAttribute('d', pathD);

    const animate = (ts: number) => {
      if (start === null) start = ts;
      const elapsed = ((ts - start) / 1000 - delay) % duration;
      const t = elapsed < 0 ? 0 : elapsed / duration;
      const pt = tmpPath.getPointAtLength(t * totalLen);
      el.setAttribute('cx', String(pt.x));
      el.setAttribute('cy', String(pt.y));
      const opacity = t < 0.05 ? t / 0.05 : t > 0.9 ? (1 - t) / 0.1 : 1;
      el.setAttribute('opacity', String(Math.max(0, Math.min(1, opacity))));
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [pathD, duration, delay]);

  return <circle ref={ref} r={safeR(r, r)} fill={color} opacity="0" />;
}

// ── Main component ──
const W = 1100;
const H = 320;
const NODE_W = 180;
const NODE_H = 80;
const PAD_X = 80;
const HEADER_Y = 30;
const CONTENT_Y = 60;

export default function NocDnsPathFlow({ nodes, edges }: Props) {
  const layers: PathNode[][] = LAYER_TYPES.map(t => nodes.filter(n => n.type === t));

  // Ensure synthetic client node
  if (layers[0].length === 0) {
    layers[0] = [{ id: 'clients', label: 'Clientes DNS', type: 'client', status: 'ok' }];
  }
  // Ensure synthetic upstream
  if (layers[3].length === 0) {
    layers[3] = [{ id: 'upstream', label: 'Upstream DNS', type: 'upstream', status: 'unknown' }];
  }

  const activeLayers = layers.map((l, i) => l.length > 0 ? i : -1).filter(i => i >= 0);
  const numActive = activeLayers.length;

  const lx = (li: number) => {
    const pos = activeLayers.indexOf(li);
    if (pos < 0) return PAD_X;
    const usable = W - PAD_X * 2;
    return PAD_X + (pos / Math.max(numActive - 1, 1)) * usable;
  };

  const ny = (ni: number, count: number) => {
    const gap = 14;
    const totalH = count * NODE_H + (count - 1) * gap;
    const startY = CONTENT_Y + (H - CONTENT_Y - totalH) / 2;
    return startY + ni * (NODE_H + gap) + NODE_H / 2;
  };

  const maxQps = Math.max(...edges.map(e => safeNum(e.qps, 0)), 1);

  // Build indexed lookup
  const allNodes = layers.flat();
  const nodeMap = new Map(allNodes.map(n => [n.id, n]));

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-muted-foreground">
          DNS Query Path Flow
        </span>
      </div>
      <div className="noc-surface-body p-0 overflow-hidden">
        <svg
          className="w-full"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ minHeight: 200 }}
        >
          <defs>
            {/* Dotted background grid */}
            <pattern id="dpf-dots" width="30" height="30" patternUnits="userSpaceOnUse">
              <circle cx="15" cy="15" r="0.6" fill="hsl(var(--muted-foreground))" opacity="0.12" />
            </pattern>
            {/* Glow filter for particles */}
            <filter id="dpf-particle-glow">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Node drop shadow */}
            <filter id="dpf-shadow" x="-10%" y="-10%" width="120%" height="130%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="rgba(0,0,0,0.35)" />
            </filter>
          </defs>

          {/* BG */}
          <rect width={W} height={H} fill="url(#dpf-dots)" rx="8" />

          {/* Column headers */}
          {activeLayers.map(li => (
            <text
              key={`hdr-${li}`}
              x={lx(li)}
              y={HEADER_Y}
              textAnchor="middle"
              fill="hsl(var(--muted-foreground))"
              fontSize="10"
              fontFamily="monospace"
              fontWeight="700"
              letterSpacing="2.5"
              opacity="0.5"
            >
              {LAYER_LABELS[li]}
            </text>
          ))}

          {/* Vertical guide lines per column */}
          {activeLayers.map(li => (
            <line
              key={`guide-${li}`}
              x1={lx(li)} y1={HEADER_Y + 8}
              x2={lx(li)} y2={H - 10}
              stroke="hsl(var(--border))"
              strokeWidth="0.5"
              strokeDasharray="4 6"
              opacity="0.3"
            />
          ))}

          {/* ── Edges ── */}
          {edges.map((edge, ei) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;

            const fromLi = layers.findIndex(l => l.some(n => n.id === fromNode.id));
            const toLi = layers.findIndex(l => l.some(n => n.id === toNode.id));
            if (fromLi < 0 || toLi < 0) return null;

            const fromNi = layers[fromLi].indexOf(fromNode);
            const toNi = layers[toLi].indexOf(toNode);

            const x1 = lx(fromLi) + NODE_W / 2 + 4;
            const y1 = ny(fromNi, layers[fromLi].length);
            const x2 = lx(toLi) - NODE_W / 2 - 4;
            const y2 = ny(toNi, layers[toLi].length);

            const hasFail = safeNum(edge.failures, 0) > 0;
            const color = hasFail ? '#ef4444' : latColor(edge.latencyMs);
            const thick = Math.max(1.5, (safeNum(edge.qps, 0) / maxQps) * 5);

            const dx = (x2 - x1) * 0.4;
            const pathD = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;

            const particles = Math.max(1, Math.min(4, Math.ceil((safeNum(edge.qps, 0) / maxQps) * 3)));
            const speed = Math.max(1.5, 4 - (safeNum(edge.qps, 0) / maxQps) * 2);

            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;

            return (
              <g key={`e-${ei}`}>
                {/* Glow */}
                <path d={pathD} fill="none" stroke={color} strokeWidth={thick + 6} strokeLinecap="round" opacity={0.06} />
                {/* Main line */}
                <path
                  d={pathD} fill="none"
                  stroke={color}
                  strokeWidth={thick}
                  strokeLinecap="round"
                  strokeDasharray={hasFail ? '6 4' : 'none'}
                  opacity={0.5}
                />

                {/* Particles */}
                {Array.from({ length: particles }).map((_, pi) => (
                  <AnimatedParticle
                    key={`p-${ei}-${pi}`}
                    pathD={pathD}
                    color={color}
                    duration={speed}
                    delay={pi * (speed / particles)}
                    r={3}
                  />
                ))}

                {/* QPS badge on edge */}
                <rect
                  x={midX - 28} y={midY - 11}
                  width={56} height={18} rx={4}
                  fill="hsl(var(--background))" stroke="hsl(var(--border))" strokeWidth={0.6} opacity={0.9}
                />
                <text
                  x={midX} y={midY + 2}
                  textAnchor="middle"
                  fill={color}
                  fontSize="9"
                  fontFamily="monospace"
                  fontWeight="700"
                >
                  {fmtQps(edge.qps)} q/s
                </text>
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {activeLayers.map(li => {
            const layer = layers[li];
            const cx = lx(li);

            return layer.map((node, ni) => {
              const cy = ny(ni, layer.length);
              const color = STATUS_COLORS[node.status] || STATUS_COLORS.unknown;
              const hw = NODE_W / 2;
              const hh = NODE_H / 2;

              const metricsLine = [
                node.latencyMs != null && Number.isFinite(node.latencyMs) ? `${node.latencyMs}ms` : null,
                node.cacheHit != null && Number.isFinite(node.cacheHit) ? `${Math.round(node.cacheHit)}% hit` : null,
                node.qps != null && Number.isFinite(node.qps) ? `${fmtQps(node.qps)} q/s` : null,
              ].filter(Boolean).join('  ·  ') || node.extra || '';

              return (
                <g key={node.id} filter="url(#dpf-shadow)">
                  {/* Card bg */}
                  <rect
                    x={cx - hw} y={cy - hh}
                    width={NODE_W} height={NODE_H}
                    rx={6}
                    fill="hsl(var(--card))"
                    stroke={color}
                    strokeWidth={1}
                    opacity={0.95}
                  />
                  {/* Top accent bar */}
                  <rect
                    x={cx - hw} y={cy - hh}
                    width={NODE_W} height={3}
                    rx={1}
                    fill={color}
                    opacity={0.9}
                  />

                  {/* Status dot */}
                  <circle cx={cx - hw + 16} cy={cy - hh + 18} r={safeR(4.5, 4.5)} fill={color} opacity={0.25} />
                  <circle cx={cx - hw + 16} cy={cy - hh + 18} r={safeR(3, 3)} fill={color}>
                    {node.status === 'ok' && (
                      <animate attributeName="r" values="3;3.5;3" dur="2s" repeatCount="indefinite" />
                    )}
                  </circle>

                  {/* Label */}
                  <text
                    x={cx - hw + 28} y={cy - hh + 22}
                    fill="hsl(var(--foreground))"
                    fontSize="12"
                    fontFamily="monospace"
                    fontWeight="700"
                  >
                    {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                  </text>

                  {/* IP address */}
                  {node.ip && (
                    <text
                      x={cx} y={cy + 4}
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      fontSize="10"
                      fontFamily="monospace"
                      opacity={0.75}
                    >
                      {node.ip}
                    </text>
                  )}

                  {/* Metrics */}
                  {metricsLine && (
                    <text
                      x={cx} y={cy + hh - 8}
                      textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      fontSize="9"
                      fontFamily="monospace"
                      opacity={0.6}
                    >
                      {metricsLine}
                    </text>
                  )}
                </g>
              );
            });
          })}
        </svg>
      </div>
    </div>
  );
}
