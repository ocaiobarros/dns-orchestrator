// ============================================================
// DNS Control — Kiosk / NOC TV Dashboard
// Fullscreen dashboard for 72" TV with large cards,
// auto-refresh, host metrics + DNS metrics, no admin UI.
// ============================================================

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Monitor, Cpu, HardDrive, MemoryStick, Clock, Activity,
  Database, Timer, Server, Globe, Shield, Wifi, AlertTriangle,
  CheckCircle2, XCircle, ChevronUp, Home,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// ── Auto-refresh interval (15s)
const REFRESH_INTERVAL = 15_000;

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ── Service status icon
function ServiceDot({ status }: { status: string }) {
  const isOk = status === 'active' || status === 'running';
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${isOk ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
  );
}

// ── Large metric card for TV
function KioskCard({ label, value, sub, icon, accent = 'default', large = false }: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  accent?: 'default' | 'success' | 'warning' | 'danger';
  large?: boolean;
}) {
  const accentColors = {
    default: 'border-border/50',
    success: 'border-emerald-500/50',
    warning: 'border-amber-500/50',
    danger: 'border-red-500/50',
  };

  return (
    <div className={`bg-card/80 backdrop-blur-sm rounded-xl border-2 ${accentColors[accent]} p-4 lg:p-6 flex flex-col justify-between min-h-[120px]`}>
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-sm lg:text-base font-mono font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`font-mono font-black ${large ? 'text-4xl lg:text-6xl' : 'text-3xl lg:text-5xl'} text-foreground leading-none`}>
        {value}
      </div>
      {sub && <div className="text-sm lg:text-base font-mono text-muted-foreground mt-2">{sub}</div>}
    </div>
  );
}

// ── Simple bar chart (inline SVG)
function MiniBar({ data, color = 'hsl(var(--primary))', height = 60 }: { data: number[]; color?: string; height?: number }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      {data.map((v, i) => {
        const h = (v / max) * (height - 2);
        return <rect key={i} x={i * w + 0.5} y={height - h} width={Math.max(w - 1, 1)} height={h} fill={color} rx={1} opacity={0.8} />;
      })}
    </svg>
  );
}

