import { Activity, Clock, Globe, Zap, AlertTriangle, Timer, Database, Shield } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import { motion } from 'framer-motion';

import NocHeroBar from '@/components/noc/NocHeroBar';
import NocHealthSummary from '@/components/noc/NocHealthSummary';
import NocMetricStrip from '@/components/noc/NocMetricStrip';
import NocInstanceTable from '@/components/noc/NocInstanceTable';
import NocTopologyPanel from '@/components/noc/NocTopologyPanel';
import NocEventsTimeline from '@/components/noc/NocEventsTimeline';
import NocResolverPanel from '@/components/noc/NocResolverPanel';
import NocHealthMatrix from '@/components/noc/NocHealthMatrix';
import NocSystemInfoGrid from '@/components/noc/NocSystemInfoGrid';
import NocQuickActions from '@/components/noc/NocQuickActions';

export default function Dashboard() {
  const { data: sysInfo, isLoading: sysLoading, error: sysError } = useSystemInfo();
  const { data: services, isLoading: svcLoading } = useServices();
  const { data: instanceStats } = useInstanceStats();
  const { data: health } = useInstanceHealth();
  const qc = useQueryClient();
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

  const isLoading = sysLoading && svcLoading;

  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  const allRunning = safeServices.every(s => s.status === 'running');
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
  const activeServicesCount = safeServices.filter(s => s.status === 'running').length;
  const inactiveServicesCount = safeServices.filter(s => s.status === 'stopped').length;
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

      {/* ═══ TIER 4: TOPOLOGY — Live operational surface ═══ */}
      <NocTopologyPanel
        health={health}
        vipConfigured={vipConfigured}
        vipAddress={vipAddress}
        dnsAvailable={dnsAvail}
      />

      {/* ═══ TIER 5: INSTANCE TABLE ═══ */}
      <NocInstanceTable instances={safeV2} />

      {/* ═══ TIER 6: HEALTH MATRIX + SERVICES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NocHealthMatrix
          services={safeServices}
          dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
          networkOk={allRunning}
          dnsAvailable={dnsAvail}
          privilegeLimited={dnsStatus === 'privilege_limited'}
        />
        <NocResolverPanel services={safeServices} />
      </div>

      {/* ═══ TIER 7: EVENTS + SYSTEM INFO ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NocEventsTimeline events={eventItems} />
        <NocSystemInfoGrid sysInfo={sysInfo} />
      </div>

      {/* ═══ TIER 8: COMMAND CONSOLE ═══ */}
      <NocQuickActions />
    </div>
  );
}
