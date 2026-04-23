import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';
import { api } from '@/lib/api';

type AnablockTelemetry = Awaited<ReturnType<typeof api.getTelemetryAnablock>>;

function formatAge(seconds: number | null): string {
  if (seconds == null) return '—';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

const STATUS_THEME: Record<string, { icon: typeof ShieldCheck; color: string; bg: string; label: string }> = {
  OK: { icon: ShieldCheck, color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'OK' },
  FAIL: { icon: ShieldAlert, color: 'text-red-400', bg: 'bg-red-500/10', label: 'FAIL' },
  UNKNOWN: { icon: ShieldQuestion, color: 'text-muted-foreground', bg: 'bg-muted/10', label: 'Sem dados' },
};

export default function NocAnablockStatus() {
  const [data, setData] = useState<AnablockTelemetry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const result = await api.getTelemetryAnablock();
        if (!cancelled) setData(result);
      } catch {
        // silent — keeps "Sem dados" state
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    const id = setInterval(fetchData, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const status = (data?.anablock_last_status ?? 'UNKNOWN') as keyof typeof STATUS_THEME;
  const theme = STATUS_THEME[status] ?? STATUS_THEME.UNKNOWN;
  const Icon = theme.icon;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon size={14} className={theme.color} />
            <span className="text-xs font-semibold uppercase tracking-wider text-foreground">AnaBlock</span>
          </div>
          <div className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${theme.bg} ${theme.color}`}>
            {theme.label}
          </div>
        </div>
      </div>
      <div className="noc-surface-body space-y-3">
        {loading ? (
          <div className="text-[11px] text-muted-foreground/60 font-mono">Carregando…</div>
        ) : !data?.enabled ? (
          <div className="text-[11px] text-muted-foreground font-mono">
            AnaBlock desabilitado no Wizard. Habilite em <span className="text-foreground">Wizard → Bloqueio</span>{' '}
            para sincronizar a blocklist judicial via API oficial.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
              <div>
                <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">Domínios</div>
                <div className="text-foreground tabular-nums">
                  {(data.anablock_domains_loaded_count ?? 0).toLocaleString('pt-BR')}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">Última sync</div>
                <div className={data.stale ? 'text-amber-400' : 'text-foreground'}>
                  {formatAge(data.age_seconds)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">Modo</div>
                <div className="text-foreground truncate" title={data.mode ?? '—'}>
                  {data.mode ?? '—'}
                </div>
              </div>
            </div>
            {data.message && (
              <div className="text-[10px] text-muted-foreground/80 font-mono pt-1 border-t border-border/40">
                {data.message}
              </div>
            )}
            {!data.conf_present && (
              <div className="text-[10px] text-amber-400 font-mono">
                ⚠ /etc/unbound/anablock.conf ausente — Unbound pode falhar no include.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
