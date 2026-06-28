// ============================================================
// DNS Control — Live Upstream Map
// Honest geographic map of REAL probed upstreams (no fake clients,
// no fake QPS, no fake PoPs). Data comes from the upstream_probe
// worker via GET /api/network/upstreams (refresh ~30s).
// ============================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import NocGeoMap, { type MapNode, type MapEdge } from './NocGeoMap';
import type { UpstreamProbeEntry, UpstreamProbeSnapshot } from '@/lib/types';

// How long a "down" upstream remains visible (red) before the front hides it.
// The backend already retires entries after 15 min; this is the extra UI guard.
const HIDE_AFTER_DOWN_S = 15 * 60;

function statusForNode(u: UpstreamProbeEntry): MapNode['status'] {
  if (u.alive) return 'ok';
  if ((u.down_for_s ?? 0) >= HIDE_AFTER_DOWN_S) return 'inactive';
  return 'failed';
}

function vendorLabel(ip: string): string {
  if (ip.startsWith('1.1.1.') || ip.startsWith('1.0.0.')) return 'Cloudflare';
  if (ip.startsWith('8.8.') || ip.startsWith('8.4.')) return 'Google';
  if (ip.startsWith('9.9.9.')) return 'Quad9';
  if (ip.startsWith('208.67.')) return 'OpenDNS';
  return 'Upstream';
}

function buildNodes(snap: UpstreamProbeSnapshot): { nodes: MapNode[]; edges: MapEdge[]; hasOrigin: boolean } {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const visible = snap.upstreams.filter(
    u => u.alive || (u.down_for_s ?? 0) < HIDE_AFTER_DOWN_S,
  );

  // Origin (egress). Position it at the median of the visible PoPs so the
  // line origins are visually grounded; the label is the real egress IP.
  // No invented city: only the IP is shown.
  const popPoints = visible
    .map(u => u.current_geo)
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  const originLat = popPoints.length
    ? popPoints.reduce((s, g) => s + g.lat, 0) / popPoints.length
    : undefined;
  const originLng = popPoints.length
    ? popPoints.reduce((s, g) => s + g.lng, 0) / popPoints.length
    : undefined;

  const hasOrigin = Boolean(snap.egress?.ip || originLat != null);
  if (hasOrigin) {
    nodes.push({
      id: 'origin',
      label: snap.egress?.ip ? `Egress ${snap.egress.ip}` : 'Origem',
      type: 'vip',
      status: 'ok',
      bindIp: snap.egress?.ip ?? undefined,
      extra: snap.egress?.ecs ?? undefined,
      lat: originLat,
      lng: originLng,
    });
  }

  visible.forEach(u => {
    const geo = u.current_geo;
    const status = statusForNode(u);
    const popLabel = u.current_pop ? u.current_pop.toUpperCase() : '—';
    const cityLabel = geo ? `${geo.city}` : 'PoP desconhecido';
    const rttLabel = u.current_rtt_ms != null ? `${u.current_rtt_ms.toFixed(1)}ms` : 'sem rtt';
    const extras: string[] = [popLabel, cityLabel, rttLabel];
    if (u.hops != null) extras.push(`${u.hops} hops`);
    if (!u.alive && u.down_for_s != null) {
      extras.push(`down ${Math.round(u.down_for_s)}s`);
    }

    nodes.push({
      id: `up-${u.ip}`,
      label: `${vendorLabel(u.ip)} ${u.ip}`,
      type: 'upstream',
      status,
      bindIp: u.ip,
      latency: u.current_rtt_ms ?? undefined,
      extra: extras.join(' · '),
      lat: geo?.lat,
      lng: geo?.lng,
    });

    if (hasOrigin) {
      edges.push({
        from: 'origin',
        to: `up-${u.ip}`,
        latency: u.current_rtt_ms ?? undefined,
      });
    }
  });

  return { nodes, edges, hasOrigin };
}

interface Props {
  /** Refetch cadence in milliseconds. Defaults to 30s (matches worker). */
  refetchMs?: number;
  title?: string;
}

export default function NocUpstreamMap({ refetchMs = 30000, title = 'DNS Network Map (Upstreams)' }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['network', 'upstreams'],
    queryFn: api.getUpstreamProbes,
    refetchInterval: refetchMs,
    staleTime: refetchMs / 2,
  });

  const snap = data as UpstreamProbeSnapshot | undefined;
  const { nodes, edges, hasOrigin, aliveCount } = useMemo(() => {
    if (!snap) return { nodes: [] as MapNode[], edges: [] as MapEdge[], hasOrigin: false, aliveCount: 0 };
    const built = buildNodes(snap);
    const alive = snap.upstreams.filter(u => u.alive).length;
    return { ...built, aliveCount: alive };
  }, [snap]);

  const totalUpstreams = snap?.upstreams.length ?? 0;

  return (
    <div className="space-y-2">
      <NocGeoMap
        nodes={nodes}
        edges={edges}
        title={title}
        showClientPoints={false}
        hideServerAnchor={hasOrigin}
      />
      <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground/70 px-1">
        <span>Upstreams: <span className="text-primary font-bold">{totalUpstreams}</span></span>
        <span>Vivos: <span className="text-success font-bold">{aliveCount}</span></span>
        {snap?.egress?.ip && (
          <span>Egress: <span className="text-foreground/80 font-bold">{snap.egress.ip}</span></span>
        )}
        {isLoading && <span className="text-muted-foreground/50">carregando…</span>}
        {isError && <span className="text-destructive/80">erro ao consultar /network/upstreams</span>}
        {!isLoading && !isError && totalUpstreams === 0 && (
          <span className="text-muted-foreground/50">nenhum upstream configurado (recursivo puro?)</span>
        )}
      </div>
    </div>
  );
}
