import { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import MetricCard from '@/components/MetricCard';
import { generateDnsMetrics, mockTopDomains } from '@/lib/mock-data';

export default function DnsPage() {
  const [selectedInstance, setSelectedInstance] = useState('all');
  const allMetrics = useMemo(() => generateDnsMetrics(6), []);

  const filteredMetrics = useMemo(() => {
    if (selectedInstance === 'all') return allMetrics;
    return allMetrics.filter(m => m.instance === selectedInstance);
  }, [allMetrics, selectedInstance]);

  // Aggregate by timestamp for charts
  const chartData = useMemo(() => {
    const byTs = new Map<string, { ts: string; qps: number; hits: number; misses: number; latency: number; count: number }>();
    filteredMetrics.forEach(m => {
      const key = m.timestamp.slice(0, 16);
      const existing = byTs.get(key) || { ts: key, qps: 0, hits: 0, misses: 0, latency: 0, count: 0 };
      existing.qps += m.qps;
      existing.hits += m.cacheHits;
      existing.misses += m.cacheMisses;
      existing.latency += m.avgLatency;
      existing.count += 1;
      byTs.set(key, existing);
    });
    return Array.from(byTs.values()).map(d => ({
      ...d,
      latency: +(d.latency / d.count).toFixed(1),
      hitRatio: d.hits + d.misses > 0 ? +((d.hits / (d.hits + d.misses)) * 100).toFixed(1) : 0,
      time: d.ts.slice(11, 16),
    }));
  }, [filteredMetrics]);

  const totalQps = chartData.length > 0 ? chartData[chartData.length - 1].qps : 0;
  const avgHitRatio = chartData.length > 0
    ? (chartData.reduce((a, b) => a + b.hitRatio, 0) / chartData.length).toFixed(1)
    : '0';
  const avgLatency = chartData.length > 0
    ? (chartData.reduce((a, b) => a + b.latency, 0) / chartData.length).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">DNS</h1>
          <p className="text-sm text-muted-foreground">Métricas e análise do Unbound</p>
        </div>
        <select
          value={selectedInstance}
          onChange={e => setSelectedInstance(e.target.value)}
          className="px-3 py-1.5 text-sm bg-secondary text-secondary-foreground border border-border rounded font-mono"
        >
          <option value="all">Todas instâncias</option>
          {['unbound01', 'unbound02', 'unbound03', 'unbound04'].map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="QPS Atual" value={totalQps.toLocaleString()} />
        <MetricCard label="Cache Hit Ratio" value={`${avgHitRatio}%`} />
        <MetricCard label="Latência Média" value={`${avgLatency}ms`} />
        <MetricCard label="SERVFAIL/5min" value="12" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="noc-panel">
          <div className="noc-panel-header">QPS ao Longo do Tempo</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 20%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: 'hsl(210 20% 90%)' }}
              />
              <Area type="monotone" dataKey="qps" stroke="hsl(160 70% 45%)" fill="hsl(160 70% 45% / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="noc-panel">
          <div className="noc-panel-header">Cache Hit Ratio (%)</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 20%)" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="hitRatio" stroke="hsl(200 80% 55%)" fill="hsl(200 80% 55% / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Top Domínios Consultados</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={mockTopDomains} layout="vertical" margin={{ left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 15% 20%)" />
            <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
            <YAxis dataKey="domain" type="category" tick={{ fontSize: 11, fill: 'hsl(215 15% 55%)' }} width={100} />
            <Tooltip
              contentStyle={{ backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 }}
            />
            <Bar dataKey="queries" fill="hsl(160 70% 45%)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
