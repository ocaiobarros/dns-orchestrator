import { useState } from 'react';
import { BarChart3, Activity, Timer, AlertTriangle, Search, Users, Globe, Database } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { LoadingState } from '@/components/DataStates';
import { useTelemetry, useTelemetryStatus } from '@/lib/hooks';

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MetricsPage() {
  const { data: telemetry, isLoading } = useTelemetry();
  const { data: telStatus } = useTelemetryStatus();
  const [tab, setTab] = useState<'resolver' | 'traffic' | 'domains' | 'clients'>('resolver');

  if (isLoading) return <LoadingState />;

  const collectorOk = telemetry?.health?.collector === 'ok';
  const resolver = telemetry?.resolver ?? {};
  const traffic = telemetry?.traffic ?? {};
  const backends = telemetry?.backends ?? [];
  const topDomains = telemetry?.top_domains ?? [];
  const topClients = telemetry?.top_clients ?? [];
  const recentQueries = telemetry?.recent_queries ?? [];
  const queryAnalytics = telemetry?.query_analytics ?? {};
  const collectorHealth = telemetry?.health ?? {};

  const telemetryConnected = collectorOk && safeNum(resolver.instances_live) > 0;
  const totalQueries = safeNum(resolver.total_queries);
  const cacheHitRatio = safeNum(resolver.cache_hit_ratio);
  const avgLatency = safeNum(resolver.avg_latency_ms);
  const qps = safeNum(resolver.qps);
  const totalServfail = safeNum(resolver.servfail);

  const tabs = [
    { key: 'resolver', label: 'Resolver', icon: <Database size={12} /> },
    { key: 'traffic', label: 'Tráfego', icon: <Activity size={12} /> },
    { key: 'domains', label: 'Domínios', icon: <Search size={12} /> },
    { key: 'clients', label: 'Clientes', icon: <Users size={12} /> },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Métricas DNS</h1>
          <p className="text-sm text-muted-foreground">
            Dados reais via collector (unbound-control + nftables)
          </p>
        </div>
        <div className="flex items-center gap-2 text-[9px] font-mono">
          <span className={`px-2 py-0.5 rounded border ${
            collectorOk ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}>
            Collector: {collectorOk ? 'OK' : 'INATIVO'}
          </span>
          {collectorHealth.last_update && (
            <span className="text-muted-foreground/50">
              Última coleta: {new Date(collectorHealth.last_update).toLocaleTimeString()}
            </span>
          )}
          {telStatus?.file_age_seconds != null && (
            <span className={telStatus.stale ? 'text-warning' : 'text-muted-foreground/50'}>
              ({telStatus.file_age_seconds}s atrás)
            </span>
          )}
        </div>
      </div>

      {/* Collector warning */}
      {!collectorOk && (
        <div className="p-3 rounded border border-destructive/30 bg-destructive/5 flex items-center gap-2 text-sm">
          <AlertTriangle size={16} className="text-destructive flex-shrink-0" />
          <div>
            <span className="font-bold text-destructive">Collector inativo.</span>
            <span className="text-muted-foreground ml-2">
              {telStatus?.collector_status === 'not_running'
                ? 'Habilite: systemctl enable --now dns-control-collector.timer'
                : telStatus?.error ?? 'Verifique /var/lib/dns-control/telemetry/latest.json'}
            </span>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Queries"
          value={telemetryConnected ? totalQueries.toLocaleString() : '—'}
          sub={telemetryConnected ? `QPS: ${qps}` : 'Collector inativo'}
          icon={<BarChart3 size={16} />}
        />
        <MetricCard
          label="Cache Hit"
          value={telemetryConnected ? `${cacheHitRatio}%` : '—'}
          sub={telemetryConnected ? `${safeNum(resolver.cache_hits)} hits` : 'Sem dados'}
          icon={<Activity size={16} />}
        />
        <MetricCard
          label="Latência"
          value={telemetryConnected ? `${avgLatency}ms` : '—'}
          sub={telemetryConnected ? 'Recursion avg' : 'Sem dados'}
          icon={<Timer size={16} />}
        />
        <MetricCard
          label="SERVFAIL"
          value={telemetryConnected ? totalServfail.toLocaleString() : '—'}
          sub={telemetryConnected ? `NXDOMAIN: ${safeNum(resolver.nxdomain)}` : 'Sem dados'}
          icon={<AlertTriangle size={16} />}
        />
      </div>

      {/* Tab selector */}
      <div className="flex gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded border transition-colors flex items-center gap-1 ${
              tab === t.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ RESOLVER TAB ═══ */}
      {tab === 'resolver' && (
        <div className="noc-panel">
          <div className="noc-panel-header">Métricas por Backend (Fonte: unbound-control)</div>
          <div className="overflow-x-auto">
            {backends.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                {collectorOk
                  ? 'Nenhum backend com dados de resolver disponível.'
                  : 'Collector não ativo — métricas indisponíveis. Não são zeros reais.'}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="py-2 pr-4 font-medium">Backend</th>
                    <th className="py-2 pr-4 font-medium text-right">Queries</th>
                    <th className="py-2 pr-4 font-medium text-right">Cache Hit</th>
                    <th className="py-2 pr-4 font-medium text-right">Latência</th>
                    <th className="py-2 pr-4 font-medium text-right">SERVFAIL</th>
                    <th className="py-2 pr-4 font-medium text-right">NXDOMAIN</th>
                    <th className="py-2 pr-4 font-medium text-right">NOERROR</th>
                    <th className="py-2 pr-4 font-medium">Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {backends.map((b: any) => (
                    <tr key={b.name} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4 font-mono text-primary font-medium">{b.name} <span className="text-muted-foreground/50 text-xs">{b.ip}</span></td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(b.resolver?.total_queries).toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right font-mono text-success">{safeNum(b.resolver?.cache_hit_ratio)}%</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(b.resolver?.recursion_avg_ms)}ms</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(b.resolver?.servfail)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(b.resolver?.nxdomain)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{safeNum(b.resolver?.noerror)}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{b.resolver?.source ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══ TRAFFIC TAB ═══ */}
      {tab === 'traffic' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Total Packets" value={traffic.available ? safeNum(traffic.total_packets).toLocaleString() : '—'} sub="nftables counters" icon={<Activity size={16} />} />
            <MetricCard label="Total Bytes" value={traffic.available ? formatBytes(safeNum(traffic.total_bytes)) : '—'} sub="nftables" icon={<Activity size={16} />} />
            <MetricCard label="QPS (nft)" value={traffic.available ? safeNum(traffic.qps).toString() : '—'} sub="Delta de pacotes" icon={<Timer size={16} />} />
            <MetricCard label="Fonte" value={traffic.source ?? '—'} sub={traffic.available ? 'Ativo' : 'Indisponível'} />
          </div>

          <div className="noc-panel">
            <div className="noc-panel-header">Distribuição por Backend (Fonte: nftables)</div>
            <div className="overflow-x-auto">
              {backends.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">Nenhum dado de tráfego disponível</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-4 font-medium">Backend</th>
                      <th className="py-2 pr-4 font-medium text-right">Packets</th>
                      <th className="py-2 pr-4 font-medium text-right">Bytes</th>
                      <th className="py-2 pr-4 font-medium text-right">Share</th>
                      <th className="py-2 font-medium">Distribuição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backends.map((b: any) => (
                      <tr key={b.name} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 font-mono text-primary">{b.name}</td>
                        <td className="py-2 pr-4 text-right font-mono">{safeNum(b.traffic?.packets).toLocaleString()}</td>
                        <td className="py-2 pr-4 text-right font-mono">{formatBytes(safeNum(b.traffic?.bytes))}</td>
                        <td className="py-2 pr-4 text-right font-mono">{safeNum(b.traffic?.share)}%</td>
                        <td className="py-2">
                          <div className="w-full bg-muted/30 rounded-full h-2">
                            <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${safeNum(b.traffic?.share)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ DOMAINS TAB ═══ */}
      {tab === 'domains' && (
        <div className="space-y-4">
          <div className="noc-panel">
            <div className="noc-panel-header flex items-center justify-between">
              <span>Top Domínios Consultados</span>
              <span className="text-xs text-muted-foreground font-normal">Fonte: {queryAnalytics.log_source ?? 'query log'} · {safeNum(queryAnalytics.queries_parsed)} queries parsed</span>
            </div>
            {topDomains.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                {collectorOk
                  ? 'Nenhum domínio capturado ainda. Verifique se log-queries está habilitado no Unbound.'
                  : 'Collector inativo — dados de domínios indisponíveis.'}
              </div>
            ) : (
              <div className="p-4 space-y-2">
                {topDomains.map((d: any, i: number) => {
                  const maxCount = topDomains[0]?.count || 1;
                  return (
                    <div key={d.domain} className="flex items-center gap-3 text-sm font-mono">
                      <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
                      <div className="flex-1 relative h-6 flex items-center">
                        <div className="absolute inset-y-0 left-0 bg-primary/10 rounded" style={{ width: `${(d.count / maxCount) * 100}%` }} />
                        <span className="relative z-10 pl-2 text-foreground">{d.domain}</span>
                      </div>
                      <span className="text-muted-foreground w-16 text-right">{d.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent queries */}
          {recentQueries.length > 0 && (
            <div className="noc-panel">
              <div className="noc-panel-header">Consultas Recentes</div>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full text-sm font-mono">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-1 pr-4">Hora</th>
                      <th className="py-1 pr-4">Cliente</th>
                      <th className="py-1 pr-4">Domínio</th>
                      <th className="py-1">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentQueries.slice(-30).reverse().map((q: any, i: number) => (
                      <tr key={i} className="border-b border-border last:border-0 text-xs">
                        <td className="py-1 pr-4 text-muted-foreground">{q.time}</td>
                        <td className="py-1 pr-4 text-accent">{q.client}</td>
                        <td className="py-1 pr-4 text-foreground">{q.domain}</td>
                        <td className="py-1 text-muted-foreground/60">{q.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ CLIENTS TAB ═══ */}
      {tab === 'clients' && (
        <div className="noc-panel">
          <div className="noc-panel-header">Top Clientes DNS</div>
          {topClients.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              {collectorOk
                ? 'Nenhum cliente capturado ainda. Verifique se log-queries está habilitado.'
                : 'Collector inativo — dados de clientes indisponíveis.'}
            </div>
          ) : (
            <div className="p-4 space-y-2">
              {topClients.map((c: any, i: number) => {
                const maxQ = topClients[0]?.queries || 1;
                return (
                  <div key={c.ip} className="flex items-center gap-3 text-sm font-mono">
                    <span className="text-muted-foreground w-6 text-right">{i + 1}.</span>
                    <div className="flex-1 relative h-6 flex items-center">
                      <div className="absolute inset-y-0 left-0 bg-accent/10 rounded" style={{ width: `${(c.queries / maxQ) * 100}%` }} />
                      <span className="relative z-10 pl-2 text-foreground">{c.ip}</span>
                    </div>
                    <span className="text-muted-foreground w-16 text-right">{c.queries}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
