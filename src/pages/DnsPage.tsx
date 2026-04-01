import { useState, lazy, Suspense, useEffect, useMemo } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useTelemetry, useTelemetryHistory } from '@/lib/hooks';

const DnsTimeSeriesCharts = lazy(() => import('@/components/DnsTimeSeriesCharts'));
const DnsTopDomains = lazy(() => import('@/components/DnsTopDomains'));

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

const ChartGridSkeleton = () => (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    {[0, 1].map(i => (
      <div key={i} className="noc-panel">
        <div className="noc-panel-header"><div className="h-3 w-32 bg-muted rounded animate-pulse" /></div>
        <div className="h-[250px] flex items-center justify-center">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    ))}
  </div>
);

export default function DnsPage() {
  const { data: telemetry, isLoading, error } = useTelemetry();
  const { data: historyData } = useTelemetryHistory();

  // Idle prefetch
  useEffect(() => {
    const id = requestIdleCallback?.(() => {
      import('@/components/DnsTimeSeriesCharts');
      import('@/components/DnsTopDomains');
    }) ?? setTimeout(() => {
      import('@/components/DnsTimeSeriesCharts');
      import('@/components/DnsTopDomains');
    }, 2000);
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id as number);
      else clearTimeout(id as number);
    };
  }, []);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const collectorOk = telemetry?.health?.collector === 'ok';
  const resolver = telemetry?.resolver ?? {};
  const backends = Array.isArray(telemetry?.backends) ? telemetry.backends : [];
  const topDomains = Array.isArray(telemetry?.top_domains) ? telemetry.top_domains : [];
  const queryAnalytics = telemetry?.query_analytics ?? {};
  const topDomainsFromAnalytics = Array.isArray(queryAnalytics?.top_domains) ? queryAnalytics.top_domains : [];
  const topClients = Array.isArray(queryAnalytics?.top_clients) ? queryAnalytics.top_clients : [];
  const recentQueries = Array.isArray(queryAnalytics?.recent_queries) ? queryAnalytics.recent_queries : [];
  const telemetryConnected = collectorOk && safeNum(resolver.instances_live) > 0;

  const totalQueries = safeNum(resolver.total_queries);
  const cacheHitRatio = safeNum(resolver.cache_hit_ratio);
  const avgLatency = safeNum(resolver.avg_latency_ms);
  const totalServfail = safeNum(resolver.servfail);
  const qps = safeNum(resolver.qps);

  // Build chart data from history endpoint (real time-series)
  const chartData = useMemo(() => {
    const history = Array.isArray(historyData) ? historyData : [];
    if (history.length === 0) return [];
    return history.map((p: any) => {
      const ts = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
      return {
        time: ts,
        qps: safeNum(p.qps),
        latency: safeNum(p.latency_ms),
        servfail: safeNum(p.servfail),
        nxdomain: safeNum(p.nxdomain),
        hitRatio: safeNum(p.cache_hit_ratio),
      };
    });
  }, [historyData]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">DNS</h1>
          <p className="text-sm text-muted-foreground">Métricas reais via collector (unbound-control + nftables)</p>
        </div>
        {!collectorOk && (
          <span className="px-2 py-1 text-xs rounded border bg-destructive/10 text-destructive border-destructive/20 font-mono">
            Collector inativo
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Queries" value={telemetryConnected ? totalQueries.toLocaleString() : '—'} sub={telemetryConnected ? `QPS: ${qps}` : 'Sem dados'} />
        <MetricCard label="Cache Hit Ratio" value={telemetryConnected ? `${cacheHitRatio}%` : '—'} />
        <MetricCard label="Latência Média" value={telemetryConnected ? `${avgLatency}ms` : '—'} />
        <MetricCard label="SERVFAIL Total" value={telemetryConnected ? totalServfail.toLocaleString() : '—'} />
      </div>

      {/* Per-instance table */}
      {backends.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Instâncias (Fonte: unbound-control)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Instância</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Queries</th>
                  <th className="pb-2 font-medium text-right">Cache Hit</th>
                  <th className="pb-2 font-medium text-right">Latência</th>
                  <th className="pb-2 font-medium text-right">SERVFAIL</th>
                  <th className="pb-2 font-medium">Fonte</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {backends.map((b: any) => (
                  <tr key={b.name} className="border-b border-border last:border-0">
                    <td className="py-2 text-primary">{b.name} <span className="text-muted-foreground/50 text-xs">{b.ip}</span></td>
                    <td className="py-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        b.healthy ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
                      }`}>{b.healthy ? 'live' : 'down'}</span>
                    </td>
                    <td className="py-2 text-right">{safeNum(b.resolver?.total_queries).toLocaleString()}</td>
                    <td className="py-2 text-right text-success">{safeNum(b.resolver?.cache_hit_ratio)}%</td>
                    <td className="py-2 text-right">{safeNum(b.resolver?.recursion_avg_ms)}ms</td>
                    <td className="py-2 text-right">{safeNum(b.resolver?.servfail)}</td>
                    <td className="py-2 text-xs text-muted-foreground">{b.resolver?.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!telemetryConnected && (
        <div className="noc-panel">
          <div className="p-8 text-center space-y-2">
            <AlertTriangle size={24} className="text-warning mx-auto" />
            <div className="text-sm font-medium">
              {collectorOk ? 'Instâncias Unbound não reportando' : 'Collector de telemetria não ativo'}
            </div>
            <div className="text-xs text-muted-foreground">
              {collectorOk
                ? 'O collector está rodando mas nenhuma instância Unbound respondeu a unbound-control stats_noreset.'
                : 'Habilite o collector: systemctl enable --now dns-control-collector.timer'}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              <strong>Nota:</strong> Valores zerados NÃO são exibidos para evitar diagnósticos incorretos.
            </div>
          </div>
        </div>
      )}

      <Suspense fallback={<ChartGridSkeleton />}>
        {chartData.length > 0 ? (
          <DnsTimeSeriesCharts chartData={chartData} />
        ) : telemetryConnected ? (
          <div className="noc-panel">
            <div className="p-8 text-center space-y-2">
              <Clock size={20} className="text-muted-foreground mx-auto" />
              <div className="text-sm font-medium text-muted-foreground">Aguardando dados históricos…</div>
              <div className="text-xs text-muted-foreground/60">
                O collector está ativo. Os gráficos aparecerão após algumas coletas (~30s).
              </div>
            </div>
          </div>
        ) : null}
      </Suspense>

      {(topDomains.length > 0 || topDomainsFromAnalytics.length > 0) && (
        <Suspense fallback={<ChartGridSkeleton />}>
          <DnsTopDomains topDomains={topDomains.length > 0 ? topDomains : topDomainsFromAnalytics} />
        </Suspense>
      )}

      {/* Top Clients */}
      {topClients.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Top Clientes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium text-right">Queries</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {topClients.map((c: any) => (
                  <tr key={c.client || c.ip} className="border-b border-border last:border-0">
                    <td className="py-2 text-primary">{c.client || c.ip}</td>
                    <td className="py-2 text-right">{safeNum(c.count || c.queries).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Recent Queries */}
      {recentQueries.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Consultas Recentes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Domínio</th>
                  <th className="pb-2 font-medium">Cliente</th>
                  <th className="pb-2 font-medium">Tipo</th>
                  <th className="pb-2 font-medium">Hora</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {recentQueries.slice(0, 50).map((q: any, i: number) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2 text-primary">{(q.domain || '').replace(/\.$/, '')}</td>
                    <td className="py-2 text-muted-foreground">{q.client || q.client_ip || '—'}</td>
                    <td className="py-2">{q.qtype || q.type || '—'}</td>
                    <td className="py-2 text-muted-foreground text-xs">{q.time || q.timestamp || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
