import { Activity, ArrowRight, Globe, Server, Timer, Zap } from 'lucide-react';
import type { InstanceHealthReport, InstanceHealthResult } from '@/lib/types';

interface Props {
  health: InstanceHealthReport;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatency?: number;
  dnsMetricsAvailable?: boolean;
}

type Tone = 'ok' | 'fail' | 'dim';

const toneClasses: Record<Tone, {
  panel: string;
  badge: string;
  dot: string;
  metric: string;
}> = {
  ok: {
    panel: 'border-success/20 bg-success/5',
    badge: 'border-success/20 bg-success/10 text-success',
    dot: 'bg-success shadow-[0_0_10px_hsl(var(--success)/0.35)]',
    metric: 'text-success',
  },
  fail: {
    panel: 'border-destructive/20 bg-destructive/5',
    badge: 'border-destructive/20 bg-destructive/10 text-destructive',
    dot: 'bg-destructive shadow-[0_0_10px_hsl(var(--destructive)/0.35)]',
    metric: 'text-destructive',
  },
  dim: {
    panel: 'border-border/50 bg-muted/10',
    badge: 'border-border/50 bg-muted/20 text-muted-foreground',
    dot: 'bg-muted-foreground/40',
    metric: 'text-muted-foreground',
  },
};

function formatQps(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M qps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k qps`;
  return `${Math.round(value)} qps`;
}

function formatLatency(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—';
  return `${Math.round(value)}ms`;
}

function resolveTone(healthy: boolean, dimmed = false): Tone {
  if (dimmed) return 'dim';
  return healthy ? 'ok' : 'fail';
}

function statusLabel(healthy: boolean, dimmed = false): string {
  if (dimmed) return 'INATIVO';
  return healthy ? 'OK' : 'FALHA';
}

function uniqueUpstreamIps(instances: InstanceHealthResult[]): string[] {
  return Array.from(
    new Set(
      instances
        .map(instance => instance.resolved_ip)
        .filter((ip): ip is string => Boolean(ip && ip !== '—')),
    ),
  );
}

function FlowStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
      <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/60">{label}</span>
      <span className="text-[11px] font-mono font-bold text-foreground">{value}</span>
    </div>
  );
}

function MetricChip({ icon: Icon, label, value, tone = 'default' }: { icon: typeof Activity; label: string; value: string; tone?: 'default' | 'success' | 'danger' }) {
  const toneClass = tone === 'success'
    ? 'border-success/20 bg-success/8 text-success'
    : tone === 'danger'
      ? 'border-destructive/20 bg-destructive/8 text-destructive'
      : 'border-border/40 bg-muted/10 text-muted-foreground';

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${toneClass}`}>
      <Icon size={12} />
      <span className="text-[9px] font-mono uppercase tracking-[0.16em]">{label}</span>
      <span className="text-[11px] font-mono font-bold">{value}</span>
    </div>
  );
}

function EndpointCard({
  icon: Icon,
  title,
  tone,
  status,
  primaryIp,
  secondaryLabel,
  metrics,
  ipList,
}: {
  icon: typeof Zap;
  title: string;
  tone: Tone;
  status: string;
  primaryIp: string;
  secondaryLabel?: string;
  metrics?: React.ReactNode;
  ipList?: string[];
}) {
  const classes = toneClasses[tone];

  return (
    <div className={`rounded-2xl border p-4 lg:p-5 ${classes.panel}`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-background/40">
            <Icon size={18} className={classes.metric} />
          </div>
          <div>
            <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground/70">{title}</div>
            <div className={`mt-1 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-[0.18em] ${classes.badge}`}>
              <span className={`h-2 w-2 rounded-full ${classes.dot}`} />
              {status}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-3">
        <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/55">IP principal</div>
        <div className="mt-2 break-all font-mono text-lg font-black leading-tight text-foreground lg:text-xl">
          {primaryIp}
        </div>
        {secondaryLabel && (
          <div className="mt-2 text-[10px] font-mono text-muted-foreground/70">{secondaryLabel}</div>
        )}
      </div>

      {ipList && ipList.length > 1 && (
        <div className="mt-3 space-y-2">
          <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/55">IPs visíveis</div>
          <div className="flex flex-wrap gap-2">
            {ipList.map(ip => (
              <span key={ip} className="rounded-md border border-border/40 bg-background/30 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-foreground/90">
                {ip}
              </span>
            ))}
          </div>
        </div>
      )}

      {metrics && <div className="mt-4 flex flex-wrap gap-2">{metrics}</div>}
    </div>
  );
}

function ResolverCard({
  instance,
  cacheHitRatio,
  dnsMetricsAvailable,
}: {
  instance: InstanceHealthResult;
  cacheHitRatio?: number;
  dnsMetricsAvailable?: boolean;
}) {
  const tone = resolveTone(instance.healthy);
  const classes = toneClasses[tone];

  return (
    <div className={`rounded-2xl border p-4 ${classes.panel}`}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/50 bg-background/40">
              <Server size={16} className={classes.metric} />
            </div>
            <div className="min-w-0">
              <div className="truncate font-mono text-sm font-black uppercase tracking-[0.14em] text-foreground">
                {instance.instance}
              </div>
              <div className="mt-1 inline-flex items-center gap-2 rounded-full border px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground/80">
                <span className={`h-2 w-2 rounded-full ${classes.dot}`} />
                {statusLabel(instance.healthy)}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(220px,0.75fr)]">
            <div className="rounded-xl border border-border/40 bg-background/30 px-3 py-3">
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/55">Bind IP</div>
              <div className="mt-2 break-all font-mono text-base font-black leading-snug text-foreground lg:text-lg">
                {instance.bind_ip}
              </div>
              <div className="mt-2 text-[10px] font-mono text-muted-foreground/70">porta {instance.port}</div>
            </div>

            <div className="rounded-xl border border-border/40 bg-background/20 px-3 py-3">
              <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-muted-foreground/55">Upstream resolvido</div>
              <div className="mt-2 break-all font-mono text-sm font-bold text-foreground/90">
                {instance.resolved_ip || '—'}
              </div>
              <div className="mt-2 text-[10px] font-mono text-muted-foreground/70 truncate">
                probe {instance.probe_domain || '—'}
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:w-[280px] xl:justify-end">
          <MetricChip icon={Timer} label="latência" value={formatLatency(instance.latency_ms)} tone={instance.healthy ? 'success' : 'danger'} />
          {dnsMetricsAvailable && (
            <MetricChip icon={Activity} label="cache" value={`${Math.round(cacheHitRatio ?? 0)}%`} />
          )}
        </div>
      </div>

      {instance.error && (
        <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 font-mono text-[10px] text-destructive/85">
          {instance.error}
        </div>
      )}
    </div>
  );
}

