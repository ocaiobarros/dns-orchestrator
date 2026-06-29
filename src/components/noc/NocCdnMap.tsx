// ============================================================
// DNS Control — Live CDN/Authoritative Map (iterative mode)
// Honest geographic map of CDNs/authoritatives the resolver
// actually contacted (source: unbound-control dump_infra,
// aggregated across all local instances). Origin is the real
// egress geoIP; nodes are entries with geo (top-N per cycle).
// A side list shows ALL providers — even those without geo —
// so nothing observed is hidden.
// ============================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import NocGeoMap from './NocGeoMap';
import type { MapNode, MapEdge } from './NocNetworkMap';
import type { CdnEntry, CdnProviderGroup, CdnSnapshot } from '@/lib/types';

// Per-provider HSL hues for the legend / node colour hint via `extra`.
// (NocGeoMap doesn't accept custom colours, so we just put the provider
// name first in the label so it shows up in the legend chips.)
const PROVIDER_ORDER = [
  'Cloudflare', 'Akamai', 'Google', 'AWS', 'Fastly',
  'Azure', 'Microsoft', 'Apple', 'Meta', 'Netflix',
  'Spotify', 'TikTok', 'TLD', 'Root', 'Other',
];

function providerRank(p: string): number {
  const i = PROVIDER_ORDER.indexOf(p);
  return i === -1 ? PROVIDER_ORDER.length : i;
}

function fmtRtt(rtt: number | null | undefined): string {
  return rtt == null ? 'sem rtt' : `${rtt.toFixed(1)}ms`;
}

function buildMap(snap: CdnSnapshot): { nodes: MapNode[]; edges: MapEdge[]; hasOrigin: boolean } {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];

  const geoOrigin = snap.egress?.geo;
  // Fallback: median of geo'd CDN entries.
  const allGeoEntries: CdnEntry[] = snap.providers.flatMap(p => p.entries).filter(e => e.geo);
  const medianLat = allGeoEntries.length
    ? allGeoEntries.reduce((s, e) => s + (e.geo!.lat), 0) / allGeoEntries.length
    : undefined;
  const medianLng = allGeoEntries.length
    ? allGeoEntries.reduce((s, e) => s + (e.geo!.lng), 0) / allGeoEntries.length
    : undefined;

  const originLat = geoOrigin?.lat ?? medianLat;
  const originLng = geoOrigin?.lng ?? medianLng;
  const hasOrigin = Boolean(snap.egress?.ip || originLat != null);

  if (hasOrigin) {
    const ips = snap.egress?.ips ?? [];
    const block = snap.egress?.block ?? snap.egress?.ecs ?? null;
    const legacyIp = snap.egress?.ip ?? '';
    const label = block
      ? `Egress ${block}`
      : (ips[0] ? `Egress ${ips[0]}` : (legacyIp ? `Egress ${legacyIp}` : 'Origem'));
    const bits: string[] = [];
    if (ips.length > 0) {
      bits.push(`egressos reais: ${ips.join(' · ')}`);
    } else if (legacyIp) {
      bits.push(legacyIp);
    }
    if (geoOrigin?.city) bits.push(geoOrigin.city);
    if (geoOrigin?.country) bits.push(geoOrigin.country);
    if (geoOrigin?.isp) bits.push(`ISP: ${geoOrigin.isp}`);
    if (snap.egress?.ecs) bits.push(`ECS: ${snap.egress.ecs}`);
    nodes.push({
      id: 'origin',
      label,
      type: 'vip',
      status: 'ok',
      bindIp: ips[0] || legacyIp || undefined,
      extra: bits.join(' · ') || undefined,
      lat: originLat,
      lng: originLng,
    });
  }


  for (const group of snap.providers) {
    for (const entry of group.entries) {
      if (!entry.geo) continue; // listed in the side panel, not on the map
      const id = `cdn-${entry.ip}`;
      const extras: string[] = [group.provider];
      if (entry.zone) extras.push(entry.zone);
      extras.push(fmtRtt(entry.rtt_ms));
      if (entry.lame) extras.push('lame');
      if (entry.dnssec_lame) extras.push('dnssec-lame');
      nodes.push({
        id,
        label: `${group.provider} · ${entry.ip}`,
        type: 'upstream',
        kind: 'pop',
        status: entry.lame || entry.dnssec_lame ? 'degraded' : 'ok',
        bindIp: entry.ip,
        latency: entry.rtt_ms ?? undefined,
        extra: extras.join(' · '),
        lat: entry.geo.lat,
        lng: entry.geo.lng,
      });
      if (hasOrigin) {
        edges.push({ from: 'origin', to: id, latency: entry.rtt_ms ?? undefined, arrow: true });
      }
    }
  }
  return { nodes, edges, hasOrigin };
}

