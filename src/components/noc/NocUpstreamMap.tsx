// ============================================================
// DNS Control — Live Upstream Map
// Honest geographic map of REAL probed upstreams (no fake clients,
// no fake QPS, no fake PoPs). Data comes from the upstream_probe
// worker via GET /api/network/upstreams (refresh ~30s).
// ============================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import NocGeoMap from './NocGeoMap';
import type { MapNode, MapEdge } from './NocNetworkMap';
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

  // Origin position. PRIORITY: real geoIP of the user's own egress (snapshot.egress.geo).
  // Fallback (geo API failed or unavailable): median of visible PoPs, labelled as "aproximada".
  const geoOrigin = snap.egress?.geo;
  const popPoints = visible
    .map(u => u.current_geo)
    .filter((g): g is NonNullable<typeof g> => Boolean(g));
  const medianLat = popPoints.length
    ? popPoints.reduce((s, g) => s + g.lat, 0) / popPoints.length
    : undefined;
  const medianLng = popPoints.length
    ? popPoints.reduce((s, g) => s + g.lng, 0) / popPoints.length
    : undefined;

  const originLat = geoOrigin?.lat ?? medianLat;
  const originLng = geoOrigin?.lng ?? medianLng;
  const originIsApprox = !geoOrigin && medianLat != null;

  const hasOrigin = Boolean(snap.egress?.ip || originLat != null);
  if (hasOrigin) {
    const egressIp = snap.egress?.ip ?? '';
    const cityBits: string[] = [];
    if (geoOrigin) {
      if (geoOrigin.city) cityBits.push(geoOrigin.city);
      if (geoOrigin.region && geoOrigin.region !== geoOrigin.city) cityBits.push(geoOrigin.region);
      if (geoOrigin.country) cityBits.push(geoOrigin.country);
    } else if (originIsApprox) {
      cityBits.push('posição aproximada (sem geoIP)');
    }
    const extras: string[] = [];
    if (cityBits.length) extras.push(cityBits.join(' · '));
    if (geoOrigin?.isp) extras.push(`ISP: ${geoOrigin.isp}`);
    if (geoOrigin?.asn) extras.push(geoOrigin.asn);
    if (snap.egress?.ecs) extras.push(`ECS: ${snap.egress.ecs}`);

    nodes.push({
      id: 'origin',
      label: egressIp ? `Egress ${egressIp}` : 'Origem',
      type: 'vip',
      status: 'ok',
      bindIp: egressIp || undefined,
      extra: extras.length ? extras.join(' · ') : undefined,
      lat: originLat,
      lng: originLng,
    });
  }

  visible.forEach(u => {
    const status = statusForNode(u);
    const vendor = vendorLabel(u.ip);
    const rttLabel = u.current_rtt_ms != null ? `${u.current_rtt_ms.toFixed(1)}ms` : 'sem rtt';

    // ── (1) PoP ATUAL — where our traffic ACTUALLY lands (anycast).
    //    This is the only node the egress connects to. Never plot the
    //    upstream IP at the registered "home" location and call it the PoP.
    const popGeo = u.current_geo;
    const popId = `pop-${u.ip}`;
    if (popGeo) {
      const popLabel = u.current_pop ? u.current_pop.toUpperCase() : '—';
      const extras: string[] = [
        `atende via ${popLabel}`,
        `${popGeo.city}${popGeo.country ? ', ' + popGeo.country : ''}`,
        rttLabel,
      ];
      if (u.hops != null) extras.push(`${u.hops} hops`);
      if (!u.alive && u.down_for_s != null) extras.push(`down ${Math.round(u.down_for_s)}s`);
      nodes.push({
        id: popId,
        label: `${vendor} ${u.ip} · ${popLabel}`,
        type: 'upstream',
        kind: 'pop',
        status,
        bindIp: u.ip,
        latency: u.current_rtt_ms ?? undefined,
        extra: extras.join(' · '),
        lat: popGeo.lat,
        lng: popGeo.lng,
      });
      if (hasOrigin) {
        // TRAFFIC edge: solid, arrow, real latency. Egress → PoP only.
        edges.push({
          from: 'origin',
          to: popId,
          latency: u.current_rtt_ms ?? undefined,
          arrow: true,
        });
      }
    } else {
      // No PoP geo known — still represent the upstream so the user sees it,
      // but without a geographic position (NocGeoMap will skip rendering).
      nodes.push({
        id: popId,
        label: `${vendor} ${u.ip} · PoP desconhecido`,
        type: 'upstream',
        kind: 'pop',
        status,
        bindIp: u.ip,
        latency: u.current_rtt_ms ?? undefined,
        extra: 'PoP desconhecido',
      });
    }

    // ── (2) DATACENTER PAI / SEDE — registered location of the upstream IP.
    //    Identity relation, NOT a traffic destination. Dashed edge PoP→home.
    //    Never receives an edge from origin.
    const home = u.home_geo;
    if (home && popGeo) {
      const sameCity =
        Math.abs(home.lat - popGeo.lat) < 0.05 &&
        Math.abs(home.lng - popGeo.lng) < 0.05;
      if (!sameCity) {
        const homeId = `home-${u.ip}`;
        const homeBits: string[] = [];
        if (home.city) homeBits.push(home.city);
        if (home.country) homeBits.push(home.country);
        const homeExtras: string[] = ['sede registrada'];
        if (homeBits.length) homeExtras.push(homeBits.join(', '));
        if (home.isp) homeExtras.push(`ISP: ${home.isp}`);
        if (home.asn) homeExtras.push(home.asn);
        nodes.push({
          id: homeId,
          label: `${vendor} · sede ${home.city ?? home.country ?? ''}`.trim(),
          type: 'upstream',
          kind: 'home',
          status: 'inactive',
          bindIp: u.ip,
          extra: homeExtras.join(' · '),
          lat: home.lat,
          lng: home.lng,
        });
        // IDENTITY edge: dashed, no arrow, no latency. PoP → home.
        edges.push({ from: popId, to: homeId, dashed: true });
      }
    }

    // ── (3) HISTORY — PoPs we already touched (dedup by city, skip current).
    const seenCities = new Set<string>();
    if (popGeo?.city) seenCities.add(popGeo.city);
    (u.history ?? []).forEach((h, idx) => {
      const hGeo = h.geo;
      if (!hGeo) return;
      const cityKey = hGeo.city || `${hGeo.lat},${hGeo.lng}`;
      if (seenCities.has(cityKey)) return;
      seenCities.add(cityKey);
      const histExtras: string[] = ['PoP anterior'];
      if (h.pop_code) histExtras.push(h.pop_code.toUpperCase());
      if (hGeo.city) histExtras.push(hGeo.city);
      if (h.last_seen) {
        const ageS = Math.max(0, Math.round(Date.now() / 1000 - h.last_seen));
        histExtras.push(`visto há ${ageS}s`);
      }
      nodes.push({
        id: `hist-${u.ip}-${idx}`,
        label: `${vendor} · ${hGeo.city ?? h.pop_code ?? 'anterior'}`,
        type: 'upstream',
        kind: 'history',
        status: 'inactive',
        bindIp: u.ip,
        extra: histExtras.join(' · '),
        lat: hGeo.lat,
        lng: hGeo.lng,
      });
      // No edge — history points are just markers, not traffic paths.
    });
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

  const snap = (data?.success ? data.data : undefined) as UpstreamProbeSnapshot | undefined;
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
          <span>
            Egress: <span className="text-foreground/80 font-bold">{snap.egress.ip}</span>
            {snap.egress.geo?.city && (
              <span className="text-muted-foreground/60"> ({snap.egress.geo.city}{snap.egress.geo.region ? `, ${snap.egress.geo.region}` : ''})</span>
            )}
            {!snap.egress.geo && (
              <span className="text-muted-foreground/40"> (geo não resolvida)</span>
            )}
          </span>
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
