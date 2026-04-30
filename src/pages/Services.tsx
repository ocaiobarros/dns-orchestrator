import { useMemo, useState } from 'react';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useServices, useRestartService, useInstanceStats, useSystemInfo } from '@/lib/hooks';
import { getInstanceName, getInstanceQueries, getInstanceLatency } from '@/lib/types';
import { toast } from 'sonner';
import {
  Globe, Network as NetIcon, Shield, Layers, Activity,
  RotateCw, FileText, Eye, MoreVertical,
} from 'lucide-react';

// ───────────────────────── helpers ─────────────────────────
function formatMemory(svc: any): string {
  if (typeof svc.memory === 'string' && svc.memory) return svc.memory;
  const bytes = typeof svc.memoryBytes === 'number' ? svc.memoryBytes : 0;
  if (bytes <= 0) return svc.memory || 'N/A';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function memoryMb(svc: any): number {
  if (typeof svc.memoryBytes === 'number' && svc.memoryBytes > 0) return svc.memoryBytes / (1024 * 1024);
  if (typeof svc.memory === 'string') {
    const m = svc.memory.match(/([\d.]+)\s*(GB|MB|KB)?/i);
    if (m) {
      const v = parseFloat(m[1]);
      const u = (m[2] || 'MB').toUpperCase();
      return u === 'GB' ? v * 1024 : u === 'KB' ? v / 1024 : v;
    }
  }
  return 0;
}

function cpuPct(svc: any): number {
  if (typeof svc.cpuPercent === 'number') return svc.cpuPercent;
  if (typeof svc.cpu === 'string') {
    const m = svc.cpu.match(/([\d.]+)/);
    if (m) return parseFloat(m[1]);
  }
  return 0;
}

function getServiceStatus(svc: any): string {
  if (svc.nftables_status === 'active') return 'running';
  if (svc.nftables_status === 'empty' || svc.nftables_status === 'unavailable') return 'stopped';
  if (svc.status === 'active') return 'running';
  if (svc.status) return svc.status;
  if (svc.active === true) return 'running';
  if (svc.active === false) return 'stopped';
  return 'unknown';
}

function categorize(name: string): 'dns' | 'rede' | 'firewall' | 'proxy' | 'outro' {
  if (name.startsWith('unbound')) return 'dns';
  if (name === 'frr' || name === 'networking' || name.includes('ifupdown')) return 'rede';
  if (name === 'nftables' || name.includes('firewall')) return 'firewall';
  if (name === 'nginx' || name.includes('proxy')) return 'proxy';
  return 'outro';
}

function categoryLabel(c: string): string {
  return c === 'dns' ? 'DNS Resolver'
    : c === 'rede' ? 'Rede'
    : c === 'firewall' ? 'Firewall'
    : c === 'proxy' ? 'Proxy'
    : 'Outro';
}

// Health % derivado de sinais reais (status + cpu/mem). Sem mock — apenas score determinístico.
function healthScore(svc: any): number {
  const st = getServiceStatus(svc);
  if (st !== 'running') return 0;
  const cpu = cpuPct(svc);
  const mem = memoryMb(svc);
  let score = 100;
  if (cpu > 80) score -= 25; else if (cpu > 60) score -= 12; else if (cpu > 40) score -= 5;
  if (mem > 2048) score -= 10; else if (mem > 1024) score -= 4;
  return Math.max(60, Math.min(100, Math.round(score)));
}

// Sparkline determinística baseada em uma seed (PID + nome). Visual apenas.
function sparkPath(seedStr: string, w: number, h: number, points = 24): string {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed % 1000) / 1000; };
  const vals = Array.from({ length: points }, () => 0.3 + rand() * 0.55);
  const step = w / (points - 1);
  return vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - v * h).toFixed(1)}`).join(' ');
}

// ───────────────────────── small UI atoms ─────────────────────────
function HealthRing({ pct, size = 44 }: { pct: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  const color = pct >= 95 ? 'hsl(var(--primary))' : pct >= 80 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .4s ease', filter: `drop-shadow(0 0 4px ${color})` }} />
      </svg>
      <span className="absolute text-[10px] font-mono font-bold" style={{ color }}>{pct}%</span>
    </div>
  );
}

function RunningBadge({ status }: { status: string }) {
  const ok = status === 'running' || status === 'active';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider border
      ${ok ? 'border-primary/40 bg-primary/10 text-primary' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-primary' : 'bg-destructive'}`}
        style={{ boxShadow: `0 0 6px ${ok ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'}` }} />
      {ok ? 'RUNNING' : status.toUpperCase()}
    </span>
  );
}

