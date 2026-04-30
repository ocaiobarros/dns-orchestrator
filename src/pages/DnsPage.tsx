import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, RefreshCw, Bell, SlidersHorizontal, Layers, Database, Timer, Shield, ChevronDown } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useTelemetry, useTelemetryHistory } from '@/lib/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts';

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function firstNum(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

function toTs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1_000_000_000_000 ? value : value * 1000;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function countWindow(rows: Array<Record<string, number>>, key: string): number {
  const values = rows.map(r => safeNum(r[key])).filter(v => v > 0);
  if (values.length === 0) return 0;
  const monotonic = values.every((v, i) => i === 0 || v >= values[i - 1]);
  if (monotonic && values.length > 1) return Math.max(0, values[values.length - 1] - values[0]);
  return values.reduce((sum, v) => sum + v, 0);
}

/* ============================================================
   KPI CARD — large, with circular glowing icon + sparkline
   ============================================================ */
type Accent = 'mint' | 'violet' | 'orange' | 'blue';

const ACCENT_HSL: Record<Accent, string> = {
  mint: '162 72% 51%',
  violet: '270 75% 65%',
  orange: '25 95% 58%',
  blue: '200 90% 60%',
};

function KpiCardLarge({
  label, value, sub, accent, icon, sparkData,
}: {
  label: string; value: string; sub?: string; accent: Accent;
  icon: React.ReactNode; sparkData: number[];
}) {
  const color = `hsl(${ACCENT_HSL[accent]})`;
  const colorAlpha = (a: number) => `hsl(${ACCENT_HSL[accent]} / ${a})`;
  const cleanSpark = sparkData.length ? sparkData : [0, 0, 0, 0, 0, 0];
  const data = cleanSpark.map((v, i) => ({ i, v }));
  const gradId = `kpi-grad-${accent}`;

  return (
    <div className="relative rounded-xl overflow-hidden p-5"
      style={{
        background: `linear-gradient(135deg, ${colorAlpha(0.08)}, hsl(220 50% 4% / 0.95))`,
        border: `1px solid ${colorAlpha(0.35)}`,
        boxShadow: `0 0 32px -8px ${colorAlpha(0.35)}, inset 0 1px 0 ${colorAlpha(0.12)}`,
      }}
    >
      {/* corner brackets */}
      <span className="absolute top-2 left-2 w-3 h-3 border-t-2 border-l-2 rounded-tl-md" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute top-2 right-2 w-3 h-3 border-t-2 border-r-2 rounded-tr-md" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-2 left-2 w-3 h-3 border-b-2 border-l-2 rounded-bl-md" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-2 right-2 w-3 h-3 border-b-2 border-r-2 rounded-br-md" style={{ borderColor: colorAlpha(0.55) }} />

      {/* small dashes top-right (HUD) */}
      <div className="absolute top-3 right-7 flex gap-0.5 opacity-60">
        {[0,1,2,3,4,5].map(i => (
          <span key={i} className="w-1.5 h-0.5" style={{ background: colorAlpha(0.6) }} />
        ))}
      </div>

      <div className="flex items-center gap-4 relative z-10">
        {/* circular icon */}
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: `radial-gradient(circle at 40% 40%, ${colorAlpha(0.3)}, ${colorAlpha(0.05)})`,
              border: `1.5px solid ${colorAlpha(0.5)}`,
              boxShadow: `0 0 24px -4px ${colorAlpha(0.6)}, inset 0 0 16px ${colorAlpha(0.2)}`,
            }}>
            <span style={{ color, filter: `drop-shadow(0 0 6px ${color})` }}>{icon}</span>
          </div>
        </div>

        {/* text */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground/85">{label}</div>
          <div className="text-4xl font-bold font-mono leading-none mt-2 text-foreground">{value}</div>
          {sub && <div className="text-[10px] font-mono text-muted-foreground/60 mt-1.5">{sub}</div>}
        </div>

        {/* sparkline */}
        <div className="w-24 min-w-[96px] h-12 min-h-[48px] flex-shrink-0 self-end opacity-90">
          <ResponsiveContainer width="100%" height={48} minWidth={96} minHeight={48}>
            <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.2} fill={`url(#${gradId})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   PANEL — print-style: dark, top-edge gradient line, bracket corners
   ============================================================ */
function Panel({
  title, badge, action, children, className = '', accent = 'mint',
}: {
  title: string; badge?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; className?: string; accent?: Accent;
}) {
  const colorAlpha = (a: number) => `hsl(${ACCENT_HSL[accent]} / ${a})`;
  return (
    <div className={`relative rounded-xl overflow-hidden min-w-0 ${className}`}
      style={{
        background: 'linear-gradient(160deg, hsl(220 42% 8%), hsl(220 50% 4%))',
        border: `1px solid ${colorAlpha(0.28)}`,
        boxShadow: `0 0 28px -12px ${colorAlpha(0.35)}`,
      }}
    >
      {/* top edge gradient */}
      <div className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${colorAlpha(0.7)}, transparent)` }} />
      {/* corner brackets */}
      <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t-2 border-l-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t-2 border-r-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b-2 border-l-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b-2 border-r-2" style={{ borderColor: colorAlpha(0.55) }} />

      <div className="px-5 pt-4 pb-3 flex items-center gap-2">
        <span className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground/90">{title}</span>
        {badge}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}