export default function KioskDashboard() {
  const { user, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  // Auto-refresh session for viewer users (silent)
  useEffect(() => {
    if (user?.role !== 'viewer') return;
    const interval = setInterval(() => {
      refreshSession().catch(() => {});
    }, 10 * 60 * 1000); // every 10 min
    return () => clearInterval(interval);
  }, [user?.role, refreshSession]);

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['kiosk', 'summary'],
    queryFn: async () => {
      const r = await api.getKioskSummary();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  const host = data?.host ?? {};
  const dns = data?.dns ?? {};
  const history = data?.history ?? [];
  const resolver = dns.resolver ?? {};
  const traffic = dns.traffic ?? {};
  const frontend = dns.frontend ?? {};
  const backends = dns.backends ?? [];
  const topDomains = dns.top_domains ?? [];
  const topClients = dns.top_clients ?? [];
  const recentQueries = dns.recent_queries ?? [];
  const collectorOk = dns.health?.collector === 'ok';

  const services = host.services ?? {};
  const allServicesOk = Object.values(services).every((s: any) => s === 'active' || s === 'running');

  // History arrays for charts
  const histQps = history.map((h: any) => h.qps ?? 0);
  const histLatency = history.map((h: any) => h.latency_ms ?? 0);
  const histCache = history.map((h: any) => h.cache_hit_ratio ?? 0);

  if (isLoading && !data) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <span className="text-xl font-mono text-muted-foreground">Carregando dashboard NOC...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-y-auto bg-background text-foreground p-4 lg:p-6 xl:p-8">
      {/* ═══ HEADER BAR ═══ */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center hover:bg-primary/80 transition-colors"
            title="Voltar ao Dashboard"
          >
            <Home size={20} className="text-primary-foreground" />
          </button>
          <div>
            <h1 className="text-2xl lg:text-3xl font-black font-mono tracking-tight">DNS Control</h1>
            <div className="flex items-center gap-3 text-sm font-mono text-muted-foreground">
              <span>{host.hostname ?? '—'}</span>
              <span>·</span>
              <span>{host.primary_ip ?? '—'}</span>
              <span>·</span>
              <span className="text-primary">{data?.operation_mode ?? '—'}</span>
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-4xl lg:text-5xl font-mono font-black tabular-nums">
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="text-sm lg:text-base font-mono text-muted-foreground">
            {now.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            <span className="ml-2">({host.timezone ?? 'UTC'})</span>
          </div>
        </div>
      </div>

      {/* ═══ STATUS BAR ═══ */}
      <div className={`rounded-xl p-3 lg:p-4 mb-6 flex items-center justify-between ${
        allServicesOk && collectorOk ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
      }`}>
        <div className="flex items-center gap-3">
          {allServicesOk && collectorOk ? (
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          ) : (
            <AlertTriangle className="h-8 w-8 text-red-500" />
          )}
          <span className="text-xl lg:text-2xl font-mono font-bold">
            {allServicesOk && collectorOk ? 'OPERACIONAL' : 'ATENÇÃO — VERIFICAR SERVIÇOS'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground">
          <span>Uptime: {host.uptime_display ?? '—'}</span>
          <span>·</span>
          <span>Última coleta: {dns.health?.last_update ? new Date(dns.health.last_update).toLocaleTimeString('pt-BR') : '—'}</span>
        </div>
      </div>

      {/* ═══ COLLECTOR INACTIVE WARNING ═══ */}
      {!collectorOk && (
        <div className="rounded-xl p-4 mb-6 bg-red-500/10 border border-red-500/30 flex items-center gap-3">
          <AlertTriangle className="h-6 w-6 text-red-500 flex-shrink-0" />
          <span className="text-lg font-mono text-red-400">
            Telemetria indisponível — collector inativo. Dados DNS podem estar desatualizados.
          </span>
        </div>
      )}

      {/* ═══ HOST METRICS ROW ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KioskCard
          label="CPU"
          value={`${host.cpu_percent ?? 0}%`}
          sub={`${host.cpu_count ?? 0} cores · Load: ${host.load_1m?.toFixed(2) ?? '—'}`}
          icon={<Cpu size={20} />}
          accent={(host.cpu_percent ?? 0) > 80 ? 'danger' : (host.cpu_percent ?? 0) > 60 ? 'warning' : 'success'}
        />
        <KioskCard
          label="RAM"
          value={`${host.ram_percent ?? 0}%`}
          sub={`${host.ram_used_display ?? `${host.ram_used_mb ?? 0} MB`} / ${host.ram_total_display ?? `${host.ram_total_mb ?? 0} MB`}`}
          icon={<MemoryStick size={20} />}
          accent={(host.ram_percent ?? 0) > 85 ? 'danger' : (host.ram_percent ?? 0) > 70 ? 'warning' : 'success'}
        />
        <KioskCard
          label="Disco"
          value={`${host.disk_percent ?? 0}%`}
          sub={`${host.disk_used_gb ?? 0} / ${host.disk_total_gb ?? 0} GB`}
          icon={<HardDrive size={20} />}
          accent={(host.disk_percent ?? 0) > 90 ? 'danger' : (host.disk_percent ?? 0) > 75 ? 'warning' : 'success'}
        />
        <KioskCard
          label="Uptime"
          value={host.uptime_display ?? '—'}
          sub={`Load: ${host.load_1m?.toFixed(2) ?? '—'} / ${host.load_5m?.toFixed(2) ?? '—'} / ${host.load_15m?.toFixed(2) ?? '—'}`}
          icon={<Clock size={20} />}
        />
      </div>

      {/* ═══ SERVICES STATUS ═══ */}
      <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6 mb-6">
        <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
          <Shield size={16} /> Serviços
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(services).map(([name, status]) => (
            <div key={name} className="flex items-center gap-3">
              <ServiceDot status={status as string} />
              <span className="font-mono text-base lg:text-lg text-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ═══ DNS METRICS ROW ═══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KioskCard
          label="Frontend DNS"
          value={frontend.ip ? `${frontend.ip}:53` : '—'}
          sub={frontend.healthy ? '✓ Respondendo' : '✗ Sem resposta'}
          icon={<Globe size={20} />}
          accent={frontend.healthy ? 'success' : 'danger'}
          large
        />
        <KioskCard
          label="QPS"
          value={collectorOk ? String(resolver.qps ?? 0) : '—'}
          sub={collectorOk ? `Total: ${(resolver.total_queries ?? 0).toLocaleString()}` : 'Collector inativo'}
          icon={<Activity size={20} />}
          accent={collectorOk ? 'success' : 'warning'}
          large
        />
        <KioskCard
          label="Cache Hit"
          value={collectorOk ? `${resolver.cache_hit_ratio ?? 0}%` : '—'}
          sub={collectorOk ? `Hits: ${(resolver.cache_hits ?? 0).toLocaleString()} · Miss: ${(resolver.cache_misses ?? 0).toLocaleString()}` : 'Collector inativo'}
          icon={<Database size={20} />}
          accent={collectorOk ? ((resolver.cache_hit_ratio ?? 0) > 70 ? 'success' : 'warning') : 'warning'}
          large
        />
        <KioskCard
          label="Latência"
          value={collectorOk ? `${resolver.avg_latency_ms ?? 0}ms` : '—'}
          sub={collectorOk ? `SERVFAIL: ${resolver.servfail ?? 0} · NXDOMAIN: ${resolver.nxdomain ?? 0}` : 'Collector inativo'}
          icon={<Timer size={20} />}
          accent={collectorOk ? ((resolver.avg_latency_ms ?? 0) < 30 ? 'success' : (resolver.avg_latency_ms ?? 0) < 100 ? 'warning' : 'danger') : 'warning'}
          large
        />
      </div>

      {/* ═══ CHARTS ROW ═══ */}
      {history.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
            <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">QPS (Série Temporal)</div>
            <MiniBar data={histQps} color="hsl(var(--primary))" height={80} />
            <div className="flex justify-between text-xs font-mono text-muted-foreground mt-2">
              <span>Min: {Math.min(...histQps)}</span>
              <span>Max: {Math.max(...histQps)}</span>
            </div>
          </div>
          <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
            <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">Latência (ms)</div>
            <MiniBar data={histLatency} color="hsl(var(--destructive))" height={80} />
            <div className="flex justify-between text-xs font-mono text-muted-foreground mt-2">
              <span>Min: {Math.min(...histLatency).toFixed(1)}</span>
              <span>Max: {Math.max(...histLatency).toFixed(1)}</span>
            </div>
          </div>
          <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
            <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-3">Cache Hit (%)</div>
            <MiniBar data={histCache} color="hsl(142, 76%, 36%)" height={80} />
            <div className="flex justify-between text-xs font-mono text-muted-foreground mt-2">
              <span>Min: {Math.min(...histCache).toFixed(1)}%</span>
              <span>Max: {Math.max(...histCache).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ BACKENDS + TOP DOMAINS + TOP CLIENTS ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Backends */}
        <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
          <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Server size={16} /> Backends ({backends.length})
          </div>
          <div className="space-y-2">
            {backends.length > 0 ? backends.map((b: any) => {
              const r = b.resolver ?? {};
              return (
                <div key={b.name} className="flex flex-col gap-1 py-2 border-b border-border/30 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${b.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span className="font-mono text-sm font-semibold text-foreground">{b.name}</span>
                    <span className="font-mono text-xs text-muted-foreground truncate">{b.ip}</span>
                  </div>
                  <div className="flex items-center gap-3 ml-[18px] text-xs font-mono text-muted-foreground">
                    <span>{r.total_queries?.toLocaleString() ?? '—'} <span className="text-muted-foreground/50">queries</span></span>
                    <span>{r.cache_hit_ratio ?? '—'}% <span className="text-muted-foreground/50">cache</span></span>
                    <span>{b.traffic?.share ?? '—'}% <span className="text-muted-foreground/50">share</span></span>
                  </div>
                </div>
              );
            }) : (
              <div className="text-muted-foreground font-mono text-sm">Nenhum backend detectado</div>
            )}
          </div>
        </div>

        {/* Top Domains */}
        <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
          <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Globe size={16} /> Top Domains
          </div>
          <div className="space-y-2">
            {topDomains.slice(0, 10).map((d: any, i: number) => (
              <div key={d.domain} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <span className="font-mono text-base truncate max-w-[200px]">{d.domain}</span>
                </div>
                <span className="font-mono text-sm font-semibold text-primary">{d.count?.toLocaleString()}</span>
              </div>
            ))}
            {topDomains.length === 0 && (
              <div className="text-muted-foreground font-mono text-sm">Sem dados</div>
            )}
          </div>
        </div>

        {/* Top Clients */}
        <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6">
          <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4 flex items-center gap-2">
            <Wifi size={16} /> Top Clients
          </div>
          <div className="space-y-2">
            {topClients.slice(0, 10).map((c: any, i: number) => (
              <div key={c.ip} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground w-5">{i + 1}.</span>
                  <span className="font-mono text-base">{c.ip}</span>
                </div>
                <span className="font-mono text-sm font-semibold text-primary">{c.queries?.toLocaleString()}</span>
              </div>
            ))}
            {topClients.length === 0 && (
              <div className="text-muted-foreground font-mono text-sm">Sem dados</div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ RECENT QUERIES ═══ */}
      {recentQueries.length > 0 && (
        <div className="bg-card/80 backdrop-blur-sm rounded-xl border border-border/50 p-4 lg:p-6 mb-6">
          <div className="text-sm font-mono font-bold uppercase tracking-widest text-muted-foreground mb-4">
            Consultas Recentes
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {recentQueries.slice(0, 12).map((q: any, i: number) => (
              <div key={i} className="flex items-center gap-3 font-mono text-sm">
                <span className="text-muted-foreground text-xs">{q.time}</span>
                <span className="text-foreground font-semibold truncate flex-1">{q.domain}</span>
                <span className="text-xs text-muted-foreground">{q.type}</span>
                <span className="text-xs text-muted-foreground">{q.client}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ FOOTER ═══ */}
      <div className="text-center text-xs font-mono text-muted-foreground/40 pb-4">
        DNS Control v2.1.0 · Carrier Edition · Dashboard NOC · Auto-refresh {REFRESH_INTERVAL / 1000}s
      </div>
    </div>
  );
}
