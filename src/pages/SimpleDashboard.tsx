// ============================================================
// DNS Control — Dashboard: Recursivo Simples
// GUI específica para modo simples (sem VIP/interceptação)
// Topologia: cliente → frontend DNS → balanceamento local → backends internos
// Now powered by real collector telemetry
// ============================================================

import { Activity, Clock, Globe, Database, Timer, Shield, Server, Layers, Zap, FileText, RotateCcw, Network, AlertTriangle, Search, Users, BarChart3 } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useServices, useInstanceHealth, useDeployState, useTelemetry, useTelemetryStatus } from '@/lib/hooks';
import { safeDate, type SystemSelfTestResult } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

import NocHeroBar from '@/components/noc/NocHeroBar';
import NocHealthSummary from '@/components/noc/NocHealthSummary';
import NocMetricStrip from '@/components/noc/NocMetricStrip';
import NocInstanceTable from '@/components/noc/NocInstanceTable';
import NocDnsPathFlow from '@/components/noc/NocDnsPathFlow';
import NocEventsTimeline from '@/components/noc/NocEventsTimeline';
import NocResolverPanel from '@/components/noc/NocResolverPanel';
import NocHealthMatrix from '@/components/noc/NocHealthMatrix';
import NocSystemInfoGrid from '@/components/noc/NocSystemInfoGrid';
import NocQuickActions from '@/components/noc/NocQuickActions';
import NocDeploySimulation from '@/components/noc/NocDeploySimulation';
import NocGeoMap from '@/components/noc/NocGeoMap';
import NocNetworkMap, { type MapNode, type MapEdge } from '@/components/noc/NocNetworkMap';
import NocTopologyPanel from '@/components/noc/NocTopologyPanel';

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.join(' ') || `${seconds}s`;
}

