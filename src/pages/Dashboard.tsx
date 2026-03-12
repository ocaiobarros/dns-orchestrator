import { Activity, Clock, Globe, Zap, AlertTriangle, Timer, Database } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import { motion } from 'framer-motion';

import NocHeroBar from '@/components/noc/NocHeroBar';
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
    queryFn: async () => { const r = await api.getEvents(undefined, 8); if (!r.success) throw new Error(r.error!); return r.data; },
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
  const unavailSub = dnsStatus === 'privilege_limited' ? 'Privilege limited' : 'Unavailable';

  const metricCards = [
    { label: 'Resolvers', value: `${healthyCount}/${totalInstances}`, sub: failedCount > 0 ? 'DEGRADED' : 'HEALTHY', icon: <Globe size={18} />, accent: 'primary' as const },
    { label: 'DNAT Active', value: `${inRotation}/${totalInstances}`, sub: 'In rotation', icon: <Zap size={18} />, accent: 'accent' as const },
    { label: 'Total Queries', value: dnsAvail ? totalQps.toLocaleString() : '—', sub: dnsAvail ? 'Accumulated' : unavailSub, icon: <Activity size={18} />, accent: 'primary' as const, unavailable: !dnsAvail },
    { label: 'Cache Hit', value: dnsAvail ? `${avgCacheHit}%` : '—', sub: dnsAvail ? 'Average' : unavailSub, icon: <Database size={18} />, accent: 'accent' as const, unavailable: !dnsAvail },
    { label: 'Latency', value: dnsAvail ? `${avgLatency}ms` : '—', sub: dnsAvail ? 'DNS avg' : unavailSub, icon: <Timer size={18} />, accent: (dnsAvail && Number(avgLatency) > 50 ? 'warning' : 'primary') as any, unavailable: !dnsAvail },
    { label: 'Uptime', value: sysInfo?.uptime ?? '—', sub: 'System', icon: <Clock size={18} />, accent: 'primary' as const },
  ];

  return (
    <div className="space-y-4">
      {/* ═══ TIER 1: HERO BAR ═══ */}
      <NocHeroBar
        allHealthy={allRunning && failedCount === 0}
        failedCount={failedCount}
        totalInstances={totalInstances}
        healthyCount={healthyCount}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconciling}
      />

      {/* Privilege warning */}
      {!dnsAvail && dnsStatus === 'privilege_limited' && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[10px] font-mono bg-warning/4 text-warning/70 border border-warning/10"
        >
          <AlertTriangle size={12} />
          DNS metrics limited — Enable privileged execution for real-time telemetry
        </motion.div>
      )}

      {/* ═══ TIER 2: KPI STRIP ═══ */}
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

      {/* ═══ TIER 3: TOPOLOGY — CENTERPIECE ═══ */}
      <NocTopologyPanel health={health} />

      {/* ═══ TIER 4: INSTANCE TABLE ═══ */}
      <NocInstanceTable instances={safeV2} />

      {/* ═══ TIER 5: HEALTH MATRIX + SERVICES ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NocHealthMatrix
          services={safeServices}
          dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
          networkOk={allRunning}
        />
        <NocResolverPanel services={safeServices} />
      </div>

      {/* ═══ TIER 6: EVENTS + SYSTEM INFO ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <NocEventsTimeline events={eventItems} />
        <NocSystemInfoGrid sysInfo={sysInfo} />
      </div>

      {/* ═══ TIER 7: COMMAND CONSOLE ═══ */}
      <NocQuickActions />
    </div>
  );
}
