import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Activity, Wifi } from 'lucide-react';
import type { InstanceHealthReport, InstanceHealthResult } from '@/lib/types';
import NocNetworkMap, { type MapNode, type MapEdge } from './NocNetworkMap';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  dnsAvailable?: boolean;
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatency?: number;
  dnsMetricsAvailable?: boolean;
  /** Override the entry-point label (defaults to 'VIP') */
  entryLabel?: string;
}

function UnavailableState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/10 flex items-center justify-center border border-border/10">
        <Wifi size={18} className="text-muted-foreground/20" />
      </div>
      <p className="text-[11px] font-mono text-muted-foreground/45">{message}</p>
      <p className="text-[9px] font-mono text-muted-foreground/30">{sub}</p>
    </div>
  );
}

function buildTopology(
  health: InstanceHealthReport,
  vipConfigured?: boolean,
  vipAddress?: string | null,
  totalQueries?: number,
  cacheHitRatio?: number,
  avgLatency?: number,
  entryLabel?: string,
): { nodes: MapNode[]; edges: MapEdge[] } {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const instances = health.instances ?? [];

  // VIP node
  const vipIp = vipAddress || health.vip?.bind_ip || 'N/A';
  const vipHealthy = health.vip?.healthy ?? Boolean(vipConfigured);
  nodes.push({
    id: 'vip-entry',
    label: entryLabel || 'VIP',
    type: 'vip',
    status: !vipConfigured && !health.vip ? 'inactive' : vipHealthy ? 'ok' : 'failed',
    qps: totalQueries,
    bindIp: vipIp,
    latency: health.vip?.latency_ms,
  });

  // Group instances by name (unbound01, unbound02, etc.)
  const grouped = new Map<string, InstanceHealthResult[]>();
  instances.forEach(inst => {
    const name = inst.instance;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name)!.push(inst);
  });

  // Resolver nodes — one per instance group
  const resolverIds: string[] = [];
  grouped.forEach((insts, name) => {
    const id = `resolver-${name}`;
    resolverIds.push(id);
    const allHealthy = insts.every(i => i.healthy);
    const anyHealthy = insts.some(i => i.healthy);
    const ips = insts.map(i => i.bind_ip).join(', ');
    const bestLatency = Math.min(...insts.map(i => i.latency_ms ?? Infinity));

    nodes.push({
      id,
      label: name.toUpperCase(),
      type: 'resolver',
      status: allHealthy ? 'ok' : anyHealthy ? 'degraded' : 'failed',
      bindIp: ips,
      latency: Number.isFinite(bestLatency) ? Math.round(bestLatency) : undefined,
      cacheHit: cacheHitRatio != null ? Math.round(cacheHitRatio) : undefined,
      extra: `${insts.length} bind${insts.length > 1 ? 's' : ''} · porta ${insts[0]?.port ?? '?'}`,
    });

    // Edge VIP → resolver
    edges.push({
      from: 'vip-entry',
      to: id,
      latency: Number.isFinite(bestLatency) ? Math.round(bestLatency) : undefined,
      qps: totalQueries ? Math.round(totalQueries / grouped.size) : 0,
    });
  });

  // Upstream nodes — unique resolved IPs
  const upstreamIps = Array.from(
    new Set(
      instances
        .map(i => i.resolved_ip)
        .filter((ip): ip is string => Boolean(ip && ip !== '—')),
    ),
  );

  if (upstreamIps.length === 0) {
    upstreamIps.push('N/A');
  }

  upstreamIps.forEach((ip, idx) => {
    const id = `upstream-${idx}`;
    const relatedInstances = instances.filter(i => i.resolved_ip === ip);
    const anyHealthy = relatedInstances.some(i => i.healthy);

    nodes.push({
      id,
      label: ip,
      type: 'upstream',
      status: ip === 'N/A' ? 'inactive' : anyHealthy ? 'ok' : 'failed',
      bindIp: ip,
    });

    // Edges resolver → upstream
    resolverIds.forEach(rid => {
      const resolverName = rid.replace('resolver-', '');
      const resolverInsts = grouped.get(resolverName) ?? [];
      const matchesUpstream = resolverInsts.some(i => i.resolved_ip === ip);
      if (matchesUpstream || upstreamIps.length === 1) {
        edges.push({
          from: rid,
          to: id,
          latency: avgLatency != null ? Math.round(avgLatency) : undefined,
          qps: totalQueries ? Math.round(totalQueries / (grouped.size * upstreamIps.length)) : 0,
        });
      }
    });
  });

  return { nodes, edges };
}

export default function NocTopologyPanel({
  health,
  vipConfigured,
  vipAddress,
  dnsAvailable,
  totalQueries,
  cacheHitRatio,
  avgLatency,
  dnsMetricsAvailable,
}: NocTopologyPanelProps) {
  const hasData = Boolean(health && Array.isArray(health.instances) && health.instances.length > 0);

  const { nodes, edges } = useMemo(() => {
    if (!hasData || !health) return { nodes: [], edges: [] };
    return buildTopology(health, vipConfigured, vipAddress, totalQueries, cacheHitRatio, avgLatency);
  }, [health, vipConfigured, vipAddress, totalQueries, cacheHitRatio, avgLatency, hasData]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="noc-surface-elevated h-full"
    >
      <div className="noc-surface-body">
        {hasData ? (
          <NocNetworkMap nodes={nodes} edges={edges} title="DNS NETWORK MAP" />
        ) : !dnsAvailable ? (
          <UnavailableState message="Network map unavailable" sub="DNS health data requires privileged access" />
        ) : (
          <UnavailableState message="Awaiting health telemetry" sub="Waiting for instance probe results" />
        )}
      </div>
    </motion.div>
  );
}
