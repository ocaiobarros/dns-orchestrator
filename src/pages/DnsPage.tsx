import { useMemo, useState, lazy, Suspense } from 'react';
import MetricCard from '@/components/MetricCard';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useDnsMetrics, useTopDomains, useInstanceStats } from '@/lib/hooks';
import { getInstanceName, getInstanceQueries, getInstanceCacheHit, getInstanceLatency } from '@/lib/types';

const DnsCharts = lazy(() => import('@/components/DnsCharts'));

const ChartSkeleton = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {[0, 1].map(i => (
      <div key={i} className="noc-panel">
        <div className="noc-panel-header">
          <div className="h-3 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="h-[250px] flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    ))}
  </div>
);

export default function DnsPage() {
  const [selectedInstance, setSelectedInstance] = useState<string | undefined>(undefined);
  const [hours, setHours] = useState(6);
  const { data: allMetrics, isLoading, error } = useDnsMetrics(hours, selectedInstance);
  const { data: topDomains } = useTopDomains(10);
  const { data: instanceStats } = useInstanceStats();

  const chartData = useMemo(() => {
    if (!Array.isArray(allMetrics)) return [];

    const asNumber = (value: unknown): number => {
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      if (typeof value === 'string') {
        const parsed = Number(value.replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const byTs = new Map<string, { ts: string; qps: number; hits: number; misses: number; latency: number; servfail: number; nxdomain: number; count: number }>();
    allMetrics.forEach(m => {
      if (!m?.timestamp) return;
      const key = m.timestamp.slice(0, 16);
      const existing = byTs.get(key) || { ts: key, qps: 0, hits: 0, misses: 0, latency: 0, servfail: 0, nxdomain: 0, count: 0 };
      existing.qps += asNumber(m.qps);
      existing.hits += asNumber(m.cacheHits);
      existing.misses += asNumber(m.cacheMisses);
      existing.latency += asNumber(m.avgLatencyMs);
      existing.servfail += asNumber(m.servfail);
      existing.nxdomain += asNumber(m.nxdomain);
      existing.count += 1;
      byTs.set(key, existing);
    });

    return Array.from(byTs.values()).map(d => ({
      ...d,
      latency: d.count > 0 ? +(d.latency / d.count).toFixed(1) : 0,
      hitRatio: d.hits + d.misses > 0 ? +((d.hits / (d.hits + d.misses)) * 100).toFixed(1) : 0,
      time: d.ts.slice(11, 16),
    }));
  }, [allMetrics]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const lastPoint = chartData[chartData.length - 1];
  const avgHitRatio = chartData.length > 0 ? (chartData.reduce((a, b) => a + b.hitRatio, 0) / chartData.length).toFixed(1) : '0';
  const avgLatency = chartData.length > 0 ? (chartData.reduce((a, b) => a + b.latency, 0) / chartData.length).toFixed(1) : '0';
  const totalServfail = chartData.reduce((a, b) => a + b.servfail, 0);

  const safeInstanceStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">DNS</h1>
          <p className="text-sm text-muted-foreground">Métricas e análise do Unbound</p>
        </div>
        <div className="flex gap-2">
          <select value={hours} onChange={e => setHours(Number(e.target.value))}
            className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground border border-border rounded font-mono">
            <option value={1}>1h</option>
            <option value={6}>6h</option>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
          </select>
          <select value={selectedInstance || 'all'} onChange={e => setSelectedInstance(e.target.value === 'all' ? undefined : e.target.value)}
            className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground border border-border rounded font-mono">
            <option value="all">Todas instâncias</option>
            {safeInstanceStats.map((i, idx) => {
              const name = getInstanceName(i);
              return <option key={`${name}-${idx}`} value={name}>{name}</option>;
            })}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="QPS Atual" value={lastPoint?.qps?.toLocaleString() ?? '0'} />
        <MetricCard label="Cache Hit Ratio" value={`${avgHitRatio}%`} />
        <MetricCard label="Latência Média" value={`${avgLatency}ms`} />
        <MetricCard label="SERVFAIL Total" value={totalServfail.toLocaleString()} />
      </div>

      {safeInstanceStats.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Instâncias</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Instância</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Queries</th>
                  <th className="pb-2 font-medium text-right">Cache Hit</th>
                  <th className="pb-2 font-medium text-right">Latência</th>
                  <th className="pb-2 font-medium">Uptime</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {safeInstanceStats.map(inst => {
                  const name = getInstanceName(inst);
                  const queries = getInstanceQueries(inst);
                  const cacheHit = getInstanceCacheHit(inst);
                  const latency = getInstanceLatency(inst);
                  const status = inst.status ?? 'unknown';
                  return (
                    <tr key={name} className="border-b border-border last:border-0">
                      <td className="py-2 text-primary">{name}</td>
                      <td className="py-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          status === 'running' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
                        }`}>{status}</span>
                      </td>
                      <td className="py-2 text-right">{queries.toLocaleString()}</td>
                      <td className="py-2 text-right">{cacheHit > 0 ? `${cacheHit}%` : '—'}</td>
                      <td className="py-2 text-right">{latency > 0 ? `${latency}ms` : '—'}</td>
                      <td className="py-2 text-muted-foreground">{inst.uptime || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Suspense fallback={<ChartSkeleton />}>
        <DnsCharts chartData={chartData} topDomains={topDomains} />
      </Suspense>
    </div>
  );
}
