import { useState } from 'react';
import {
  BarChart3, Activity, Timer, AlertTriangle, Search, Users, Globe, Database, Sparkles,
} from 'lucide-react';
import IpAddressStack from '@/components/IpAddressStack';
import { LoadingState } from '@/components/DataStates';
import TopListDialog from '@/components/TopListDialog';
import { useTelemetry, useTelemetryStatus } from '@/lib/hooks';

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

type KpiTone = 'primary' | 'success' | 'accent' | 'warning' | 'info' | 'muted';

const toneStyles: Record<KpiTone, { icon: string; ring: string; glow: string }> = {
  primary: { icon: 'text-primary', ring: 'border-primary/20', glow: 'shadow-[0_0_24px_-12px_hsl(var(--primary)/0.6)]' },
  success: { icon: 'text-success', ring: 'border-success/20', glow: 'shadow-[0_0_24px_-12px_hsl(var(--success)/0.6)]' },
  accent: { icon: 'text-accent', ring: 'border-accent/20', glow: 'shadow-[0_0_24px_-12px_hsl(var(--accent)/0.6)]' },
  warning: { icon: 'text-warning', ring: 'border-warning/20', glow: 'shadow-[0_0_24px_-12px_hsl(var(--warning)/0.6)]' },
  info: { icon: 'text-blue-400', ring: 'border-blue-400/20', glow: 'shadow-[0_0_24px_-12px_rgba(96,165,250,0.6)]' },
  muted: { icon: 'text-muted-foreground', ring: 'border-border', glow: '' },
};

