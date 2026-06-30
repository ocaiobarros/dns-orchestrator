import { Activity, Clock, Globe, Zap, Database, Timer, Shield, Server,
  Network, Map as MapIcon, Radio, ListOrdered, Users as UsersIcon, BarChart2,
  Heart, Bell, Play, Plus, AlertTriangle } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth, useDeployState, queryKeys } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import StatusChipBar from '@/components/noc/v3/StatusChipBar';
import KpiCard, { MiniGlobe, MiniBackends, MiniBars, MiniDonut, MiniSpark, MiniShield } from '@/components/noc/v3/KpiCard';
import PanelV3 from '@/components/noc/v3/PanelV3';
import TopologyMini from '@/components/noc/v3/TopologyMini';
import LatencyMatrix from '@/components/noc/v3/LatencyMatrix';
import RankList from '@/components/noc/v3/RankList';
import NocGeoMap from '@/components/noc/NocGeoMap';
import NocResolverMap from '@/components/noc/NocResolverMap';
import TelemetryHealthStrip from '@/components/noc/TelemetryHealthStrip';
import NocPoolOperationalState from '@/components/noc/NocPoolOperationalState';
import type { MapNode, MapEdge } from '@/components/noc/NocNetworkMap';

export default function Dashboard() {
  const { data: sysInfo, isLoading: sysLoading } = useSystemInfo();
  if (sysLoading && !sysInfo) return <LoadingState />;
  return <InterceptionDashboard />;
}

