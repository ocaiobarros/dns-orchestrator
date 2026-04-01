// ============================================================
// DNS Control — DNS Path Flow Visualization (v3)
// Pure HTML/CSS React implementation with CSS animations
// 4-layer horizontal flow: CLIENT → VIP → RESOLVER → UPSTREAM
// ============================================================

import { useEffect, useRef, useMemo } from 'react';
import { Globe, Server, Shield, Wifi } from 'lucide-react';
import { safeNum } from '@/lib/svg-utils';

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
  layerLabels?: Partial<Record<PathNode['type'], string>>;
}

const LAYER_TYPES: Array<PathNode['type']> = ['client', 'vip', 'resolver', 'upstream'];

const LAYER_CONFIG: Record<string, { label: string; icon: typeof Globe; gradient: string; glow: string; border: string }> = {
  client:   { label: 'CLIENTES',        icon: Globe,  gradient: 'from-blue-500/20 to-blue-600/5',   glow: 'shadow-blue-500/20',   border: 'border-blue-500/30' },
  vip:      { label: 'VIP DE SERVIÇO',  icon: Shield, gradient: 'from-emerald-500/20 to-emerald-600/5', glow: 'shadow-emerald-500/20', border: 'border-emerald-500/30' },
  resolver: { label: 'RESOLVERS',       icon: Server, gradient: 'from-violet-500/20 to-violet-600/5',  glow: 'shadow-violet-500/20',  border: 'border-violet-500/30' },
  upstream: { label: 'UPSTREAM',        icon: Wifi,   gradient: 'from-amber-500/20 to-amber-600/5',   glow: 'shadow-amber-500/20',   border: 'border-amber-500/30' },
};

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-400',
  degraded: 'bg-amber-400',
  failed: 'bg-red-400',
  unknown: 'bg-gray-500',
};

const STATUS_RING: Record<string, string> = {
  ok: 'ring-emerald-400/30',
  degraded: 'ring-amber-400/30',
  failed: 'ring-red-400/30',
  unknown: 'ring-gray-500/30',
};

