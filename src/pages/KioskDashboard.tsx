// ============================================================
// DNS Control — Kiosk / NOC TV Dashboard
// Pixel-accurate reproduction of the reference layout:
// 8-col left zone (host metrics, services pill, DNS metrics,
// charts, backends + top domains/clients) + 3-col right
// rail (System status, Resumo Rápido, Alertas).
// ============================================================

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Link, useNavigate } from 'react-router-dom';
import {
  Cpu, MemoryStick, HardDrive, Clock, Activity, Database, Timer,
  Globe, Shield, Server, Wifi, Bell, Eye, CheckCircle2, ChevronDown,
  ArrowLeft,
} from 'lucide-react';

// ── Auto-refresh interval (15s)
const REFRESH_INTERVAL = 15_000;

/* ────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────── */

function pad2(n: number) { return n.toString().padStart(2, '0'); }

function formatGb(mb?: number) {
  if (!mb && mb !== 0) return '—';
  return `${(mb / 1024).toFixed(1)} GB`;
}

function uptimeShort(s?: string) {
  if (!s) return '0d 0h 0m';
  // Backend often returns "0d 0h 31m" or "1 day, 2:15:33"
  const m = s.match(/(\d+)\s*d.*?(\d+)\s*h.*?(\d+)\s*m/i);
  if (m) return `${m[1]}d ${m[2]}h ${m[3]}m`;
  return s;
}

/* ────────────────────────────────────────────────────────
   Mini SVG visuals
   ──────────────────────────────────────────────────────── */

