import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, RefreshCw, Bell, SlidersHorizontal, Layers, Database, Timer, Shield, ChevronDown, Search, Package, HardDrive, Zap, Globe, Users, Server, Activity } from 'lucide-react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useTelemetry, useTelemetryHistory } from '@/lib/hooks';
import TelemetryHealthStrip, { FallbackRankingsBadge, isRankingsFallback } from '@/components/noc/TelemetryHealthStrip';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ServerTimeMetadata } from '@/lib/api';
import {
  DEFAULT_SERVER_TIME_META,
  buildServerTimeTicks,
  formatServerAxisTime,
  formatServerDateTime,
  formatServerTooltipTime,
  parseUtcTimestamp,
  timezoneBadgeText,
} from '@/lib/server-time';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
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
  return parseUtcTimestamp(value);
}

function countWindow(rows: Array<Record<string, number>>, key: string): number {
  const values = rows.map(r => safeNum(r[key])).filter(v => v > 0);
  if (values.length === 0) return 0;
  const monotonic = values.every((v, i) => i === 0 || v >= values[i - 1]);
  if (monotonic && values.length > 1) return Math.max(0, values[values.length - 1] - values[0]);
  return values.reduce((sum, v) => sum + v, 0);
}

function backendName(b: any): string {
  return String(b?.name ?? b?.instance ?? b?.id ?? '');
}

function sameInstance(a: unknown, b: unknown): boolean {
  return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}

function queryTypeOf(row: any): string {
  return String(row?.type ?? row?.qtype ?? row?.query_type ?? row?.queryType ?? '').toUpperCase();
}

function queryInstanceOf(row: any): string {
  return String(row?.instance ?? row?.backend ?? row?.backend_ip ?? row?.backendIp ?? '');
}

function rowHasQueryType(row: any): boolean {
  return Boolean(row?.type ?? row?.qtype ?? row?.query_type ?? row?.queryType);
}

function rowHasInstance(row: any): boolean {
  return Boolean(row?.instance ?? row?.backend ?? row?.backend_ip ?? row?.backendIp);
}

function queryDomainOf(row: any): string {
  return String(row?.domain ?? row?.qname ?? row?.query ?? row?.name ?? '').replace(/\.$/, '');
}

function rowMatchesFilters(
  row: any,
  instance: string,
  type: string,
  options: { allowMissingInstance?: boolean; allowMissingType?: boolean } = {},
): boolean {
  const rowInstance = queryInstanceOf(row);
  const matchesInstance = !instance || (rowHasInstance(row) ? sameInstance(rowInstance, instance) : Boolean(options.allowMissingInstance));
  const matchesType = !type || (rowHasQueryType(row) ? queryTypeOf(row) === type : Boolean(options.allowMissingType));
  return matchesInstance && matchesType;
}

const SELECT_PANEL = 'noc-overlay-panel z-[120]';
const SELECT_ITEM = 'font-mono text-[11px] text-popover-foreground focus:bg-primary/15 focus:text-primary data-[state=checked]:text-primary';
const DNS_FILTER_STORAGE_KEY = 'dns-control:dns-page-filters:v2';
const DEFAULT_DNS_FILTERS = { instance: 'all', qtype: 'all', timeRange: '1h' } as const;
const TIME_RANGE_HOURS: Record<string, number> = {
  '1h': 1,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '48h': 48,
  '72h': 72,
};
const PERIOD_LABELS: Record<string, string> = {
  '1h': 'Última 1 hora',
  '6h': 'Últimas 6 horas',
  '12h': 'Últimas 12 horas',
  '24h': 'Últimas 24 horas',
  '48h': 'Últimas 48 horas',
  '72h': 'Últimas 72 horas',
};

type DnsFilterState = {
  instance: string;
  qtype: string;
  timeRange: string;
};

function normalizeTimeRange(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(TIME_RANGE_HOURS, raw)) return raw;
  const legacyHours = `${Number(value)}h`;
  return Object.prototype.hasOwnProperty.call(TIME_RANGE_HOURS, legacyHours) ? legacyHours : DEFAULT_DNS_FILTERS.timeRange;
}