export default function NocTopologyColumnMap({
  health,
  vipConfigured,
  vipAddress,
  totalQueries,
  cacheHitRatio,
  avgLatency,
  dnsMetricsAvailable,
}: Props) {
  const instances = health.instances ?? [];
  const vipIp = vipAddress || health.vip?.bind_ip || 'não configurado';
  const vipHealthy = health.vip?.healthy ?? Boolean(vipConfigured);
  const vipTone = resolveTone(vipHealthy, !vipConfigured && !health.vip);
  const upstreamIps = uniqueUpstreamIps(instances);
  const upstreamHealthy = instances.some(instance => instance.healthy);
  const avgUpstreamLatency = instances.length > 0
    ? Math.round(instances.reduce((acc, instance) => acc + (instance.latency_ms ?? 0), 0) / instances.length)
    : Math.round(avgLatency ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/65">
          <FlowStep label="entrada" value={vipIp} />
          <ArrowRight size={14} className="hidden xl:block text-muted-foreground/35" />
          <FlowStep label="resolvers" value={`${instances.length}`} />
          <ArrowRight size={14} className="hidden xl:block text-muted-foreground/35" />
          <FlowStep label="upstream" value={`${upstreamIps.length || 1} IP${upstreamIps.length === 1 ? '' : 's'}`} />
        </div>

        <div className="flex flex-wrap gap-2">
          {dnsMetricsAvailable && (
            <MetricChip icon={Activity} label="tráfego" value={formatQps(totalQueries)} tone="success" />
          )}
          <MetricChip icon={Timer} label="latência média" value={formatLatency(avgUpstreamLatency)} tone={upstreamHealthy ? 'success' : 'danger'} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(220px,0.9fr)_minmax(0,1.5fr)_minmax(220px,0.9fr)]">
        <EndpointCard
          icon={Zap}
          title="VIP / Entrada"
          tone={vipTone}
          status={statusLabel(vipHealthy, vipTone === 'dim')}
          primaryIp={vipIp}
          secondaryLabel={vipConfigured ? 'IP publicado para os clientes' : 'VIP não configurado'}
          metrics={
            dnsMetricsAvailable ? (
              <MetricChip icon={Activity} label="queries" value={formatQps(totalQueries)} tone={vipHealthy ? 'success' : 'default'} />
            ) : undefined
          }
        />

        <div className="space-y-3">
          <div className="rounded-2xl border border-border/40 bg-muted/10 px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground/70">Resolvers ativos</div>
                <div className="mt-1 text-sm font-mono text-muted-foreground/80">
                  Cada card mostra bind IP, porta e upstream resolvido sem sobreposição.
                </div>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/40 px-3 py-1.5 text-[10px] font-mono font-bold uppercase tracking-[0.18em] text-foreground">
                <Globe size={12} className="text-accent" />
                {instances.length} instância{instances.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {instances.map(instance => (
              <ResolverCard
                key={`${instance.instance}-${instance.bind_ip}-${instance.port}`}
                instance={instance}
                cacheHitRatio={cacheHitRatio}
                dnsMetricsAvailable={dnsMetricsAvailable}
              />
            ))}
          </div>
        </div>

        <EndpointCard
          icon={Globe}
          title="Upstream / Saída"
          tone={resolveTone(upstreamHealthy, upstreamIps.length === 0)}
          status={statusLabel(upstreamHealthy, upstreamIps.length === 0)}
          primaryIp={upstreamIps[0] || 'sem IP resolvido'}
          secondaryLabel={upstreamHealthy ? 'Destino que os resolvers estão alcançando' : 'Sem upstream confirmado'}
          ipList={upstreamIps}
          metrics={
            <>
              <MetricChip icon={Timer} label="média" value={formatLatency(avgUpstreamLatency)} tone={upstreamHealthy ? 'success' : 'danger'} />
              {dnsMetricsAvailable && (
                <MetricChip icon={Activity} label="cache médio" value={`${Math.round(cacheHitRatio ?? 0)}%`} />
              )}
            </>
          }
        />
      </div>
    </div>
  );
}
