/**
 * NocUpstreamSilence (v1.1)
 *
 * Painel da Aba de Observabilidade — detector de IPs autoritativos sem
 * resposta via nf_conntrack [UNREPLIED]. Espelha NocAnablockStatus:
 *   - degradação honesta (chip 'indisponível' / 'desativado' / 'observando');
 *   - estado vazio honesto;
 *   - mutações (toggle / config) admin-only e auditadas no backend.
 *
 * v1.1 adiciona:
 *   - Filtro IPv4/IPv6 + destaque de recência (client-side puro).
 *   - Alerta com banner derivado do snapshot (backend emite o evento UMA
 *     única vez na transição abaixo→acima).
 *   - Polling near-real-time via React Query (refetchInterval=5s) com
 *     pausa automática quando a aba/janela perde foco
 *     (refetchIntervalInBackground=false).
 *   - Form admin de janelas, cap e limiar — backend valida/clampeia.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Radio, AlertTriangle, PowerOff, Wifi, RefreshCw, Loader2, Settings2, Bell,
} from 'lucide-react';
import {
  api,
  type UpstreamSilenceSnapshot,
  type UpstreamSilenceConfig,
  type UpstreamSilenceConfigEnvelope,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type Family = 'all' | 'ipv4' | 'ipv6';
type ChipKind = 'ok' | 'degraded' | 'disabled';

const RECENT_THRESHOLD_SEC = 60; // <1 min = "recente"

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

function formatAge(epochSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - epochSec));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function recencyKind(lastSeenEpoch: number, now: number = Date.now() / 1000): 'recent' | 'old' {
  return now - lastSeenEpoch < RECENT_THRESHOLD_SEC ? 'recent' : 'old';
}

export function filterItemsByFamily<T extends { family: 'ipv4' | 'ipv6' }>(
  items: T[],
  family: Family,
): T[] {
  if (family === 'all') return items;
  return items.filter((i) => i.family === family);
}

export default function NocUpstreamSilence() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();
  const [family, setFamily] = useState<Family>('all');

  // Polling near-real-time. refetchIntervalInBackground=false → pausa
  // automaticamente quando a aba/janela perde foco (Page Visibility API,
  // implementada internamente pelo React Query).
  const snapQuery = useQuery({
    queryKey: ['upstream-silence', 'snapshot'],
    queryFn: async () => {
      const res = await api.getUpstreamSilence();
      if (!res.success || !res.data) throw new Error(res.error || 'Falha ao ler snapshot');
      return res.data;
    },
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const snap: UpstreamSilenceSnapshot | undefined = snapQuery.data;
  const loading = snapQuery.isLoading;

  const toggleMut = useMutation({
    mutationFn: (enabled: boolean) => api.setUpstreamSilenceEnabled(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['upstream-silence'] }),
  });

  const status = (snap?.collector_status ?? 'disabled') as ChipKind;
  const chip = CHIP[status] ?? CHIP.disabled;
  const Icon = chip.icon;

  const items = snap?.items ?? [];
  const filtered = useMemo(() => filterItemsByFamily(items, family), [items, family]);
  const totals = useMemo(() => ({
    v4: items.filter((i) => i.family === 'ipv4').length,
    v6: items.filter((i) => i.family === 'ipv6').length,
  }), [items]);

  const alert = snap?.alert;
  const alertActive = !!alert?.active || !!alert?.above;

  return (
    <div className="space-y-3">
      {alertActive && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-amber-300">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider">
            <Bell size={14} /> Alerta — silêncio acima do limiar
          </div>
          <div className="text-[11px] font-mono mt-1">
            {alert?.count} IPs autoritativos mudos na janela{' '}
            {Math.round((alert?.window_seconds ?? 0) / 60)} min (limiar:{' '}
            {alert?.threshold}). Backend já registrou
            <code className="mx-1">telemetry.upstream_silence.alert</code>
            uma vez nesta transição.
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border/60 bg-card/80">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
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
              onClick={() => snapQuery.refetch()}
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
                  onCheckedChange={(v) => toggleMut.mutate(v)}
                  disabled={toggleMut.isPending}
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

          {snapQuery.isError && (
            <div className="text-[10px] font-mono text-destructive">
              ⚠ {(snapQuery.error as Error)?.message}
            </div>
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

          {/* Family filter (segmented) */}
          <div className="flex items-center gap-1" role="tablist" aria-label="Filtrar por família">
            {(['all', 'ipv4', 'ipv6'] as Family[]).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={family === f}
                onClick={() => setFamily(f)}
                className={`px-2 py-1 text-[10px] font-mono uppercase tracking-wider border rounded ${
                  family === f
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'todos' : f}
              </button>
            ))}
            <div className="ml-auto text-[10px] font-mono text-muted-foreground">
              {filtered.length} / {items.length}
            </div>
          </div>

          <div className="rounded border border-border/40">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 border-b border-border/40 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">
              <div className="col-span-4">IP autoritativo</div>
              <div className="col-span-1">v</div>
              <div className="col-span-2 text-right">5 min</div>
              <div className="col-span-2 text-right">15 min</div>
              <div className="col-span-2 text-right">Última</div>
              <div className="col-span-1 text-right">Rec.</div>
            </div>
            {loading && !snap ? (
              <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground/60">
                Carregando…
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] font-mono text-muted-foreground">
                {snap?.collector_status === 'ok'
                  ? 'Nenhum autoritativo mudo na janela observada.'
                  : snap?.collector_status === 'disabled'
                    ? 'Sem observação ativa — distinto de "0 falhas".'
                    : 'Sem dados — coleta indisponível.'}
              </div>
            ) : (
              <div className="divide-y divide-border/40 max-h-[480px] overflow-y-auto">
                {filtered.map((row) => {
                  const kind = recencyKind(row.last_seen_epoch);
                  return (
                    <div
                      key={row.ip}
                      className={`grid grid-cols-12 gap-2 px-3 py-1.5 text-[11px] font-mono hover:bg-secondary/40 ${
                        kind === 'recent' ? 'bg-amber-500/5' : ''
                      }`}
                    >
                      <div className="col-span-4 text-foreground truncate" title={row.ip}>{row.ip}</div>
                      <div className="col-span-1 text-muted-foreground uppercase">{row.family === 'ipv6' ? 'v6' : 'v4'}</div>
                      <div className="col-span-2 text-right tabular-nums text-foreground">{row.count_5min}</div>
                      <div className="col-span-2 text-right tabular-nums text-amber-400">{row.count_15min}</div>
                      <div className="col-span-2 text-right text-muted-foreground">{formatAge(row.last_seen_epoch)}</div>
                      <div className="col-span-1 text-right">
                        {kind === 'recent' ? (
                          <Badge
                            data-testid="recency-badge"
                            variant="outline"
                            className="h-4 px-1 py-0 text-[9px] uppercase border-amber-500/60 text-amber-400"
                          >
                            novo
                          </Badge>
                        ) : (
                          <span className="text-[9px] text-muted-foreground/40">·</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="text-[9px] font-mono text-muted-foreground/60 leading-relaxed">
            Polling 5 s, pausa quando a aba sai de foco. Backend emite o
            evento de alerta uma única vez por transição (debounce).
            Fonte: <code>conntrack -E -p udp --dport 53 [UNREPLIED]</code>.
            Puramente observacional (não bloqueia, não altera nftables/Unbound).
          </div>
        </div>
      </div>

      {isAdmin && <UpstreamSilenceConfigForm />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Admin config form — windows / cap / alert threshold + alert window.
// Backend é autoridade: valida/clampeia e responde com o efetivo.
// ─────────────────────────────────────────────────────────────────────

function UpstreamSilenceConfigForm() {
  const qc = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: ['upstream-silence', 'config'],
    queryFn: async () => {
      const res = await api.getUpstreamSilenceConfig();
      if (!res.success || !res.data) throw new Error(res.error || 'Falha');
      return res.data;
    },
    staleTime: 60_000,
  });

  const env: UpstreamSilenceConfigEnvelope | undefined = cfgQuery.data;
  const [draft, setDraft] = useState<UpstreamSilenceConfig | null>(null);
  const cfg = draft ?? env?.config ?? null;

  const mut = useMutation({
    mutationFn: (next: Partial<UpstreamSilenceConfig>) => api.updateUpstreamSilenceConfig(next),
    onSuccess: (res) => {
      if (res.success && res.data) {
        setDraft(res.data.config);
        qc.invalidateQueries({ queryKey: ['upstream-silence'] });
      }
    },
  });

  if (!env || !cfg) {
    return (
      <div className="rounded-lg border border-border/60 bg-card/80 px-4 py-3 text-[11px] font-mono text-muted-foreground">
        Carregando configuração…
      </div>
    );
  }

  const bounds = env.bounds;
  const updateField = <K extends keyof UpstreamSilenceConfig>(k: K, v: UpstreamSilenceConfig[K]) => {
    setDraft({ ...(cfg as UpstreamSilenceConfig), [k]: v });
  };

  return (
    <div className="rounded-lg border border-border/60 bg-card/80">
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <Settings2 size={14} className="text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Configuração admin — janelas, cap e alerta
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          backend valida/clampeia ({bounds.window_seconds.min}–{bounds.window_seconds.max}s,
          cap {bounds.snapshot_cap.min}–{bounds.snapshot_cap.max},
          limiar {bounds.alert_threshold.min}–{bounds.alert_threshold.max})
        </span>
      </div>
      <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
        <NumberField
          label="Janela curta (s)"
          value={cfg.window_short}
          min={bounds.window_seconds.min}
          max={bounds.window_seconds.max}
          onChange={(v) => updateField('window_short', v)}
        />
        <NumberField
          label="Janela longa (s)"
          value={cfg.window_long}
          min={bounds.window_seconds.min}
          max={bounds.window_seconds.max}
          onChange={(v) => updateField('window_long', v)}
        />
        <NumberField
          label="Cap (top N do snapshot)"
          value={cfg.snapshot_cap}
          min={bounds.snapshot_cap.min}
          max={bounds.snapshot_cap.max}
          onChange={(v) => updateField('snapshot_cap', v)}
        />
        <NumberField
          label="Limiar de alerta (IPs únicos)"
          value={cfg.alert_threshold}
          min={bounds.alert_threshold.min}
          max={bounds.alert_threshold.max}
          onChange={(v) => updateField('alert_threshold', v)}
        />
        <div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">Janela do alerta</div>
          <div className="flex gap-1 mt-1">
            {(['short', 'long'] as const).map((w) => (
              <button
                key={w}
                onClick={() => updateField('alert_window', w)}
                className={`px-2 py-1 text-[10px] uppercase border rounded ${
                  cfg.alert_window === w
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:text-foreground'
                }`}
              >
                {w === 'short' ? 'curta' : 'longa'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDraft(env.defaults)}
            disabled={mut.isPending}
          >
            Restaurar padrões
          </Button>
          <Button
            size="sm"
            onClick={() => mut.mutate(cfg)}
            disabled={mut.isPending}
          >
            {mut.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Aplicar'}
          </Button>
        </div>
      </div>
      {mut.isError && (
        <div className="px-4 pb-3 text-[10px] font-mono text-destructive">
          ⚠ {(mut.error as Error)?.message}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label, value, min, max, onChange,
}: {
  label: string; value: number; min: number; max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/60">
        {label} <span className="opacity-50">({min}–{max})</span>
      </div>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
        className="mt-1 h-8 font-mono text-[11px]"
      />
    </label>
  );
}