function ProviderListItem({ p }: { p: CdnProviderGroup }) {
  return (
    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-mono border-b border-border/30 last:border-b-0">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-foreground font-bold truncate">{p.provider}</span>
        <span className="text-muted-foreground/70 shrink-0">×{p.count}</span>
        {p.geo_count > 0 && (
          <span className="text-success/80 shrink-0" title="entradas com geo no mapa">
            ◉ {p.geo_count}
          </span>
        )}
      </div>
      <div className="text-muted-foreground/80 shrink-0">
        rtt&nbsp;<span className="text-primary font-bold">{fmtRtt(p.avg_rtt_ms)}</span>
      </div>
    </div>
  );
}

interface Props {
  refetchMs?: number;
  title?: string;
}

export default function NocCdnMap({ refetchMs = 60000, title = 'DNS Network Map (CDNs reais)' }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['network', 'cdns'],
    queryFn: api.getCdns,
    refetchInterval: refetchMs,
    staleTime: refetchMs / 2,
  });

  const snap = (data?.success ? data.data : undefined) as CdnSnapshot | undefined;
  const { nodes, edges, hasOrigin, totalEntries, totalGeo } = useMemo(() => {
    if (!snap) return { nodes: [] as MapNode[], edges: [] as MapEdge[], hasOrigin: false, totalEntries: 0, totalGeo: 0 };
    const built = buildMap(snap);
    const totals = snap.providers.reduce(
      (acc, p) => {
        acc.totalEntries += p.count;
        acc.totalGeo += p.geo_count;
        return acc;
      },
      { totalEntries: 0, totalGeo: 0 },
    );
    return { ...built, ...totals };
  }, [snap]);

  const providersSorted = useMemo(() => {
    if (!snap) return [] as CdnProviderGroup[];
    return [...snap.providers].sort(
      (a, b) => providerRank(a.provider) - providerRank(b.provider) || b.count - a.count,
    );
  }, [snap]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-2">
      <div className="space-y-2 min-w-0">
        <NocGeoMap
          nodes={nodes}
          edges={edges}
          title={title}
          showClientPoints={false}
          hideServerAnchor={hasOrigin}
        />
        <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground/70 px-1 flex-wrap">
          <span>CDNs/autoritativos: <span className="text-primary font-bold">{totalEntries}</span></span>
          <span>Com geo no mapa: <span className="text-success font-bold">{totalGeo}</span></span>
          {snap?.egress?.ip && (
            <span>
              Egress: <span className="text-foreground/80 font-bold">{snap.egress.ip}</span>
              {snap.egress.geo?.city && (
                <span className="text-muted-foreground/60"> ({snap.egress.geo.city}{snap.egress.geo.country ? `, ${snap.egress.geo.country}` : ''})</span>
              )}
            </span>
          )}
          {isLoading && <span className="text-muted-foreground/50">carregando…</span>}
          {isError && <span className="text-destructive/80">erro ao consultar /network/cdns</span>}
          {!isLoading && !isError && totalEntries === 0 && (
            <span className="text-muted-foreground/50">
              nenhuma entrada em dump_infra ainda (resolver recém iniciado?)
            </span>
          )}
        </div>
      </div>

      <aside className="border border-border/40 rounded bg-card/30 overflow-hidden">
        <div className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border/40 bg-card/50">
          Provedores que te servem
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {providersSorted.length === 0 ? (
            <div className="px-2 py-3 text-[10px] font-mono text-muted-foreground/50">
              sem dados ainda
            </div>
          ) : (
            providersSorted.map(p => <ProviderListItem key={p.provider} p={p} />)
          )}
        </div>
      </aside>
    </div>
  );
}