/* ============================================================
   Time-series chart panel
   ============================================================ */
function ChartPanel({
  title, data, dataKey, accent, height = 200,
}: {
  title: string; data: any[]; dataKey: string; accent: Accent; height?: number;
}) {
  const color = `hsl(${ACCENT_HSL[accent]})`;
  const colorAlpha = (a: number) => `hsl(${ACCENT_HSL[accent]} / ${a})`;
  const gid = `chart-${title.replace(/\s+/g, '-')}`;

  const series = data.length > 0 ? data : Array.from({ length: 2 }, () => ({ time: '', [dataKey]: 0 }));

  return (
    <Panel title={title} accent={accent}>
      <div className="w-full min-w-0" style={{ height, minHeight: height }}>
        <ResponsiveContainer width="100%" height={height} minWidth={1} minHeight={height}>
          <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colorAlpha(0.12)} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={{
                background: 'hsl(220 50% 4%)', border: `1px solid ${colorAlpha(0.4)}`,
                borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 11,
                boxShadow: `0 0 24px -4px ${colorAlpha(0.4)}`,
              }}
              labelStyle={{ color: 'hsl(215 15% 60%)' }}
              itemStyle={{ color }}
            />
            <Area
              type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5}
              fill={`url(#${gid})`} isAnimationActive={false}
              dot={false}
              style={{ filter: `drop-shadow(0 0 4px ${colorAlpha(0.6)})` }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ============================================================
   Cache Hit chart — line only, magenta/violet
   ============================================================ */
function CacheHitChart({ data }: { data: any[] }) {
  const color = 'hsl(290 80% 60%)';
  const series = data.length > 0 ? data : Array.from({ length: 2 }, () => ({ time: '', hitRatio: 0 }));
  return (
    <Panel title="Cache Hit Ratio (%)" accent="violet">
      <div className="w-full min-w-0" style={{ height: 200, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height={200} minWidth={1} minHeight={200}>
          <LineChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <CartesianGrid stroke="hsl(290 60% 40% / 0.15)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis domain={[0, 100]} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: 'hsl(220 50% 4%)', border: `1px solid ${color}`, borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 11 }}
              labelStyle={{ color: 'hsl(215 15% 60%)' }} itemStyle={{ color }}
            />
            <Line type="monotone" dataKey="hitRatio" stroke={color} strokeWidth={1.5} dot={false}
              isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ============================================================
   Errors chart — area, pink/magenta
   ============================================================ */
function ErrorsChart({ data }: { data: any[] }) {
  const color = 'hsl(330 90% 60%)';
  const colorA = (a: number) => `hsl(330 90% 60% / ${a})`;
  const series = data.length > 0
    ? data.map(d => ({ ...d, total: safeNum(d.servfail) + safeNum(d.nxdomain) }))
    : Array.from({ length: 2 }, () => ({ time: '', total: 0 }));
  return (
    <Panel title="Erros. (SERVFAIL + NXDOMAIN)" accent="violet">
      <div className="w-full min-w-0" style={{ height: 200, minHeight: 200 }}>
        <ResponsiveContainer width="100%" height={200} minWidth={1} minHeight={200}>
          <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <defs>
              <linearGradient id="err-grad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.55} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colorA(0.1)} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              contentStyle={{ background: 'hsl(220 50% 4%)', border: `1px solid ${color}`, borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 11 }}
              labelStyle={{ color: 'hsl(215 15% 60%)' }} itemStyle={{ color }}
            />
            <Area type="monotone" dataKey="total" stroke={color} strokeWidth={1.5} fill="url(#err-grad)" isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

/* ============================================================
   MAIN PAGE
   ============================================================ */
export default function DnsPage() {
  const { data: telemetry, isLoading, error } = useTelemetry();
  const { data: historyData } = useTelemetryHistory();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [hours, setHours] = useState(1);
  const [selectedInstance, setSelectedInstance] = useState('');
  const [qtype, setQtype] = useState('');
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: filteredMetrics } = useQuery({
    queryKey: ['dns', 'metrics', hours, selectedInstance],
    queryFn: async () => { const r = await api.getDnsMetrics(hours, selectedInstance || undefined); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
    placeholderData: previousData => previousData,
  });

  const { data: recentQueries } = useQuery({
    queryKey: ['telemetry', 'recent-queries', selectedInstance, qtype],
    queryFn: async () => { const r = await api.getRecentQueries({ instance: selectedInstance || undefined, qtype: qtype || undefined, limit: 100 }); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 15000,
    placeholderData: previousData => previousData,
  });

  useEffect(() => {/* warm-up */}, []);

  const chartData = useMemo(() => {
    const metricRows = Array.isArray(filteredMetrics) ? filteredMetrics : [];
    const historyRows = Array.isArray(historyData) ? historyData : [];
    const timedMetrics = metricRows.filter((p: any) => toTs(p.timestamp ?? p.epoch) > 0);
    const history = timedMetrics.length > 0 ? timedMetrics : historyRows;
    const minTs = Date.now() - hours * 60 * 60 * 1000;
    const series = history
      .filter((p: any) => {
        const ts = toTs(p.timestamp ?? p.epoch);
        return !ts || ts >= minTs;
      })
      .map((p: any) => ({
        time: (p.timestamp || p.epoch) ? new Date(toTs(p.timestamp ?? p.epoch)).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
        qps: firstNum(p.qps, p.queries_per_second),
        latency: firstNum(p.latency_ms, p.latency_avg_ms, p.avgLatencyMs, p.avg_latency_ms),
        servfail: firstNum(p.servfail, p.servfail_count),
        nxdomain: firstNum(p.nxdomain, p.nxdomain_count),
        hitRatio: firstNum(p.cache_hit_ratio, p.cacheHitRatio),
        totalQueries: firstNum(p.total_queries, p.totalQueries, p.queries_total, p.queries),
        cacheHits: firstNum(p.cache_hits, p.cacheHits),
        cacheMisses: firstNum(p.cache_misses, p.cacheMisses),
      }));

    if (series.length > 0) return series;
    const resolver = telemetry?.resolver ?? {};
    return [{
      time: telemetry?.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '',
      qps: firstNum(resolver.qps),
      latency: firstNum(resolver.avg_latency_ms),
      servfail: firstNum(resolver.servfail),
      nxdomain: firstNum(resolver.nxdomain),
      hitRatio: firstNum(resolver.cache_hit_ratio),
      totalQueries: firstNum(resolver.total_queries),
      cacheHits: firstNum(resolver.cache_hits),
      cacheMisses: firstNum(resolver.cache_misses),
    }];
  }, [filteredMetrics, historyData, hours, telemetry]);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const collectorOk = telemetry?.health?.collector === 'ok';
  const resolver = telemetry?.resolver ?? {};
  const backends = Array.isArray(telemetry?.backends) ? telemetry.backends : [];
  const queryAnalytics = telemetry?.query_analytics ?? {};
  const availableQtypes = recentQueries?.available_types ?? [];
  const visibleBackends = selectedInstance
    ? backends.filter((b: any) => b.name === selectedInstance || b.instance === selectedInstance || b.id === selectedInstance)
    : backends;
  const filteredRecentItems = recentQueries?.items ?? [];
  const topDomainsRaw = Array.isArray(telemetry?.top_domains) ? telemetry.top_domains
    : Array.isArray(queryAnalytics?.top_domains) ? queryAnalytics.top_domains : [];

  // Live state: any signal of data → connected (don't gate KPIs on collector flag alone)
  const hasMetrics = Array.isArray(filteredMetrics) && filteredMetrics.length > 0;
  const hasBackends = backends.length > 0;
  const telemetryConnected = collectorOk || hasMetrics || hasBackends;

  // Aggregate window metrics (sum/avg over the selected range, not last point only)
  const metricsArr: any[] = Array.isArray(filteredMetrics) ? filteredMetrics : [];
  const latestMetric = metricsArr.length > 0 ? metricsArr[metricsArr.length - 1] : null;

  // Fall back to backend-aggregated values from telemetry for instant display
  const totalQueries =
    metricsArr.reduce((a, m) => a + safeNum(m.total_queries ?? m.queries), 0)
    || safeNum(latestMetric?.total_queries)
    || backends.reduce((a: number, b: any) => a + safeNum(b.resolver?.total_queries), 0)
    || safeNum(resolver.total_queries);

  const cacheHitRatio = safeNum(latestMetric?.cache_hit_ratio)
    || (backends.length
      ? Math.round(backends.reduce((a: number, b: any) => a + safeNum(b.resolver?.cache_hit_ratio), 0) / backends.length)
      : safeNum(resolver.cache_hit_ratio));

  const avgLatency = safeNum(latestMetric?.latency_avg_ms ?? latestMetric?.latency_ms)
    || (backends.length
      ? backends.reduce((a: number, b: any) => a + safeNum(b.resolver?.recursion_avg_ms), 0) / backends.length
      : safeNum(resolver.avg_latency_ms));

  const totalServfail =
    metricsArr.reduce((a, m) => a + safeNum(m.servfail_count ?? m.servfail), 0)
    || safeNum(latestMetric?.servfail_count ?? latestMetric?.servfail)
    || backends.reduce((a: number, b: any) => a + safeNum(b.resolver?.servfail), 0)
    || safeNum(resolver.servfail);

  const qps = safeNum(latestMetric?.queries_per_second ?? latestMetric?.qps ?? resolver.qps);

  // Sparkline data per KPI
  const sparkQ = chartData.length > 0 ? chartData.slice(-30).map(d => d.qps) : Array.from({ length: 30 }, () => Math.random() * 20 + 5);
  const sparkH = chartData.length > 0 ? chartData.slice(-30).map(d => d.hitRatio) : Array.from({ length: 30 }, () => Math.random() * 30 + 50);
  const sparkL = chartData.length > 0 ? chartData.slice(-30).map(d => d.latency) : Array.from({ length: 30 }, () => Math.random() * 100 + 20);
  const sparkE = chartData.length > 0 ? chartData.slice(-30).map(d => d.servfail + d.nxdomain) : Array.from({ length: 30 }, () => Math.random() * 5);

  const topDomains = topDomainsRaw
    .filter((d: any) => !qtype || d.query_type === qtype || d.type === qtype)
    .slice(0, showOnlyAlerts ? 5 : 9).map((d: any) => ({
    domain: d.domain || d.name || '—',
    count: safeNum(d.query_count || d.count || d.queries),
  }));
  const maxDomain = Math.max(1, ...topDomains.map((d: any) => d.count));

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['telemetry'] }),
        qc.invalidateQueries({ queryKey: ['dns'] }),
      ]);
      await new Promise(r => setTimeout(r, 600));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4 -mx-1">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1 pt-1 pb-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-5xl font-bold tracking-tight text-foreground">DNS</h1>
          <p className="text-xs font-mono text-muted-foreground/80">
            Métricas reais via collector (unbound-control + nftables)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-mono"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(162 72% 51% / 0.3)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-primary" style={{ boxShadow: '0 0 6px hsl(var(--primary))' }} />
            <span className="text-primary">Operacional</span>
          </div>
          <label className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground hover:border-primary/40 transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Calendar size={13} />
            <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="bg-transparent outline-none text-foreground cursor-pointer">
              <option value={1}>Última 1 hora</option>
              <option value={6}>Últimas 6 horas</option>
              <option value={12}>Últimas 12 horas</option>
              <option value={24}>Últimas 24 horas</option>
              <option value={48}>Últimas 48 horas</option>
              <option value={72}>Últimas 72 horas</option>
            </select>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground hover:border-primary/40 transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Layers size={13} />
            <select value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)} className="bg-transparent outline-none text-foreground min-w-[112px] cursor-pointer">
              <option value="">Todas instâncias</option>
              {backends.map((b: any) => <option key={b.name || b.instance || b.id} value={b.name || b.instance || b.id}>{b.name || b.instance || b.id}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground hover:border-primary/40 transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <ChevronDown size={13} />
            <select value={qtype} onChange={(e) => setQtype(e.target.value)} className="bg-transparent outline-none text-foreground min-w-[72px] cursor-pointer">
              <option value="">Todos tipos</option>
              {availableQtypes.length === 0 && ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV'].map(t => <option key={t} value={t}>{t}</option>)}
              {availableQtypes.map((t: string) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <button
            onClick={refreshAll}
            disabled={refreshing}
            title="Atualizar agora"
            className="p-2 rounded-md text-muted-foreground hover:text-primary hover:border-primary/50 transition-all disabled:opacity-60"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/events?severity=warning,critical')}
            title="Ver alertas operacionais"
            className="relative p-2 rounded-md text-muted-foreground hover:text-warning hover:border-warning/40 transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Bell size={14} />
            {totalServfail > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-warning text-warning-foreground text-[8px] font-bold flex items-center justify-center px-1">
                {totalServfail > 99 ? '99+' : totalServfail}
              </span>
            )}
          </button>
          <button
            onClick={() => { setSelectedInstance(''); setQtype(''); setShowOnlyAlerts(false); setHours(1); }}
            title="Limpar filtros"
            className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* 4 KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardLarge
          label="Total Queries"
          value={telemetryConnected ? totalQueries.toLocaleString() : '0'}
          sub={`QPS: ${qps}`}
          accent="mint" sparkData={sparkQ}
          icon={<Layers size={28} strokeWidth={1.6} />}
        />
        <KpiCardLarge
          label="Cache Hit Ratio"
          value={`${telemetryConnected ? cacheHitRatio : 0}%`}
          accent="violet" sparkData={sparkH}
          icon={<Database size={28} strokeWidth={1.6} />}
        />
        <KpiCardLarge
          label="Latência Média"
          value={`${telemetryConnected ? avgLatency.toFixed(2) : '0.00'}ms`}
          accent="orange" sparkData={sparkL}
          icon={<Timer size={28} strokeWidth={1.6} />}
        />
        <KpiCardLarge
          label="SERVFAIL Total"
          value={telemetryConnected ? totalServfail.toLocaleString() : '0'}
          accent="blue" sparkData={sparkE}
          icon={<Shield size={28} strokeWidth={1.6} />}
        />
      </div>

      {/* INSTÂNCIAS + TOP DOMÍNIOS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Instances 2/3 */}
        <Panel title="Instâncias (Fonte: unbound-control)" accent="mint" className="lg:col-span-2">
          <table className="w-full">
            <thead>
              <tr className="text-left">
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Instância</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Status</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Queries</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Cache Hit</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Latência</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">SERVFAIL</th>
                <th className="pb-3 text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground/70">Fonte</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[12px]">
              {visibleBackends.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-muted-foreground text-[11px]">Sem dados</td></tr>
              )}
              {visibleBackends.map((b: any) => (
                <tr key={b.name} className="border-t border-border/30">
                  <td className="py-3.5 align-top">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary" style={{ boxShadow: '0 0 6px hsl(var(--primary))' }} />
                      <span className="text-primary font-bold">{b.name}</span>
                    </div>
                    <div className="mt-1 ml-3.5 flex items-center gap-1.5">
                      <span className="px-1 py-px text-[8px] rounded bg-muted/60 text-muted-foreground/80 font-bold">IPv4</span>
                      <span className="text-foreground/85 text-[11px]">{b.ipv4 || b.ip || '—'}</span>
                    </div>
                  </td>
                  <td className="py-3.5 align-top">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${b.healthy ? 'bg-primary' : 'bg-destructive'}`}
                        style={{ boxShadow: b.healthy ? '0 0 6px hsl(var(--primary))' : '0 0 6px hsl(var(--destructive))' }} />
                      <span className={`text-[11px] font-bold uppercase ${b.healthy ? 'text-primary' : 'text-destructive'}`}>
                        {b.healthy ? 'LIVE' : 'DOWN'}
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 text-foreground/90 align-top">{safeNum(b.resolver?.total_queries).toLocaleString()}</td>
                  <td className="py-3.5 align-top">
                    <span className={safeNum(b.resolver?.cache_hit_ratio) >= 90 ? 'text-primary' : 'text-warning'}>
                      {safeNum(b.resolver?.cache_hit_ratio)}%
                    </span>
                  </td>
                  <td className="py-3.5 text-foreground/90 align-top">{safeNum(b.resolver?.recursion_avg_ms).toFixed(2)}ms</td>
                  <td className="py-3.5 text-foreground/90 align-top">{safeNum(b.resolver?.servfail)}</td>
                  <td className="py-3.5 align-top">
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground/80"
                      style={{ background: 'hsl(220 42% 9%)', border: '1px solid hsl(220 35% 14%)' }}>
                      <Shield size={9} />
                      {b.resolver?.source ?? 'unbound-control'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* Top Domains 1/3 */}
        <Panel title="Top Domínios Consultados" accent="mint">
          <div className="space-y-2">
            {topDomains.length === 0 && (
              <div className="text-center text-muted-foreground text-[11px] py-8">{filteredRecentItems.length ? `${filteredRecentItems.length} consultas filtradas` : 'Sem dados'}</div>
            )}
            {topDomains.map((d: any) => {
              const pct = (d.count / maxDomain) * 100;
              return (
                <div key={d.domain} className="grid grid-cols-[1fr_auto] gap-3 items-center text-[11px] font-mono py-1">
                  <div className="min-w-0">
                    <div className="text-foreground/90 truncate mb-1">{d.domain}</div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(220 42% 9%)' }}>
                      <div className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, hsl(162 72% 51%), hsl(162 90% 60%))',
                          boxShadow: '0 0 6px hsl(162 72% 51% / 0.7)',
                        }} />
                    </div>
                  </div>
                  <span className="text-foreground/85 tabular-nums whitespace-nowrap">{d.count.toLocaleString('de-DE')}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* QPS + Latência */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartPanel title="QPS ao longo do tempo" data={chartData} dataKey="qps" accent="mint" />
        <ChartPanel title="Latência (ms)" data={chartData} dataKey="latency" accent="orange" />
      </div>

      {/* Cache Hit + Errors (full width each) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CacheHitChart data={chartData} />
        <ErrorsChart data={chartData} />
      </div>
    </div>
  );
}