export default function SimpleDashboard() {
  const { data: services, isLoading: svcLoading } = useServices();
  const { data: health } = useInstanceHealth();
  const { data: deployState } = useDeployState();
  const { data: telemetry, isLoading: telLoading } = useTelemetry();
  const { data: telStatus } = useTelemetryStatus();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selfTestResult, setSelfTestResult] = useState<SystemSelfTestResult | null>(null);

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

  const { data: sysInfo } = useQuery({
    queryKey: ['system', 'info'],
    queryFn: async () => { const r = await api.getSystemInfo(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 15000,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => { const r = await api.reconcileNow(); if (!r.success) throw new Error(r.error!); return r.data; },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['v2-instances'] }); qc.invalidateQueries({ queryKey: ['events'] }); },
  });

  const selfTestMutation = useMutation({
    mutationFn: async () => { const r = await api.runSystemSelfTest(); if (!r.success) throw new Error(r.error!); return r.data; },
    onSuccess: (data) => setSelfTestResult(data),
  });

  const { data: serviceModeData } = useQuery({
    queryKey: ['service-mode'],
    queryFn: async () => { const r = await api.getServiceMode(); return r.success ? r.data : { service_mode: 'managed' }; },
    refetchInterval: 30000,
  });
  const isObservedMode = serviceModeData?.service_mode === 'observed';
  const isReadonlyMode = serviceModeData?.service_mode === 'imported' || isObservedMode;

  const isLoading = svcLoading && telLoading;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  // ── Telemetry-driven data ──
  const collectorOk = telemetry?.health?.collector === 'ok';
  const collectorStale = telStatus?.stale === true;
  const resolver = telemetry?.resolver ?? {};
  const traffic = telemetry?.traffic ?? {};
  const frontendData = telemetry?.frontend ?? {};
  const backends = telemetry?.backends ?? [];
  const topDomains = telemetry?.top_domains ?? [];
  const topClients = telemetry?.top_clients ?? [];
  const recentQueries = telemetry?.recent_queries ?? [];
  const queryAnalytics = telemetry?.query_analytics ?? {};
  const collectorHealth = telemetry?.health ?? {};

  const frontendIp = frontendData.ip || sysInfo?.frontend_dns_ip || deployState?.frontendDnsIp || '';
  const frontendHealthy = frontendData.healthy ?? false;

  const telemetryConnected = collectorOk && (resolver.instances_live ?? 0) > 0;
  const totalQueries = resolver.total_queries ?? 0;
  const cacheHitRatio = resolver.cache_hit_ratio ?? 0;
  const avgLatency = resolver.avg_latency_ms ?? 0;
  const qps = resolver.qps ?? 0;
  const liveCnt = resolver.instances_live ?? 0;
  const totalCnt = resolver.instances_total ?? backends.length;

  const healthyCount = safeV2.length > 0 ? safeV2.filter(i => i.current_status === 'healthy').length : liveCnt;
  const totalInstances = safeV2.length > 0 ? safeV2.length : totalCnt;
  const failedCount = safeV2.length > 0 ? safeV2.filter(i => i.current_status === 'failed' || i.current_status === 'withdrawn').length : (totalCnt - liveCnt);

  const allRunning = safeServices.length > 0 && safeServices.every(s => s.status === 'running' || s.status === 'active' || s.active);
  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);

  const resolverHealthState: 'healthy' | 'degraded' | 'critical' | 'unknown' =
    totalInstances === 0 ? 'unknown' :
    failedCount === 0 ? 'healthy' :
    failedCount >= totalInstances ? 'critical' : 'degraded';

  const critEvents = eventItems.filter((e: any) => e.severity === 'critical').length;
  const warnEvents = eventItems.filter((e: any) => e.severity === 'warning').length;

  const lastMeaningfulEvent = eventItems.find((e: any) =>
    e.severity === 'critical' || e.severity === 'warning' ||
    (e.event_type && !['health_check', 'login_success', 'reconciliation_noop'].includes(e.event_type))
  );

  const activeServicesCount = safeServices.filter(s => s.status === 'running' || s.status === 'active' || s.active).length;
  const inactiveServicesCount = safeServices.filter(s => (s.status === 'stopped' || s.status === 'no ruleset') && !s.active).length;
  const errorServicesCount = safeServices.filter(s => s.status === 'error').length;

  // ── Collector status label ──
  const collectorLabel = collectorOk
    ? (collectorStale ? 'Dados desatualizados' : 'Collector ativo')
    : telStatus?.collector_status === 'not_running' ? 'Collector não iniciado'
    : 'Collector com erro';

  // ── Telemetry status text for cards ──
  const telUnavailableLabel = collectorOk ? 'Sem dados de instâncias' : 'Collector inativo';

  // ═══ METRIC CARDS ═══
  const metricCards = [
    {
      label: 'Frontend DNS',
      value: frontendIp ? `${frontendIp}:53` : '—',
      sub: frontendHealthy ? 'Respondendo' : frontendIp ? 'Sem resposta' : 'Não configurado',
      icon: <Network size={18} />,
      accent: (frontendHealthy ? 'accent' : 'primary') as any,
      healthState: frontendHealthy ? 'healthy' : frontendIp ? 'critical' : undefined,
    },
    {
      label: 'Backends',
      value: `${healthyCount}/${totalInstances}`,
      sub: resolverHealthState === 'healthy' ? 'Todos saudáveis' : failedCount > 0 ? `${failedCount} em falha` : 'Verificando',
      icon: <Server size={18} />,
      accent: (resolverHealthState === 'critical' ? 'destructive' : resolverHealthState === 'degraded' ? 'warning' : 'primary') as any,
      healthState: resolverHealthState,
    },
    {
      label: 'Total Queries',
      value: telemetryConnected ? totalQueries.toLocaleString() : '—',
      sub: telemetryConnected ? `QPS: ${qps}` : telUnavailableLabel,
      icon: <Activity size={18} />,
      accent: 'primary' as const,
      unavailable: !telemetryConnected,
    },
    {
      label: 'Cache Hit',
      value: telemetryConnected ? `${cacheHitRatio}%` : '—',
      sub: telemetryConnected ? (cacheHitRatio > 80 ? 'Eficiente' : cacheHitRatio > 50 ? 'Moderado' : 'Baixo') : telUnavailableLabel,
      icon: <Database size={18} />,
      accent: (telemetryConnected && cacheHitRatio < 50 ? 'warning' : 'accent') as any,
      unavailable: !telemetryConnected,
      healthState: telemetryConnected ? (cacheHitRatio > 80 ? 'healthy' : cacheHitRatio > 50 ? 'degraded' : 'critical') : undefined,
    },
    {
      label: 'Latência DNS',
      value: telemetryConnected ? `${avgLatency}ms` : '—',
      sub: telemetryConnected ? (avgLatency < 30 ? 'Ótima' : avgLatency < 100 ? 'Aceitável' : 'Alta') : telUnavailableLabel,
      icon: <Timer size={18} />,
      accent: (telemetryConnected && avgLatency > 100 ? 'destructive' : telemetryConnected && avgLatency > 50 ? 'warning' : 'primary') as any,
      unavailable: !telemetryConnected,
    },
    {
      label: 'Uptime',
      value: sysInfo?.uptime ?? '—',
      sub: 'Sistema',
      icon: <Clock size={18} />,
      accent: 'primary' as const,
    },
  ];

  // ═══ PATH FLOW ═══
  const resolvers = backends.map((b: any) => ({
    id: `r-${b.name}`, label: b.name,
    ip: b.ip,
    status: (b.healthy ? 'ok' : 'failed') as any,
  }));

  const pathNodes = [
    { id: 'clients', label: 'Clientes DNS', type: 'client' as const, status: 'ok' as const },
    {
      id: 'frontend', label: frontendIp ? `Frontend ${frontendIp}` : 'Frontend DNS',
      type: 'vip' as const, status: frontendHealthy ? 'ok' as const : 'unknown' as const,
      ip: frontendIp || undefined, qps: telemetryConnected ? qps : undefined,
    },
    ...resolvers.map((r: any) => {
      const bData = backends.find((b: any) => b.name === r.label);
      return {
        ...r, type: 'resolver' as const,
        latencyMs: bData?.resolver?.recursion_avg_ms ? Math.round(bData.resolver.recursion_avg_ms) : undefined,
        cacheHit: bData?.resolver?.cache_hit_ratio ? Math.round(bData.resolver.cache_hit_ratio) : undefined,
        qps: telemetryConnected ? Math.round(qps / (resolvers.length || 1)) : undefined,
      };
    }),
    { id: 'upstream', label: 'Upstream DNS', type: 'upstream' as const, status: 'ok' as const },
  ];

  const pathEdges = [
    { from: 'clients', to: 'frontend', qps: telemetryConnected ? qps : 0 },
    ...resolvers.map((r: any) => ({
      from: 'frontend', to: r.id,
      qps: telemetryConnected ? Math.round(qps / (resolvers.length || 1)) : 0,
    })),
    ...resolvers.map((r: any) => ({ from: r.id, to: 'upstream', qps: 0 })),
  ];

  return (
    <div className="space-y-3">
      {/* ═══ MODE BADGE ═══ */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded bg-primary/10 text-primary border border-primary/20">
          Recursivo Simples
        </span>
        {frontendIp && (
          <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded bg-accent/10 text-accent border border-accent/20">
            Frontend: {frontendIp}:53
          </span>
        )}
        <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded bg-secondary text-secondary-foreground border border-border">
          Distribuição: {deployState?.simpleDistributionStrategy === 'sticky-source' ? 'Sticky por origem' : 'Round-robin'}
        </span>
        <span className={`px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded border ${
          collectorOk && !collectorStale ? 'bg-success/10 text-success border-success/20' :
          collectorStale ? 'bg-warning/10 text-warning border-warning/20' :
          'bg-destructive/10 text-destructive border-destructive/20'
        }`}>
          {collectorLabel}
        </span>
      </div>

      {isReadonlyMode && (
        <div className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          <strong>{isObservedMode ? 'Modo Observação Ativo' : 'Modo Importação Ativo'}</strong> — Nenhuma configuração será alterada. O painel opera apenas em leitura.
        </div>
      )}

      {/* ═══ HERO BAR ═══ */}
      <NocHeroBar
        allHealthy={allRunning && failedCount === 0}
        failedCount={failedCount}
        totalInstances={totalInstances}
        healthyCount={healthyCount}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconcileMutation.isPending}
        readOnlyMode={isReadonlyMode}
        dnsAvailable={telemetryConnected}
        dnsStatus={collectorOk ? 'ok' : 'error'}
        lastEvent={lastMeaningfulEvent}
        activeIncidents={critEvents}
      />

      {/* ═══ HEALTH SUMMARY ═══ */}
      <NocHealthSummary
        incidents={critEvents}
        warnings={warnEvents}
        activeServices={activeServicesCount}
        inactiveServices={inactiveServicesCount}
        errorServices={errorServicesCount}
        resolverState={resolverHealthState}
        dnsAvailable={telemetryConnected}
        privilegeLimited={false}
        lastEvent={lastMeaningfulEvent}
      />

      {/* ═══ KPI STRIP ═══ */}
      <NocMetricStrip cards={metricCards} loading={isLoading} />

      {/* ═══ TELEMETRY DIAGNOSTICS BAR ═══ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="noc-surface">
        <div className="noc-surface-body py-2">
          <div className="flex items-center gap-4 flex-wrap text-[9px] font-mono text-muted-foreground/60">
            <span className="uppercase tracking-widest font-bold text-muted-foreground/40">Diagnóstico de Telemetria</span>
            <span>Collector: <span className={collectorOk ? 'text-success' : 'text-destructive'}>{collectorOk ? 'OK' : 'FALHA'}</span></span>
            <span>Última coleta: <span className="text-foreground/70">{collectorHealth.last_update ? new Date(collectorHealth.last_update).toLocaleTimeString() : '—'}</span></span>
            <span>Duração: <span className="text-foreground/70">{collectorHealth.collection_duration_ms ?? '—'}ms</span></span>
            <span>Resolver: <span className={telemetryConnected ? 'text-success' : 'text-warning'}>{resolver.source ?? 'n/a'}</span> ({liveCnt}/{totalCnt} live)</span>
            <span>Tráfego: <span className={traffic.available ? 'text-success' : 'text-warning'}>{traffic.source ?? 'n/a'}</span></span>
            <span>Logs: <span className="text-foreground/70">{queryAnalytics.log_source ?? 'n/a'}</span> ({queryAnalytics.queries_parsed ?? 0} parsed)</span>
            {telStatus?.file_age_seconds != null && (
              <span>Idade: <span className={telStatus.stale ? 'text-warning' : 'text-foreground/70'}>{telStatus.file_age_seconds}s</span></span>
            )}
          </div>
        </div>
      </motion.div>

      {/* ═══ COLLECTOR NOT RUNNING WARNING ═══ */}
      {!collectorOk && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="noc-surface" style={{ borderLeft: '2px solid hsl(var(--destructive))' }}>
          <div className="noc-surface-body py-3 flex items-center gap-3">
            <AlertTriangle size={14} className="text-destructive flex-shrink-0" />
            <div className="text-[10px] font-mono">
              <span className="font-bold text-destructive uppercase">Telemetria indisponível</span>
              <span className="text-muted-foreground/60 ml-3">
                {telStatus?.collector_status === 'not_running'
                  ? 'O collector (dns-control-collector.timer) não está ativo. Habilite com: systemctl enable --now dns-control-collector.timer'
                  : telStatus?.error ?? 'Erro ao ler dados do collector. Verifique /var/lib/dns-control/telemetry/latest.json'}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ FRONTEND + BACKEND TOPOLOGY ═══ */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="noc-surface">
        <div className="noc-surface-header flex items-center gap-2">
          <Layers size={12} />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Topologia do Serviço</span>
        </div>
        <div className="noc-surface-body">
          {/* Frontend DNS */}
          <div className="mb-4 pb-4 border-b border-border/30">
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Frontend DNS Publicado</div>
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${frontendHealthy ? 'bg-success animate-pulse' : 'bg-destructive'}`} />
              <span className="font-mono font-bold text-foreground">{frontendIp || '—'}:53</span>
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">→ Balanceamento Local ({deployState?.simpleDistributionStrategy === 'sticky-source' ? 'Sticky por origem' : 'Round-robin'} — nftables DNAT)</span>
              {telemetryConnected && (
                <span className="text-[9px] font-mono text-accent ml-auto">{qps} QPS · {formatBytes(traffic.total_bytes ?? 0)}</span>
              )}
            </div>
          </div>

          {/* Backend Resolvers */}
          <div>
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Backends Internos</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {backends.length > 0 ? backends.map((b: any) => (
                <div key={b.name} className="flex flex-col gap-2 p-3 rounded-lg border border-border/30 bg-muted/5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${b.healthy ? 'bg-success' : 'bg-destructive'}`} />
                    <div>
                      <div className="font-mono font-bold text-sm text-foreground">{b.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground/50">{b.ip ? `${b.ip}:53` : '—'}</div>
                    </div>
                  </div>
                  {b.resolver?.source === 'unbound-control' && (
                    <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                      <div><span className="text-muted-foreground/50">Q</span> <span className="text-foreground">{b.resolver.total_queries.toLocaleString()}</span></div>
                      <div><span className="text-muted-foreground/50">Cache</span> <span className="text-foreground">{b.resolver.cache_hit_ratio}%</span></div>
                      <div><span className="text-muted-foreground/50">Lat</span> <span className="text-foreground">{b.resolver.recursion_avg_ms}ms</span></div>
                    </div>
                  )}
                  {b.traffic?.source === 'nftables' && (
                    <div className="grid grid-cols-3 gap-1 text-[9px] font-mono text-muted-foreground/40">
                      <div>Pkts: {b.traffic.packets.toLocaleString()}</div>
                      <div>{formatBytes(b.traffic.bytes)}</div>
                      <div>Share: {b.traffic.share}%</div>
                    </div>
                  )}
                  <div className="text-[8px] font-mono text-muted-foreground/30">
                    Fontes: {[b.resolver?.source, b.traffic?.source].filter(Boolean).join(' + ')}
                  </div>
                </div>
              )) : (
                <div className="text-[10px] font-mono text-muted-foreground/40 col-span-full">Nenhum backend descoberto</div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ DNS PATH FLOW ═══ */}
      <NocDnsPathFlow nodes={pathNodes} edges={pathEdges} layerLabels={{ vip: 'FRONTEND DNS', resolver: 'BACKENDS' }} />

      {/* ═══ GEO MAP (compact) + DNS TOPOLOGY SVG (expanded) — Side by side ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {/* Geo Map — 2/5 width */}
        <div className="lg:col-span-2">
          {(() => {
            const mapNodes: MapNode[] = [];
            const mapEdges: MapEdge[] = [];

            mapNodes.push({
              id: 'frontend-dns',
              label: frontendIp ? `Frontend ${frontendIp}` : 'Frontend DNS',
              type: 'vip',
              status: frontendHealthy ? 'ok' : frontendIp ? 'degraded' : 'inactive',
              qps: telemetryConnected ? qps : undefined,
              bindIp: frontendIp || undefined,
            });

            backends.forEach((b: any) => {
              const bLatency = b.resolver?.recursion_avg_ms ? Math.round(b.resolver.recursion_avg_ms) : undefined;
              const bQps = b.resolver?.total_queries ?? undefined;
              const bCacheHit = b.resolver?.cache_hit_ratio ? Math.round(b.resolver.cache_hit_ratio) : undefined;
              mapNodes.push({
                id: `resolver-${b.name}`,
                label: b.name,
                type: 'resolver',
                status: b.healthy ? 'ok' : 'failed',
                latency: bLatency,
                qps: bQps,
                cacheHit: bCacheHit,
                bindIp: b.ip,
              });
              mapEdges.push({
                from: 'frontend-dns',
                to: `resolver-${b.name}`,
                latency: bLatency,
                qps: bQps ?? 0,
              });
            });

            mapNodes.push({
              id: 'upstream-primary',
              label: 'Upstream DNS',
              type: 'upstream',
              status: 'ok',
              bindIp: '8.8.8.8',
            });
            const resolverIds = mapNodes.filter(n => n.type === 'resolver').map(n => n.id);
            resolverIds.forEach(rid => {
              mapEdges.push({ from: rid, to: 'upstream-primary', latency: undefined, qps: 0 });
            });

            return <NocGeoMap nodes={mapNodes} edges={mapEdges} />;
          })()}
        </div>

        {/* DNS Network Map (Topology SVG) — 3/5 width */}
        <div className="lg:col-span-3">
          <NocTopologyPanel
            health={health}
            vipConfigured={!!frontendIp}
            vipAddress={frontendIp || null}
            dnsAvailable={telemetryConnected}
            totalQueries={totalQueries}
            cacheHitRatio={cacheHitRatio}
            avgLatency={avgLatency}
            dnsMetricsAvailable={telemetryConnected}
            entryLabel="FRONTEND"
          />
        </div>
      </div>

      {/* ═══ TOP DOMAINS + TOP CLIENTS — always show side by side ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Top Domains */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="noc-surface">
          <div className="noc-surface-header flex items-center gap-2">
            <Search size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Top Domínios</span>
            <span className="text-[8px] font-mono text-muted-foreground/40 ml-auto">Fonte: {queryAnalytics.log_source ?? 'query log'}</span>
          </div>
          <div className="noc-surface-body">
            {topDomains.length > 0 ? (
              <div className="space-y-1">
                {topDomains.slice(0, 10).map((d: any, i: number) => {
                  const maxCount = topDomains[0]?.count || 1;
                  return (
                    <div key={d.domain} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-muted-foreground/40 w-4 text-right">{i + 1}</span>
                      <div className="flex-1 relative">
                        <div className="absolute inset-y-0 left-0 bg-primary/10 rounded-sm" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                        <span className="relative z-10 text-foreground pl-1">{d.domain}</span>
                      </div>
                      <span className="text-muted-foreground/60 w-12 text-right">{d.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[10px] font-mono text-muted-foreground/40 py-2">Nenhum domínio capturado</div>
            )}
          </div>
        </motion.div>

        {/* Top Clients */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="noc-surface">
          <div className="noc-surface-header flex items-center gap-2">
            <Users size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Top Clientes</span>
          </div>
          <div className="noc-surface-body">
            {topClients.length > 0 ? (
              <div className="space-y-1">
                {topClients.slice(0, 10).map((c: any, i: number) => {
                  const maxQ = topClients[0]?.queries || 1;
                  return (
                    <div key={c.ip} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="text-muted-foreground/40 w-4 text-right">{i + 1}</span>
                      <div className="flex-1 relative">
                        <div className="absolute inset-y-0 left-0 bg-accent/10 rounded-sm" style={{ width: `${(c.queries / maxQ) * 100}%` }} />
                        <span className="relative z-10 text-foreground pl-1">{c.ip}</span>
                      </div>
                      <span className="text-muted-foreground/60 w-12 text-right">{c.queries}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[10px] font-mono text-muted-foreground/40 py-2">Nenhum cliente capturado</div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ═══ RECENT QUERIES ═══ */}
      {recentQueries.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="noc-surface">
          <div className="noc-surface-header flex items-center gap-2">
            <Globe size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Consultas Recentes</span>
            <span className="text-[8px] font-mono text-muted-foreground/40 ml-auto">{recentQueries.length} registros</span>
          </div>
          <div className="noc-surface-body max-h-48 overflow-y-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="text-muted-foreground/50 uppercase tracking-wider">
                  <th className="text-left pb-1 pr-2">Hora</th>
                  <th className="text-left pb-1 pr-2">Cliente</th>
                  <th className="text-left pb-1 pr-2">Domínio</th>
                  <th className="text-left pb-1">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {recentQueries.slice(-20).reverse().map((q: any, i: number) => (
                  <tr key={i} className="border-b border-border/10">
                    <td className="py-0.5 pr-2 text-muted-foreground/60">{q.time}</td>
                    <td className="py-0.5 pr-2 text-accent">{q.client}</td>
                    <td className="py-0.5 pr-2 text-foreground">{q.domain}</td>
                    <td className="py-0.5 text-muted-foreground/50">{q.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}

      {/* ═══ PER-BACKEND DETAILED METRICS ═══ */}
      {telemetryConnected && backends.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="noc-surface">
          <div className="noc-surface-header flex items-center gap-2">
            <BarChart3 size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Métricas Detalhadas por Backend</span>
          </div>
          <div className="noc-surface-body">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="text-muted-foreground/50 uppercase tracking-wider border-b border-border/20">
                    <th className="text-left py-1">Backend</th>
                    <th className="text-right py-1">Queries</th>
                    <th className="text-right py-1">Cache Hit</th>
                    <th className="text-right py-1">Latência</th>
                    <th className="text-right py-1">SERVFAIL</th>
                    <th className="text-right py-1">NXDOMAIN</th>
                    <th className="text-right py-1">Packets</th>
                    <th className="text-right py-1">Bytes</th>
                    <th className="text-right py-1">Share</th>
                    <th className="text-left py-1">Uptime</th>
                    <th className="text-left py-1">Fontes</th>
                  </tr>
                </thead>
                <tbody>
                  {backends.map((b: any) => (
                    <tr key={b.name} className="border-b border-border/10">
                      <td className="py-1 text-primary font-bold">{b.name}</td>
                      <td className="py-1 text-right">{(b.resolver?.total_queries ?? 0).toLocaleString()}</td>
                      <td className="py-1 text-right text-success">{b.resolver?.cache_hit_ratio ?? 0}%</td>
                      <td className="py-1 text-right">{b.resolver?.recursion_avg_ms ?? 0}ms</td>
                      <td className="py-1 text-right">{b.resolver?.servfail ?? 0}</td>
                      <td className="py-1 text-right">{b.resolver?.nxdomain ?? 0}</td>
                      <td className="py-1 text-right">{(b.traffic?.packets ?? 0).toLocaleString()}</td>
                      <td className="py-1 text-right">{formatBytes(b.traffic?.bytes ?? 0)}</td>
                      <td className="py-1 text-right">{b.traffic?.share ?? 0}%</td>
                      <td className="py-1">{b.resolver?.uptime_seconds ? formatUptime(b.resolver.uptime_seconds) : '—'}</td>
                      <td className="py-1 text-muted-foreground/40">{[b.resolver?.source, b.traffic?.source].filter(Boolean).join('+')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ INSTANCE TABLE ═══ */}
      <NocInstanceTable instances={safeV2} />

      {/* ═══ SUBSYSTEM MATRIX + OPERATIONAL FEED + SERVICE STATUS — 3 cols ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <NocHealthMatrix
          services={safeServices}
          dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
          networkOk={allRunning}
          dnsAvailable={telemetryConnected}
          privilegeLimited={false}
        />
        <NocEventsTimeline events={eventItems} />
        <NocResolverPanel services={safeServices} />
      </div>

      {/* ═══ PLATFORM METADATA ═══ */}
      <NocSystemInfoGrid sysInfo={sysInfo} />

      {/* ═══ DEPLOY STATE + DNS REPLAY — Side by side ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {deployState && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="noc-surface">
            <div className="noc-surface-header flex items-center gap-2">
              <FileText size={12} />
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Deploy State</span>
            </div>
            <div className="noc-surface-body">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Config Version</div>
                  <div className="font-mono font-bold">{deployState.configVersion || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Last Apply</div>
                  <div className="font-mono">{safeDate(deployState.lastApplyAt)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Operator</div>
                  <div className="font-mono">{deployState.lastApplyOperator || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Status</div>
                  <div className={`font-mono font-bold ${
                    deployState.lastApplyStatus === 'success' ? 'text-success' :
                    deployState.lastApplyStatus === 'failed' ? 'text-destructive' : ''
                  }`}>{deployState.lastApplyStatus || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Total Deploys</div>
                  <div className="font-mono font-bold">{deployState.totalDeployments}</div>
                </div>
                <div>
                  <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Modo</div>
                  <div className="font-mono text-accent">Recursivo Simples</div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
                <button onClick={() => navigate('/history')}
                  className="px-2 py-1 text-[10px] bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 flex items-center gap-1">
                  <Clock size={10} /> Histórico
                </button>
                <button onClick={() => selfTestMutation.mutate()} disabled={selfTestMutation.isPending}
                  className="px-2 py-1 text-[10px] bg-accent text-accent-foreground rounded font-medium hover:bg-accent/90 disabled:opacity-60 flex items-center gap-1">
                  <Shield size={10} /> {selfTestMutation.isPending ? 'Self-test...' : 'Self-test'}
                </button>
                <button onClick={() => navigate('/wizard')}
                  className="px-2 py-1 text-[10px] bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 flex items-center gap-1">
                  <Zap size={10} /> Deploy
                </button>
              </div>
              {selfTestResult && (
                <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                    <span className="text-muted-foreground/70">System self-test</span>
                    <span className={selfTestResult.overall === 'ok' ? 'text-success font-bold' : 'text-destructive font-bold'}>
                      {selfTestResult.overall === 'ok' ? 'OK' : 'FAILED'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {selfTestResult.checks.map((check) => (
                      <div key={check.name} className="grid grid-cols-[auto_1fr_auto] gap-2 text-[10px] font-mono items-center">
                        <span className={check.status === 'pass' ? 'text-success' : check.status === 'warn' ? 'text-warning' : 'text-destructive'}>
                          {check.status.toUpperCase()}
                        </span>
                        <span className="text-foreground/85 truncate">{check.name}: {check.detail}</span>
                        <span className="text-muted-foreground/55">{check.duration_ms}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        <NocDeploySimulation
          listeners={backends.length > 0
            ? backends.map((b: any) => ({ name: b.name, ip: b.ip || '127.0.0.1' }))
            : safeV2.length > 0
              ? safeV2.map(inst => ({ name: inst.instance_name || `backend-${inst.id}`, ip: inst.bind_ip || '127.0.0.1' }))
              : []}
        />
      </div>

      {/* ═══ COMMAND CONSOLE ═══ */}
      <NocQuickActions />
    </div>
  );
}