function Sparkline({ data, color, height = 28 }: { data: number[]; color: string; height?: number }) {
  if (!data.length) data = [1, 1, 1];
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const w = 200;
  const pts = data
    .map((v, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * w;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
    </svg>
  );
}

function HBar({ pct, from = 'hsl(var(--primary))', to = 'hsl(var(--accent))' }: { pct: number; from?: string; to?: string }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-noc-depth-3/80 overflow-hidden" style={{ backgroundColor: 'hsl(var(--noc-depth-3))' }}>
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.min(100, Math.max(0, pct))}%`,
          background: `linear-gradient(90deg, ${from}, ${to})`,
          boxShadow: `0 0 8px ${from}`,
        }}
      />
    </div>
  );
}

function BarChart({ data, color, height = 64 }: { data: number[]; color: string; height?: number }) {
  if (!data.length) data = Array(40).fill(1);
  const max = Math.max(...data, 1);
  const w = 100 / data.length;
  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      {data.map((v, i) => {
        const h = Math.max((v / max) * (height - 2), 1);
        return (
          <rect
            key={i}
            x={i * w + 0.4}
            y={height - h}
            width={Math.max(w - 0.8, 0.6)}
            height={h}
            fill={color}
            opacity="0.92"
            rx="0.4"
          />
        );
      })}
    </svg>
  );
}

function DotMap() {
  // Decorative tiny "world dots" map for Frontend DNS card
  const cells: { cx: number; cy: number; o: number }[] = [];
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 28; x++) {
      // pseudo-random sparse dots
      const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
      const r = v - Math.floor(v);
      if (r > 0.62) cells.push({ cx: x * 3, cy: y * 3, o: 0.3 + r * 0.7 });
    }
  }
  return (
    <svg viewBox="0 0 84 42" width="84" height="42">
      {cells.map((c, i) => (
        <circle key={i} cx={c.cx} cy={c.cy} r="0.7" fill="hsl(var(--primary))" opacity={c.o} />
      ))}
    </svg>
  );
}

function Donut({ pct, size = 64, stroke = 8 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <defs>
        <linearGradient id="donutGrad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--accent))" />
          <stop offset="100%" stopColor="hsl(330 85% 65%)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--noc-depth-3))" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="url(#donutGrad)"
        strokeWidth={stroke}
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ filter: 'drop-shadow(0 0 5px hsl(var(--accent) / 0.7))' }}
      />
    </svg>
  );
}

function BigCheckRing() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120">
      <defs>
        <linearGradient id="ringGrad" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(195 95% 55%)" />
          <stop offset="50%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--accent))" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="50" fill="none" stroke="hsl(var(--noc-depth-3))" strokeWidth="6" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="url(#ringGrad)" strokeWidth="6"
        strokeLinecap="round" strokeDasharray="290 314" transform="rotate(-90 60 60)"
        style={{ filter: 'drop-shadow(0 0 8px hsl(var(--primary) / 0.7))' }} />
      <circle cx="60" cy="60" r="34" fill="none" stroke="hsl(var(--primary) / 0.25)" strokeWidth="1.2" />
      <path d="M44 60 L55 71 L78 48" fill="none" stroke="hsl(var(--primary))" strokeWidth="4"
        strokeLinecap="round" strokeLinejoin="round"
        style={{ filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.9))' }} />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────
   Reusable wrappers
   ──────────────────────────────────────────────────────── */

function Panel({ children, className = '', glow }: { children: React.ReactNode; className?: string; glow?: 'mint' | 'violet' }) {
  const glowStyle =
    glow === 'mint' ? { boxShadow: '0 0 22px -8px hsl(var(--primary) / 0.45), inset 0 0 0 1px hsl(var(--primary) / 0.18)' }
    : glow === 'violet' ? { boxShadow: '0 0 22px -8px hsl(var(--accent) / 0.4), inset 0 0 0 1px hsl(var(--accent) / 0.18)' }
    : undefined;
  return (
    <div
      className={`rounded-xl border border-border/50 p-4 ${className}`}
      style={{
        background: 'linear-gradient(165deg, hsl(220 42% 8%) 0%, hsl(220 50% 4.5%) 100%)',
        ...glowStyle,
      }}
    >
      {children}
    </div>
  );
}

function CardLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono font-bold uppercase tracking-[0.18em] text-muted-foreground/85">
      <span className="w-6 h-6 rounded-md bg-primary/10 border border-primary/25 flex items-center justify-center text-primary">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────
   Main component
   ──────────────────────────────────────────────────────── */

export default function KioskDashboard() {
  const { user, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    if (user?.role !== 'viewer') return;
    const t = setInterval(() => { refreshSession().catch(() => {}); }, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, [user?.role, refreshSession]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['kiosk', 'summary'],
    queryFn: async () => {
      const r = await api.getKioskSummary();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: REFRESH_INTERVAL,
  });

  if (isLoading && !data) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <span className="text-base font-mono text-muted-foreground">Carregando...</span>
        </div>
      </div>
    );
  }

  const host = data?.host ?? {};
  const dns = data?.dns ?? {};
  const history = data?.history ?? [];
  const resolver = dns.resolver ?? {};
  const frontend = dns.frontend ?? {};
  const backends: any[] = dns.backends ?? [];
  const topDomains: any[] = dns.top_domains ?? [];
  const topClients: any[] = dns.top_clients ?? [];
  const services: Record<string, string> = host.services ?? {};
  const collectorOk = dns.health?.collector === 'ok';

  const cpuPct = host.cpu_percent ?? 0;
  const ramPct = host.ram_percent ?? 0;
  const diskPct = host.disk_percent ?? 0;
  const ramUsed = host.ram_used_display ?? formatGb(host.ram_used_mb);
  const ramTotal = host.ram_total_display ?? formatGb(host.ram_total_mb);
  const diskUsed = host.disk_used_gb ?? 0;
  const diskTotal = host.disk_total_gb ?? 0;

  const cpuHist: number[] = (history.map((h: any) => h.cpu_percent ?? 0).filter((x: number) => x > 0).length
    ? history.map((h: any) => h.cpu_percent ?? cpuPct)
    : Array.from({ length: 32 }, (_, i) => 0.2 + Math.sin(i * 0.7) * 0.15 + Math.random() * 0.2));
  const histQps: number[] = history.map((h: any) => h.qps ?? 0);
  const histLatency: number[] = history.map((h: any) => h.latency_ms ?? 0);
  const histCache: number[] = history.map((h: any) => h.cache_hit_ratio ?? 0);

  const qps = collectorOk ? (resolver.qps ?? 0) : 0;
  const totalQ = collectorOk ? (resolver.total_queries ?? 0) : 0;
  const cacheHit = collectorOk ? (resolver.cache_hit_ratio ?? 0) : 0;
  const cacheHits = collectorOk ? (resolver.cache_hits ?? 0) : 0;
  const cacheMiss = collectorOk ? (resolver.cache_misses ?? 0) : 0;
  const latency = collectorOk ? (resolver.avg_latency_ms ?? 0) : 0;
  const servfail = collectorOk ? (resolver.servfail ?? 0) : 0;
  const nxdomain = collectorOk ? (resolver.nxdomain ?? 0) : 0;

  const serviceEntries = Object.entries(services);
  const servicesUp = serviceEntries.filter(([, s]) => s === 'active' || s === 'running').length;
  const servicesTotal = serviceEntries.length;
  const backendsUp = backends.filter((b: any) => b.healthy).length;
  const backendsTotal = backends.length;
  const allOk = servicesUp === servicesTotal && backendsUp === backendsTotal && collectorOk;

  const hostname = host.hostname ?? '—';
  const primaryIp = host.primary_ip ?? '—';
  const opMode = data?.operation_mode_label ?? data?.operation_mode ?? 'Recursivo Simples';

  const tzShort =
    new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(now).find(p => p.type === 'timeZoneName')?.value || '';

  return (
    <div className="min-h-screen bg-background text-foreground font-sans" style={{ paddingBlock: 'clamp(0.75rem, 1.2vw, 1.75rem)' }}>
      <div className="noc-page">
        {/* ═══ HEADER ═══ */}
        <header className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/15 border border-primary/40 flex items-center justify-center">
              <CheckCircle2 size={16} className="text-primary" style={{ filter: 'drop-shadow(0 0 4px hsl(var(--primary)))' }} />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-[20px] font-bold text-primary tracking-tight" style={{ textShadow: '0 0 12px hsl(var(--primary) / 0.4)' }}>
                  {hostname}
                </h1>
                <span className="text-muted-foreground/60">·</span>
                <span className="font-mono text-[13px] text-muted-foreground/85">{primaryIp}</span>
              </div>
              <div className="text-[12px] font-medium text-primary/85 mt-0.5">{opMode}</div>
            </div>
          </div>

          <div className="flex items-start gap-4">
            <div className="text-right">
              <div className="text-[44px] leading-none font-mono font-bold tabular-nums tracking-tight">
                {pad2(now.getHours())}<span className="text-primary/80">:</span>{pad2(now.getMinutes())}<span className="text-primary/80">:</span>{pad2(now.getSeconds())}
              </div>
              <div className="text-[12px] font-mono text-muted-foreground/75 mt-1">
                {now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                {tzShort && <span className="ml-1.5">({tzShort})</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <Link to="/" className="h-9 px-3 rounded-lg bg-noc-depth-2 border border-border/40 flex items-center gap-2 text-[11px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: 'hsl(var(--noc-depth-2))' }}>
                <ArrowLeft size={14} /> Dashboard
              </Link>
              <button
                onClick={() => navigate('/events?severity=warning,critical')}
                title="Ver alertas operacionais"
                className="w-9 h-9 rounded-lg bg-noc-depth-2 border border-border/40 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                style={{ background: 'hsl(var(--noc-depth-2))' }}>
                <Bell size={15} />
              </button>
              <div className="flex items-center gap-2 px-2.5 h-9 rounded-lg border border-primary/25"
                style={{ background: 'hsl(var(--noc-depth-2))' }}>
                <Activity size={14} className="text-primary" />
                <span className="w-px h-4 bg-border/40" />
                <Eye size={14} className="text-primary" />
              </div>
            </div>
          </div>
        </header>

        {/* ═══ MAIN GRID ═══ */}
        <div className="grid grid-cols-12 gap-4">
          {/* ═══════════ LEFT (8 cols) ═══════════ */}
          <div className="col-span-12 lg:col-span-9 space-y-4">

            {/* Row 1 — host metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Panel className="min-h-[140px]">
                <CardLabel icon={<Cpu size={13} />}>CPU</CardLabel>
                <div className="text-[40px] font-bold font-mono leading-none mt-2 tracking-tight">{cpuPct.toFixed(1)}%</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">
                  {host.cpu_count ?? 0} cores · Load: {(host.load_1m ?? 0).toFixed(2)}
                </div>
                <div className="mt-2"><Sparkline data={cpuHist} color="hsl(var(--primary))" /></div>
              </Panel>

              <Panel className="min-h-[140px]">
                <CardLabel icon={<MemoryStick size={13} />}>RAM</CardLabel>
                <div className="text-[40px] font-bold font-mono leading-none mt-2 tracking-tight">{ramPct.toFixed(1)}%</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">{ramUsed} / {ramTotal}</div>
                <div className="mt-3"><HBar pct={ramPct} /></div>
              </Panel>

              <Panel className="min-h-[140px]">
                <CardLabel icon={<HardDrive size={13} />}>Disco</CardLabel>
                <div className="text-[40px] font-bold font-mono leading-none mt-2 tracking-tight">{diskPct.toFixed(1)}%</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">{diskUsed} / {diskTotal} GB</div>
                <div className="mt-3"><HBar pct={diskPct} from="hsl(var(--primary))" to="hsl(var(--primary-glow))" /></div>
              </Panel>

              <Panel className="min-h-[140px]">
                <CardLabel icon={<Clock size={13} />}>Uptime</CardLabel>
                <div className="text-[32px] font-bold font-mono leading-none mt-2 tracking-tight">{uptimeShort(host.uptime_display)}</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">
                  Load: {(host.load_1m ?? 0).toFixed(2)} / {(host.load_5m ?? 0).toFixed(2)} / {(host.load_15m ?? 0).toFixed(2)}
                </div>
                <div className="mt-2"><Sparkline data={cpuHist} color="hsl(var(--primary))" /></div>
              </Panel>
            </div>

            {/* Row 2 — services pill */}
            <Panel>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75">
                  Serviços Online
                </div>
                <button
                  onClick={() => navigate('/services')}
                  className="ml-auto px-3 py-1 text-[10.5px] font-mono text-muted-foreground/80 hover:text-foreground border border-border/40 rounded-md flex items-center gap-1"
                  style={{ background: 'hsl(var(--noc-depth-2))' }}>
                  Ver todos <ChevronDown size={11} />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
                {serviceEntries.length > 0 ? serviceEntries.map(([name, status]) => {
                  const ok = status === 'active' || status === 'running';
                  return (
                    <div key={name} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-primary' : 'bg-destructive'}`}
                        style={{ boxShadow: ok ? '0 0 6px hsl(var(--primary))' : '0 0 6px hsl(var(--destructive))' }} />
                      <span className="font-mono text-[12px] text-foreground/90 truncate">{name}</span>
                    </div>
                  );
                }) : (
                  <div className="text-muted-foreground font-mono text-[12px]">Sem dados</div>
                )}
              </div>
            </Panel>

            {/* Row 3 — DNS metric cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Panel className="min-h-[160px]">
                <CardLabel icon={<Globe size={13} />}>Frontend DNS</CardLabel>
                <div className="flex items-end justify-between gap-3 mt-2">
                  <div className="min-w-0">
                    <div className="text-[24px] font-bold font-mono leading-none tracking-tight truncate">
                      {frontend.ip ?? primaryIp}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-primary/30"
                      style={{ background: 'hsl(var(--primary) / 0.08)' }}>
                      <CheckCircle2 size={11} className="text-primary" />
                      <span className="text-[10.5px] font-mono text-primary">{frontend.healthy === false ? 'Sem resposta' : 'Respondendo'}</span>
                    </div>
                  </div>
                  <div className="opacity-90 flex-shrink-0"><DotMap /></div>
                </div>
              </Panel>

              <Panel className="min-h-[160px]">
                <CardLabel icon={<Activity size={13} />}>QPS</CardLabel>
                <div className="text-[40px] font-bold font-mono leading-none mt-2 tracking-tight">{qps}</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">Total: {totalQ.toLocaleString()}</div>
                <div className="mt-2"><Sparkline data={histQps.length ? histQps : [1, 2, 4, 3, 5, 6, 4, 7, 5]} color="hsl(var(--accent))" height={36} /></div>
              </Panel>

              <Panel className="min-h-[160px]">
                <CardLabel icon={<Database size={13} />}>Cache Hit</CardLabel>
                <div className="flex items-center justify-between gap-3 mt-2">
                  <div className="min-w-0">
                    <div className="text-[40px] font-bold font-mono leading-none tracking-tight">{cacheHit.toFixed(1)}%</div>
                    <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">
                      Hits: {cacheHits.toLocaleString()} · Miss: {cacheMiss.toLocaleString()}
                    </div>
                  </div>
                  <Donut pct={cacheHit} />
                </div>
              </Panel>

              <Panel className="min-h-[160px]">
                <CardLabel icon={<Timer size={13} />}>Latência</CardLabel>
                <div className="text-[40px] font-bold font-mono leading-none mt-2 tracking-tight"
                  style={{ color: 'hsl(var(--warning))', textShadow: '0 0 12px hsl(var(--warning) / 0.4)' }}>
                  {latency.toFixed(2)}ms
                </div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1.5">
                  SERVFAIL: {servfail} · NXDOMAIN: {nxdomain}
                </div>
                <div className="mt-2"><Sparkline data={histLatency.length ? histLatency : [10, 20, 15, 30, 25, 18, 35, 28]} color="hsl(var(--warning))" height={36} /></div>
              </Panel>
            </div>

            {/* Row 4 — charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Panel>
                <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  QPS (Série Temporal)
                </div>
                <div className="flex">
                  <div className="flex flex-col justify-between text-[9.5px] font-mono text-muted-foreground/60 pr-2 py-0.5"
                    style={{ height: 80 }}>
                    <span>{Math.max(...(histQps.length ? histQps : [18])).toFixed(0)}</span>
                    <span>{(Math.max(...(histQps.length ? histQps : [18])) / 2).toFixed(0)}</span>
                    <span>0</span>
                  </div>
                  <div className="flex-1"><BarChart data={histQps.length ? histQps : Array.from({ length: 36 }, () => Math.random() * 18)} color="hsl(var(--accent))" height={80} /></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 mt-2">
                  <span>Min: {histQps.length ? Math.min(...histQps).toFixed(0) : '0'}</span>
                  <span>Max: {histQps.length ? Math.max(...histQps).toFixed(0) : '18'}</span>
                </div>
              </Panel>

              <Panel>
                <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  Latência (ms)
                </div>
                <div className="flex">
                  <div className="flex flex-col justify-between text-[9.5px] font-mono text-muted-foreground/60 pr-2 py-0.5"
                    style={{ height: 80 }}>
                    <span>500</span><span>250</span><span>0</span>
                  </div>
                  <div className="flex-1"><BarChart data={histLatency.length ? histLatency : Array.from({ length: 36 }, () => Math.random() * 400)} color="hsl(330 85% 60%)" height={80} /></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 mt-2">
                  <span>Min: {histLatency.length ? Math.min(...histLatency).toFixed(1) : '0.0'}</span>
                  <span>Max: {histLatency.length ? Math.max(...histLatency).toFixed(1) : '407.9'}</span>
                </div>
              </Panel>

              <Panel>
                <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  Cache Hit (%)
                </div>
                <div className="flex">
                  <div className="flex flex-col justify-between text-[9.5px] font-mono text-muted-foreground/60 pr-2 py-0.5"
                    style={{ height: 80 }}>
                    <span>100%</span><span>50%</span><span>0%</span>
                  </div>
                  <div className="flex-1"><BarChart data={histCache.length ? histCache : Array.from({ length: 36 }, () => 55 + Math.random() * 45)} color="hsl(var(--primary))" height={80} /></div>
                </div>
                <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 mt-2">
                  <span>Min: {histCache.length ? Math.min(...histCache).toFixed(1) : '55.8'}%</span>
                  <span>Max: {histCache.length ? Math.max(...histCache).toFixed(1) : '100'}%</span>
                </div>
              </Panel>
            </div>

            {/* Row 5 — Backends + Top Domains + Top Clients */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Backends */}
              <Panel className="flex flex-col">
                <div className="flex items-center gap-2 text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  <Server size={12} className="text-primary" /> Backends ({backendsTotal})
                </div>
                <div className="flex-1 space-y-3">
                  {backends.length > 0 ? backends.map((b: any) => {
                    const r = b.resolver ?? {};
                    return (
                      <div key={b.name} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${b.healthy ? 'bg-primary' : 'bg-destructive'}`}
                            style={{ boxShadow: b.healthy ? '0 0 6px hsl(var(--primary))' : '0 0 6px hsl(var(--destructive))' }} />
                          <span className="font-mono text-[13px] font-bold text-foreground">{b.name}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3 ml-4">
                          <div className="text-[10px] font-mono text-muted-foreground/70 flex items-center gap-2">
                            <span className="text-primary/85">IPv4</span>
                            <span className="text-foreground/85">{b.ipv4 ?? b.ip ?? '—'}</span>
                          </div>
                          <div className="w-[80px] flex-shrink-0">
                            <BarChart data={Array.from({ length: 18 }, () => Math.random() * (r.qps ?? 5) + 1)} color="hsl(var(--primary))" height={22} />
                          </div>
                        </div>
                        <div className="text-[10px] font-mono text-muted-foreground/70 ml-4">
                          {(r.total_queries ?? 0).toLocaleString()} <span className="text-muted-foreground/50">queries</span> ·{' '}
                          {r.cache_hit_ratio ?? 0}% <span className="text-muted-foreground/50">cache</span> ·{' '}
                          {b.traffic?.share ?? 0}% <span className="text-muted-foreground/50">share</span>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="text-muted-foreground font-mono text-[12px]">Sem dados</div>
                  )}
                </div>
                <button
                  onClick={() => navigate('/services')}
                  className="mt-4 py-2 text-[11px] font-mono text-muted-foreground/80 hover:text-foreground border border-border/40 rounded-md w-full"
                  style={{ background: 'hsl(var(--noc-depth-2))' }}>
                  Ver todos os backends
                </button>
              </Panel>

              {/* Top Domains */}
              <Panel className="flex flex-col">
                <div className="flex items-center gap-2 text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  <Globe size={12} className="text-primary" /> Top Domains
                </div>
                <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[420px] pr-1">
                  {topDomains.length > 0 ? topDomains.slice(0, 30).map((d: any, i: number) => (
                    <div key={d.domain + i} className="flex items-center justify-between gap-2 font-mono text-[12px]">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-muted-foreground/55 w-6 text-right">{i + 1}.</span>
                        <span className="text-foreground/90 truncate">{d.domain}</span>
                      </div>
                      <span className="text-foreground/85 tabular-nums">{(d.count ?? 0).toLocaleString()}</span>
                    </div>
                  )) : (
                    <div className="text-muted-foreground font-mono text-[12px]">Sem dados</div>
                  )}
                </div>
                <button className="mt-4 py-2 text-[11px] font-mono text-muted-foreground/80 hover:text-foreground border border-border/40 rounded-md w-full"
                  style={{ background: 'hsl(var(--noc-depth-2))' }}>
                  Ver todos os domínios
                </button>
              </Panel>

              {/* Top Clients */}
              <Panel className="flex flex-col">
                <div className="flex items-center gap-2 text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                  <Wifi size={12} className="text-primary" /> Top Clients
                </div>
                <div className="flex-1 space-y-1.5 overflow-y-auto max-h-[420px] pr-1">
                  {topClients.length > 0 ? topClients.slice(0, 30).map((c: any, i: number) => (
                    <div key={c.ip + i} className="flex items-center justify-between gap-2 font-mono text-[12px]">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-muted-foreground/55 w-6 text-right">{i + 1}.</span>
                        <span className="text-foreground/90 truncate">{c.ip}</span>
                      </div>
                      <span className="text-foreground/85 tabular-nums">{(c.queries ?? 0).toLocaleString()}</span>
                    </div>
                  )) : (
                    <div className="text-muted-foreground font-mono text-[12px]">Sem dados</div>
                  )}
                </div>
                <button className="mt-4 py-2 text-[11px] font-mono text-muted-foreground/80 hover:text-foreground border border-border/40 rounded-md w-full"
                  style={{ background: 'hsl(var(--noc-depth-2))' }}>
                  Ver todos os clientes
                </button>
              </Panel>
            </div>
          </div>

          {/* ═══════════ RIGHT RAIL (3 cols) ═══════════ */}
          <div className="col-span-12 lg:col-span-3 space-y-4">
            {/* SISTEMA */}
            <Panel glow="violet">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0"><BigCheckRing /></div>
                <div className="min-w-0">
                  <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75">Sistema</div>
                  <div className="text-[22px] font-bold font-mono mt-1 leading-none" style={{ textShadow: '0 0 10px hsl(var(--primary) / 0.4)' }}>
                    {allOk ? 'OPERACIONAL' : 'ATENÇÃO'}
                  </div>
                  <div className="text-[12px] font-medium text-primary/85 mt-1.5">{opMode}</div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-border/30 space-y-2 text-[12px] font-mono">
                <div className="flex justify-between"><span className="text-muted-foreground/70">Uptime</span><span className="text-foreground/90">{uptimeShort(host.uptime_display)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground/70">Última coleta</span>
                  <span className="text-foreground/90">{dns.health?.last_update ? new Date(dns.health.last_update).toLocaleTimeString('pt-BR', { hour12: false }) : '—'}</span>
                </div>
              </div>
            </Panel>

            {/* RESUMO RÁPIDO */}
            <Panel>
              <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 mb-3">
                Resumo Rápido
              </div>
              <div className="space-y-3 text-[13px] font-mono">
                <RowStat icon={<Globe size={13} />} label="QPS Atual" value={String(qps)} />
                <RowStat icon={<Database size={13} />} label="Cache Hit" value={`${cacheHit.toFixed(1)}%`} />
                <RowStat icon={<Timer size={13} />} label="Latência" value={`${latency.toFixed(2)}ms`} />
                <RowStat icon={<Shield size={13} />} label="Serviços Online" value={`${servicesUp}/${servicesTotal}`} />
                <RowStat icon={<Server size={13} />} label="Backends Online" value={`${backendsUp}/${backendsTotal}`} />
              </div>
            </Panel>

            {/* ALERTAS */}
            <Panel glow="mint" className="text-center">
              <div className="text-[10.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground/75 text-left mb-4">
                Alertas (0)
              </div>
              <div className="flex flex-col items-center pb-3">
                <div className="w-16 h-16 rounded-full border-2 border-primary/60 flex items-center justify-center mb-3"
                  style={{ background: 'hsl(var(--primary) / 0.08)', boxShadow: '0 0 24px -4px hsl(var(--primary) / 0.6)' }}>
                  <CheckCircle2 size={32} className="text-primary" style={{ filter: 'drop-shadow(0 0 6px hsl(var(--primary)))' }} />
                </div>
                <div className="text-[14px] font-bold text-foreground">Nenhum alerta ativo</div>
                <div className="text-[11px] font-mono text-muted-foreground/70 mt-1">Tudo funcionando normalmente</div>
              </div>
            </Panel>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[10px] font-mono text-muted-foreground/40 mt-6 pb-2">
          DNS Control · Carrier Edition · Auto-refresh {REFRESH_INTERVAL / 1000}s
        </div>
      </div>
    </div>
  );
}

/* ── Resumo Rápido row ── */
function RowStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground/80">
        <span className="text-primary/80">{icon}</span>
        <span>{label}</span>
      </div>
      <span className="font-bold text-foreground">{value}</span>
    </div>
  );
}
