import { useState } from 'react';
import { BarChart3, Activity, Timer, AlertTriangle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { LoadingState } from '@/components/DataStates';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function MetricsPage() {
  const [selectedMetric, setSelectedMetric] = useState('dns_queries_total');

  const { data: metrics, isLoading } = useQuery({
    queryKey: ['v2-metrics'],
    queryFn: async () => {
      const r = await api.getV2Metrics();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 10000,
  });

  const { data: instanceStats } = useQuery({
    queryKey: ['dns', 'instances'],
    queryFn: async () => {
      const r = await api.getInstanceStats();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
  });

  if (isLoading) return <LoadingState />;

  // Group metrics by instance
  const byInstance: Record<string, Record<string, number>> = {};
  for (const m of (metrics ?? [])) {
    if (!byInstance[m.instance_name]) byInstance[m.instance_name] = {};
    byInstance[m.instance_name][m.metric_name] = m.metric_value;
  }

  const instanceNames = Object.keys(byInstance);
  const totalQueries = instanceNames.reduce((sum, n) => sum + (byInstance[n]?.dns_queries_total ?? 0), 0);
  const avgHitRatio = instanceNames.length > 0
    ? instanceNames.reduce((sum, n) => sum + (byInstance[n]?.dns_cache_hit_ratio ?? 0), 0) / instanceNames.length
    : 0;
  const avgLatency = instanceNames.length > 0
    ? instanceNames.reduce((sum, n) => sum + (byInstance[n]?.dns_latency_ms ?? 0), 0) / instanceNames.length
    : 0;
  const totalServfail = instanceNames.reduce((sum, n) => sum + (byInstance[n]?.dns_servfail_total ?? 0), 0);

  const metricOptions = [
    { key: 'dns_queries_total', label: 'Total Queries' },
    { key: 'dns_cache_hit_ratio', label: 'Cache Hit Ratio' },
    { key: 'dns_latency_ms', label: 'Latência (ms)' },
    { key: 'dns_servfail_total', label: 'SERVFAIL' },
    { key: 'dns_nxdomain_total', label: 'NXDOMAIN' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Métricas DNS</h1>
        <p className="text-sm text-muted-foreground">Dados reais via unbound-control stats_noreset</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Queries" value={totalQueries.toLocaleString()} sub="Todas as instâncias" icon={<BarChart3 size={16} />} />
        <MetricCard label="Cache Hit" value={`${(avgHitRatio * 100).toFixed(1)}%`} sub="Média geral" icon={<Activity size={16} />} />
        <MetricCard label="Latência" value={`${avgLatency.toFixed(1)}ms`} sub="Recursion avg" icon={<Timer size={16} />} />
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

      {/* Per-instance table */}
      <div className="noc-panel">
        <div className="noc-panel-header">Métricas por Instância</div>
        <div className="overflow-x-auto">
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
                    <td className="py-2 pr-4 text-right font-mono">{(m.dns_queries_total ?? 0).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right font-mono text-emerald-500">{((m.dns_cache_hit_ratio ?? 0) * 100).toFixed(1)}%</td>
                    <td className="py-2 pr-4 text-right font-mono">{(m.dns_latency_ms ?? 0).toFixed(1)}ms</td>
                    <td className="py-2 pr-4 text-right font-mono">{(m.dns_servfail_total ?? 0).toLocaleString()}</td>
                    <td className="py-2 pr-4 text-right font-mono">{(m.dns_nxdomain_total ?? 0).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Instance stats from v1 (mock in preview) */}
      {instanceStats && instanceStats.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Visão de Instâncias (Live Stats)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {instanceStats.map(inst => (
              <div key={inst.instance} className="p-3 rounded border border-border bg-secondary/20">
                <div className="font-mono text-sm font-medium mb-2">{inst.instance}</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground block">Queries</span>
                    <span className="font-mono">{inst.totalQueries.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Cache Hit</span>
                    <span className="font-mono text-emerald-500">{inst.cacheHitRatio}%</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Latência</span>
                    <span className="font-mono">{inst.avgLatencyMs}ms</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