function readStoredDnsFilters(): DnsFilterState {
  if (typeof window === 'undefined') return DEFAULT_DNS_FILTERS;
  try {
    const raw = window.localStorage.getItem(DNS_FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_DNS_FILTERS;
    const parsed = JSON.parse(raw) as Partial<DnsFilterState>;
    const storedQtype = String(parsed.qtype || DEFAULT_DNS_FILTERS.qtype);
    return {
      instance: String(parsed.instance ?? (parsed as any).selectedInstance ?? DEFAULT_DNS_FILTERS.instance) || DEFAULT_DNS_FILTERS.instance,
      qtype: storedQtype.toLowerCase() === 'all' ? DEFAULT_DNS_FILTERS.qtype : storedQtype.toUpperCase(),
      timeRange: normalizeTimeRange(parsed.timeRange ?? (parsed as any).hours),
    };
  } catch {
    return DEFAULT_DNS_FILTERS;
  }
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

function ChartTooltip({ active, payload, label, meta }: { active?: boolean; payload?: any[]; label?: unknown; meta: ServerTimeMetadata }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-primary/30 bg-card/95 px-3 py-2 font-mono text-[11px] shadow-[0_0_24px_-8px_hsl(var(--primary)/0.65)]">
      <div className="font-bold text-foreground">{formatServerTooltipTime(label, meta)}</div>
      <div className="mt-0.5 text-muted-foreground">{meta.timezone_label} ({meta.timezone})</div>
      <div className="mt-2 space-y-1">
        {payload.filter(item => item?.value !== undefined && item?.value !== null).map(item => (
          <div key={item.dataKey || item.name} className="flex items-center justify-between gap-5">
            <span style={{ color: item.color }}>{item.name || item.dataKey}</span>
            <span className="font-bold text-foreground tabular-nums">{typeof item.value === 'number' ? item.value.toFixed(item.value % 1 === 0 ? 0 : 2) : item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MeasuredChartFrame({
  minHeight = 180,
  children,
}: {
  minHeight?: number;
  children: (size: { width: number; height: number }) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height || minHeight);
      setSize(prev => {
        const next = { width: Math.max(1, width), height: Math.max(minHeight, height) };
        return prev.width === next.width && prev.height === next.height ? prev : next;
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minHeight]);

  return (
    <div ref={ref} className="noc-chart-frame" style={{ minHeight }}>
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}

/* ============================================================
   Honest empty state for charts when no data point exists.
   Used by P1-03 fix — never fabricate a [0,0] synthetic series.
   ============================================================ */
function NoDataPlaceholder({ minHeight = 180, reason }: { minHeight?: number; reason?: string }) {
  return (
    <div
      className="noc-chart-frame flex flex-col items-center justify-center gap-1 text-center"
      style={{ minHeight }}
    >
      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        sem dados
      </span>
      <span className="font-mono text-[9px] text-muted-foreground/70">
        {reason ?? 'fonte de telemetria indisponível'}
      </span>
    </div>
  );
}


/* ============================================================
   Time-series chart panel
   ============================================================ */
function ChartPanel({
  title, data, dataKey, accent, rangeLabel, timeMeta, timeRange,
}: {
  title: string; data: any[]; dataKey: string; accent: Accent; rangeLabel?: string; timeMeta: ServerTimeMetadata; timeRange: string;
}) {
  const color = `hsl(${ACCENT_HSL[accent]})`;
  const colorAlpha = (a: number) => `hsl(${ACCENT_HSL[accent]} / ${a})`;
  const gid = `chart-${title.replace(/\s+/g, '-')}`;

  const hasData = data.length > 0;
  const series = hasData ? data : [];
  const ticks = hasData ? buildServerTimeTicks(series, timeRange) : [];


  return (
    <Panel title={title} accent={accent} badge={<div className="ml-2 flex flex-wrap items-center gap-1.5">{rangeLabel ? <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">{rangeLabel}</span> : null}<span className="rounded border border-border/60 bg-secondary/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">{timezoneBadgeText(timeMeta)}</span></div>}>
      {!hasData ? <NoDataPlaceholder minHeight={180} /> : (
      <MeasuredChartFrame minHeight={180}>{({ width, height }) => (
        <ResponsiveContainer width={width} height={height}>
          <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <defs>
              <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colorAlpha(0.12)} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={(value) => formatServerAxisTime(value, timeMeta, timeRange)} minTickGap={36} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTooltip meta={timeMeta} />} />
            <Area
              type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.5}
              fill={`url(#${gid})`} isAnimationActive={false}
              dot={false}
              style={{ filter: `drop-shadow(0 0 4px ${colorAlpha(0.6)})` }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}</MeasuredChartFrame>
      )}
    </Panel>
  );
}


/* ============================================================
   Cache Hit chart — line only, magenta/violet
   ============================================================ */
function CacheHitChart({ data, rangeLabel, timeMeta, timeRange }: { data: any[]; rangeLabel?: string; timeMeta: ServerTimeMetadata; timeRange: string }) {
  const color = 'hsl(290 80% 60%)';
  const hasData = data.length > 0;
  const series = hasData ? data : [];
  const ticks = hasData ? buildServerTimeTicks(series, timeRange) : [];
  return (
    <Panel title="Cache Hit Ratio (%)" accent="violet" badge={<div className="ml-2 flex flex-wrap items-center gap-1.5">{rangeLabel ? <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">{rangeLabel}</span> : null}<span className="rounded border border-border/60 bg-secondary/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">{timezoneBadgeText(timeMeta)}</span></div>}>
      {!hasData ? <NoDataPlaceholder minHeight={180} /> : (
      <MeasuredChartFrame minHeight={180}>{({ width, height }) => (
        <ResponsiveContainer width={width} height={height}>
          <LineChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <CartesianGrid stroke="hsl(290 60% 40% / 0.15)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={(value) => formatServerAxisTime(value, timeMeta, timeRange)} minTickGap={36} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis domain={[0, 100]} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTooltip meta={timeMeta} />} />
            <Line type="monotone" dataKey="hitRatio" stroke={color} strokeWidth={1.5} dot={false}
              isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          </LineChart>
        </ResponsiveContainer>
      )}</MeasuredChartFrame>
      )}
    </Panel>
  );
}


/* ============================================================
   Errors chart — area, pink/magenta
   ============================================================ */
function ErrorsChart({ data, rangeLabel, timeMeta, timeRange }: { data: any[]; rangeLabel?: string; timeMeta: ServerTimeMetadata; timeRange: string }) {
  const color = 'hsl(330 90% 60%)';
  const colorA = (a: number) => `hsl(330 90% 60% / ${a})`;
  const hasData = data.length > 0;
  const series = hasData ? data.map(d => ({ ...d, total: safeNum(d.servfail) + safeNum(d.nxdomain) })) : [];
  const ticks = hasData ? buildServerTimeTicks(series, timeRange) : [];
  return (
    <Panel title="Erros. (SERVFAIL + NXDOMAIN)" accent="violet" badge={<div className="ml-2 flex flex-wrap items-center gap-1.5">{rangeLabel ? <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">{rangeLabel}</span> : null}<span className="rounded border border-border/60 bg-secondary/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">{timezoneBadgeText(timeMeta)}</span></div>}>
      {!hasData ? <NoDataPlaceholder minHeight={180} /> : (
      <MeasuredChartFrame minHeight={180}>{({ width, height }) => (
        <ResponsiveContainer width={width} height={height}>
          <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 4, left: -10 }}>
            <defs>
              <linearGradient id="err-grad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.55} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colorA(0.1)} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={(value) => formatServerAxisTime(value, timeMeta, timeRange)} minTickGap={36} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<ChartTooltip meta={timeMeta} />} />
            <Area type="monotone" dataKey="total" stroke={color} strokeWidth={1.5} fill="url(#err-grad)" isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
          </AreaChart>
        </ResponsiveContainer>
      )}</MeasuredChartFrame>
      )}
    </Panel>
  );
}


/* ============================================================
   Helpers — bytes formatter
   ============================================================ */
function formatBytes(n: number): string {
  if (!n || !Number.isFinite(n)) return '0 B';
  if (n < 1024) return `${n.toFixed(0)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/* ============================================================
   Empty-state diagnostic for Top Domains/Clients
   ============================================================ */
function EmptyTopState({ analytics, windowMin }: { analytics: any; windowMin: number }) {
  const src = analytics?.log_source || 'none';
  const parsed = Number(analytics?.queries_parsed || 0);
  const infoLines = Number(analytics?.diag?.info_lines || 0);
  const totalLines = Number(analytics?.diag?.total_lines || 0);

  let hint: React.ReactNode;
  if (src === 'none') {
    hint = (
      <>
        Coletor <b>sem fonte de log</b>. Habilite <code className="px-1 rounded bg-muted/40">log-queries: yes</code>{' '}
        e <code className="px-1 rounded bg-muted/40">use-syslog: yes</code> em todos os
        <code className="px-1 rounded bg-muted/40">/etc/unbound/unbound*.conf</code> e reinicie o serviço.
      </>
    );
  } else if (parsed === 0 && infoLines > 0) {
    hint = (
      <>
        Fonte ativa (<code className="px-1 rounded bg-muted/40">{src}</code>) com {infoLines} linhas <i>info:</i>, mas
        <b> 0 queries reconhecidas</b>. Provável: <code className="px-1 rounded bg-muted/40">log-queries: yes</code> ausente
        nos <i>unbound*.conf</i> (apenas estatísticas estão sendo logadas).
      </>
    );
  } else if (parsed === 0 && totalLines === 0) {
    hint = (
      <>
        Fonte <code className="px-1 rounded bg-muted/40">{src}</code> não retornou nenhuma linha. Verifique se o
        serviço unbound está logando no <i>journal</i> e se o coletor tem permissão (<code className="px-1 rounded bg-muted/40">sudo journalctl</code>).
      </>
    );
  } else {
    hint = <>Coletor ativo (<code className="px-1 rounded bg-muted/40">{src}</code>). Aguardando próxima janela.</>;
  }

  return (
    <div className="text-center text-muted-foreground text-[11px] py-8 px-3 leading-relaxed">
      Sem dados na janela de {windowMin} min.
      <div className="mt-2 text-muted-foreground/70 text-left max-w-md mx-auto">{hint}</div>
    </div>
  );
}

/* ============================================================
   Segmented control — section focus
   ============================================================ */
type SectionTab = 'overview' | 'domains' | 'clients' | 'backends' | 'traffic';

function SectionTabs({ value, onChange }: { value: SectionTab; onChange: (v: SectionTab) => void }) {
  const tabs: Array<{ id: SectionTab; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: 'Visão Geral', icon: <Activity size={12} /> },
    { id: 'domains', label: 'Domínios', icon: <Globe size={12} /> },
    { id: 'clients', label: 'Clientes', icon: <Users size={12} /> },
    { id: 'backends', label: 'Backends', icon: <Server size={12} /> },
    { id: 'traffic', label: 'Tráfego', icon: <Activity size={12} /> },
  ];
  return (
    <div className="inline-flex items-center gap-1 rounded-lg p-1 border border-border/60 bg-card/70">
      {tabs.map(t => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono font-bold uppercase tracking-wider transition-all ${
              active
                ? 'bg-primary/15 text-primary border border-primary/40'
                : 'text-muted-foreground hover:text-foreground/90 border border-transparent'
            }`}
            style={active ? { boxShadow: '0 0 12px -4px hsl(var(--primary) / 0.6)' } : undefined}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Multi-line traffic chart (QPS + CacheHit + Latência)
   ============================================================ */
function TrafficEvolutionChart({ data, rangeLabel, timeMeta, timeRange }: { data: any[]; rangeLabel?: string; timeMeta: ServerTimeMetadata; timeRange: string }) {
  const hasData = data.length > 0;
  const series = hasData ? data : [];
  const ticks = hasData ? buildServerTimeTicks(series, timeRange) : [];
  const cQps = 'hsl(200 90% 60%)';
  const cHit = 'hsl(162 72% 51%)';
  const cLat = 'hsl(270 75% 65%)';
  return (
    <Panel
      title="Evolução do Tráfego"
      accent="blue"
      badge={<div className="ml-2 flex flex-wrap items-center gap-1.5">{rangeLabel ? <span className="rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">{rangeLabel}</span> : null}<span className="rounded border border-border/60 bg-secondary/70 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground">{timezoneBadgeText(timeMeta)}</span></div>}
    >
      {!hasData ? <NoDataPlaceholder minHeight={220} /> : (
      <MeasuredChartFrame minHeight={220}>{({ width, height }) => (
        <ResponsiveContainer width={width} height={height}>
          <LineChart data={series} margin={{ top: 6, right: 30, bottom: 4, left: -10 }}>
            <CartesianGrid stroke="hsl(220 35% 18% / 0.6)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} ticks={ticks} tickFormatter={(value) => formatServerAxisTime(value, timeMeta, timeRange)} minTickGap={36} stroke="hsl(215 15% 40%)" tick={{ fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} interval={0} />
            <YAxis yAxisId="left" stroke={cQps} tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: cQps }} tickLine={false} axisLine={false} width={36}
              label={{ value: 'Queries (QPS)', angle: -90, position: 'insideLeft', style: { fill: cQps, fontFamily: 'JetBrains Mono', fontSize: 9 }, dy: 40 }} />
            <YAxis yAxisId="right" orientation="right" stroke={cLat} tick={{ fontSize: 9, fontFamily: 'JetBrains Mono', fill: cLat }} tickLine={false} axisLine={false} width={36}
              label={{ value: 'Latência (ms)', angle: 90, position: 'insideRight', style: { fill: cLat, fontFamily: 'JetBrains Mono', fontSize: 9 }, dy: -40 }} />
            <Tooltip content={<ChartTooltip meta={timeMeta} />} />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: 'JetBrains Mono' }} iconType="line" />
            <Line yAxisId="left" type="monotone" dataKey="qps" name="Queries (QPS)" stroke={cQps} strokeWidth={1.6} dot={false} isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${cQps})` }} />
            <Line yAxisId="left" type="monotone" dataKey="hitRatio" name="Cache Hit (%)" stroke={cHit} strokeWidth={1.6} dot={false} isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${cHit})` }} />
            <Line yAxisId="right" type="monotone" dataKey="latency" name="Latência (ms)" stroke={cLat} strokeWidth={1.6} dot={false} isAnimationActive={false}
              style={{ filter: `drop-shadow(0 0 4px ${cLat})` }} />
          </LineChart>
        </ResponsiveContainer>
      )}</MeasuredChartFrame>
      )}
    </Panel>
  );
}


/* ============================================================
   MAIN PAGE
   ============================================================ */
export default function DnsPage() {
  const storedFilters = useMemo(() => readStoredDnsFilters(), []);
  const { data: telemetry, isLoading, error } = useTelemetry();
  const { data: telemetryHistory } = useTelemetryHistory();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<DnsFilterState>(storedFilters);
  const selectedInstance = filters.instance === 'all' ? '' : filters.instance;
  const qtype = filters.qtype === 'all' ? '' : filters.qtype;
  const timeRange = filters.timeRange;
  const hours = TIME_RANGE_HOURS[timeRange] ?? TIME_RANGE_HOURS[DEFAULT_DNS_FILTERS.timeRange];
  const setFilter = (patch: Partial<DnsFilterState>) => setFilters(prev => ({ ...prev, ...patch }));
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionTab>('overview');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(DNS_FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  const resetFilters = () => {
    setFilters(DEFAULT_DNS_FILTERS);
    setShowOnlyAlerts(false);
    window.localStorage.removeItem(DNS_FILTER_STORAGE_KEY);
    qc.invalidateQueries({ queryKey: ['dnsMetrics'] });
    qc.invalidateQueries({ queryKey: ['telemetry', 'recent-queries'] });
  };

  // GATE-RETENÇÃO opção (c): janela curta (1h) → buffer local em /api/dns/metrics;
  // janelas longas (6h..72h) → TSDB externo via proxy /api/telemetry/range
  // (dns_chart_bundle). Degradação honesta quando o TSDB não está configurado.
  const isLongWindow = (TIME_RANGE_HOURS[timeRange] ?? 1) > 1;
  const { data: dnsMetricsPayload, refetch: refetchDnsMetrics } = useQuery({
    queryKey: ['dnsMetrics', filters.instance, filters.qtype, filters.timeRange, isLongWindow ? 'tsdb' : 'local'],
    queryFn: async () => {
      if (isLongWindow) {
        const r = await api.getTelemetryRange({
          metric: 'dns_chart_bundle',
          window: timeRange,
          instance: selectedInstance || undefined,
        });
        if (!r.success) throw new Error(r.error!);
        return {
          rows: r.data?.rows ?? [],
          source: r.data?.source ?? 'none',
          source_available: r.data?.source_available ?? false,
          degraded: r.data?.degraded ?? true,
          reason: r.data?.reason,
        };
      }
      const r = await api.getDnsMetrics({ instance: selectedInstance || undefined, qtype: qtype || undefined, range: timeRange });
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 30000,
  });
  // P1-03: unwrap the explicit envelope; never invent a [0,0] point.
  const filteredMetrics = Array.isArray(dnsMetricsPayload?.rows) ? dnsMetricsPayload!.rows : [];
  const dnsMetricsSourceAvailable = dnsMetricsPayload?.source_available !== false;


  const { data: serverTimeMeta } = useQuery({
    queryKey: ['system', 'time'],
    queryFn: async () => {
      const r = await api.getSystemTime();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 60000,
  });
  const timeMeta = serverTimeMeta ?? DEFAULT_SERVER_TIME_META;

  const { data: recentQueries } = useQuery({
    queryKey: ['telemetry', 'recent-queries', filters.instance, filters.qtype, filters.timeRange],
    queryFn: async () => {
      const r = await api.getRecentQueries({ instance: selectedInstance || undefined, qtype: qtype || undefined, range: timeRange, limit: 1000 });
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
    placeholderData: previousData => previousData,
  });

  const { data: queryRankings } = useQuery({
    queryKey: ['telemetry', 'query-rankings', filters.timeRange],
    queryFn: async () => {
      const r = await api.getQueryRankings({ range: timeRange, limit: 30 });
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
    placeholderData: previousData => previousData,
  });

  useEffect(() => {
    refetchDnsMetrics();
  }, [filters.instance, filters.qtype, filters.timeRange, refetchDnsMetrics]);

  const chartData = useMemo(() => {
    // ── P1-04 canonical unit for chartData ────────────────────────────────
    // `hitRatio` MUST be expressed as a percentage in the 0-100 scale.
    // Sources we accept here (collector live snapshot, MetricSample history,
    // unbound-control resolver block) are ALL already 0-100. The Prometheus
    // exposition is 0-1 by convention and is NEVER read into this chart —
    // it lives at /api/prometheus and is converted at that border only.
    // ─────────────────────────────────────────────────────────────────────
    const dbRows = Array.isArray(filteredMetrics) ? filteredMetrics : [];
    const histRows = Array.isArray(telemetryHistory) ? telemetryHistory : [];
    // Fall back to collector circular history when DB-backed metrics are empty
    // (covers Cache Hit Ratio + Latency widgets when DnsEvent/MetricSample tables are empty).
    const metricRows = dbRows.length > 0 ? dbRows : histRows;

    const historyRows = metricRows;
    const telemetryBackends = Array.isArray(telemetry?.backends) ? telemetry.backends : [];
    const selectedBackend = selectedInstance
      ? telemetryBackends.find((b: any) => sameInstance(backendName(b), selectedInstance))
      : null;
    const allBackendQueries = telemetryBackends.reduce((sum: number, b: any) => sum + safeNum(b?.resolver?.total_queries), 0);
    const instanceShare = selectedInstance && selectedBackend && allBackendQueries > 0
      ? Math.max(0, Math.min(1, safeNum(selectedBackend?.resolver?.total_queries) / allBackendQueries))
      : 1;
    const queryTypeRows = Array.isArray(telemetry?.top_query_types) ? telemetry.top_query_types : [];
    const allTypeQueries = queryTypeRows.reduce((sum: number, t: any) => sum + safeNum(t?.count), 0);
    const selectedTypeQueries = qtype
      ? safeNum(queryTypeRows.find((t: any) => queryTypeOf(t) === qtype)?.count)
      : 0;
    const typeShare = qtype && allTypeQueries > 0
      ? Math.max(0, Math.min(1, selectedTypeQueries / allTypeQueries))
      : 1;
    const countShare = instanceShare * typeShare;
    const timedMetrics = metricRows
      .filter((p: any) => rowMatchesFilters(p, selectedInstance, ''))
      .filter((p: any) => toTs(p.timestamp_utc ?? p.timestamp ?? p.epoch) > 0);
    const liveMetricRows = selectedInstance && metricRows.length > 0
      ? metricRows
        .filter((p: any) => rowMatchesFilters(p, selectedInstance, ''))
        .map((p: any) => ({ ...p, timestamp_utc: p.timestamp_utc ?? p.timestamp ?? telemetry?.timestamp ?? new Date().toISOString() }))
      : [];
    const filteredHistoryRows = historyRows.filter((p: any) => rowMatchesFilters(p, selectedInstance, '', { allowMissingInstance: true }));
    const history = timedMetrics.length > 0 ? timedMetrics : filteredHistoryRows.length > 0 ? filteredHistoryRows : liveMetricRows;
    const minTs = Date.now() - hours * 60 * 60 * 1000;
    const series = history
      .filter((p: any) => {
        const ts = toTs(p.timestamp_utc ?? p.timestamp ?? p.epoch);
        return !ts || ts >= minTs;
      })
      .map((p: any) => {
        const ts = toTs(p.timestamp_utc ?? p.timestamp ?? p.epoch);
        return {
        ts,
        time: ts ? formatServerAxisTime(ts, timeMeta) : '',
        qps: Math.round(firstNum(p.qps, p.queries_per_second) * countShare * 100) / 100,
        latency: selectedBackend ? safeNum(selectedBackend?.resolver?.recursion_avg_ms) : firstNum(p.latency_ms, p.latency_avg_ms, p.avgLatencyMs, p.avg_latency_ms),
        servfail: Math.round(firstNum(p.servfail, p.servfail_count) * countShare),
        nxdomain: Math.round(firstNum(p.nxdomain, p.nxdomain_count) * countShare),
        hitRatio: selectedBackend ? safeNum(selectedBackend?.resolver?.cache_hit_ratio) : firstNum(p.cache_hit_ratio, p.cacheHitRatio),
        totalQueries: Math.round(firstNum(p.total_queries, p.totalQueries, p.queries_total, p.queries) * countShare),
        cacheHits: Math.round(firstNum(p.cache_hits, p.cacheHits) * countShare),
        cacheMisses: Math.round(firstNum(p.cache_misses, p.cacheMisses) * countShare),
      };
      });

    if (series.length > 0) return series;
    const resolver = telemetry?.resolver ?? {};
    const fallbackTs = toTs(telemetry?.timestamp ?? Date.now());
    // P1-03: only synthesize a single fallback point if the live resolver
    // actually reports activity — otherwise return [] and let the chart
    // render the honest empty-state placeholder instead of [0,0].
    const liveHasSignal =
      firstNum(resolver.total_queries) > 0 ||
      firstNum(resolver.qps) > 0 ||
      firstNum(resolver.cache_hit_ratio) > 0 ||
      (selectedBackend && safeNum(selectedBackend?.resolver?.total_queries) > 0);
    if (!liveHasSignal && !dnsMetricsSourceAvailable) return [];
    if (!liveHasSignal) return [];
    return [{
      ts: fallbackTs,
      time: fallbackTs ? formatServerAxisTime(fallbackTs, timeMeta) : '',
      qps: Math.round(firstNum(resolver.qps) * countShare * 100) / 100,
      latency: selectedBackend ? safeNum(selectedBackend?.resolver?.recursion_avg_ms) : firstNum(resolver.avg_latency_ms),
      servfail: Math.round(firstNum(resolver.servfail) * countShare),
      nxdomain: Math.round(firstNum(resolver.nxdomain) * countShare),
      hitRatio: selectedBackend ? safeNum(selectedBackend?.resolver?.cache_hit_ratio) : firstNum(resolver.cache_hit_ratio),
      totalQueries: Math.round(firstNum(resolver.total_queries) * countShare),
      cacheHits: Math.round(firstNum(resolver.cache_hits) * countShare),
      cacheMisses: Math.round(firstNum(resolver.cache_misses) * countShare),
    }];

  }, [filteredMetrics, telemetryHistory, hours, selectedInstance, qtype, telemetry, timeMeta, dnsMetricsSourceAvailable]);

  const collectorOk = telemetry?.health?.collector === 'ok';
  const resolver = telemetry?.resolver ?? {};
  const backends = Array.isArray(telemetry?.backends) ? telemetry.backends : [];
  const queryAnalytics = telemetry?.query_analytics ?? {};
  const visibleBackends = selectedInstance
    ? backends.filter((b: any) => sameInstance(backendName(b), selectedInstance))
    : backends;
  const selectedBackends = visibleBackends.length ? visibleBackends : backends;
  const allRecentItems = useMemo(() => {
    const apiItems = Array.isArray(recentQueries?.items) ? recentQueries.items : [];
    const telemetryItems = Array.isArray(telemetry?.recent_queries) ? telemetry.recent_queries : [];
    const src = apiItems.length ? apiItems : telemetryItems;
    return src.filter((q: any) => rowMatchesFilters(q, selectedInstance, qtype, { allowMissingInstance: true }));
  }, [recentQueries, telemetry, selectedInstance, qtype]);
  const availableQtypes = useMemo(() => {
    const fromApi = Array.isArray(recentQueries?.available_types) ? recentQueries.available_types : [];
    const fromTelemetry = Array.isArray(telemetry?.top_query_types)
      ? telemetry.top_query_types.map((t: any) => t.type)
      : [];
    const fromRecent = [
      ...(Array.isArray(recentQueries?.items) ? recentQueries.items : []),
      ...(Array.isArray(telemetry?.recent_queries) ? telemetry.recent_queries : []),
    ].map(queryTypeOf);
    const stableDefaults = ['A', 'AAAA', 'HTTPS', 'NAPTR', 'NS', 'PTR', 'SOA', 'SRV', 'SVCB', 'TXT'];
    return Array.from(new Set([...stableDefaults, ...fromApi, ...fromTelemetry, ...fromRecent].filter(Boolean).map((t: string) => t.toUpperCase()))).sort();
  }, [recentQueries, telemetry]);
  const filteredRecentItems = allRecentItems;
  const querySeries = useMemo(() => {
    if ((!qtype && !selectedInstance) || filteredRecentItems.length === 0) return [];
    const buckets = filteredRecentItems.reduce((acc: Record<string, number>, q: any) => {
      const time = String(q?.time ?? '').slice(0, 5) || '--:--';
      acc[time] = (acc[time] ?? 0) + 1;
      return acc;
    }, {});
    const today = new Date();
    return Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b)).map(([time, count]) => ({
      ts: Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), Number(time.slice(0, 2)) || 0, Number(time.slice(3, 5)) || 0),
      time,
      qps: count,
      latency: 0,
      servfail: 0,
      nxdomain: 0,
      hitRatio: 0,
      totalQueries: count,
      cacheHits: 0,
      cacheMisses: 0,
    }));
  }, [qtype, selectedInstance, filteredRecentItems]);
  const effectiveChartData = chartData.length ? chartData : querySeries;
  const topDomainsRaw = Array.isArray(queryRankings?.top_domains) ? queryRankings.top_domains
    : Array.isArray(telemetry?.top_domains) ? telemetry.top_domains
    : Array.isArray(queryAnalytics?.top_domains) ? queryAnalytics.top_domains : [];

  // Live state: any signal of data → connected (don't gate KPIs on collector flag alone)
  const hasMetrics = Array.isArray(filteredMetrics) && filteredMetrics.length > 0;
  const hasBackends = backends.length > 0;
  const telemetryConnected = collectorOk || hasMetrics || hasBackends;

  // Aggregate window metrics (sum/avg over the selected range, not last point only)
  const metricsArr: any[] = effectiveChartData;
  const latestMetric = metricsArr.length > 0 ? metricsArr[metricsArr.length - 1] : null;

  // Fall back to backend-aggregated values from telemetry for instant display
  const filteredRecentCount = filteredRecentItems.length;
  const qtypeAggregateCount = qtype && Array.isArray(telemetry?.top_query_types)
    ? safeNum(telemetry.top_query_types.find((t: any) => queryTypeOf(t) === qtype)?.count)
    : 0;
  const qtypeSelectedCount = qtype ? (filteredRecentCount || qtypeAggregateCount) : 0;
  const hasQueryFilterData = Boolean(qtype);
  const backendQueries = selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.total_queries), 0);
  const backendCacheHits = selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.cache_hits), 0);
  const backendCacheMisses = selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.cache_misses), 0);
  const backendServfail = selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.servfail), 0);

  const totalQueries = countWindow(metricsArr, 'totalQueries')
      || safeNum(latestMetric?.totalQueries)
      || (hasQueryFilterData ? qtypeSelectedCount : 0)
      || (selectedInstance ? backendQueries : 0)
      || backendQueries
      || safeNum(resolver.total_queries);

  const cacheHitRatio = selectedInstance && (backendCacheHits + backendCacheMisses) > 0
    ? Math.round((backendCacheHits / (backendCacheHits + backendCacheMisses)) * 1000) / 10
    : safeNum(latestMetric?.hitRatio)
    || (selectedBackends.length
      ? Math.round(selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.cache_hit_ratio), 0) / selectedBackends.length)
      : safeNum(resolver.cache_hit_ratio));

  const avgLatency = selectedInstance
    ? (selectedBackends.length ? selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.recursion_avg_ms), 0) / selectedBackends.length : 0)
    : safeNum(latestMetric?.latency)
    || (selectedBackends.length
      ? selectedBackends.reduce((a: number, b: any) => a + safeNum(b.resolver?.recursion_avg_ms), 0) / selectedBackends.length
      : safeNum(resolver.avg_latency_ms));

  const totalServfail = countWindow(metricsArr, 'servfail')
      || safeNum(latestMetric?.servfail)
      || (selectedInstance ? backendServfail : 0)
      || backendServfail
      || safeNum(resolver.servfail);

  const qps = safeNum(latestMetric?.qps) || safeNum(resolver.qps);

  // Sparkline data per KPI
  const sparkQ = effectiveChartData.slice(-30).map(d => safeNum(d.qps));
  const sparkH = effectiveChartData.slice(-30).map(d => safeNum(d.hitRatio) || cacheHitRatio);
  const sparkL = effectiveChartData.slice(-30).map(d => safeNum(d.latency) || avgLatency);
  const sparkE = effectiveChartData.slice(-30).map(d => safeNum(d.servfail) + safeNum(d.nxdomain));

  const recentDomainCounts = allRecentItems.reduce((acc: Record<string, number>, q: any) => {
    const domain = queryDomainOf(q);
    if (domain) acc[domain] = (acc[domain] ?? 0) + 1;
    return acc;
  }, {});
  const topDomainsSource = (qtype || selectedInstance) && Object.keys(recentDomainCounts).length
    ? Object.entries(recentDomainCounts)
        .map(([domain, count]) => ({ domain, count: Number(count) || 0 }))
        .sort((a, b) => b.count - a.count)
    : topDomainsRaw;
  const topDomains = topDomainsSource
    .slice(0, showOnlyAlerts ? 5 : 30).map((d: any) => ({
      domain: d.domain || d.name || '—',
      count: firstNum(d.query_count, d.queryCount, d.count, d.queries),
    }));
  const maxDomain = Math.max(1, ...topDomains.map((d: any) => d.count));

  // ─── nftables traffic totals (PRESERVED — same telemetry source) ───
  const traffic = (telemetry as any)?.traffic ?? {};
  const trafficTotalPackets = safeNum(traffic.total_packets);
  const trafficTotalBytes = safeNum(traffic.total_bytes);
  const trafficQpsNft = safeNum(traffic.qps);
  const trafficDeltaPackets = safeNum(traffic.delta_packets ?? traffic.deltaPackets);

  // ─── per-backend nftables traffic distribution ───
  const backendTraffic = backends.map((b: any) => {
    const t = b?.traffic ?? {};
    return {
      name: backendName(b),
      packets: safeNum(t.packets),
      bytes: safeNum(t.bytes),
      share: safeNum(t.share),
    };
  });
  const totalBackendPackets = backendTraffic.reduce((a, b) => a + b.packets, 0);

  // ─── top clients (PRESERVED — telemetry.top_clients) ───
  const topClientsRaw: any[] = Array.isArray(queryRankings?.top_clients) ? queryRankings.top_clients
    : Array.isArray((telemetry as any)?.top_clients) ? (telemetry as any).top_clients : [];
  const topClients = topClientsRaw
    .map((c: any) => ({
      ip: c.client || c.ip || c.address || '—',
      count: firstNum(c.queries, c.query_count, c.count, c.value),
    }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const maxClient = Math.max(1, ...topClients.map(c => c.count));

  const periodLabel = PERIOD_LABELS[timeRange] ?? PERIOD_LABELS[DEFAULT_DNS_FILTERS.timeRange];
  const activeFilters = [
    `Instância: ${selectedInstance || 'Todas'}`,
    `QType: ${qtype || 'Todos'}`,
    `Período: ${periodLabel}`,
  ];
  const hasActiveFilters = filters.instance !== DEFAULT_DNS_FILTERS.instance || filters.qtype !== DEFAULT_DNS_FILTERS.qtype || filters.timeRange !== DEFAULT_DNS_FILTERS.timeRange;

  // Environment summary
  const lastCollect = telemetry?.timestamp ? formatServerDateTime(telemetry.timestamp, timeMeta, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const uniqueClients = topClientsRaw.length || safeNum((telemetry as any)?.top_clients_count);
  const uniqueDomains = topDomainsRaw.length || safeNum((telemetry as any)?.top_domains_count);

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['telemetry'] }),
        qc.invalidateQueries({ queryKey: ['dnsMetrics'] }),
      ]);
      await new Promise(r => setTimeout(r, 600));
    } finally {
      setRefreshing(false);
    }
  };

  // Highlight which sections to emphasize based on segmented control (none are hidden — focus only)
  const isOverview = activeSection === 'overview';
  const focusRing = (key: SectionTab): string =>
    activeSection === key && !isOverview
      ? 'ring-1 ring-primary/50 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.55)]'
      : '';

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  return (
    <div className="space-y-4 noc-page">
      {/* ───── HEADER (search + status badges + collector) ───── */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1 pt-1 pb-1">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-3xl xl:text-4xl font-bold tracking-tight text-foreground">Métricas DNS</h1>
          <p className="text-[11px] font-mono text-muted-foreground/80 truncate">
            Dados reais via collector (unbound-control + nftables)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-mono text-muted-foreground/80 min-w-[260px]"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Search size={12} />
            <input
              placeholder="Buscar métricas (Ctrl+K)"
              className="bg-transparent border-0 outline-none w-full text-foreground/85 placeholder:text-muted-foreground/50"
            />
          </div>
          <button
            onClick={() => navigate('/events?severity=warning,critical')}
            title="Ver alertas operacionais"
            className="relative p-2 rounded-md text-muted-foreground hover:text-warning transition-colors"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Bell size={14} />
            {totalServfail > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-warning text-warning-foreground text-[8px] font-bold flex items-center justify-center px-1">
                {totalServfail > 99 ? '99+' : totalServfail}
              </span>
            )}
          </button>
          <button
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-mono text-foreground/85"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <SlidersHorizontal size={12} /> Padrão
          </button>
          <div className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-mono"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(162 72% 51% / 0.4)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-primary" style={{ boxShadow: '0 0 6px hsl(var(--primary))' }} />
            <span className="text-primary font-bold uppercase tracking-wider">Operacional</span>
          </div>
        </div>
      </div>

      {/* ───── Active filter strip + collector status ───── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/80 px-4 py-2.5 font-mono text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground uppercase tracking-[0.18em]">Filtro ativo</span>
          {activeFilters.map(filter => (
            <span key={filter} className="rounded border border-primary/25 bg-primary/10 px-2.5 py-1 text-primary">
              {filter}
            </span>
          ))}
          <button
            onClick={resetFilters}
            disabled={!hasActiveFilters}
            className="rounded-md border border-border bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-secondary-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-45"
          >
            Reset
          </button>
        </div>
        <div className="flex items-center gap-3 text-muted-foreground/80">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded ${collectorOk ? 'border border-primary/40 bg-primary/10 text-primary' : 'border border-warning/40 bg-warning/10 text-warning'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${collectorOk ? 'bg-primary' : 'bg-warning'}`} />
            Collector: {collectorOk ? 'OK' : 'DEGRADADO'}
          </span>
          <span>Última coleta: <span className="text-foreground/90">{lastCollect}</span></span>
        </div>
      </div>

      {/* Global telemetry provenance strip (mode/source/freshness/retention) */}
      <TelemetryHealthStrip />

      {/* ───── 6 KPI cards (single horizontal row, auto-fit) ───── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))' }}>
        {(() => {
          // Honest empty-state: when the local source has NO real signal
          // (no source_available, no metrics, no backends), KPI cards must
          // show "—" instead of fabricated zeros derived from defaults.
          const noSource = !dnsMetricsSourceAvailable && !telemetryConnected;
          const dash = '—';
          return (
            <>
              <KpiCardLarge
                label="Total Queries"
                value={noSource ? dash : totalQueries.toLocaleString()}
                sub={noSource ? 'sem dados' : `QPS: ${qps}`}
                accent="blue" sparkData={noSource ? [] : sparkQ}
                icon={<Layers size={24} strokeWidth={1.6} />}
              />
              <KpiCardLarge
                label="Cache Hit"
                value={noSource ? dash : `${cacheHitRatio}%`}
                sub={noSource ? 'sem dados' : (backendCacheHits > 0 ? `${backendCacheHits.toLocaleString()} hits` : 'Eficiente')}
                accent="mint" sparkData={noSource ? [] : sparkH}
                icon={<Database size={24} strokeWidth={1.6} />}
              />
              <KpiCardLarge
                label="Latência"
                value={noSource ? dash : `${avgLatency.toFixed(0)}ms`}
                sub={noSource ? 'sem dados' : 'Recursion avg'}
                accent="violet" sparkData={noSource ? [] : sparkL}
                icon={<Timer size={24} strokeWidth={1.6} />}
              />
            </>
          );
        })()}
        <KpiCardLarge
          label="Total Packets"
          value={trafficTotalPackets > 0 ? trafficTotalPackets.toLocaleString('de-DE') : '0'}
          sub="nftables counters"
          accent="blue" sparkData={sparkQ}
          icon={<Package size={24} strokeWidth={1.6} />}
        />
        <KpiCardLarge
          label="Total Bytes"
          value={formatBytes(trafficTotalBytes)}
          sub="nftables"
          accent="violet" sparkData={sparkQ}
          icon={<HardDrive size={24} strokeWidth={1.6} />}
        />
        <KpiCardLarge
          label="QPS (NFT)"
          value={trafficQpsNft > 0 ? trafficQpsNft.toFixed(1) : qps.toFixed(1)}
          sub={trafficDeltaPackets > 0 ? `Δ ${trafficDeltaPackets.toLocaleString()} pkts` : 'Delta de pacotes'}
          accent="orange" sparkData={sparkE}
          icon={<Zap size={24} strokeWidth={1.6} />}
        />
      </div>

      {/* ───── Segmented control + time/instance/qtype filters ───── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <SectionTabs value={activeSection} onChange={setActiveSection} />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Layers size={13} />
            <Select value={filters.instance} onValueChange={(value) => setFilter({ instance: value })}>
              <SelectTrigger className="h-auto min-h-0 w-[150px] border-0 bg-transparent p-0 font-mono text-[11px] text-foreground ring-offset-0 focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={SELECT_PANEL}>
                <SelectItem className={SELECT_ITEM} value="all">Todas instâncias</SelectItem>
                {backends.map((b: any) => {
                  const id = String(b.name || b.instance || b.id || '');
                  return id ? <SelectItem className={SELECT_ITEM} key={id} value={id}>{id}</SelectItem> : null;
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <ChevronDown size={13} />
            <Select value={filters.qtype} onValueChange={(value) => setFilter({ qtype: value })}>
              <SelectTrigger className="h-auto min-h-0 w-[112px] border-0 bg-transparent p-0 font-mono text-[11px] text-foreground ring-offset-0 focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={SELECT_PANEL}>
                <SelectItem className={SELECT_ITEM} value="all">Todos tipos</SelectItem>
                {availableQtypes.map((t: string) => <SelectItem className={SELECT_ITEM} key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <Calendar size={13} />
            <Select value={timeRange} onValueChange={(value) => setFilter({ timeRange: value })}>
              <SelectTrigger className="h-auto min-h-0 w-[150px] border-0 bg-transparent p-0 font-mono text-[11px] text-foreground ring-offset-0 focus:ring-0 focus:ring-offset-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={SELECT_PANEL}>
                <SelectItem className={SELECT_ITEM} value="1h">Última 1 hora</SelectItem>
                <SelectItem className={SELECT_ITEM} value="6h">Últimas 6 horas</SelectItem>
                <SelectItem className={SELECT_ITEM} value="12h">Últimas 12 horas</SelectItem>
                <SelectItem className={SELECT_ITEM} value="24h">Últimas 24 horas</SelectItem>
                <SelectItem className={SELECT_ITEM} value="48h">Últimas 48 horas</SelectItem>
                <SelectItem className={SELECT_ITEM} value="72h">Últimas 72 horas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <button
            onClick={refreshAll}
            disabled={refreshing}
            title="Atualizar agora"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[11px] font-mono text-muted-foreground hover:text-primary transition-all disabled:opacity-60"
            style={{ background: 'hsl(220 42% 7%)', border: '1px solid hsl(220 35% 14%)' }}>
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Auto
          </button>
        </div>
      </div>

      {/* ───── Main grid: Top Domínios | Top Clientes | (Distribuição nft + Métricas backend) ───── */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}
      >
        {/* LEFT — Top Domínios */}
        <div className={`min-w-0 ${focusRing('domains')} rounded-xl`}>
          <Panel
            title="Top Domínios Consultados"
            accent="mint"
            badge={
              <span className="ml-2 inline-flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/10 px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-primary">
                  Fonte: {queryRankings?.log_source ?? queryAnalytics?.log_source ?? 'none'} · {filteredRecentItems.length} queries parsed
                </span>
                <FallbackRankingsBadge logSource={queryRankings?.log_source ?? queryAnalytics?.log_source} />
              </span>
            }
          >
            <div className="space-y-1.5">
              {topDomains.length === 0 && (
                <EmptyTopState analytics={queryAnalytics} windowMin={safeNum((telemetry as any)?.window_minutes) || 30} />
              )}
              <div className="max-h-[520px] overflow-y-auto pr-1 space-y-1.5">
              {topDomains.slice(0, 30).map((d: any, i: number) => {
                const pct = (d.count / maxDomain) * 100;
                return (
                  <div key={d.domain} className="grid grid-cols-[18px_1fr_auto] gap-2 items-center text-[11px] font-mono py-0.5">
                    <span className="text-muted-foreground/60 tabular-nums text-right">{i + 1}.</span>
                    <div className="min-w-0">
                      <div className="text-foreground/90 truncate mb-1">{d.domain}</div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'hsl(220 42% 9%)' }}>
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
              {topDomains.length > 0 && (
                <button
                  onClick={() => setActiveSection('domains')}
                  className="mt-3 w-full text-[10px] font-mono text-muted-foreground/70 hover:text-primary px-2 py-2 rounded border border-border/40 hover:border-primary/40 transition-colors"
                >
                  Ver todos os domínios →
                </button>
              )}
            </div>
          </Panel>
        </div>

        {/* CENTER — Top Clientes */}
        <div className={`min-w-0 ${focusRing('clients')} rounded-xl`}>
          <Panel title="Top Clientes DNS" accent="violet" badge={<FallbackRankingsBadge logSource={queryRankings?.log_source ?? queryAnalytics?.log_source} />}>
            <div className="space-y-1.5">
              {topClients.length === 0 && (
                <EmptyTopState analytics={queryAnalytics} windowMin={safeNum((telemetry as any)?.window_minutes) || 30} />
              )}
              <div className="max-h-[520px] overflow-y-auto pr-1 space-y-1.5">
              {topClients.map((c, i) => {
                const pct = (c.count / maxClient) * 100;
                return (
                  <div key={c.ip} className="grid grid-cols-[18px_1fr_auto] gap-2 items-center text-[11px] font-mono py-0.5">
                    <span className="text-muted-foreground/60 tabular-nums text-right">{i + 1}.</span>
                    <div className="min-w-0">
                      <div className="text-foreground/90 truncate mb-1">{c.ip}</div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: 'hsl(220 42% 9%)' }}>
                        <div className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            background: 'linear-gradient(90deg, hsl(270 75% 65%), hsl(290 80% 70%))',
                            boxShadow: '0 0 6px hsl(270 75% 65% / 0.7)',
                          }} />
                      </div>
                    </div>
                    <span className="text-foreground/85 tabular-nums whitespace-nowrap">{c.count.toLocaleString('de-DE')}</span>
                  </div>
                );
              })}
              </div>
              {topClients.length > 0 && (
                <button
                  onClick={() => setActiveSection('clients')}
                  className="mt-3 w-full text-[10px] font-mono text-muted-foreground/70 hover:text-primary px-2 py-2 rounded border border-border/40 hover:border-primary/40 transition-colors"
                >
                  Ver todos os clientes →
                </button>
              )}
            </div>
          </Panel>
        </div>

        {/* RIGHT — stacked: Distribuição nftables + Métricas backend Unbound */}
        <div className={`min-w-0 flex flex-col gap-3 ${focusRing('backends')}`}>
          <Panel title="Distribuição por Backend (nftables)" accent="mint">
            <div className="noc-data-table-wrap">
              <table className="noc-data-table">
                <thead>
                  <tr className="text-left">
                    <th>Backend</th>
                    <th className="text-right">Packets</th>
                    <th className="text-right">Bytes</th>
                    <th className="text-right">Share</th>
                    <th>Distribuição</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[11px]">
                  {backendTraffic.length === 0 && (
                    <tr><td colSpan={5} className="py-4 text-center text-muted-foreground text-[10px]">Sem dados nftables</td></tr>
                  )}
                  {backendTraffic.map((bt) => {
                    const sharePct = bt.share > 0 ? bt.share : (totalBackendPackets > 0 ? (bt.packets / totalBackendPackets) * 100 : 0);
                    return (
                      <tr key={bt.name} className="border-t border-border/30">
                        <td className="cell-nowrap text-primary font-bold">{bt.name}</td>
                        <td className="cell-nowrap text-right text-foreground/90">{bt.packets.toLocaleString('de-DE')}</td>
                        <td className="cell-nowrap text-right text-foreground/90">{formatBytes(bt.bytes)}</td>
                        <td className="cell-nowrap text-right text-primary">{sharePct.toFixed(0)}%</td>
                        <td className="min-w-[120px]">
                          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'hsl(220 42% 9%)' }}>
                            <div className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, sharePct)}%`,
                                background: 'linear-gradient(90deg, hsl(162 72% 51%), hsl(162 90% 60%))',
                                boxShadow: '0 0 6px hsl(162 72% 51% / 0.6)',
                              }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Métricas por Backend (Fonte: Unbound-Control)" accent="mint">
            <div className="noc-data-table-wrap">
              <table className="noc-data-table">
                <thead>
                  <tr className="text-left">
                    <th>Backend</th>
                    <th className="text-right">Queries</th>
                    <th className="text-right">Cache Hit</th>
                    <th className="text-right">Latência</th>
                    <th className="text-right">SERVFAIL</th>
                    <th className="text-right">NXDOMAIN</th>
                    <th className="text-right">NOERROR</th>
                    <th>Fonte</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-[11px]">
                  {visibleBackends.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-center text-muted-foreground text-[10px]">Sem dados</td></tr>
                  )}
                  {visibleBackends.map((b: any) => (
                    <tr key={b.name} className="border-t border-border/30">
                      <td className="cell-wrap min-w-[10rem]">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${b.healthy !== false ? 'bg-primary' : 'bg-destructive'}`}
                            style={{ boxShadow: b.healthy !== false ? '0 0 6px hsl(var(--primary))' : '0 0 6px hsl(var(--destructive))' }} />
                          <span className="text-primary font-bold">{b.name}</span>
                        </div>
                        <div className="mt-1 ml-3.5 flex items-center gap-1.5">
                          <span className="px-1 py-px text-[8px] rounded bg-muted/60 text-muted-foreground/80 font-bold">IPv4</span>
                          <span className="text-foreground/85 text-[10px]">{b.ipv4 || b.ip || '—'}</span>
                        </div>
                      </td>
                      <td className="cell-nowrap text-right text-foreground/90">{safeNum(b.resolver?.total_queries).toLocaleString()}</td>
                      <td className="cell-nowrap text-right">
                        <span className={safeNum(b.resolver?.cache_hit_ratio) >= 90 ? 'text-primary' : 'text-warning'}>
                          {safeNum(b.resolver?.cache_hit_ratio)}%
                        </span>
                      </td>
                      <td className="cell-nowrap text-right text-foreground/90">{safeNum(b.resolver?.recursion_avg_ms).toFixed(0)}ms</td>
                      <td className="cell-nowrap text-right text-foreground/90">{safeNum(b.resolver?.servfail)}</td>
                      <td className="cell-nowrap text-right text-foreground/90">{safeNum(b.resolver?.nxdomain)}</td>
                      <td className="cell-nowrap text-right text-foreground/90">{safeNum(b.resolver?.noerror)}</td>
                      <td className="cell-nowrap">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-muted-foreground/80"
                          style={{ background: 'hsl(220 42% 9%)', border: '1px solid hsl(220 35% 14%)' }}>
                          <Shield size={8} />
                          {b.resolver?.source ?? 'unbound-control'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      {/* ───── Bottom: Evolução do Tráfego (full-width multi-line) + Resumo do Ambiente ───── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)' }}>
        <div className={`min-w-0 ${focusRing('traffic')} rounded-xl`}>
          <TrafficEvolutionChart data={effectiveChartData} rangeLabel={periodLabel} timeMeta={timeMeta} timeRange={timeRange} />
        </div>
        <div className="min-w-0">
          <Panel title="Resumo do Ambiente" accent="mint">
            <div className="space-y-2 font-mono text-[11px]">
              <SummaryRow label="Fonte de Dados" value="Unbound-Control + nftables" />
              <SummaryRow label="Collector" value={collectorOk ? 'OK' : 'DEGRADADO'} valueColor={collectorOk ? 'text-primary' : 'text-warning'} />
              <SummaryRow label="Última Coleta" value={lastCollect} />
              <SummaryRow label="Timezone" value={`${timeMeta.timezone_label} (${timeMeta.timezone}) ${timeMeta.utc_offset}`} />
              <SummaryRow label="Período" value={periodLabel} />
              <SummaryRow label="Backends Ativos" value={String(backends.filter((b: any) => b.healthy !== false).length)} />
              <SummaryRow label="Clientes Únicos" value={uniqueClients ? uniqueClients.toLocaleString('de-DE') : '—'} />
              <SummaryRow label="Domínios Únicos" value={uniqueDomains ? uniqueDomains.toLocaleString('de-DE') : '—'} />
            </div>
          </Panel>
        </div>
      </div>

      {/* ───── Secondary charts (preserved — were tab "Tráfego") ───── */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-3 ${focusRing('traffic')} rounded-xl`}>
        <ChartPanel title="QPS ao longo do tempo" data={effectiveChartData} dataKey="qps" accent="blue" rangeLabel={periodLabel} timeMeta={timeMeta} timeRange={timeRange} />
        <ChartPanel title="Latência (ms)" data={effectiveChartData} dataKey="latency" accent="violet" rangeLabel={periodLabel} timeMeta={timeMeta} timeRange={timeRange} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <CacheHitChart data={effectiveChartData} rangeLabel={periodLabel} timeMeta={timeMeta} timeRange={timeRange} />
        <ErrorsChart data={effectiveChartData} rangeLabel={periodLabel} timeMeta={timeMeta} timeRange={timeRange} />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, valueColor = 'text-foreground/90' }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground/80">{label}</span>
      <span className={`${valueColor} font-bold tabular-nums text-right`}>{value}</span>
    </div>
  );
}
