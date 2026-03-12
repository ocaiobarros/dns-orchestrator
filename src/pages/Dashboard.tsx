import { Activity, Clock, Globe, Server, Zap, AlertTriangle, Timer } from 'lucide-react';
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
    queryFn: async () => { const r = await api.getEvents(undefined, 5); if (!r.success) throw new Error(r.error!); return r.data; },
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
  const unavailableSub = dnsMetricsStatus === 'privilege_limited' ? 'Sem privilégio' : 'Indisponível';

  return (
    <div className="space-y-4">
      {/* Status Banner */}
      <NocStatusBanner
        allHealthy={allRunning && failedCount === 0}
        failedCount={failedCount}
        totalInstances={totalInstances}
        onReconcile={() => reconcileMutation.mutate()}
        reconciling={reconciling}
      />

      {/* Privilege warning */}
      {!dnsMetricsAvailable && dnsMetricsStatus === 'privilege_limited' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs bg-warning/10 text-warning border border-warning/20 animate-slide-in-up">
          <AlertTriangle size={14} />
          <span>Métricas DNS limitadas por privilégio — ative o modelo de execução privilegiada para dados reais</span>
        </div>
      )}

      {/* Core Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <NocMetricCard label="Resolvers" value={`${healthyCount}/${totalInstances}`} sub={failedCount > 0 ? 'Degradado' : 'Saudáveis'} icon={<Globe size={16} />} accent="primary" />
        <NocMetricCard label="Em Rotação" value={`${inRotation}/${totalInstances}`} sub="DNAT ativo" icon={<Zap size={16} />} accent="accent" />
        <NocMetricCard label="Total Queries" value={dnsMetricsAvailable ? totalQps.toLocaleString() : '—'} sub={dnsMetricsAvailable ? 'Acumulado' : unavailableSub} icon={<Activity size={16} />} accent="primary" />
        <NocMetricCard label="Cache Hit" value={dnsMetricsAvailable ? `${avgCacheHit}%` : '—'} sub={dnsMetricsAvailable ? 'Média geral' : unavailableSub} icon={<Server size={16} />} accent="accent" />
        <NocMetricCard label="Latência" value={dnsMetricsAvailable ? `${avgLatency}ms` : '—'} sub={dnsMetricsAvailable ? 'Média DNS' : unavailableSub} icon={<Timer size={16} />} accent={dnsMetricsAvailable && Number(avgLatency) > 50 ? 'warning' : 'primary'} />
        <NocMetricCard label="Uptime" value={sysInfo?.uptime ?? '—'} sub="Sistema" icon={<Clock size={16} />} accent="primary" />
      </div>

      {/* Reconciliation result */}
      {reconcileMutation.data && (
        <div className="noc-card border-l-2 border-l-primary animate-slide-in-up">
          <div className="text-sm">
            <span className="font-medium">Reconciliação:</span>{' '}
            <span className="font-mono">{reconcileMutation.data.instances_checked ?? 0} verificadas</span>{' · '}
            <span className="font-mono text-destructive">{reconcileMutation.data.instances_failed ?? 0} falhas</span>{' · '}
            <span className="font-mono">{reconcileMutation.data.backends_removed ?? 0} removidas</span>{' · '}
            <span className="font-mono text-success">{reconcileMutation.data.backends_restored ?? 0} restauradas</span>
          </div>
        </div>
      )}

      {/* Instance State Table */}
      <NocInstanceTable instances={safeV2} />

      {/* Two-column: Health + System Health sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <NocHealthPanel health={health} />
        </div>
        <NocSystemHealth services={safeServices} dnsHealthy={healthyCount === totalInstances && totalInstances > 0} networkOk={allRunning} />
      </div>

      {/* Two-column: Events + Services */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <NocEventsTimeline events={eventItems} />
        <NocServicesPanel services={safeServices} />
      </div>

      {/* System Info */}
      <NocSystemInfo sysInfo={sysInfo} />

      {/* Quick Actions */}
      <NocQuickActions />
    </div>
  );
}
