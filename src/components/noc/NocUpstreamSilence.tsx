/**
 * NocUpstreamSilence
 *
 * Painel da Aba de Observabilidade — v1 do detector "IPs autoritativos sem
 * resposta" via nf_conntrack [UNREPLIED]. Espelha NocAnablockStatus em
 * termos de:
 *   - degradação honesta (chip "indisponível" quando collector_status !== 'ok';
 *     "desativado" quando off);
 *   - estado vazio honesto ("nenhum autoritativo mudo na janela");
 *   - polling leve a cada 15 s, sem rerender de árvore inteira.
 *
 * O toggle (admin) vive no mesmo cartão para o operador autenticado como
 * admin; viewers veem apenas leitura. Auditoria do toggle é feita no backend
 * (operational_events) — aqui só dispara a chamada.
 */

import { useEffect, useMemo, useState } from 'react';
import { Radio, AlertTriangle, PowerOff, Wifi, RefreshCw, Loader2 } from 'lucide-react';
import { api, type UpstreamSilenceSnapshot } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

function formatAge(epochSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

type ChipKind = 'ok' | 'degraded' | 'disabled';

const CHIP: Record<ChipKind, { label: string; cls: string; icon: typeof Radio }> = {
  ok: {
    label: 'observando',
    cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
    icon: Wifi,
  },
  degraded: {
    label: 'indisponível',
    cls: 'border-destructive/40 bg-destructive/10 text-destructive',
    icon: AlertTriangle,
  },
  disabled: {
    label: 'desativado',
    cls: 'border-border/60 bg-muted/30 text-muted-foreground',
    icon: PowerOff,
  },
};

export default function NocUpstreamSilence() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [snap, setSnap] = useState<UpstreamSilenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnap = async () => {
    try {
      const res = await api.getUpstreamSilence();
      if (res.success && res.data) {
        setSnap(res.data);
        setError(null);
      } else {
        setError(res.error || 'Falha ao ler snapshot');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchSnap();
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const status = (snap?.collector_status ?? 'disabled') as ChipKind;
  const chip = CHIP[status] ?? CHIP.disabled;
  const Icon = chip.icon;

  const items = snap?.items ?? [];
  const totals = useMemo(() => ({
    v4: items.filter((i) => i.family === 'ipv4').length,
    v6: items.filter((i) => i.family === 'ipv6').length,
  }), [items]);

  const handleToggle = async (checked: boolean) => {
    if (!isAdmin || toggling) return;
    setToggling(true);
    try {
      const res = await api.setUpstreamSilenceEnabled(checked);
      if (!res.success) setError(res.error || 'Falha ao alternar');
      await fetchSnap();
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/80">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Detector — IPs autoritativos sem resposta
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border font-mono text-[10px] uppercase ${chip.cls}`}>
            <Icon size={10} /> {chip.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={fetchSnap}
            disabled={loading}
            className="h-7 px-2"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Button>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Coleta
              </span>
              <Switch
                checked={snap?.running ?? false}
                onCheckedChange={handleToggle}
                disabled={toggling}
                aria-label="Ativar detector"
              />
            </div>
          )}
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {!isAdmin && snap?.collector_status === 'disabled' && (
          <div className="text-[11px] font-mono text-muted-foreground">
            Detector desativado. Peça a um administrador para habilitar a coleta.
          </div>
        )}

        {snap?.collector_status === 'degraded' && (
          <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] font-mono text-destructive">
            <div className="font-semibold uppercase tracking-wider mb-1">Indisponível</div>
            <div>{snap.last_error ?? 'Subprocesso de leitura indisponível.'}</div>
            {!snap.binary_available && (
              <div className="mt-1 text-[10px] opacity-80">
                Verifique: <code>apt install conntrack</code> e <code>nft list table ip raw</code> (sem NOTRACK em udp/53).
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-[10px] font-mono text-destructive">⚠ {error}</div>
        )}

        <div className="grid grid-cols-4 gap-2 text-[11px] font-mono">
          <div>
            <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">Janelas</div>
            <div className="text-foreground tabular-nums">
              {Math.round((snap?.window_seconds.short ?? 300) / 60)}/{Math.round((snap?.window_seconds.long ?? 900) / 60)} min
            </div>
          </div>
          <div>
            <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">IPs únicos</div>
            <div className="text-foreground tabular-nums">{snap?.unique_ips ?? 0}</div>
          </div>
          <div>
            <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">IPv4 / IPv6</div>
            <div className="text-foreground tabular-nums">{totals.v4} / {totals.v6}</div>
          </div>
          <div>
            <div className="text-muted-foreground/60 text-[9px] uppercase tracking-wider">Eventos totais</div>
            <div className="text-foreground tabular-nums">{snap?.events_total ?? 0}</div>
          </div>
        </div>

        <div className="rounded border border-border/40">
          <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/40 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
            <div className="col-span-5">IP autoritativo</div>
            <div className="col-span-1">v</div>
            <div className="col-span-2 text-right">5 min</div>
            <div className="col-span-2 text-right">15 min</div>
            <div className="col-span-2 text-right">Última</div>
          </div>
          {loading && !snap ? (
            <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground/60">
              Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground">
              {snap?.collector_status === 'ok'
                ? 'Nenhum autoritativo mudo na janela observada.'
                : snap?.collector_status === 'disabled'
                  ? 'Sem observação ativa — distinto de "0 falhas".'
                  : 'Sem dados — coleta indisponível.'}
            </div>
          ) : (
            <div className="divide-y divide-border/40 max-h-[480px] overflow-y-auto">
              {items.map((row) => (
                <div key={row.ip} className="grid grid-cols-12 gap-2 px-3 py-1.5 text-[11px] font-mono hover:bg-secondary/40">
                  <div className="col-span-5 text-foreground truncate" title={row.ip}>{row.ip}</div>
                  <div className="col-span-1 text-muted-foreground uppercase">{row.family === 'ipv6' ? 'v6' : 'v4'}</div>
                  <div className="col-span-2 text-right tabular-nums text-foreground">{row.count_5min}</div>
                  <div className="col-span-2 text-right tabular-nums text-amber-400">{row.count_15min}</div>
                  <div className="col-span-2 text-right text-muted-foreground">{formatAge(row.last_seen_epoch)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-[9px] font-mono text-muted-foreground/60 leading-relaxed">
          Fonte: <code>conntrack -E -p udp --dport 53 [UNREPLIED]</code>. Detector
          puramente observacional (não bloqueia, não altera nftables/Unbound).
          v2 (eBPF + enriquecimento por qname via dnstap) fica fora deste escopo.
        </div>
      </div>
    </div>
  );
}