function KpiCard({
  label, value, sub, icon, tone = 'primary',
}: { label: string; value: string; sub?: string; icon: React.ReactNode; tone?: KpiTone }) {
  const t = toneStyles[tone];
  return (
    <div className={`relative rounded-lg border ${t.ring} bg-card/40 backdrop-blur-sm p-3 ${t.glow}`}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-md border ${t.ring} flex items-center justify-center ${t.icon} bg-background/40 flex-shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-mono">{label}</div>
          <div className="text-2xl font-semibold leading-tight mt-0.5 truncate">{value}</div>
          {sub && <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

type TabKey = 'overview' | 'domains' | 'clients' | 'backends' | 'traffic';

export default function MetricsPage() {
  const { data: telemetry, isLoading } = useTelemetry();
  const { data: telStatus } = useTelemetryStatus();
  const [tab, setTab] = useState<TabKey>('overview');
  const [openDomains, setOpenDomains] = useState(false);
  const [openClients, setOpenClients] = useState(false);

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

  const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Visão Geral', icon: <Sparkles size={12} /> },
    { key: 'domains', label: 'Domínios', icon: <Globe size={12} /> },
    { key: 'clients', label: 'Clientes', icon: <Users size={12} /> },
    { key: 'backends', label: 'Backends', icon: <Database size={12} /> },
    { key: 'traffic', label: 'Tráfego', icon: <Activity size={12} /> },
  ];

  // ---- shared sub-blocks (used in overview AND in dedicated tabs) ----

  const TopDomainsBlock = (
    <div className="noc-panel h-full">
      <div className="noc-panel-header flex items-center justify-between">
        <span>Top Domínios Consultados</span>
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
          Fonte: {(queryAnalytics.log_source ?? 'journalctl').toString().toUpperCase()} · {safeNum(queryAnalytics.queries_parsed)} queries parsed
        </span>
      </div>
      {topDomains.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          {collectorOk
            ? 'Nenhum domínio capturado. Verifique se log-queries está habilitado.'
            : 'Collector inativo — dados de domínios indisponíveis.'}
        </div>
      ) : (
        <div className="p-4 space-y-1.5">
          {topDomains.slice(0, 10).map((d: any, i: number) => {
            const maxCount = topDomains[0]?.count || 1;
            const pct = (d.count / maxCount) * 100;
            return (
              <div key={d.domain} className="flex items-center gap-3 text-[12px] font-mono">
                <span className="text-muted-foreground/70 w-6 text-right">{i + 1}.</span>
                <div className="flex-1 relative h-5 flex items-center">
                  <div
                    className="absolute inset-y-0 left-0 bg-success/15 border-b border-success/60 rounded-sm"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative z-10 pl-2 text-foreground truncate">{d.domain}</span>
                </div>
                <span className="text-muted-foreground w-20 text-right tabular-nums">
                  {safeNum(d.count).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() => setOpenDomains(true)}
          disabled={topDomains.length === 0}
          className="w-full text-center text-[11px] text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 rounded py-2 bg-background/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ver todos os domínios →
        </button>
      </div>
    </div>
  );

  const TopClientsBlock = (
    <div className="noc-panel h-full">
      <div className="noc-panel-header">Top Clientes DNS</div>
      {topClients.length === 0 ? (
        <div className="p-6 text-center text-muted-foreground text-sm">
          {collectorOk
            ? 'Nenhum cliente capturado ainda.'
            : 'Collector inativo — dados de clientes indisponíveis.'}
        </div>
      ) : (
        <div className="p-4 space-y-1.5">
          {topClients.slice(0, 10).map((c: any, i: number) => {
            const maxQ = topClients[0]?.queries || 1;
            const pct = (c.queries / maxQ) * 100;
            return (
              <div key={c.ip} className="flex items-center gap-3 text-[12px] font-mono">
                <span className="text-muted-foreground/70 w-6 text-right">{i + 1}.</span>
                <div className="flex-1 relative h-5 flex items-center">
                  <div
                    className="absolute inset-y-0 left-0 bg-accent/20 border-b border-accent/60 rounded-sm"
                    style={{ width: `${pct}%` }}
                  />
                  <span className="relative z-10 pl-2 text-foreground truncate">{c.ip}</span>
                </div>
                <span className="text-muted-foreground w-20 text-right tabular-nums">
                  {safeNum(c.queries).toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() => setOpenClients(true)}
          disabled={topClients.length === 0}
          className="w-full text-center text-[11px] text-muted-foreground hover:text-primary border border-border/60 hover:border-primary/40 rounded py-2 bg-background/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ver todos os clientes →
        </button>
      </div>
    </div>
  );

  const NftDistributionBlock = (
    <div className="noc-panel">
      <div className="noc-panel-header">Distribuição por Backend (nftables)</div>
      <div className="overflow-x-auto">
        {backends.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">Nenhum dado de tráfego disponível</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider">
                <th className="py-2 px-4 font-medium">Backend</th>
                <th className="py-2 pr-4 font-medium text-right">Packets</th>
                <th className="py-2 pr-4 font-medium text-right">Bytes</th>
                <th className="py-2 pr-4 font-medium text-right">Share</th>
                <th className="py-2 pr-4 font-medium">Distribuição</th>
              </tr>
            </thead>
            <tbody>
              {backends.map((b: any) => {
                const share = safeNum(b.traffic?.share);
                return (
                  <tr key={b.name} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5 px-4 font-mono text-success font-medium">{b.name}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.traffic?.packets).toLocaleString()}</td>
                    <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{formatBytes(safeNum(b.traffic?.bytes))}</td>
                    <td className="py-2.5 pr-4 text-right font-mono text-success tabular-nums">{share}%</td>
                    <td className="py-2.5 pr-4 min-w-[180px]">
                      <div className="w-full bg-muted/20 rounded-full h-1.5">
                        <div
                          className="bg-success rounded-full h-1.5 transition-all shadow-[0_0_8px_hsl(var(--success)/0.6)]"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const UnboundMetricsBlock = (
    <div className="noc-panel">
      <div className="noc-panel-header">Métricas por Backend (Fonte: Unbound-Control)</div>
      <div className="overflow-x-auto">
        {backends.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {collectorOk
              ? 'Nenhum backend com dados de resolver disponível.'
              : 'Collector inativo — métricas indisponíveis.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider">
                <th className="py-2 px-4 font-medium">Backend</th>
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
                <tr key={b.name} className="border-b border-border/60 last:border-0 align-top">
                  <td className="py-2.5 px-4 font-mono text-success font-medium">
                    <div>{b.name}</div>
                    <div className="mt-1 max-w-[18rem]">
                      <IpAddressStack
                        ipv4={b.ipv4}
                        ipv6={b.ipv6}
                        fallback={b.ip}
                        valueClassName="text-[10px] text-muted-foreground"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.resolver?.total_queries).toLocaleString()}</td>
                  <td className="py-2.5 pr-4 text-right font-mono text-success tabular-nums">{safeNum(b.resolver?.cache_hit_ratio)}%</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.resolver?.recursion_avg_ms)}ms</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.resolver?.servfail)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.resolver?.nxdomain)}</td>
                  <td className="py-2.5 pr-4 text-right font-mono tabular-nums">{safeNum(b.resolver?.noerror)}</td>
                  <td className="py-2.5 pr-4 text-[11px] text-muted-foreground font-mono">{b.resolver?.source ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  const EnvironmentSummaryBlock = (
    <div className="noc-panel h-full">
      <div className="noc-panel-header">Resumo do Ambiente</div>
      <div className="p-4 space-y-3 text-sm">
        {[
          ['Fonte de Dados', traffic.source ? `Unbound-Control + ${traffic.source}` : 'Unbound-Control + nftables'],
          ['Collector', collectorOk ? 'OK' : 'INATIVO'],
          ['Última Coleta', collectorHealth.last_update ? new Date(collectorHealth.last_update).toLocaleTimeString() : '—'],
          ['Backends Ativos', String(backends.length)],
          ['Clientes Únicos', String(topClients.length)],
          ['Domínios Únicos', String(safeNum(queryAnalytics.unique_domains) || topDomains.length)],
        ].map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-border/40 pb-2 last:border-0 last:pb-0">
            <span className="text-muted-foreground text-[12px]">{k}</span>
            <span className={`font-mono text-[12px] ${k === 'Collector' && v === 'OK' ? 'text-success' : ''}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const TrafficKpisBlock = (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <KpiCard label="Total Packets" tone="info" icon={<Activity size={16} />}
        value={traffic.available ? safeNum(traffic.total_packets).toLocaleString() : '—'} sub="nftables counters" />
      <KpiCard label="Total Bytes" tone="info" icon={<Activity size={16} />}
        value={traffic.available ? formatBytes(safeNum(traffic.total_bytes)) : '—'} sub="nftables" />
      <KpiCard label="QPS (NFT)" tone="accent" icon={<Timer size={16} />}
        value={traffic.available ? String(safeNum(traffic.qps)) : '—'} sub="Delta de pacotes" />
      <KpiCard label="Fonte" tone="muted" icon={<Database size={16} />}
        value={traffic.source ?? '—'} sub={traffic.available ? 'Ativo' : 'Indisponível'} />
    </div>
  );

  const RecentQueriesBlock = recentQueries.length > 0 ? (
    <div className="noc-panel">
      <div className="noc-panel-header">Consultas Recentes</div>
      <div className="overflow-x-auto max-h-72">
        <table className="w-full text-sm font-mono">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border text-[11px] uppercase tracking-wider">
              <th className="py-1.5 px-4">Hora</th>
              <th className="py-1.5 pr-4">Cliente</th>
              <th className="py-1.5 pr-4">Domínio</th>
              <th className="py-1.5 pr-4">Tipo</th>
            </tr>
          </thead>
          <tbody>
            {recentQueries.slice(-30).reverse().map((q: any, i: number) => (
              <tr key={i} className="border-b border-border/40 last:border-0 text-xs">
                <td className="py-1.5 px-4 text-muted-foreground">{q.time}</td>
                <td className="py-1.5 pr-4 text-accent">{q.client}</td>
                <td className="py-1.5 pr-4 text-foreground">{q.domain}</td>
                <td className="py-1.5 pr-4 text-muted-foreground/60">{q.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Métricas DNS</h1>
          <p className="text-sm text-muted-foreground">
            Dados reais via collector (unbound-control + nftables)
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className={`px-2 py-1 rounded border ${
            collectorOk
              ? 'bg-success/10 text-success border-success/30'
              : 'bg-destructive/10 text-destructive border-destructive/30'
          }`}>
            Collector: {collectorOk ? 'OK' : 'INATIVO'}
          </span>
          {collectorHealth.last_update && (
            <span className="text-muted-foreground/70">
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

      {/* KPI row — 7 KPIs (Total Queries, Cache Hit, Latência, SERVFAIL, Total Packets, Total Bytes, QPS NFT) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <KpiCard label="Total Queries" tone="info" icon={<BarChart3 size={16} />}
          value={telemetryConnected ? totalQueries.toLocaleString() : '—'}
          sub={telemetryConnected ? `QPS: ${qps}` : 'Collector inativo'} />
        <KpiCard label="Cache Hit" tone="success" icon={<Activity size={16} />}
          value={telemetryConnected ? `${cacheHitRatio}%` : '—'}
          sub={telemetryConnected ? `${safeNum(resolver.cache_hits)} hits` : 'Sem dados'} />
        <KpiCard label="Latência" tone="accent" icon={<Timer size={16} />}
          value={telemetryConnected ? `${avgLatency}ms` : '—'} sub="Recursion avg" />
        <KpiCard label="SERVFAIL" tone="warning" icon={<AlertTriangle size={16} />}
          value={telemetryConnected ? totalServfail.toLocaleString() : '—'}
          sub={`NXDOMAIN: ${safeNum(resolver.nxdomain)}`} />
        <KpiCard label="Total Packets" tone="info" icon={<Activity size={16} />}
          value={traffic.available ? safeNum(traffic.total_packets).toLocaleString() : '—'} sub="nftables counters" />
        <KpiCard label="Total Bytes" tone="info" icon={<Activity size={16} />}
          value={traffic.available ? formatBytes(safeNum(traffic.total_bytes)) : '—'} sub="nftables" />
        <KpiCard label="QPS (NFT)" tone="accent" icon={<Sparkles size={16} />}
          value={traffic.available ? String(safeNum(traffic.qps)) : '—'} sub="Delta de pacotes" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs rounded-t border-b-2 transition-colors flex items-center gap-1.5 ${
              tab === t.key
                ? 'border-success text-success bg-success/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ VISÃO GERAL (single pane of glass) ═══ */}
      {tab === 'overview' && (
        <div className="space-y-5">
          {/* Row 1 — Top Domains | Top Clients | (Backend cards stacked) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {TopDomainsBlock}
            {TopClientsBlock}
            <div className="space-y-4">
              {NftDistributionBlock}
              {UnboundMetricsBlock}
            </div>
          </div>

          {/* Row 2 — Recent queries (if any) | Environment summary */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              {RecentQueriesBlock}
            </div>
            {EnvironmentSummaryBlock}
          </div>
        </div>
      )}

      {/* ═══ DOMÍNIOS ═══ */}
      {tab === 'domains' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {TopDomainsBlock}
          {RecentQueriesBlock ?? (
            <div className="noc-panel p-6 text-center text-muted-foreground text-sm">
              Sem consultas recentes capturadas.
            </div>
          )}
        </div>
      )}

      {/* ═══ CLIENTES ═══ */}
      {tab === 'clients' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {TopClientsBlock}
          {EnvironmentSummaryBlock}
        </div>
      )}

      {/* ═══ BACKENDS ═══ */}
      {tab === 'backends' && (
        <div className="space-y-4">
          {NftDistributionBlock}
          {UnboundMetricsBlock}
        </div>
      )}

      {/* ═══ TRÁFEGO ═══ */}
      {tab === 'traffic' && (
        <div className="space-y-4">
          {TrafficKpisBlock}
          {NftDistributionBlock}
        </div>
      )}

      <TopListDialog
        open={openDomains}
        onOpenChange={setOpenDomains}
        title="Todos os Domínios Consultados"
        items={topDomains.map((d: any) => ({ label: String(d.domain ?? '—'), count: safeNum(d.count) }))}
        itemLabel="domínios"
        accent="mint"
        source={(queryAnalytics.log_source ?? 'journalctl').toString().toUpperCase()}
      />
      <TopListDialog
        open={openClients}
        onOpenChange={setOpenClients}
        title="Todos os Clientes DNS"
        items={topClients.map((c: any) => ({ label: String(c.ip ?? '—'), count: safeNum(c.queries) }))}
        itemLabel="clientes"
        accent="violet"
        source={(queryAnalytics.log_source ?? 'journalctl').toString().toUpperCase()}
      />
    </div>
  );
}
