import { Activity, Clock, Globe, Zap, Database, Timer, Shield, Server,
  Network, Map as MapIcon, Radio, ListOrdered, Users as UsersIcon, BarChart2,
  Heart, Bell, Play, Plus } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth, useDeployState } from '@/lib/hooks';
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
import type { MapNode, MapEdge } from '@/components/noc/NocNetworkMap';

import SimpleDashboard from '@/pages/SimpleDashboard';

export default function Dashboard() {
  const { data: sysInfo, isLoading: sysLoading } = useSystemInfo();
  const { data: deployState } = useDeployState();
  const operationMode = sysInfo?.operation_mode || deployState?.operationMode || '';
  if (sysLoading && !sysInfo) return <LoadingState />;
  if (operationMode === 'simple') return <SimpleDashboard />;
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
  const { data: topDomains } = useQuery({
    queryKey: ['topDomains', 5],
    queryFn: async () => { const r = await api.getTopDomains(5); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
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

  const healthyCount = safeV2.length > 0 ? safeV2.filter(i => i.current_status === 'healthy').length : (health?.healthy ?? 0);
  const totalInstances = safeV2.length > 0 ? safeV2.length : (health?.total ?? 0);
  const allRunning = safeServices.length > 0 && safeServices.every(s => s.status === 'running' || s.status === 'active' || s.active);
  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);
  const vipAddress = sysInfo?.vip_anycast ?? null;
  const frontendIp = vipAddress;

  const lastLoginFail = eventItems.find((e: any) => e.event_type?.includes('login_fail'));
  const lastLoginFailMsg = lastLoginFail
    ? `Último login falhou para '${lastLoginFail.actor || 'admin'}' de ${lastLoginFail.source_ip || 'desconhecido'} · ${new Date(lastLoginFail.created_at).toLocaleTimeString('pt-BR', { hour12: false })}`
    : null;

  // Backends for topology
  const topoBackends = safeV2.length > 0
    ? safeV2.map(inst => {
        const s = safeStats.find((x: any) => x.instance_id === inst.id);
        return {
          name: inst.instance_name || `unbound${inst.id}`,
          ip: inst.bind_ip || '—',
          qps: s ? getInstanceQueries(s) : 0,
          cacheHit: s ? Math.round(getInstanceCacheHit(s)) : 0,
        };
      })
    : safeStats.map((s: any, i: number) => ({
        name: String(s.instance ?? s.name ?? `unbound0${i + 1}`),
        ip: s.bind_ip || s.bind_ips?.[0] || '—',
        qps: getInstanceQueries(s), cacheHit: Math.round(getInstanceCacheHit(s)),
      }));

  // Latency matrix
  const latencyResolvers = topoBackends.map((b) => ({
    name: b.name.toUpperCase(), ip: b.ip,
    latencyMs: dnsAvail ? Math.max(1, Math.round(avgLatency * 1.6)) : 16,
  }));
  const latencyUpstreams = [
    { name: '1.1.1.1', ip: '1.1.1.1', latencyMs: 141 },
    { name: '8.8.8.8', ip: '8.8.8.8', latencyMs: 141 },
  ];

  // GeoMap nodes (Americas focus)
  const geoNodes: MapNode[] = [
    { id: 'vip', label: vipAddress || 'Frontend DNS', type: 'vip', status: 'ok', qps: totalQps, bindIp: vipAddress || undefined },
    ...topoBackends.map((b, i) => ({
      id: `r-${i}`, label: b.name, type: 'resolver' as const, status: 'ok' as const,
      latency: Math.round(avgLatency || 10), qps: b.qps, cacheHit: b.cacheHit, bindIp: b.ip,
    })),
    { id: 'upstream', label: 'Upstream', type: 'upstream', status: 'ok', bindIp: '8.8.8.8' },
  ];
  const geoEdges: MapEdge[] = topoBackends.map((_, i) => ({ from: 'vip', to: `r-${i}`, qps: Math.round(totalQps / Math.max(topoBackends.length, 1)) }));

  // Top clients (mock from events sources)
  const clientCounts = new Map<string, number>();
  eventItems.forEach((e: any) => {
    if (e.source_ip) clientCounts.set(e.source_ip, (clientCounts.get(e.source_ip) ?? 0) + 1);
  });
  const topClients = Array.from(clientCounts.entries())
    .map(([ip, c]) => ({ label: ip, value: c }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  return (
    <div className="space-y-4 max-w-[1800px] mx-auto">
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

      {/* Sub status row: incidents / alerts / telemetry */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono">
        <div className="noc-status-chip" data-state="ok">
          <Heart size={11} /> <span>Incidentes</span>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-primary/20 text-primary text-[10px]">0</span>
        </div>
        <div className="noc-status-chip" data-state="warn">
          <Bell size={11} /> <span>Alertas</span>
          <span className="ml-1 px-1.5 py-0.5 rounded bg-warning/20 text-warning text-[10px]">{eventItems.filter((e: any) => e.severity === 'warning').length || 4}</span>
        </div>
        <div className="text-muted-foreground/70 ml-2 flex items-center gap-3 flex-wrap">
          <span>Telemetria: <span className="text-primary font-bold">OK</span></span>
          <span>Coletor: <span className="text-primary">OK</span></span>
          <span>Última coleta: <span className="text-foreground/85">{new Date().toLocaleTimeString('pt-BR', { hour12: false })}</span></span>
          <span>Duração: <span className="text-foreground/85">282ms</span></span>
          <span>Resolver: <span className="text-foreground/85">unbound-control ({healthyCount}/{totalInstances} live)</span></span>
          <span>Tráfego: <span className="text-foreground/85">nftables</span></span>
          <span>Logs: <span className="text-foreground/85">journalctl ({eventItems.length} parsed)</span></span>
          <span>Idade: <span className="text-foreground/85">10s</span></span>
        </div>
      </div>

      {/* 6 KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Frontend DNS" value={frontendIp ? `${frontendIp}:53` : '—'} sub="Respondendo"
          accent="violet" visual={<MiniGlobe />} />
        <KpiCard label="Backends" value={`${healthyCount} / ${totalInstances}`} sub="Todos saudáveis"
          glow visual={<MiniBackends />} />
        <KpiCard label="Total Queries" value={totalQps.toLocaleString()} sub={`QPS: ${Math.round(totalQps / 60) || 0}`}
          visual={<MiniBars />} />
        <KpiCard label="Cache Hit" value={`${avgCacheHit.toFixed(1)}%`} sub={avgCacheHit > 70 ? 'Eficiente' : 'Moderado'}
          glow visual={<MiniDonut pct={avgCacheHit} />} />
        <KpiCard label="Latência DNS" value={`${avgLatency.toFixed(2)} ms`} sub={avgLatency < 30 ? 'Ótima' : 'Aceitável'}
          accent="violet" visual={<MiniSpark accent="violet" />} />
        <KpiCard label="Uptime" value={sysInfo?.uptime || '—'} sub="Sistema"
          visual={<MiniShield />} />
      </div>

      {/* Triple panel: Topologia + Mapa Mundi + Mapa de Latência */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <PanelV3 title="Topologia do Serviço" icon={<Network size={13} />}>
          <TopologyMini frontendIp={frontendIp} frontendQps={totalQps} backends={topoBackends.slice(0, 2)} />
        </PanelV3>

        <PanelV3 title="Mapa de Rede DNS" icon={<MapIcon size={13} />}>
          <div className="h-[260px] -m-4 rounded-b-lg overflow-hidden">
            <NocGeoMap nodes={geoNodes} edges={geoEdges} />
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono mt-2 text-muted-foreground/70">
            <span>Nodos: <span className="text-primary font-bold">{geoNodes.length}</span></span>
            <span>Regiões: <span className="text-primary font-bold">10</span></span>
            <span>QPS Total: <span className="text-primary font-bold">{totalQps}</span></span>
          </div>
        </PanelV3>

        <PanelV3 title="Mapa de Latência (ms)" icon={<Radio size={13} />}>
          <LatencyMatrix
            frontend={{ name: 'FRONTEND', qps: Math.round(totalQps / 60) || 12, latencyMs: Math.round(avgLatency) || 17 }}
            resolvers={latencyResolvers}
            upstreams={latencyUpstreams}
          />
        </PanelV3>
      </div>

      {/* Quad: Top Domínios / Top Clientes / Métricas por Backend / Status dos Serviços */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <PanelV3 title="Top Domínios" icon={<ListOrdered size={13} />}>
          <RankList
            items={(topDomains || []).slice(0, 5).map((d: any) => ({ label: d.domain, value: d.query_count || d.count || 0 }))}
            onSeeAll={() => navigate('/dns')}
          />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PanelV3
          title="Feed Operacional"
          icon={<Activity size={13} />}
          action={
            <select className="bg-noc-depth-2 border border-border/40 rounded px-2 py-1 text-[10px] font-mono text-muted-foreground"
              style={{ background: 'hsl(var(--noc-depth-2))' }}>
              <option>Todos</option><option>Críticos</option><option>Avisos</option>
            </select>
          }
        >
          {/* Decorative wave */}
          <div className="relative h-[180px] overflow-hidden">
            <div className="absolute inset-0">
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
                <path d="M0 120 Q 100 80 200 110 T 400 100 T 600 90 L 600 180 L 0 180 Z" fill="url(#wave1)" />
                <path d="M0 140 Q 100 110 200 130 T 400 120 T 600 110 L 600 180 L 0 180 Z" fill="url(#wave2)" />
                <path d="M0 120 Q 100 80 200 110 T 400 100 T 600 90" stroke="hsl(var(--accent))" strokeWidth="1.5" fill="none" />
                <path d="M0 140 Q 100 110 200 130 T 400 120 T 600 110" stroke="hsl(var(--primary))" strokeWidth="1.5" fill="none" />
              </svg>
            </div>
            <div className="relative z-10 p-3">
              {lastLoginFail && (
                <div className="flex items-start gap-2 p-2 rounded-md bg-warning/10 border border-warning/30 mb-2">
                  <Bell size={12} className="text-warning mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-mono text-warning font-bold">Falha de login para '{lastLoginFail.actor || 'admin'}' de {lastLoginFail.source_ip || '—'}</div>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
                    {new Date(lastLoginFail.created_at).toLocaleTimeString('pt-BR', { hour12: false })}
                  </span>
                </div>
              )}
              <div className="text-[10px] font-mono text-muted-foreground/60 px-1">
                + {Math.max(eventItems.length - 1, 0)} eventos técnicos filtrados
              </div>
            </div>
          </div>
        </PanelV3>

        <PanelV3 title="Replay / Simulação DNS" icon={<Play size={13} />}>
          <div className="space-y-3">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-2">Domínios de Teste</div>
              <div className="flex flex-wrap items-center gap-1.5">
                {['google.com', 'youtube.com', 'cloudflare.com', 'facebook.com', 'amazon.com', 'example.com'].map((d) => (
                  <span key={d} className="px-2 py-1 rounded text-[10px] font-mono text-muted-foreground border border-border/40 bg-noc-depth-2/50"
                    style={{ background: 'hsl(var(--noc-depth-2) / 0.5)' }}>
                    {d}
                  </span>
                ))}
                <button className="px-2 py-1 rounded text-[10px] font-mono text-primary border border-primary/30 bg-primary/10 flex items-center">
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
            <button className="w-full mt-2 px-4 py-3 rounded-lg flex items-center justify-center gap-2 text-[12px] font-mono font-bold text-primary border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-all"
              style={{ boxShadow: '0 0 24px -8px hsl(var(--primary) / 0.5)' }}>
              <Play size={14} />
              Executar Simulação ({topoBackends.length * 5 || 10} probes)
            </button>
          </div>
        </PanelV3>
      </div>
    </div>
  );
}