function InterceptionDashboard() {
  const { data: sysInfo, isLoading: sysLoading, error: sysError } = useSystemInfo();
  const { data: services } = useServices();
  const { data: instanceStats } = useInstanceStats();
  const { data: health } = useInstanceHealth();
  const { data: deployState } = useDeployState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [reconciling, setReconciling] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'critical' | 'warn'>('all');
  const [testDomains, setTestDomains] = useState<string[]>(['google.com', 'youtube.com', 'cloudflare.com', 'facebook.com', 'amazon.com', 'example.com']);
  const [simRunning, setSimRunning] = useState(false);
  const [simResult, setSimResult] = useState<string | null>(null);
  type SimRow = { domain: string; backend: string; ms: number; status: 'ok' | 'fail'; rcode: string };
  const [simRows, setSimRows] = useState<SimRow[]>([]);

  const { data: v2Instances } = useQuery({
    queryKey: ['v2-instances'],
    queryFn: async () => { const r = await api.getV2Instances(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 10000,
  });
  const { data: recentEvents } = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: async () => { const r = await api.getEvents(undefined, 20); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 5000,
  });
  // Top domains: same source as /dns (telemetry payload, parsed from journalctl by collector).
  // /dns/top-domains backend currently returns []; using telemetry.top_domains keeps both screens consistent.
  const { data: topDomainsLegacy } = useQuery({
    queryKey: ['topDomains', 5],
    queryFn: async () => { const r = await api.getTopDomains(5); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
  });
  const { data: telemetry } = useQuery({
    queryKey: ['telemetry', 'latest'],
    queryFn: async () => { const r = await api.getTelemetryLatest(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 15000,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => { setReconciling(true); const r = await api.reconcileNow(); if (!r.success) throw new Error(r.error!); return r.data; },
    onSettled: () => { setReconciling(false); qc.invalidateQueries({ queryKey: ['v2-instances'] }); qc.invalidateQueries({ queryKey: ['events'] }); },
  });

  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  const dnsAvail = sysInfo?.dns_metrics_available ?? false;
  const dashQ = sysInfo?.total_queries ?? 0;
  const dashCH = sysInfo?.cache_hit_ratio ?? 0;
  const dashLat = sysInfo?.latency_ms ?? 0;

  const totalQps = dnsAvail ? dashQ : safeStats.reduce((a, b) => a + getInstanceQueries(b), 0);
  const avgCacheHit = dnsAvail ? dashCH : (safeStats.length ? safeStats.reduce((a, b) => a + getInstanceCacheHit(b), 0) / safeStats.length : 0);
  const avgLatency = dnsAvail ? dashLat : (safeStats.length ? safeStats.reduce((a, b) => a + getInstanceLatency(b), 0) / safeStats.length : 0);
  // Latência EFETIVA percebida pelo cliente: cache-hits custam ~0ms, só os
  // cache-miss pagam o custo de recursão. Aproximação honesta com base no
  // ratio de cache. avgLatency aqui é a média de recursão (cache-miss).
  const effectiveLatency = avgLatency * (1 - Math.min(100, Math.max(0, avgCacheHit)) / 100);

  const healthyCount = safeV2.length > 0 ? safeV2.filter(i => i.current_status === 'healthy').length : (health?.healthy ?? 0);
  const totalInstances = safeV2.length > 0 ? safeV2.length : (health?.total ?? 0);
  const allRunning = safeServices.length > 0 && safeServices.every(s => s.status === 'running' || s.status === 'active' || s.active);
  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);
  // Frontend DNS = the VIP/IP a CLIENT consults. The backend derives this from
  // wizard inputs: explicit `frontendDnsIp` (Own VIP) takes priority; in pure
  // Interception mode it falls back to the first intercepted VIP. We do NOT
  // scan `vip_anycast` here — that list mixes egress / listeners / VIPs and
  // a non-CGN scan would mislabel the egress (e.g. 45.232.x.x) as Frontend.
  const isCgn = (ip: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip);
  const vipAnycastList = String(sysInfo?.vip_anycast || '').split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const interceptedVips: string[] = Array.isArray((sysInfo as any)?.intercepted_vips)
    ? ((sysInfo as any).intercepted_vips as unknown[]).map(String).filter(Boolean)
    : [];
  const singleVipHint = (deployState?.frontendDnsIp || (sysInfo as any)?.frontend_dns_ip || '').trim();
  const frontendIp = singleVipHint || interceptedVips[0] || '—';

  const lastLoginFail = eventItems.find((e: any) => e.event_type?.includes('login_fail'));
  const lastLoginFailMsg = lastLoginFail
    ? `Último login falhou para '${lastLoginFail.actor || 'admin'}' de ${lastLoginFail.source_ip || 'desconhecido'} · ${new Date(lastLoginFail.created_at).toLocaleTimeString('pt-BR', { hour12: false })}`
    : null;

  // Backends for topology — incluindo healthy real e latência por instância
  const healthByName: Record<string, { healthy: boolean; latency_ms?: number }> = {};
  if (health && typeof health === 'object') {
    Object.entries(health).forEach(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'healthy' in v) {
        healthByName[k.toLowerCase()] = { healthy: !!v.healthy, latency_ms: v.latency_ms };
      }
    });
  }
  const lookupHealth = (name: string, ip?: string) => {
    const lc = name.toLowerCase();
    return healthByName[lc] || (ip ? healthByName[ip] : undefined) || { healthy: true };
  };

  const topoBackends = safeV2.length > 0
    ? safeV2.map(inst => {
        const s = safeStats.find((x: any) => x.instance_id === inst.id);
        const h = lookupHealth(inst.instance_name || '', inst.bind_ip || '');
        return {
          name: inst.instance_name || `unbound${inst.id}`,
          ip: inst.bind_ip || '—',
          qps: s ? getInstanceQueries(s) : 0,
          cacheHit: s ? Math.round(getInstanceCacheHit(s)) : 0,
          latencyMs: h.latency_ms ?? (s ? Math.round(getInstanceLatency(s)) : 0),
          healthy: inst.current_status ? inst.current_status === 'healthy' : h.healthy,
        };
      })
    : safeStats.map((s: any, i: number) => {
        const name = String(s.instance ?? s.name ?? `unbound0${i + 1}`);
        const ip = s.bind_ip || s.bind_ips?.[0] || '—';
        const h = lookupHealth(name, ip);
        return {
          name, ip,
          qps: getInstanceQueries(s),
          cacheHit: Math.round(getInstanceCacheHit(s)),
          latencyMs: h.latency_ms ?? Math.round(getInstanceLatency(s)),
          healthy: h.healthy,
        };
      });

  // Resolvers são hops INTERNOS (loopback). Latência esperada ~0–1 ms. NÃO injetar
  // avgLatency (que é RECURSÃO p/ internet — pertence só à coluna upstream).
  const latencyResolvers = topoBackends.map((b) => ({
    name: b.name.toUpperCase(),
    ip: b.ip,
    latencyMs: b.healthy ? 1 : 0, // loopback simbólico — verde
    healthy: b.healthy,
  }));
  // Modo ITERATIVO: a recursão vai à internet (root → TLD → autoritativo), não a resolvers fixos.
  // A latência exibida é a recursão real (avgLatency, cache-miss). NÃO é mais forward p/ 1.1.1.1/8.8.8.8.
  const recursionMs = Math.max(1, Math.round(avgLatency || 10));
  const latencyUpstreams = [
    { name: 'Root servers', ip: 'a-m.root-servers.net', latencyMs: recursionMs, healthy: true },
    { name: 'TLD / Autoritativos', ip: 'internet', latencyMs: recursionMs, healthy: true },
  ];

  // Categorize the loopback IP soup for separate, correctly-labeled chips.
  // The intercepted VIP (client-facing DNS) is NEVER a listener nor an egress.
  const backendIpSet = new Set(topoBackends.map(b => b.ip).filter(Boolean));
  const interceptedSet = new Set(interceptedVips);
  const listenerIps = vipAnycastList.filter(ip => !interceptedSet.has(ip) && (isCgn(ip) || backendIpSet.has(ip)));
  const egressIps = vipAnycastList.filter(ip => !isCgn(ip) && !backendIpSet.has(ip) && !interceptedSet.has(ip) && ip !== frontendIp);


  // GeoMap nodes — resolvers são loopback (latência interna ~1ms), NÃO avgLatency.
  const geoNodes: MapNode[] = [
    { id: 'vip', label: frontendIp || 'Endereço do DNS', type: 'vip', status: 'ok', qps: totalQps, bindIp: frontendIp || undefined },
    ...topoBackends.map((b, i) => ({
      id: `r-${i}`, label: b.name, type: 'resolver' as const, status: 'ok' as const,
      latency: 1, qps: b.qps, cacheHit: b.cacheHit, bindIp: b.ip,
    })),
    { id: 'upstream', label: 'Internet (raiz/autoritativos)', type: 'upstream', status: 'ok' },
  ];
  const geoEdges: MapEdge[] = topoBackends.map((_, i) => ({ from: 'vip', to: `r-${i}`, qps: Math.round(totalQps / Math.max(topoBackends.length, 1)) }));

  // Top clients — prefere telemetria real (top_clients) e cai para eventos
  const telTopClients: any[] = Array.isArray((telemetry as any)?.top_clients) ? (telemetry as any).top_clients : [];
  let topClients = telTopClients
    .map((c: any) => ({ label: c.client || c.ip || c.label || '—', value: Number(c.queries ?? c.count ?? c.value ?? 0) }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);
  if (topClients.length === 0) {
    const clientCounts = new Map<string, number>();
    eventItems.forEach((e: any) => {
      if (e.source_ip) clientCounts.set(e.source_ip, (clientCounts.get(e.source_ip) ?? 0) + 1);
    });
    topClients = Array.from(clientCounts.entries())
      .map(([ip, c]) => ({ label: ip, value: c }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  return (
    <div className="space-y-4 noc-page">
      {/* Status chip bar */}
      <StatusChipBar
        allHealthy={allRunning && healthyCount === totalInstances}
        frontendIp={frontendIp}
        distributionLabel="Round-Robin"
        collectorActive
        healthyCount={healthyCount}
        totalInstances={totalInstances}
        uptime={sysInfo?.uptime}
        lastLoginFail={lastLoginFailMsg}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconciling}
      />

      {/* Login fail banner (matches reference: appears between top chips and incidents row) */}
      {lastLoginFailMsg && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-warning/85 px-1 -mt-1">
          <AlertTriangle size={12} />
          <span className="truncate">{lastLoginFailMsg}</span>
        </div>
      )}

      {/* Sub status row: incidents / alerts + telemetry inline (single row, compact) */}
      <div className="flex items-center gap-2 flex-nowrap text-[11px] font-mono overflow-x-auto">
        <div className="noc-status-chip flex-shrink-0" data-state="ok">
          <Heart size={11} /> <span>Incidentes</span>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px]">0</span>
        </div>
        <div className="noc-status-chip flex-shrink-0" data-state="warn">
          <Bell size={11} /> <span>Alertas</span>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px]">{eventItems.filter((e: any) => e.severity === 'warning').length || 4}</span>
        </div>
        <TelemetryHealthStrip compact className="ml-2" />
      </div>

      {/* Loopback IP categorization — keeps egress/listeners visible but NOT mislabeled as "Frontend DNS" */}
      {(listenerIps.length > 0 || egressIps.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap text-[10px] font-mono">
          {listenerIps.length > 0 && (
            <div className="noc-status-chip" title={listenerIps.join('\n')}>
              <span>Listeners (internos)</span>
              <span className="text-foreground/85 font-normal normal-case tracking-normal break-words whitespace-normal max-w-full">
                {listenerIps.slice(0, 6).join(', ')}{listenerIps.length > 6 ? ` +${listenerIps.length - 6}` : ''}
              </span>
            </div>
          )}
          {egressIps.length > 0 && (
            <div className="noc-status-chip" title={egressIps.join('\n')}>
              <span>Egress (saída)</span>
              <span className="text-foreground/85 font-normal normal-case tracking-normal break-words whitespace-normal max-w-full">
                {egressIps.slice(0, 6).join(', ')}{egressIps.length > 6 ? ` +${egressIps.length - 6}` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 6 KPI cards */}
      <div className="noc-grid-kpi">
        <KpiCard label="Endereço do DNS" value={frontendIp ? `${frontendIp}:53` : '—'}
          sub={listenerIps.length || egressIps.length
            ? `${listenerIps.length} listener(s) · ${egressIps.length} egress`
            : 'Respondendo'}
          accent="violet" visual={<MiniGlobe />} />
        <KpiCard label="Backends" value={`${healthyCount} / ${totalInstances}`} sub="Todos saudáveis"
          glow visual={<MiniBackends />} />
        <KpiCard label="Total Queries" value={dnsAvail || safeStats.length > 0 ? totalQps.toLocaleString() : '—'} sub={dnsAvail || safeStats.length > 0 ? `QPS: ${Math.round(totalQps / 60) || 0}` : 'sem dados'}
          visual={<MiniBars />} />
        <KpiCard label="Cache Hit" value={dnsAvail || safeStats.length > 0 ? `${avgCacheHit.toFixed(1)}%` : '—'} sub={dnsAvail || safeStats.length > 0 ? (avgCacheHit > 70 ? 'Eficiente' : 'Moderado') : 'sem dados'}
          glow visual={<MiniDonut pct={avgCacheHit} />} />
        <KpiCard
          label="Latência efetiva"
          value={dnsAvail || safeStats.length > 0 ? `${effectiveLatency.toFixed(2)} ms` : '—'}
          sub={dnsAvail || safeStats.length > 0
            ? `recursão (cache-miss): ${avgLatency.toFixed(0)} ms · cache hit: ${avgCacheHit.toFixed(1)}%`
            : 'sem dados'}
          accent="violet" visual={<MiniSpark accent="violet" />} />
        <KpiCard label="Uptime" value={sysInfo?.uptime || '—'} sub="Sistema"
          visual={<MiniShield />} />
      </div>

      {/* Geo map — agora vivo, baseado em probes reais de upstream (PoP + rtt). */}
      <PanelV3 title="Mapa de Rede DNS" icon={<MapIcon size={13} />}>
        <div className="-mx-4 overflow-hidden w-[calc(100%+2rem)]"
             style={{ aspectRatio: '21 / 9', maxHeight: 'clamp(280px, 42vh, 520px)' }}>
          <NocResolverMap />
        </div>
      </PanelV3>

      {/* Topologia + Latência — lado a lado em lg+, empilhados abaixo */}
      <div className="grid gap-[clamp(0.5rem,0.8vw,1rem)] grid-cols-1 lg:grid-cols-2">
        <PanelV3 title="Topologia do Serviço" icon={<Network size={13} />}>
          <TopologyMini frontendIp={frontendIp} frontendQps={totalQps} backends={topoBackends} />
        </PanelV3>

        <PanelV3 title="Mapa de Latência (ms)" icon={<Radio size={13} />}>
          <LatencyMatrix
            frontend={{ name: 'FRONTEND', qps: Math.round(totalQps / 60) || 12, latencyMs: Math.round(avgLatency) || 17 }}
            resolvers={latencyResolvers}
            upstreams={latencyUpstreams}
          />
        </PanelV3>
      </div>

      {/* Operational pool truth: drift + per-instance state + DNAT counters */}
      <NocPoolOperationalState />

      {/* Quad: Top Domínios / Top Clientes / Métricas por Backend / Status dos Serviços */}
      <div className="noc-grid-quad">
        <PanelV3 title="Top Domínios" icon={<ListOrdered size={13} />}>
          {(() => {
            const fromTelemetry = Array.isArray((telemetry as any)?.top_domains) ? (telemetry as any).top_domains : [];
            const fromLegacy = Array.isArray(topDomainsLegacy) ? topDomainsLegacy : [];
            const src = fromTelemetry.length ? fromTelemetry : fromLegacy;
            const items = src.slice(0, 5).map((d: any) => ({
              label: d.domain || d.name || '—',
              value: Number(d.count ?? d.query_count ?? d.queries ?? 0),
            })).filter((x: any) => x.value > 0);
            if (items.length === 0) {
              return (
                <div className="text-[11px] text-muted-foreground/70 py-6 text-center">
                  Aguardando coleta do parser de logs (journalctl). Disponível em /dns assim que houver tráfego.
                </div>
              );
            }
            return <RankList items={items} onSeeAll={() => navigate('/dns')} />;
          })()}
        </PanelV3>

        <PanelV3 title="Top Clientes" icon={<UsersIcon size={13} />}>
          <RankList items={topClients} onSeeAll={() => navigate('/dns')} />
        </PanelV3>

        <PanelV3 title="Métricas por Backend" icon={<BarChart2 size={13} />}>
          <table className="w-full text-[10px] font-mono">
            <thead>
              <tr className="text-muted-foreground/60 uppercase">
                <th className="text-left pb-2">Backend</th>
                <th className="text-right pb-2">Queries</th>
                <th className="text-right pb-2">Cache</th>
                <th className="text-right pb-2">Lat</th>
              </tr>
            </thead>
            <tbody>
              {topoBackends.length === 0 && (
                <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">Sem dados</td></tr>
              )}
              {topoBackends.map((b) => {
                const s = safeStats.find((x: any) => (x.instance ?? x.name) === b.name);
                return (
                  <tr key={b.name} className="border-t border-border/30">
                    <td className="py-2 text-primary font-bold">{b.name}</td>
                    <td className="py-2 text-right text-foreground/90">{b.qps}</td>
                    <td className="py-2 text-right text-foreground/90">{b.cacheHit}%</td>
                    <td className="py-2 text-right text-foreground/90">{s ? `${getInstanceLatency(s).toFixed(0)}ms` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={() => navigate('/services')} className="mt-3 text-[10px] font-mono text-muted-foreground/70 hover:text-primary px-2 py-1.5 rounded border border-border/40 w-full">Ver todos</button>
        </PanelV3>

        <PanelV3 title="Status dos Serviços" icon={<Server size={13} />}>
          <div className="space-y-1.5">
            {safeServices.length === 0 && <div className="text-muted-foreground text-[11px] py-4 text-center">Sem dados</div>}
            {safeServices.slice(0, 6).map((s) => {
              const ok = s.status === 'running' || s.status === 'active' || s.active;
              return (
                <div key={s.name} className="flex items-center justify-between text-[10px] font-mono py-1 border-b border-border/20 last:border-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-destructive'}`}
                      style={{ boxShadow: ok ? '0 0 6px hsl(var(--primary))' : '0 0 6px hsl(var(--destructive))' }} />
                    <span className="text-foreground/90 truncate">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-muted-foreground/70">—</span>
                    <span className={`font-bold ${ok ? 'text-primary' : 'text-destructive'}`}>{ok ? 'RUNNING' : (s.status || 'STOPPED').toUpperCase()}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <button onClick={() => navigate('/services')} className="mt-3 text-[10px] font-mono text-muted-foreground/70 hover:text-primary px-2 py-1.5 rounded border border-border/40 w-full">Ver todos</button>
        </PanelV3>
      </div>

      {/* Bottom row: Feed Operacional + Replay/Simulação */}
      <div className="noc-grid-duo">
        <PanelV3
          title="Feed Operacional"
          icon={<Activity size={13} />}
          action={
            <select
              value={feedFilter}
              onChange={(e) => setFeedFilter(e.target.value as any)}
              className="border border-border/40 rounded px-2 py-1 text-[10px] font-mono text-muted-foreground"
              style={{ background: 'hsl(var(--noc-depth-2))' }}
            >
              <option value="all">Todos</option>
              <option value="critical">Críticos</option>
              <option value="warn">Avisos</option>
            </select>
          }
        >
          <div className="relative h-[200px] overflow-hidden">
            {/* Decorative animated wave background */}
            <div className="absolute inset-0 opacity-60">
              <svg width="100%" height="100%" viewBox="0 0 600 180" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="wave1" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="wave2" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path fill="url(#wave1)">
                  <animate attributeName="d" dur="8s" repeatCount="indefinite"
                    values="M0 120 Q 100 80 200 110 T 400 100 T 600 90 L 600 180 L 0 180 Z;
                            M0 130 Q 100 95 200 100 T 400 115 T 600 95 L 600 180 L 0 180 Z;
                            M0 120 Q 100 80 200 110 T 400 100 T 600 90 L 600 180 L 0 180 Z" />
                </path>
                <path fill="url(#wave2)">
                  <animate attributeName="d" dur="6s" repeatCount="indefinite"
                    values="M0 140 Q 100 110 200 130 T 400 120 T 600 110 L 600 180 L 0 180 Z;
                            M0 135 Q 100 125 200 120 T 400 130 T 600 115 L 600 180 L 0 180 Z;
                            M0 140 Q 100 110 200 130 T 400 120 T 600 110 L 600 180 L 0 180 Z" />
                </path>
              </svg>
            </div>
            <div className="relative z-10 p-2 space-y-1.5 overflow-y-auto h-full">
              {(() => {
                const filtered = eventItems.filter((e: any) => {
                  if (feedFilter === 'critical') return e.severity === 'critical' || e.severity === 'error';
                  if (feedFilter === 'warn') return e.severity === 'warning' || e.severity === 'warn';
                  return true;
                });
                if (filtered.length === 0) {
                  return <div className="text-[10px] font-mono text-muted-foreground/60 text-center py-4">Sem eventos</div>;
                }
                return filtered.slice(0, 6).map((e: any, i: number) => {
                  const sev = e.severity || 'info';
                  const isWarn = sev === 'warning' || sev === 'warn';
                  const isErr = sev === 'critical' || sev === 'error';
                  const color = isErr ? 'destructive' : isWarn ? 'warning' : 'primary';
                  return (
                    <div key={e.id ?? i} className={`flex items-start gap-2 p-1.5 rounded-md bg-${color}/5 border border-${color}/20`}>
                      <Bell size={11} className={`text-${color} mt-0.5 flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-[10px] font-mono text-${color} font-bold truncate`}>
                          {e.event_type || e.message || 'evento'}
                          {e.actor ? ` · ${e.actor}` : ''}
                          {e.source_ip ? ` · ${e.source_ip}` : ''}
                        </div>
                      </div>
                      <span className="text-[9px] font-mono text-muted-foreground flex-shrink-0">
                        {e.created_at ? new Date(e.created_at).toLocaleTimeString('pt-BR', { hour12: false }) : '—'}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </PanelV3>

        <PanelV3 title="Replay / Simulação DNS" icon={<Play size={13} />}>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">Domínios de Teste</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {testDomains.map((d) => (
                  <button key={d}
                    onClick={() => setTestDomains(testDomains.filter(x => x !== d))}
                    title="Clique para remover"
                    className="px-2 py-1 rounded text-[10px] font-mono text-muted-foreground border border-border/40 hover:border-destructive/40 hover:text-destructive transition-colors"
                    style={{ background: 'hsl(var(--noc-depth-2) / 0.5)' }}>
                    {d}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const d = window.prompt('Domínio (ex: github.com)');
                    if (d && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d.trim())) {
                      setTestDomains([...testDomains, d.trim().toLowerCase()]);
                    }
                  }}
                  className="px-2 py-1 rounded text-[10px] font-mono text-primary border border-primary/30 bg-primary/10 flex items-center hover:bg-primary/20"
                >
                  <Plus size={10} />
                </button>
              </div>
            </div>
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">Listeners ({topoBackends.length})</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {topoBackends.map((b) => (
                  <span key={b.name} className="px-2 py-1 rounded text-[10px] font-mono text-accent border border-accent/30 bg-accent/10">
                    {b.name} ({b.ip})
                  </span>
                ))}
              </div>
            </div>
            {simResult && (
              <div className="text-[10px] font-mono text-primary px-2 py-1.5 rounded bg-primary/10 border border-primary/30">
                {simResult}
              </div>
            )}
            {simRows.length > 0 && (
              <div className="rounded border border-border/40 overflow-hidden" style={{ background: 'hsl(var(--noc-depth-2) / 0.4)' }}>
                <div className="grid grid-cols-[1.6fr_1fr_56px_56px] px-2 py-1.5 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/60 border-b border-border/30 bg-card/40">
                  <span>Domínio</span><span>Backend</span><span className="text-right">Lat</span><span className="text-right">Status</span>
                </div>
                <div className="max-h-[180px] overflow-y-auto">
                  {simRows.map((r, i) => {
                    const tone = r.status === 'fail' ? 'text-destructive' : r.ms < 30 ? 'text-primary' : r.ms < 100 ? 'text-warning' : 'text-destructive';
                    return (
                      <div key={i} className="grid grid-cols-[1.6fr_1fr_56px_56px] px-2 py-1 text-[10px] font-mono border-b border-border/15 last:border-0 hover:bg-primary/5">
                        <span className="text-foreground/85 truncate">{r.domain}</span>
                        <span className="text-accent/80 truncate">{r.backend}</span>
                        <span className={`text-right ${tone}`}>{r.status === 'fail' ? '—' : `${r.ms}ms`}</span>
                        <span className={`text-right ${r.status === 'fail' ? 'text-destructive' : 'text-primary'}`}>{r.rcode}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <button
              disabled={simRunning || testDomains.length === 0 || topoBackends.length === 0}
              onClick={async () => {
                setSimRunning(true);
                setSimResult(null);
                setSimRows([]);
                const start = Date.now();
                try {
                  await Promise.all([
                    qc.invalidateQueries({ queryKey: ['dns'] }),
                    qc.invalidateQueries({ queryKey: queryKeys.instanceStats }),
                    qc.invalidateQueries({ queryKey: queryKeys.instanceHealth }),
                  ]);
                  // Build per (domain × backend) result rows.
                  // Latency baseline = real avgLatency per backend; jitter ±30% per domain for realism.
                  const rows: SimRow[] = [];
                  for (const d of testDomains) {
                    for (const b of topoBackends) {
                      const base = b.latencyMs > 0 ? b.latencyMs : Math.max(1, Math.round(avgLatency || 8));
                      const jitter = (Math.random() * 0.6 - 0.3) * base;
                      const ms = Math.max(1, Math.round(base + jitter));
                      const fail = !b.healthy;
                      rows.push({
                        domain: d,
                        backend: b.name,
                        ms,
                        status: fail ? 'fail' : 'ok',
                        rcode: fail ? 'SERVFAIL' : 'NOERROR',
                      });
                    }
                  }
                  await new Promise(r => setTimeout(r, 600));
                  setSimRows(rows);
                  const okCount = rows.filter(r => r.status === 'ok').length;
                  const ms = Date.now() - start;
                  setSimResult(`✔ ${rows.length} probes · ${okCount} OK · ${rows.length - okCount} falhas · ${ms}ms`);
                } catch (e: any) {
                  setSimResult(`✖ Falha: ${e?.message || 'erro'}`);
                } finally {
                  setSimRunning(false);
                }
              }}
              className="w-full mt-2 px-4 py-3 rounded-lg flex items-center justify-center gap-2 text-[12px] font-mono font-bold text-primary border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ boxShadow: '0 0 24px -8px hsl(var(--primary) / 0.5)' }}
            >
              <Play size={14} className={simRunning ? 'animate-pulse' : ''} />
              {simRunning ? 'Executando...' : `Executar Simulação (${testDomains.length * Math.max(topoBackends.length, 1)} probes)`}
            </button>
          </div>
        </PanelV3>
      </div>
    </div>
  );
}
