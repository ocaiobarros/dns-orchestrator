import { Activity, Clock, Globe, Zap, AlertTriangle, Timer, Database, Shield, FileText, RotateCcw } from 'lucide-react';
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
import NocTopologyPanel from '@/components/noc/NocTopologyPanel';
import NocGeoMap from '@/components/noc/NocGeoMap';
import NocNetworkMap, { type MapNode, type MapEdge } from '@/components/noc/NocNetworkMap';
import NocEventsTimeline from '@/components/noc/NocEventsTimeline';
import NocResolverPanel from '@/components/noc/NocResolverPanel';
import NocHealthMatrix from '@/components/noc/NocHealthMatrix';
import NocSystemInfoGrid from '@/components/noc/NocSystemInfoGrid';
import NocQuickActions from '@/components/noc/NocQuickActions';
import NocDnsPathFlow from '@/components/noc/NocDnsPathFlow';
import NocIncidentDetector from '@/components/noc/NocIncidentDetector';
import NocDeploySimulation from '@/components/noc/NocDeploySimulation';
import NocVipDiagnostics from '@/components/noc/NocVipDiagnostics';

export default function Dashboard() {
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

  const { data: vipDiagnostics, isLoading: vipDiagLoading } = useQuery({
    queryKey: ['vip-diagnostics'],
    queryFn: async () => { const r = await api.getVipDiagnostics(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
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
    onSuccess: (data) => {
      setSelfTestResult(data);
    },
  });

  const isLoading = sysLoading && svcLoading;

  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  // allRunning: check that essential services are active (nftables uses 'active' status, not 'running')
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
  const inRotation = safeV2.length > 0 ? safeV2.filter(i => i.in_rotation).length : totalInstances;

  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);
  const unavailSub = dnsStatus === 'privilege_limited' ? 'Privilege limited' : 'No telemetry';

  // Determine resolver health state
  const resolverHealthState: 'healthy' | 'degraded' | 'critical' | 'unknown' =
    totalInstances === 0 ? 'unknown' :
    failedCount === 0 ? 'healthy' :
    failedCount >= totalInstances ? 'critical' : 'degraded';

  // VIP state
  const vipConfigured = sysInfo?.vip_anycast_available ?? false;
  const vipAddress = sysInfo?.vip_anycast ?? null;

  // Upstream reachability from health data
  const upstreamOk = health ? health.instances?.some(i => i.healthy) ?? false : null;

  const metricCards = [
    {
      label: 'Resolvers',
      value: `${healthyCount}/${totalInstances}`,
      sub: resolverHealthState === 'unknown' ? 'No instances' : resolverHealthState === 'healthy' ? 'All healthy' : failedCount > 0 ? `${failedCount} failed` : 'Checking',
      icon: <Globe size={18} />,
      accent: (resolverHealthState === 'critical' ? 'destructive' : resolverHealthState === 'degraded' ? 'warning' : 'primary') as any,
      healthState: resolverHealthState,
    },
    {
      label: 'Total Queries',
      value: dnsAvail ? totalQps.toLocaleString() : '—',
      sub: dnsAvail ? 'Accumulated' : unavailSub,
      icon: <Activity size={18} />,
      accent: 'primary' as const,
      unavailable: !dnsAvail,
    },
    {
      label: 'Cache Hit',
      value: dnsAvail ? `${avgCacheHit}%` : '—',
      sub: dnsAvail ? (Number(avgCacheHit) > 80 ? 'Efficient' : Number(avgCacheHit) > 50 ? 'Moderate' : 'Low') : unavailSub,
      icon: <Database size={18} />,
      accent: (dnsAvail && Number(avgCacheHit) < 50 ? 'warning' : 'accent') as any,
      unavailable: !dnsAvail,
      healthState: dnsAvail ? (Number(avgCacheHit) > 80 ? 'healthy' : Number(avgCacheHit) > 50 ? 'degraded' : 'critical') : undefined,
    },
    {
      label: 'DNS Latency',
      value: dnsAvail ? `${avgLatency}ms` : '—',
      sub: dnsAvail ? (Number(avgLatency) < 30 ? 'Optimal' : Number(avgLatency) < 100 ? 'Acceptable' : 'High') : unavailSub,
      icon: <Timer size={18} />,
      accent: (dnsAvail && Number(avgLatency) > 100 ? 'destructive' : dnsAvail && Number(avgLatency) > 50 ? 'warning' : 'primary') as any,
      unavailable: !dnsAvail,
      healthState: dnsAvail ? (Number(avgLatency) < 30 ? 'healthy' : Number(avgLatency) < 100 ? 'degraded' : 'critical') : undefined,
    },
    {
      label: 'VIP Status',
      value: vipConfigured ? (vipAddress || 'Active') : '—',
      sub: vipConfigured ? 'Anycast active' : 'Not configured',
      icon: <Zap size={18} />,
      accent: (vipConfigured ? 'accent' : 'primary') as any,
      unavailable: !vipConfigured,
      healthState: vipConfigured ? 'healthy' : undefined,
    },
    {
      label: 'Uptime',
      value: sysInfo?.uptime ?? '—',
      sub: 'System',
      icon: <Clock size={18} />,
      accent: 'primary' as const,
    },
  ];

  // Compute health summary counts
  const activeServicesCount = safeServices.filter(s => s.status === 'running' || s.status === 'active' || s.active).length;
  const inactiveServicesCount = safeServices.filter(s => (s.status === 'stopped' || s.status === 'no ruleset') && !s.active).length;
  const errorServicesCount = safeServices.filter(s => s.status === 'error').length;
  const critEvents = eventItems.filter((e: any) => e.severity === 'critical').length;
  const warnEvents = eventItems.filter((e: any) => e.severity === 'warning').length;

  // Last meaningful event
  const lastMeaningfulEvent = eventItems.find((e: any) =>
    e.severity === 'critical' || e.severity === 'warning' ||
    (e.event_type && !['health_check', 'login_success', 'reconciliation_noop'].includes(e.event_type))
  );

  return (
    <div className="space-y-4">
      {/* ═══ TIER 1: HERO BAR — Operational state at a glance ═══ */}
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

      {/* ═══ TIER 2: HEALTH SUMMARY — Executive glance ═══ */}
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

      {/* ═══ TIER 3: KPI STRIP ═══ */}
      <NocMetricStrip cards={metricCards} loading={isLoading} />

      {/* Reconciliation flash */}
      {reconcileMutation.data && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="noc-surface"
          style={{ borderLeft: '2px solid hsl(var(--primary))' }}
        >
          <div className="noc-surface-body py-3">
            <div className="text-[10px] font-mono flex items-center gap-4 flex-wrap">
              <span className="font-bold text-foreground/85">RECONCILIATION</span>
              <span className="text-muted-foreground/40">{reconcileMutation.data.instances_checked ?? 0} checked</span>
              <span className="text-destructive font-bold">{reconcileMutation.data.instances_failed ?? 0} failed</span>
              <span className="text-muted-foreground/40">{reconcileMutation.data.backends_removed ?? 0} removed</span>
              <span className="text-success font-bold">{reconcileMutation.data.backends_restored ?? 0} restored</span>
            </div>
          </div>
        </motion.div>
      )}

      {/* ═══ TIER 4: DNS GEO MAP — Real world map centerpiece ═══ */}
      {(() => {
        const mapNodes: MapNode[] = [];
        const mapEdges: MapEdge[] = [];

        // VIP node
        mapNodes.push({
          id: 'vip-anycast',
          label: vipConfigured ? (vipAddress || 'VIP Anycast') : 'VIP Anycast',
          type: 'vip',
          status: vipConfigured ? 'ok' : 'inactive',
          qps: dnsAvail ? totalQps : undefined,
          extra: vipConfigured ? 'Anycast active' : 'Not configured',
          bindIp: vipAddress || undefined,
        });

        // Resolver nodes
        if (safeV2.length > 0) {
          safeV2.forEach(inst => {
            const instStat = safeStats.find((s: any) => s.instance_id === inst.id);
            const instLat = instStat ? getInstanceLatency(instStat) : (dnsAvail ? Number(avgLatency) : undefined);
            const instQps = instStat ? getInstanceQueries(instStat) : undefined;
            const instCh = instStat ? Math.round(getInstanceCacheHit(instStat)) : (dnsAvail ? Math.round(Number(avgCacheHit)) : undefined);
            mapNodes.push({
              id: `resolver-${inst.id}`,
              label: inst.instance_name || `Resolver ${inst.id}`,
              type: 'resolver',
              status: inst.current_status === 'healthy' ? 'ok' : inst.current_status === 'degraded' ? 'degraded' : inst.current_status === 'failed' || inst.current_status === 'withdrawn' ? 'failed' : 'inactive',
              latency: instLat != null ? Math.round(instLat) : undefined,
              qps: instQps,
              cacheHit: instCh,
              bindIp: inst.bind_ip,
            });
            mapEdges.push({ from: 'vip-anycast', to: `resolver-${inst.id}`, latency: instLat != null ? Math.round(instLat) : undefined, qps: instQps ?? 0 });
          });
        } else if (totalInstances > 0) {
          mapNodes.push({
            id: 'resolver-main', label: 'Resolver Local', type: 'resolver',
            status: resolverHealthState === 'healthy' ? 'ok' : resolverHealthState === 'degraded' ? 'degraded' : resolverHealthState === 'critical' ? 'failed' : 'unknown',
            latency: dnsAvail ? Math.round(Number(avgLatency)) : undefined, qps: dnsAvail ? totalQps : undefined, cacheHit: dnsAvail ? Math.round(Number(avgCacheHit)) : undefined,
          });
          mapEdges.push({ from: 'vip-anycast', to: 'resolver-main', latency: dnsAvail ? Math.round(Number(avgLatency)) : undefined, qps: dnsAvail ? totalQps : 0 });
        }

        // Upstream
        mapNodes.push({
          id: 'upstream-primary', label: 'Upstream DNS', type: 'upstream',
          status: upstreamOk === true ? 'ok' : upstreamOk === false ? 'failed' : 'unknown',
          latency: dnsAvail ? Math.max(Math.round(Number(avgLatency)) - 2, 1) : undefined,
          extra: upstreamOk === true ? 'Reachable' : upstreamOk === false ? 'Unreachable' : 'Unknown',
          bindIp: '8.8.8.8',
        });
        const resolverIds = mapNodes.filter(n => n.type === 'resolver').map(n => n.id);
        resolverIds.forEach(rid => {
          const rn = mapNodes.find(n => n.id === rid);
          mapEdges.push({ from: rid, to: 'upstream-primary', latency: dnsAvail ? Math.max(Math.round(Number(avgLatency)) - 2, 1) : undefined, qps: rn?.qps ?? 0 });
        });

        return <NocGeoMap nodes={mapNodes} edges={mapEdges} />;
      })()}

      {/* ═══ TIER 4B: DNS PATH FLOW ═══ */}
      {(() => {
        const pathNodes = [
          { id: 'clients', label: 'Clientes DNS', type: 'client' as const, status: 'ok' as const },
          {
            id: 'vip', label: vipConfigured ? (vipAddress || 'VIP') : 'VIP',
            type: 'vip' as const, status: vipConfigured ? 'ok' as const : 'unknown' as const,
            ip: vipAddress || undefined, qps: dnsAvail ? totalQps : undefined,
          },
          ...safeV2.map(inst => ({
            id: `r-${inst.id}`, label: inst.instance_name || 'Resolver',
            type: 'resolver' as const,
            status: (inst.current_status === 'healthy' ? 'ok' : inst.current_status === 'degraded' ? 'degraded' : 'failed') as any,
            ip: inst.bind_ip,
            latencyMs: dnsAvail ? Math.round(Number(avgLatency)) : undefined,
            cacheHit: dnsAvail ? Math.round(Number(avgCacheHit)) : undefined,
            qps: dnsAvail ? Math.round(totalQps / Math.max(safeV2.length, 1)) : undefined,
          })),
          {
            id: 'upstream', label: 'Upstream DNS', type: 'upstream' as const,
            status: (upstreamOk === true ? 'ok' : upstreamOk === false ? 'failed' : 'unknown') as any,
          },
        ];
        const pathEdges = [
          { from: 'clients', to: 'vip', qps: dnsAvail ? totalQps : 0 },
          ...safeV2.map(inst => ({
            from: 'vip', to: `r-${inst.id}`,
            qps: dnsAvail ? Math.round(totalQps / Math.max(safeV2.length, 1)) : 0,
            latencyMs: dnsAvail ? Math.round(Number(avgLatency)) : undefined,
          })),
          ...safeV2.map(inst => ({
            from: `r-${inst.id}`, to: 'upstream',
            qps: dnsAvail ? Math.round(totalQps / Math.max(safeV2.length, 1)) : 0,
            latencyMs: dnsAvail ? Math.max(Math.round(Number(avgLatency)) - 3, 1) : undefined,
          })),
        ];
        if (safeV2.length === 0 && totalInstances > 0) {
          pathNodes.splice(2, 0, {
            id: 'r-main', label: 'Resolver', type: 'resolver' as const,
            status: resolverHealthState === 'healthy' ? 'ok' as const : 'degraded' as const,
            latencyMs: dnsAvail ? Math.round(Number(avgLatency)) : undefined,
            cacheHit: dnsAvail ? Math.round(Number(avgCacheHit)) : undefined,
            qps: dnsAvail ? totalQps : undefined, ip: undefined,
          });
          pathEdges.push(
            { from: 'vip', to: 'r-main', qps: dnsAvail ? totalQps : 0, latencyMs: dnsAvail ? Math.round(Number(avgLatency)) : undefined },
            { from: 'r-main', to: 'upstream', qps: dnsAvail ? totalQps : 0, latencyMs: dnsAvail ? Math.round(Number(avgLatency)) : undefined },
          );
        }
        return <NocDnsPathFlow nodes={pathNodes} edges={pathEdges} />;
      })()}

      {/* ═══ TIER 4C: INCIDENT DETECTION ═══ */}
      <NocIncidentDetector
        resolvers={safeV2.map(inst => {
          const instStat = safeStats.find((s: any) => s.instance_id === inst.id);
          return {
            name: inst.instance_name || `Resolver ${inst.id}`,
            latencyMs: dnsAvail ? Number(avgLatency) : 0,
            servfailPct: 0.3,
            cacheHitPct: dnsAvail ? Number(avgCacheHit) : 100,
            qps: instStat ? getInstanceQueries(instStat) : (dnsAvail ? Math.round(totalQps / Math.max(safeV2.length, 1)) : 0),
            healthy: inst.current_status === 'healthy',
            upstreamReachable: upstreamOk !== false,
          };
        })}
        vipDiagnostics={vipDiagnostics}
      />

      {/* ═══ TIER 4D: SERVICE VIP DIAGNOSTICS ═══ */}
      <NocVipDiagnostics data={vipDiagnostics} isLoading={vipDiagLoading} />

      {/* ═══ TIER 5: TOPOLOGY DETAIL (8col) + Health Matrix (4col) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-8">
          <NocTopologyPanel
            health={health}
            vipConfigured={vipConfigured}
            vipAddress={vipAddress}
            dnsAvailable={dnsAvail}
            totalQueries={totalQps}
            cacheHitRatio={Number(avgCacheHit)}
            avgLatency={Number(avgLatency)}
            dnsMetricsAvailable={dnsAvail}
          />
        </div>
        <div className="lg:col-span-4">
          <NocHealthMatrix
            services={safeServices}
            dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
            networkOk={allRunning}
            dnsAvailable={dnsAvail}
            privilegeLimited={dnsStatus === 'privilege_limited'}
          />
        </div>
      </div>

      {/* ═══ TIER 5B: INSTANCE TABLE ═══ */}
      <NocInstanceTable instances={safeV2} />

      {/* ═══ TIER 6: EVENTS + SERVICES + SYSTEM INFO (4+4+4) ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <NocEventsTimeline events={eventItems} />
        <NocResolverPanel services={safeServices} />
        <NocSystemInfoGrid sysInfo={sysInfo} />
      </div>

      {/* ═══ TIER 7: DEPLOYMENT STATE ═══ */}
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
                <div className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Rollback</div>
                <div className={`font-mono ${deployState.rollbackAvailable ? 'text-accent' : 'text-muted-foreground'}`}>
                  {deployState.rollbackAvailable ? 'Disponível' : 'Indisponível'}
                </div>
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
                        check.status === 'pass'
                          ? 'text-success'
                          : check.status === 'warn'
                            ? 'text-warning'
                            : 'text-destructive'
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

      {/* ═══ TIER 8: DNS REPLAY SIMULATION ═══ */}
      <NocDeploySimulation
        listeners={
          safeV2.length > 0
            ? safeV2.map(inst => ({
                name: inst.instance_name || `resolver-${inst.id}`,
                ip: inst.bind_ip || '127.0.0.1',
              }))
            : health?.instances?.length
              ? health.instances.map(inst => ({
                  name: inst.instance || 'resolver',
                  ip: inst.bind_ip || '127.0.0.1',
                }))
              : totalInstances > 0
                ? [{ name: 'resolver-local', ip: '127.0.0.1' }]
                : []
        }
      />

      {/* ═══ TIER 9: COMMAND CONSOLE ═══ */}
      <NocQuickActions />
    </div>
  );
}