function fmtQps(n?: number): string {
  if (n == null || !Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function latBadgeColor(ms?: number): string {
  if (ms == null) return 'text-muted-foreground';
  if (ms < 30) return 'text-emerald-400';
  if (ms < 100) return 'text-amber-400';
  return 'text-red-400';
}

// ── Animated connection between two layers ──
function FlowConnector({ edge, maxQps }: { edge: PathEdge; maxQps: number }) {
  const hasFail = safeNum(edge.failures, 0) > 0;
  const intensity = Math.max(0.15, safeNum(edge.qps, 0) / maxQps);
  const speed = Math.max(1, 5 - intensity * 3);

  const lineColor = hasFail
    ? 'from-red-500 to-red-400'
    : edge.latencyMs != null && edge.latencyMs > 100
      ? 'from-red-500/60 to-amber-500/60'
      : edge.latencyMs != null && edge.latencyMs > 30
        ? 'from-amber-500/60 to-amber-400/60'
        : 'from-emerald-500/40 to-cyan-400/40';

  const particleColor = hasFail ? 'bg-red-400' : 'bg-cyan-400';

  return (
    <div className="flex items-center gap-0 flex-1 min-w-[60px] max-w-[200px] mx-1">
      <div className="relative w-full h-12 flex items-center">
        {/* Main line */}
        <div className={`absolute inset-x-0 top-1/2 -translate-y-px h-[2px] bg-gradient-to-r ${lineColor} rounded-full`} />
        
        {/* Glow line */}
        <div
          className={`absolute inset-x-0 top-1/2 -translate-y-px h-[6px] bg-gradient-to-r ${lineColor} rounded-full blur-sm`}
          style={{ opacity: intensity * 0.4 }}
        />

        {/* Animated particles */}
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 ${particleColor} rounded-full`}
            style={{
              animation: `flowParticle ${speed}s linear ${i * (speed / 3)}s infinite`,
              opacity: 0,
              filter: 'blur(0.5px)',
              boxShadow: hasFail ? '0 0 6px rgba(239,68,68,0.6)' : '0 0 8px rgba(34,211,238,0.5)',
            }}
          />
        ))}

        {/* QPS badge centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="px-2.5 py-0.5 rounded-full bg-background/90 backdrop-blur-sm border border-border/50 shadow-lg">
            <span className="text-[10px] font-mono font-bold text-foreground/80">
              {fmtQps(edge.qps)} <span className="text-muted-foreground/60">q/s</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Single node card ──
function NodeCard({ node }: { node: PathNode }) {
  const cfg = LAYER_CONFIG[node.type];
  const Icon = cfg.icon;
  const dotClass = STATUS_DOT[node.status] || STATUS_DOT.unknown;
  const ringClass = STATUS_RING[node.status] || STATUS_RING.unknown;

  const metrics = useMemo(() => {
    const parts: string[] = [];
    if (node.qps != null && Number.isFinite(node.qps)) parts.push(`${fmtQps(node.qps)} q/s`);
    if (node.latencyMs != null && Number.isFinite(node.latencyMs)) parts.push(`${node.latencyMs}ms`);
    if (node.cacheHit != null && Number.isFinite(node.cacheHit)) parts.push(`${Math.round(node.cacheHit)}% cache`);
    return parts;
  }, [node.qps, node.latencyMs, node.cacheHit]);

  return (
    <div
      className={`
        relative group rounded-xl border ${cfg.border}
        bg-gradient-to-b ${cfg.gradient}
        backdrop-blur-sm p-3 min-w-[150px] max-w-[200px]
        transition-all duration-300
        hover:scale-[1.03] hover:shadow-lg ${cfg.glow}
      `}
    >
      {/* Top accent line */}
      <div
        className="absolute top-0 left-3 right-3 h-px rounded-full"
        style={{
          background: `linear-gradient(90deg, transparent, hsl(var(--${
            node.type === 'client' ? 'accent' :
            node.type === 'vip' ? 'primary' :
            node.type === 'resolver' ? 'chart-4' : 'warning'
          })), transparent)`,
          opacity: 0.6,
        }}
      />

      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`relative flex-shrink-0 w-3 h-3 ${dotClass} rounded-full ring-4 ${ringClass}`}>
          {node.status === 'ok' && (
            <div className={`absolute inset-0 ${dotClass} rounded-full animate-ping`} style={{ animationDuration: '2s' }} />
          )}
        </div>
        <Icon size={14} className="text-muted-foreground/60 flex-shrink-0" />
        <span className="text-xs font-mono font-bold text-foreground truncate">
          {node.label}
        </span>
      </div>

      {/* IP */}
      {node.ip && (
        <div className="text-[10px] font-mono text-muted-foreground/70 truncate mb-1.5 pl-5">
          {node.ip}
        </div>
      )}

      {/* Metrics row */}
      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 pl-5">
          {metrics.map((m, i) => (
            <span
              key={i}
              className={`text-[9px] font-mono ${
                m.includes('ms') ? latBadgeColor(node.latencyMs) : 'text-muted-foreground/60'
              }`}
            >
              {m}
            </span>
          ))}
        </div>
      )}

      {/* Extra info */}
      {!metrics.length && node.extra && (
        <div className="text-[9px] font-mono text-muted-foreground/50 pl-5 truncate">{node.extra}</div>
      )}
    </div>
  );
}

// ── Main component ──
export default function NocDnsPathFlow({ nodes, edges, layerLabels }: Props) {
  const layers: PathNode[][] = LAYER_TYPES.map(t => nodes.filter(n => n.type === t));

  // Synthetic defaults
  if (layers[0].length === 0) {
    layers[0] = [{ id: 'clients', label: 'Clientes DNS', type: 'client', status: 'ok' }];
  }
  if (layers[3].length === 0) {
    layers[3] = [{ id: 'upstream', label: 'Upstream DNS', type: 'upstream', status: 'unknown' }];
  }

  const maxQps = Math.max(...edges.map(e => safeNum(e.qps, 0)), 1);

  // Build edge lookup by source layer index
  const edgesByFromLayer = useMemo(() => {
    const map = new Map<number, PathEdge[]>();
    const allNodes = layers.flat();
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));

    edges.forEach(edge => {
      const fromNode = nodeMap.get(edge.from);
      if (!fromNode) return;
      const li = LAYER_TYPES.indexOf(fromNode.type);
      if (li < 0) return;
      const arr = map.get(li) || [];
      arr.push(edge);
      map.set(li, arr);
    });
    return map;
  }, [nodes, edges]);

  return (
    <div className="noc-surface">
      {/* Header */}
      <div className="noc-surface-header flex items-center gap-2.5">
        <div className="relative w-2 h-2">
          <div className="absolute inset-0 rounded-full bg-cyan-400 animate-ping" style={{ animationDuration: '2s' }} />
          <div className="absolute inset-0 rounded-full bg-cyan-400" />
        </div>
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground">
          DNS Query Path Flow
        </span>
      </div>

      {/* Body */}
      <div className="noc-surface-body p-4 overflow-x-auto">
        {/* Column labels */}
        <div className="flex items-start justify-between mb-4 px-1">
          {LAYER_TYPES.map((type, i) => {
            const cfg = LAYER_CONFIG[type];
            const hasNodes = layers[i].length > 0;
            return (
              <div key={type} className="flex-1 text-center" style={{ opacity: hasNodes ? 1 : 0.3 }}>
                <span className="text-[9px] font-mono font-bold uppercase tracking-[0.25em] text-muted-foreground/50">
                  {layerLabels?.[type] || cfg.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Flow row */}
        <div className="flex items-center justify-between gap-0">
          {LAYER_TYPES.map((type, li) => {
            const layerNodes = layers[li];
            const layerEdges = edgesByFromLayer.get(li) || [];
            const isLast = li === LAYER_TYPES.length - 1;

            return (
              <div key={type} className="contents">
                {/* Node column */}
                <div className="flex flex-col gap-2 items-center flex-shrink-0">
                  {layerNodes.map(node => (
                    <NodeCard key={node.id} node={node} />
                  ))}
                </div>

                {/* Connector */}
                {!isLast && (
                  layerEdges.length > 0 ? (
                    <div className="flex flex-col gap-1 flex-1 min-w-[60px] max-w-[200px]">
                      {layerEdges.map((edge, ei) => (
                        <FlowConnector key={ei} edge={edge} maxQps={maxQps} />
                      ))}
                    </div>
                  ) : (
                    <FlowConnector
                      edge={{ from: '', to: '', qps: 0 }}
                      maxQps={1}
                    />
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Inline keyframes */}
      <style>{`
        @keyframes flowParticle {
          0%   { left: 0%;   opacity: 0; transform: translateY(-50%) scale(0.5); }
          10%  { opacity: 1; transform: translateY(-50%) scale(1); }
          85%  { opacity: 1; transform: translateY(-50%) scale(1); }
          100% { left: 100%; opacity: 0; transform: translateY(-50%) scale(0.5); }
        }
      `}</style>
    </div>
  );
}
