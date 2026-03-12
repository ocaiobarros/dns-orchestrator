import { Activity, Clock, Globe, Server, Zap, AlertTriangle, Timer, Database } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency } from '@/lib/types';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';

import NocStatusBanner from '@/components/noc/NocStatusBanner';
import NocMetricCard from '@/components/noc/NocMetricCard';
import NocInstanceTable from '@/components/noc/NocInstanceTable';
import NocHealthPanel from '@/components/noc/NocHealthPanel';
import NocEventsTimeline from '@/components/noc/NocEventsTimeline';
import NocServicesPanel from '@/components/noc/NocServicesPanel';
import NocSystemInfo from '@/components/noc/NocSystemInfo';
import NocQuickActions from '@/components/noc/NocQuickActions';
import NocSystemHealth from '@/components/noc/NocSystemHealth';

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

  if (sysLoading && svcLoading) return <LoadingState />;
  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  const allRunning = safeServices.every(s => s.status === 'running');
  const dnsMetricsAvailable = sysInfo?.dns_metrics_available ?? false;
  const dnsMetricsStatus = sysInfo?.dns_metrics_status ?? 'unknown';
  const dashTotalQueries = sysInfo?.total_queries ?? 0;
  const dashCacheHit = sysInfo?.cache_hit_ratio ?? 0;
  const dashLatency = sysInfo?.latency_ms ?? 0;

  const totalQps = dnsMetricsAvailable ? dashTotalQueries : safeStats.reduce((a, b) => a + getInstanceQueries(b), 0);
  const avgCacheHit = dnsMetricsAvailable ? dashCacheHit.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceCacheHit(b), 0) / safeStats.length).toFixed(1) : '0');
  const avgLatency = dnsMetricsAvailable ? dashLatency.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceLatency(b), 0) / safeStats.length).toFixed(1) : '0');

  const healthyCount = safeV2.length > 0
    ? safeV2.filter(i => i.current_status === 'healthy').length
    : (health?.healthy ?? 0);
  const totalInstances = safeV2.length > 0 ? safeV2.length : (health?.total ?? 0);
  const failedCount = safeV2.filter(i => i.current_status === 'failed' || i.current_status === 'withdrawn').length;
  const inRotation = safeV2.length > 0
    ? safeV2.filter(i => i.in_rotation).length
    : totalInstances;

  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);
  const unavailableSub = dnsMetricsStatus === 'privilege_limited' ? 'Privilege limited' : 'Unavailable';

  return (
    <div className="space-y-3">
      {/* ─── TIER 1: GLOBAL STATUS BANNER ─── */}
      <NocStatusBanner
        allHealthy={allRunning && failedCount === 0}
        failedCount={failedCount}
        totalInstances={totalInstances}
        healthyCount={healthyCount}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconciling}
      />

      {/* Privilege warning */}
      {!dnsMetricsAvailable && dnsMetricsStatus === 'privilege_limited' && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded text-[11px] font-mono bg-warning/8 text-warning border border-warning/20 animate-slide-in-up">
          <AlertTriangle size={13} />
          DNS METRICS LIMITED — Enable privileged execution model for real-time data
        </div>
      )}

      {/* ─── TIER 2: PRIMARY METRICS STRIP ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <NocMetricCard label="Resolvers" value={`${healthyCount}/${totalInstances}`} sub={failedCount > 0 ? 'DEGRADED' : 'HEALTHY'} icon={<Globe size={18} />} accent="primary" />
        <NocMetricCard label="DNAT Active" value={`${inRotation}/${totalInstances}`} sub="In rotation" icon={<Zap size={18} />} accent="accent" />
        <NocMetricCard label="Total Queries" value={dnsMetricsAvailable ? totalQps.toLocaleString() : '—'} sub={dnsMetricsAvailable ? 'Accumulated' : unavailableSub} icon={<Activity size={18} />} accent="primary" />
        <NocMetricCard label="Cache Hit" value={dnsMetricsAvailable ? `${avgCacheHit}%` : '—'} sub={dnsMetricsAvailable ? 'Average' : unavailableSub} icon={<Database size={18} />} accent="accent" />
        <NocMetricCard label="Latency" value={dnsMetricsAvailable ? `${avgLatency}ms` : '—'} sub={dnsMetricsAvailable ? 'DNS avg' : unavailableSub} icon={<Timer size={18} />} accent={dnsMetricsAvailable && Number(avgLatency) > 50 ? 'warning' : 'primary'} />
        <NocMetricCard label="Uptime" value={sysInfo?.uptime ?? '—'} sub="System" icon={<Clock size={18} />} accent="primary" />
      </div>

      {/* Reconciliation result flash */}
      {reconcileMutation.data && (
        <div className="noc-card animate-slide-in-up" style={{ borderLeftColor: 'hsl(var(--primary))', borderLeftWidth: 3 }}>
          <div className="noc-card-body">
            <div className="text-[12px] font-mono flex items-center gap-3 flex-wrap">
              <span className="font-bold text-foreground">RECONCILIATION</span>
              <span className="text-muted-foreground">{reconcileMutation.data.instances_checked ?? 0} checked</span>
              <span className="text-destructive font-bold">{reconcileMutation.data.instances_failed ?? 0} failed</span>
              <span className="text-muted-foreground">{reconcileMutation.data.backends_removed ?? 0} removed</span>
              <span className="text-success font-bold">{reconcileMutation.data.backends_restored ?? 0} restored</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── TIER 3: INSTANCE STATE TABLE ─── */}
      <NocInstanceTable instances={safeV2} />

      {/* ─── TIER 4: DNS HEALTH + SYSTEM HEALTH MATRIX ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <NocHealthPanel health={health} />
        </div>
        <NocSystemHealth
          services={safeServices}
          dnsHealthy={healthyCount === totalInstances && totalInstances > 0}
          networkOk={allRunning}
        />
      </div>

      {/* ─── TIER 5: EVENTS + SERVICES ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <NocEventsTimeline events={eventItems} />
        <NocServicesPanel services={safeServices} />
      </div>

      {/* ─── TIER 6: SYSTEM INFO ─── */}
      <NocSystemInfo sysInfo={sysInfo} />

      {/* ─── TIER 7: COMMAND CONSOLE ─── */}
      <NocQuickActions />
    </div>
  );
}
