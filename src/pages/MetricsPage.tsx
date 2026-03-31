import { useState } from 'react';
import { BarChart3, Activity, Timer, AlertTriangle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { LoadingState } from '@/components/DataStates';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export default function MetricsPage() {
  const [selectedMetric, setSelectedMetric] = useState('dns_queries_total');

  const { data: rawMetrics, isLoading } = useQuery({
    queryKey: ['v2-metrics'],
    queryFn: async () => {
      const r = await api.getV2Metrics();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 10000,
  });

  const { data: rawInstanceStats } = useQuery({
    queryKey: ['dns', 'instances'],
    queryFn: async () => {
      const r = await api.getInstanceStats();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
  });

  if (isLoading) return <LoadingState />;

  // Normalize metrics: accept [], { items: [] }, { data: [] }, etc.
  const metrics: Array<Record<string, unknown>> = (() => {
    if (Array.isArray(rawMetrics)) return rawMetrics;
    if (rawMetrics && typeof rawMetrics === 'object') {
      const r = rawMetrics as Record<string, unknown>;
      if (Array.isArray(r.items)) return r.items;
      if (Array.isArray(r.data)) return r.data;
      if (Array.isArray(r.samples)) return r.samples;
    }
    return [];
  })();

  // Normalize instance stats
  const instanceStats = Array.isArray(rawInstanceStats) ? rawInstanceStats : [] as any[];

  // Group metrics by instance
  const byInstance: Record<string, Record<string, number>> = {};
  for (const m of metrics) {
    const instName = String(m.instance_name ?? m.instanceName ?? m.instance ?? 'unknown');
    const metricName = String(m.metric_name ?? m.metricName ?? m.name ?? '');
    const metricValue = safeNum(m.metric_value ?? m.metricValue ?? m.value);
    if (!byInstance[instName]) byInstance[instName] = {};
    if (metricName) byInstance[instName][metricName] = metricValue;
  }

  // If no collected metrics, synthesize from live instance stats
  const useLiveFallback = Object.keys(byInstance).length === 0 && instanceStats.length > 0;
  if (useLiveFallback) {
    for (const inst of instanceStats) {
      const name = String(inst.instance ?? inst.name ?? 'unknown');
      byInstance[name] = {
        dns_queries_total: safeNum(inst.totalQueries ?? inst.queries_total),
        dns_cache_hit_ratio: (() => {
          const ratio = safeNum(inst.cacheHitRatio ?? inst.cache_hit_ratio);
          return ratio > 1 ? ratio / 100 : ratio;  // normalize to 0-1
        })(),
        dns_latency_ms: safeNum(inst.avgLatencyMs ?? inst.avg_latency_ms ?? inst.recursionTimeAvg),
        dns_servfail_total: safeNum(inst.servfail),
        dns_nxdomain_total: safeNum(inst.nxdomain),
        dns_cache_hits: safeNum(inst.cacheHits ?? inst.cache_hits),
        dns_cache_misses: safeNum(inst.cacheMisses ?? inst.cache_misses),
      };
    }
  }

  const instanceNames = Object.keys(byInstance);
  const totalQueries = instanceNames.reduce((sum, n) => sum + safeNum(byInstance[n]?.dns_queries_total), 0);
  const avgHitRatio = instanceNames.length > 0
    ? instanceNames.reduce((sum, n) => sum + safeNum(byInstance[n]?.dns_cache_hit_ratio), 0) / instanceNames.length
    : 0;
  const avgLatency = instanceNames.length > 0
    ? instanceNames.reduce((sum, n) => sum + safeNum(byInstance[n]?.dns_latency_ms), 0) / instanceNames.length
    : 0;
  const totalServfail = instanceNames.reduce((sum, n) => sum + safeNum(byInstance[n]?.dns_servfail_total), 0);

  const metricOptions = [
    { key: 'dns_queries_total', label: 'Total Queries' },
    { key: 'dns_cache_hit_ratio', label: 'Cache Hit Ratio' },
    { key: 'dns_latency_ms', label: 'Latência (ms)' },
    { key: 'dns_servfail_total', label: 'SERVFAIL' },
    { key: 'dns_nxdomain_total', label: 'NXDOMAIN' },
  ];

  const hasMetrics = metrics.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Métricas DNS</h1>
        <p className="text-sm text-muted-foreground">Dados reais via unbound-control stats_noreset</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Queries" value={totalQueries.toLocaleString()} sub="Todas as instâncias" icon={<BarChart3 size={16} />} />
        <MetricCard label="Cache Hit" value={`${(safeNum(avgHitRatio) * 100).toFixed(1)}%`} sub="Média geral" icon={<Activity size={16} />} />
        <MetricCard label="Latência" value={`${safeNum(avgLatency).toFixed(1)}ms`} sub="Recursion avg" icon={<Timer size={16} />} />
        <MetricCard label="SERVFAIL" value={totalServfail.toLocaleString()} sub="Total" icon={<AlertTriangle size={16} />} />
      </div>

      {/* Metric selector */}
      <div className="flex flex-wrap gap-1">
        {metricOptions.map(m => (
          <button
            key={m.key}
            onClick={() => setSelectedMetric(m.key)}
            className={`px-3 py-1.5 text-xs rounded border transition-colors ${
              selectedMetric === m.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Per-instance metrics table */}
      <div className="noc-panel">
        <div className="noc-panel-header">Métricas por Instância</div>
        <div className="overflow-x-auto">
          {!hasMetrics ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Nenhuma métrica coletada ainda. O collector pode não ter executado ou as instâncias Unbound não estão reportando.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4 font-medium">Instância</th>
                  <th className="py-2 pr-4 font-medium text-right">Queries</th>
                  <th className="py-2 pr-4 font-medium text-right">Cache Hit</th>
                  <th className="py-2 pr-4 font-medium text-right">Latência</th>
                  <th className="py-2 pr-4 font-medium text-right">SERVFAIL</th>
                  <th className="py-2 pr-4 font-medium text-right">NXDOMAIN</th>
                </tr>
              </thead>
              <tbody>
                {instanceNames.map(name => {
                  const m = byInstance[name];
                  return (
                    <tr key={name} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 font-mono">{name}</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(m.dns_queries_total).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right font-mono text-emerald-500">{(safeNum(m.dns_cache_hit_ratio) * 100).toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(m.dns_latency_ms).toFixed(1)}ms</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(m.dns_servfail_total).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(m.dns_nxdomain_total).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Instance stats from /dns/instances */}
      {instanceStats.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Visão de Instâncias (Live Stats)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {instanceStats.map((inst, idx) => {
              const name = String(inst.instance ?? inst.name ?? `inst-${idx}`);
              const queries = safeNum(inst.totalQueries ?? inst.queries_total ?? inst.total_queries);
              const cacheHit = safeNum(inst.cacheHitRatio ?? inst.cache_hit_ratio ?? inst.cache_entries);
              const latency = safeNum(inst.avgLatencyMs ?? inst.avg_latency_ms ?? inst.latency);
              return (
                <div key={name} className="p-3 rounded border border-border bg-secondary/20">
                  <div className="font-mono text-sm font-medium mb-2">{name}</div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground block">Queries</span>
                      <span className="font-mono">{queries.toLocaleString()}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Cache</span>
                      <span className="font-mono text-emerald-500">{cacheHit}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Latência</span>
                      <span className="font-mono">{latency}ms</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