function MetricRow({
  label, value, suffix, pct, sparkSeed,
}: { label: string; value: string; suffix?: string; pct?: number; sparkSeed: string }) {
  const safePct = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)_70px_46px] items-center gap-2 text-[10.5px] font-mono">
      <span className="text-muted-foreground/70 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-foreground/90 font-semibold tabular-nums">{value}</span>
        <div className="flex-1 h-1 rounded-full bg-border/40 overflow-hidden min-w-0">
          <div className="h-full rounded-full bg-primary"
            style={{ width: `${safePct}%`, boxShadow: '0 0 6px hsl(var(--primary) / 0.6)' }} />
        </div>
      </div>
      <svg width={70} height={18} className="text-primary/80">
        <path d={sparkPath(sparkSeed, 70, 18)} fill="none" stroke="currentColor" strokeWidth="1" />
      </svg>
      <span className="text-muted-foreground/70 text-right tabular-nums">{suffix ?? ''}</span>
    </div>
  );
}

// ───────────────────────── status strip block ─────────────────────────
function CategoryBlock({
  icon, label, healthy, total,
}: { icon: React.ReactNode; label: string; healthy: number; total: number }) {
  const pct = total > 0 ? (healthy / total) * 100 : 0;
  const allOk = healthy === total && total > 0;
  return (
    <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <div className="text-primary">{icon}</div>
        <span className="text-[12px] font-semibold text-foreground/95 truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-mono font-bold text-foreground">{healthy}/{total}</span>
        <span className={`text-[10.5px] font-mono ${allOk ? 'text-primary' : 'text-warning'}`}>
          {total === 0 ? 'Sem serviços' : allOk ? 'Todos saudáveis' : `${total - healthy} com falha`}
        </span>
      </div>
      <div className="h-1 rounded-full bg-border/50 overflow-hidden">
        <div className={`h-full rounded-full ${allOk ? 'bg-primary' : 'bg-warning'}`}
          style={{ width: `${pct}%`, boxShadow: `0 0 6px ${allOk ? 'hsl(var(--primary))' : 'hsl(var(--warning))'}` }} />
      </div>
    </div>
  );
}

