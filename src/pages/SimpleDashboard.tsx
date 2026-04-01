// ============================================================
// DNS Control — Dashboard: Recursivo Simples
// GUI específica para modo simples (sem VIP/interceptação)
// Topologia: cliente → frontend DNS → balanceamento local → backends internos
// ============================================================

import { Activity, Clock, Globe, Database, Timer, Shield, Server, Layers, Zap, FileText, RotateCcw, Network, AlertTriangle } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth, useDeployState } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency, safeDate, type SystemSelfTestResult } from '@/lib/types';
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

export default function SimpleDashboard() {
  const { data: sysInfo, isLoading: sysLoading, error: sysError } = useSystemInfo();
  const { data: services, isLoading: svcLoading } = useServices();
  const { data: instanceStats } = useInstanceStats();
  const { data: health } = useInstanceHealth();
  const { data: deployState } = useDeployState();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [reconciling, setReconciling] = useState(false);
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

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      setReconciling(true);
      const r = await api.reconcileNow();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    onSettled: () => {
      setReconciling(false);
      qc.invalidateQueries({ queryKey: ['v2-instances'] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const selfTestMutation = useMutation({
    mutationFn: async () => {
      const r = await api.runSystemSelfTest();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    onSuccess: (data) => setSelfTestResult(data),
  });

  const isLoading = sysLoading && svcLoading;
  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  const allRunning = safeServices.length > 0 && safeServices.every(s => s.status === 'running' || s.status === 'active' || s.active);
  const dnsAvail = sysInfo?.dns_metrics_available ?? false;
  const dnsStatus = sysInfo?.dns_metrics_status ?? 'unknown';
  const dashQ = sysInfo?.total_queries ?? 0;
  const dashCH = sysInfo?.cache_hit_ratio ?? 0;
  const dashLat = sysInfo?.latency_ms ?? 0;

  const totalQps = dnsAvail ? dashQ : safeStats.reduce((a, b) => a + getInstanceQueries(b), 0);
  const avgCacheHit = dnsAvail ? dashCH.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceCacheHit(b), 0) / safeStats.length).toFixed(1) : '0');
  const avgLatency = dnsAvail ? dashLat.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceLatency(b), 0) / safeStats.length).toFixed(1) : '0');

  const healthyCount = safeV2.length > 0 ? safeV2.filter(i => i.current_status === 'healthy').length : (health?.healthy ?? 0);
  const totalInstances = safeV2.length > 0 ? safeV2.length : (health?.total ?? 0);
  const failedCount = safeV2.filter(i => i.current_status === 'failed' || i.current_status === 'withdrawn').length;

  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);

  const resolverHealthState: 'healthy' | 'degraded' | 'critical' | 'unknown' =
    totalInstances === 0 ? 'unknown' :
    failedCount === 0 ? 'healthy' :
    failedCount >= totalInstances ? 'critical' : 'degraded';

  const upstreamOk = health ? health.instances?.some(i => i.healthy) ?? false : null;

  // Frontend DNS info
  const frontendIp = sysInfo?.frontend_dns_ip || deployState?.frontendDnsIp || '';

  // Telemetry status helper
  const telemetryConnected = dnsAvail;
  const telemetryLabel = dnsStatus === 'privilege_limited' ? 'Privilégio limitado' : 'Telemetria não conectada';

  // ═══ METRIC CARDS — Simple mode: NO VIP ═══
  const metricCards = [
    {
      label: 'Frontend DNS',
      value: frontendIp ? `${frontendIp}:53` : '—',
      sub: frontendIp ? 'Endpoint publicado' : 'Não configurado',
      icon: <Network size={18} />,
      accent: (frontendIp ? 'accent' : 'primary') as any,
      healthState: frontendIp ? 'healthy' : undefined,
    },
    {
      label: 'Backends',
      value: `${healthyCount}/${totalInstances}`,
      sub: resolverHealthState === 'unknown' ? 'Sem instâncias' : resolverHealthState === 'healthy' ? 'Todos saudáveis' : failedCount > 0 ? `${failedCount} em falha` : 'Verificando',
      icon: <Server size={18} />,
      accent: (resolverHealthState === 'critical' ? 'destructive' : resolverHealthState === 'degraded' ? 'warning' : 'primary') as any,
      healthState: resolverHealthState,
    },
    {
      label: 'Total Queries',
      value: telemetryConnected ? totalQps.toLocaleString() : '—',
      sub: telemetryConnected ? 'Acumulado' : telemetryLabel,
      icon: <Activity size={18} />,
      accent: 'primary' as const,
      unavailable: !telemetryConnected,
    },
    {
      label: 'Cache Hit',
      value: telemetryConnected ? `${avgCacheHit}%` : '—',
      sub: telemetryConnected ? (Number(avgCacheHit) > 80 ? 'Eficiente' : Number(avgCacheHit) > 50 ? 'Moderado' : 'Baixo') : telemetryLabel,
      icon: <Database size={18} />,
      accent: (telemetryConnected && Number(avgCacheHit) < 50 ? 'warning' : 'accent') as any,
      unavailable: !telemetryConnected,
      healthState: telemetryConnected ? (Number(avgCacheHit) > 80 ? 'healthy' : Number(avgCacheHit) > 50 ? 'degraded' : 'critical') : undefined,
    },
    {
      label: 'Latência DNS',
      value: telemetryConnected ? `${avgLatency}ms` : '—',
      sub: telemetryConnected ? (Number(avgLatency) < 30 ? 'Ótima' : Number(avgLatency) < 100 ? 'Aceitável' : 'Alta') : telemetryLabel,
      icon: <Timer size={18} />,
      accent: (telemetryConnected && Number(avgLatency) > 100 ? 'destructive' : telemetryConnected && Number(avgLatency) > 50 ? 'warning' : 'primary') as any,
      unavailable: !telemetryConnected,
      healthState: telemetryConnected ? (Number(avgLatency) < 30 ? 'healthy' : Number(avgLatency) < 100 ? 'degraded' : 'critical') : undefined,
    },
    {
      label: 'Uptime',
      value: sysInfo?.uptime ?? '—',
      sub: 'Sistema',
      icon: <Clock size={18} />,
      accent: 'primary' as const,
    },
  ];

  const activeServicesCount = safeServices.filter(s => s.status === 'running' || s.status === 'active' || s.active).length;
  const inactiveServicesCount = safeServices.filter(s => (s.status === 'stopped' || s.status === 'no ruleset') && !s.active).length;
  const errorServicesCount = safeServices.filter(s => s.status === 'error').length;
  const critEvents = eventItems.filter((e: any) => e.severity === 'critical').length;
  const warnEvents = eventItems.filter((e: any) => e.severity === 'warning').length;

  const lastMeaningfulEvent = eventItems.find((e: any) =>
    e.severity === 'critical' || e.severity === 'warning' ||
    (e.event_type && !['health_check', 'login_success', 'reconciliation_noop'].includes(e.event_type))
  );

  // Build resolvers for path flow
  const resolvers = safeV2.length > 0
    ? safeV2.map(inst => ({
        id: `r-${inst.id}`, label: inst.instance_name || 'Backend',
        ip: inst.bind_ip,
        status: (inst.current_status === 'healthy' ? 'ok' : inst.current_status === 'degraded' ? 'degraded' : 'failed') as any,
      }))
    : safeStats.length > 0
      ? safeStats.map((inst: any) => {
          const name = String(inst.instance ?? inst.name ?? 'backend');
          return {
            id: `r-${name}`, label: name,
            ip: inst.bind_ip || inst.bind_ips?.[0],
            status: (inst.source === 'live' ? 'ok' : 'degraded') as any,
          };
        })
      : [];

  const resolverCount = resolvers.length || 1;
  const perResolverQps = telemetryConnected ? Math.round(totalQps / resolverCount) : 0;

  // Path flow for simple mode: CLIENT → FRONTEND → BACKENDS → UPSTREAM
  const pathNodes = [
    { id: 'clients', label: 'Clientes DNS', type: 'client' as const, status: 'ok' as const },
    {
      id: 'frontend', label: frontendIp ? `Frontend ${frontendIp}` : 'Frontend DNS',
      type: 'vip' as const, status: frontendIp ? 'ok' as const : 'unknown' as const,
      ip: frontendIp || undefined, qps: telemetryConnected ? totalQps : undefined,
    },
    ...resolvers.map(r => ({
      ...r, type: 'resolver' as const,
      latencyMs: telemetryConnected ? Math.round(Number(avgLatency)) : undefined,
      cacheHit: telemetryConnected ? Math.round(Number(avgCacheHit)) : undefined,
      qps: perResolverQps || undefined,
    })),
    {
      id: 'upstream', label: 'Upstream DNS', type: 'upstream' as const,
      status: (upstreamOk === true ? 'ok' : upstreamOk === false ? 'failed' : 'unknown') as any,
    },
  ];
  const pathEdges = [
    { from: 'clients', to: 'frontend', qps: telemetryConnected ? totalQps : 0 },
    ...resolvers.map(r => ({
      from: 'frontend', to: r.id,
      qps: perResolverQps,
      latencyMs: telemetryConnected ? Math.round(Number(avgLatency)) : undefined,
    })),
    ...resolvers.map(r => ({
      from: r.id, to: 'upstream',
      qps: perResolverQps,
      latencyMs: telemetryConnected ? Math.max(Math.round(Number(avgLatency)) - 3, 1) : undefined,
    })),
  ];

  if (resolvers.length === 0 && totalInstances > 0) {
    pathNodes.splice(2, 0, {
      id: 'r-main', label: 'Backend', type: 'resolver' as const,
      status: resolverHealthState === 'healthy' ? 'ok' as const : 'degraded' as const,
      latencyMs: telemetryConnected ? Math.round(Number(avgLatency)) : undefined,
      cacheHit: telemetryConnected ? Math.round(Number(avgCacheHit)) : undefined,
      qps: telemetryConnected ? totalQps : undefined, ip: undefined,
    });
    pathEdges.push(
      { from: 'frontend', to: 'r-main', qps: telemetryConnected ? totalQps : 0, latencyMs: telemetryConnected ? Math.round(Number(avgLatency)) : undefined },
      { from: 'r-main', to: 'upstream', qps: telemetryConnected ? totalQps : 0, latencyMs: telemetryConnected ? Math.round(Number(avgLatency)) : undefined },
    );
  }

  return (
    <div className="space-y-4">
      {/* ═══ MODE BADGE ═══ */}
      <div className="flex items-center gap-2">
        <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest rounded bg-primary/10 text-primary border border-primary/20">
          Recursivo Simples
        </span>
        {frontendIp && (
          <span className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider rounded bg-accent/10 text-accent border border-accent/20">
            Frontend: {frontendIp}:53
          </span>
        )}
      </div>

      {/* ═══ TIER 1: HERO BAR ═══ */}
      <NocHeroBar
        allHealthy={allRunning && failedCount === 0}
        failedCount={failedCount}
        totalInstances={totalInstances}
        healthyCount={healthyCount}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconciling}
        dnsAvailable={dnsAvail}
        dnsStatus={dnsStatus}
        lastEvent={lastMeaningfulEvent}
        activeIncidents={critEvents}
      />

      {/* ═══ TIER 2: HEALTH SUMMARY ═══ */}
      <NocHealthSummary
        incidents={critEvents}
        warnings={warnEvents}
        activeServices={activeServicesCount}
        inactiveServices={inactiveServicesCount}
        errorServices={errorServicesCount}
        resolverState={resolverHealthState}
        dnsAvailable={dnsAvail}
        privilegeLimited={dnsStatus === 'privilege_limited'}
        lastEvent={lastMeaningfulEvent}
      />

      {/* ═══ TIER 3: KPI STRIP — No VIP card ═══ */}
      <NocMetricStrip cards={metricCards} loading={isLoading} />

      {/* ═══ TELEMETRY WARNING ═══ */}
      {!telemetryConnected && totalInstances > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="noc-surface"
          style={{ borderLeft: '2px solid hsl(var(--warning))' }}
        >
          <div className="noc-surface-body py-3 flex items-center gap-3">
            <AlertTriangle size={14} className="text-warning flex-shrink-0" />
            <div className="text-[10px] font-mono">
              <span className="font-bold text-warning uppercase">Telemetria não conectada</span>
              <span className="text-muted-foreground/60 ml-3">
                {dnsStatus === 'privilege_limited'
                  ? 'unbound-control requer privilégios — métricas DNS indisponíveis'
                  : 'Aguardando coleta de métricas via unbound-control stats_noreset'}
              </span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ FRONTEND + BACKEND TOPOLOGY ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="noc-surface"
      >
        <div className="noc-surface-header flex items-center gap-2">
          <Layers size={12} />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Topologia do Serviço</span>
        </div>
        <div className="noc-surface-body">
          {/* Frontend DNS */}
          <div className="mb-4 pb-4 border-b border-border/30">
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Frontend DNS Publicado</div>
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="font-mono font-bold text-foreground">{frontendIp || '—'}:53</span>
              <span className="text-[9px] font-mono text-muted-foreground/50 uppercase">→ Balanceamento Local (nftables DNAT)</span>
            </div>
          </div>

          {/* Backend Resolvers */}
          <div>
            <div className="text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/50 mb-2">Backends Internos</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {resolvers.length > 0 ? resolvers.map(r => (
                <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-muted/5">
                  <div className={`w-2 h-2 rounded-full ${r.status === 'ok' ? 'bg-success' : r.status === 'degraded' ? 'bg-warning' : 'bg-destructive'}`} />
                  <div>
                    <div className="font-mono font-bold text-sm text-foreground">{r.label}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/50">{r.ip ? `${r.ip}:53` : '—'}</div>
                  </div>
                  {telemetryConnected && perResolverQps > 0 && (
                    <span className="ml-auto text-[9px] font-mono text-muted-foreground/40">{perResolverQps} q</span>
                  )}
                </div>
              )) : (
                <div className="text-[10px] font-mono text-muted-foreground/40 col-span-full">Nenhum backend descoberto</div>
              )}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ═══ DNS PATH FLOW (Simple: Frontend → Backends → Upstream) ═══ */}
      <NocDnsPathFlow nodes={pathNodes} edges={pathEdges} />

      {/* ═══ PER-INSTANCE METRICS ═══ */}
      {telemetryConnected && safeStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="noc-surface"
        >
          <div className="noc-surface-header flex items-center gap-2">
            <Activity size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Métricas por Backend</span>
          </div>
          <div className="noc-surface-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {safeStats.map((inst: any, idx: number) => {
                const name = String(inst.instance ?? inst.name ?? `backend-${idx + 1}`);
                const queries = getInstanceQueries(inst);
                const cacheHit = getInstanceCacheHit(inst);
                const latency = getInstanceLatency(inst);
                return (
                  <div key={name} className="p-3 rounded-lg border border-border/20 bg-muted/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-bold text-sm">{name}</span>
                      <span className="text-[9px] font-mono text-muted-foreground/40">{inst.bind_ip || ''}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                      <div>
                        <div className="text-muted-foreground/50 uppercase tracking-wider">Queries</div>
                        <div className="font-bold text-foreground">{queries.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground/50 uppercase tracking-wider">Cache Hit</div>
                        <div className="font-bold text-foreground">{cacheHit.toFixed(1)}%</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground/50 uppercase tracking-wider">Latência</div>
                        <div className="font-bold text-foreground">{latency.toFixed(1)}ms</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ INSTANCE TABLE ═══ */}
      <NocInstanceTable instances={safeV2} />

      {/* ═══ HEALTH MATRIX + SERVICES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <NocHealthMatrix
            services={safeServices}
            dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
            networkOk={allRunning}
            dnsAvailable={dnsAvail}
            privilegeLimited={dnsStatus === 'privilege_limited'}
          />
        </div>
        <div className="lg:col-span-4">
          <NocResolverPanel services={safeServices} />
        </div>
      </div>

      {/* ═══ EVENTS + SYSTEM INFO ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NocEventsTimeline events={eventItems} />
        <NocSystemInfoGrid sysInfo={sysInfo} />
      </div>

      {/* ═══ DEPLOY STATE ═══ */}
      {deployState && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="noc-surface"
        >
          <div className="noc-surface-header flex items-center gap-2">
            <FileText size={12} />
            <span className="text-[10px] font-mono font-bold uppercase tracking-widest">Deploy State</span>
          </div>
          <div className="noc-surface-body">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 text-xs">
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
              <div className="flex items-end gap-2">
                <button onClick={() => navigate('/history')}
                  className="px-2 py-1 text-[10px] bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 flex items-center gap-1">
                  <Clock size={10} /> Histórico
                </button>
                <button onClick={() => selfTestMutation.mutate()}
                  disabled={selfTestMutation.isPending}
                  className="px-2 py-1 text-[10px] bg-accent text-accent-foreground rounded font-medium hover:bg-accent/90 disabled:opacity-60 flex items-center gap-1">
                  <Shield size={10} /> {selfTestMutation.isPending ? 'Self-test...' : 'Self-test'}
                </button>
                <button onClick={() => navigate('/wizard')}
                  className="px-2 py-1 text-[10px] bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 flex items-center gap-1">
                  <Zap size={10} /> Deploy
                </button>
              </div>
            </div>
            {selfTestResult && (
              <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                  <span className="text-muted-foreground/70">System self-test</span>
                  <span className={selfTestResult.overall === 'ok' ? 'text-success font-bold' : 'text-destructive font-bold'}>
                    {selfTestResult.overall === 'ok' ? 'OK' : 'FAILED'}
                  </span>
                </div>
                <div className="text-[10px] font-mono text-muted-foreground/70">
                  pass={selfTestResult.passed} warn={selfTestResult.warned} fail={selfTestResult.failed}
                </div>
                <div className="space-y-1.5">
                  {selfTestResult.checks.map((check) => (
                    <div key={check.name} className="grid grid-cols-[auto_1fr_auto] gap-2 text-[10px] font-mono items-center">
                      <span className={
                        check.status === 'pass' ? 'text-success' : check.status === 'warn' ? 'text-warning' : 'text-destructive'
                      }>
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

      {/* ═══ DNS REPLAY SIMULATION ═══ */}
      <NocDeploySimulation
        listeners={
          safeV2.length > 0
            ? safeV2.map(inst => ({
                name: inst.instance_name || `backend-${inst.id}`,
                ip: inst.bind_ip || '127.0.0.1',
              }))
            : health?.instances?.length
              ? health.instances.map(inst => ({
                  name: inst.instance || 'backend',
                  ip: inst.bind_ip || '127.0.0.1',
                }))
              : totalInstances > 0
                ? [{ name: 'backend-local', ip: '127.0.0.1' }]
                : []
        }
      />

      {/* ═══ COMMAND CONSOLE ═══ */}
      <NocQuickActions />
    </div>
  );
}