// ───────────────────────── service card ─────────────────────────
function ServiceCard({
  svc, onRestart, onLogs, onInspect, instanceQps, instanceLatencyMs, version,
}: {
  svc: any;
  onRestart: () => void;
  onLogs: () => void;
  onInspect: () => void;
  instanceQps?: number;
  instanceLatencyMs?: number;
  version?: string;
}) {
  const status = getServiceStatus(svc);
  const isNft = svc.name === 'nftables';
  const cat = categorize(svc.name);
  const cpu = cpuPct(svc);
  const mem = memoryMb(svc);
  const memMax = mem > 1024 ? 4096 : 2048;
  const memPct = mem > 0 ? Math.min(100, (mem / memMax) * 100) : 0;
  const health = healthScore(svc);
  const seed = `${svc.name}-${svc.pid ?? 0}`;
  const cpuTime = svc.cpu_time || svc.cpuTime || (typeof svc.cpu === 'string' && svc.cpu.includes('s') ? svc.cpu : '');

  return (
    <div className="group relative rounded-lg border border-border bg-card p-4 transition-all
      hover:-translate-y-0.5 hover:border-primary/40"
      style={{ boxShadow: 'inset 0 1px 0 hsl(var(--border) / 0.4)' }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 28px -12px hsl(var(--primary) / 0.45), inset 0 1px 0 hsl(var(--border) / 0.4)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 1px 0 hsl(var(--border) / 0.4)'; }}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-mono font-bold text-[14px] text-foreground truncate">{svc.display_name || svc.name}</h3>
            <RunningBadge status={status} />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 uppercase tracking-wider">
            {categoryLabel(cat)}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[9px] font-mono text-muted-foreground/70 uppercase tracking-wider">Health</span>
          <HealthRing pct={health} />
        </div>
      </div>

      {/* metrics body */}
      {!isNft ? (
        <div className="space-y-1.5 py-2 border-y border-border/40">
          <MetricRow
            label="CPU" value={`${cpu.toFixed(0)}%`} suffix={cpuTime || ''}
            pct={cpu} sparkSeed={seed + '-cpu'}
          />
          <MetricRow
            label="Memória" value={formatMemory(svc)} suffix={`${memPct.toFixed(0)}%`}
            pct={memPct} sparkSeed={seed + '-mem'}
          />
          {typeof instanceLatencyMs === 'number' && instanceLatencyMs > 0 && (
            <MetricRow
              label="Latência (p95)" value={`${instanceLatencyMs.toFixed(1)} ms`}
              pct={Math.min(100, instanceLatencyMs * 2)} sparkSeed={seed + '-lat'}
            />
          )}
          {typeof instanceQps === 'number' && instanceQps > 0 && (
            <MetricRow
              label={cat === 'proxy' ? 'REQ/S' : 'QPS'} value={`${(instanceQps / 1000).toFixed(1)}k qps`}
              pct={Math.min(100, instanceQps / 200)} sparkSeed={seed + '-qps'}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3 py-3 border-y border-border/40 text-[11px] font-mono">
          <div>
            <div className="text-[9px] uppercase text-muted-foreground/70 tracking-wider mb-1">Status</div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status === 'running' ? 'bg-primary' : 'bg-destructive'}`} />
              <span className={status === 'running' ? 'text-primary font-bold' : 'text-destructive font-bold'}>
                {status === 'running' ? 'Ativo' : 'Inativo'}
              </span>
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground/70 tracking-wider mb-1">Tabelas</div>
            <div className="text-foreground font-bold">{Array.isArray(svc.tables) ? svc.tables.length : '—'}</div>
            <div className="text-[9px] text-muted-foreground/60 truncate">
              {Array.isArray(svc.tables) && svc.tables.length ? svc.tables.join(', ') : ''}
            </div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground/70 tracking-wider mb-1">Regras</div>
            <div className="text-foreground font-bold">{svc.rules_count ?? '—'}</div>
          </div>
          <div>
            <div className="text-[9px] uppercase text-muted-foreground/70 tracking-wider mb-1">Conexões</div>
            <div className="text-foreground font-bold">{svc.conntrack_count ?? '—'}</div>
          </div>
        </div>
      )}

      {/* footer info */}
      <div className="grid grid-cols-3 gap-2 py-2 mt-1 text-[10px] font-mono">
        <div>
          <div className="text-muted-foreground/60 uppercase tracking-wider">Uptime</div>
          <div className="text-foreground/90 truncate">{svc.uptime || '—'}</div>
        </div>
        <div>
          <div className="text-muted-foreground/60 uppercase tracking-wider">PID</div>
          <div className="text-foreground/90">{svc.pid ?? '—'}</div>
        </div>
        <div>
          <div className="text-muted-foreground/60 uppercase tracking-wider">Versão</div>
          <div className="text-foreground/90 truncate">{version || '—'}</div>
        </div>
      </div>

      {/* actions */}
      <div className="flex items-center gap-2 pt-3 mt-1 border-t border-border/40">
        <button
          onClick={onLogs}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-border bg-secondary/40 hover:bg-secondary/70 text-[11px] font-mono text-foreground/90 transition-colors"
        >
          <FileText size={12} /> Logs
        </button>
        {!isNft && (
          <button
            onClick={onRestart}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-primary/40 bg-primary/10 hover:bg-primary/20 text-[11px] font-mono text-primary transition-colors"
          >
            <RotateCw size={12} /> Restart
          </button>
        )}
        <button
          onClick={onInspect}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border border-border bg-secondary/40 hover:bg-secondary/70 text-[11px] font-mono text-foreground/90 transition-colors"
        >
          <Eye size={12} /> Inspecionar
        </button>
        <button
          className="inline-flex items-center justify-center w-7 h-7 rounded border border-border bg-secondary/40 hover:bg-secondary/70 text-muted-foreground"
          aria-label="Mais ações"
        >
          <MoreVertical size={12} />
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── page ─────────────────────────
export default function Services() {
  const { data: services, isLoading, error, refetch } = useServices();
  const { data: instanceStats } = useInstanceStats();
  const { data: sysInfo } = useSystemInfo();
  const restartMutation = useRestartService();
  const [groupFilter, setGroupFilter] = useState<'todos' | 'dns' | 'rede' | 'firewall' | 'proxy'>('todos');
  const [inspecting, setInspecting] = useState<any | null>(null);
  const [logsOf, setLogsOf] = useState<any | null>(null);

  const handleRestart = (name: string) => {
    restartMutation.mutate(name, {
      onSuccess: () => toast.success(`${name} reiniciado com sucesso`),
      onError: (err) => toast.error(`Falha ao reiniciar ${name}: ${err.message}`),
    });
  };

  const safe = useMemo(() => Array.isArray(services) ? services.filter(Boolean) : [], [services]);

  const grouped = useMemo(() => {
    const cats = { dns: [] as any[], rede: [] as any[], firewall: [] as any[], proxy: [] as any[], outro: [] as any[] };
    safe.forEach((s: any) => { cats[categorize(s.name)].push(s); });
    return cats;
  }, [safe]);

  const summary = (arr: any[]) => ({
    total: arr.length,
    healthy: arr.filter((s) => getServiceStatus(s) === 'running').length,
  });

  const versionFor = (svc: any): string => {
    const n = svc.name;
    if (n.startsWith('unbound')) return sysInfo?.unbound_version || sysInfo?.unboundVersion || '';
    if (n === 'frr') return sysInfo?.frr_version || sysInfo?.frrVersion || '';
    if (n === 'nftables') return sysInfo?.nftables_version || sysInfo?.nftablesVersion || '';
    if (n === 'nginx') return svc.version || '';
    return svc.version || '';
  };

  const instanceFor = (svc: any) => {
    if (!svc.name.startsWith('unbound') || !Array.isArray(instanceStats)) return undefined;
    return instanceStats.find((i: any) => getInstanceName(i).toLowerCase() === svc.name.toLowerCase());
  };

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  const visible = groupFilter === 'todos' ? safe : grouped[groupFilter];

  return (
    <div className="space-y-4 noc-page">
      {/* page header */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Serviços</h1>
          <p className="text-[12px] text-muted-foreground">Estado real dos serviços do sistema</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as any)}
            className="bg-card border border-border rounded px-3 py-1.5 text-[12px] font-mono text-foreground/90 hover:border-primary/40"
          >
            <option value="todos">Todos os grupos</option>
            <option value="dns">DNS Resolver</option>
            <option value="rede">Rede</option>
            <option value="firewall">Firewall</option>
            <option value="proxy">Proxy</option>
          </select>
        </div>
      </div>

      {/* status strip */}
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
        <CategoryBlock icon={<Globe size={16} />} label="DNS Resolver" {...summary(grouped.dns)} />
        <CategoryBlock icon={<NetIcon size={16} />} label="Rede (FRR)" {...summary(grouped.rede)} />
        <CategoryBlock icon={<Shield size={16} />} label="Firewall (nftables)" {...summary(grouped.firewall)} />
        <CategoryBlock icon={<Layers size={16} />} label="Proxy (nginx)" {...summary(grouped.proxy)} />
      </div>

      {/* services grid */}
      <div className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
        {visible.length === 0 && (
          <div className="col-span-full text-center text-muted-foreground text-sm py-12 border border-dashed border-border rounded-lg">
            Nenhum serviço encontrado
          </div>
        )}
        {visible.map((svc: any) => {
          const inst = instanceFor(svc);
          return (
            <ServiceCard
              key={svc.name}
              svc={svc}
              version={versionFor(svc)}
              instanceQps={inst ? getInstanceQueries(inst) : undefined}
              instanceLatencyMs={inst ? getInstanceLatency(inst) : undefined}
              onRestart={() => handleRestart(svc.name)}
              onLogs={() => setLogsOf(svc)}
              onInspect={() => setInspecting(svc)}
            />
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground/70 pt-2">
        <span>Mostrando {visible.length} de {safe.length} serviços</span>
        <span className="inline-flex items-center gap-1.5"><Activity size={11} className="text-primary" /> Atualização automática</span>
      </div>

      {/* inspect drawer */}
      {inspecting && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setInspecting(null)}>
          <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold font-mono text-foreground">Inspecionar — {inspecting.display_name || inspecting.name}</h3>
              <button onClick={() => setInspecting(null)} className="text-muted-foreground hover:text-foreground text-sm">Fechar</button>
            </div>
            <pre className="text-[11px] font-mono text-foreground/85 whitespace-pre-wrap break-all bg-background/50 border border-border rounded p-3">
{JSON.stringify(inspecting, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {/* logs drawer (last log line do backend) */}
      {logsOf && (
        <div className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLogsOf(null)}>
          <div className="bg-card border border-border rounded-lg w-full max-w-2xl max-h-[80vh] overflow-auto p-5"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold font-mono text-foreground">Logs — {logsOf.display_name || logsOf.name}</h3>
              <button onClick={() => setLogsOf(null)} className="text-muted-foreground hover:text-foreground text-sm">Fechar</button>
            </div>
            <pre className="text-[11px] font-mono text-foreground/85 whitespace-pre-wrap bg-background/50 border border-border rounded p-3 min-h-[120px]">
{logsOf.lastLog || 'Sem entradas de log recentes para este serviço.'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
