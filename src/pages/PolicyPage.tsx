/**
 * POL-1 — Policy Plane (read-only)
 *
 * Read-only view of the native policy plane: lists rules grouped by layer
 * (100/200/300/400), shows scope (global vs. view), feed sources and tenants.
 * NO mutations — CRUD lands in POL-2/POL-3 (admin-only). Viewer-accessible.
 */

import { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Layers, Eye, Rss, Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '@/components/DataStates';
import { api, type PolicyRuleRecord } from '@/lib/api';

type LayerKey = '100' | '200' | '300' | '400';

const LAYER_META: Record<LayerKey, { label: string; icon: React.ElementType; tone: string }> = {
  '100': { label: 'AnaBlock judicial', icon: ShieldAlert, tone: 'text-destructive border-l-destructive' },
  '200': { label: 'Bloqueio nativo do operador', icon: Shield, tone: 'text-foreground border-l-muted-foreground' },
  '300': { label: 'Feeds de reputação', icon: Rss, tone: 'text-blue-500 border-l-blue-500' },
  '400': { label: 'Allowlist / exceção', icon: ShieldCheck, tone: 'text-emerald-500 border-l-emerald-500' },
};

export default function PolicyPage() {
  const [layerFilter, setLayerFilter] = useState<'all' | LayerKey>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'view'>('all');

  const summaryQ = useQuery({
    queryKey: ['policy', 'summary'],
    queryFn: async () => {
      const r = await api.getPolicySummary();
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
  });
  const rulesQ = useQuery({
    queryKey: ['policy', 'rules', layerFilter, scopeFilter],
    queryFn: async () => {
      const r = await api.getPolicyRules({
        layer: layerFilter === 'all' ? undefined : Number(layerFilter),
        scope_view: scopeFilter === 'all' ? undefined : scopeFilter === 'global' ? 'global' : undefined,
      });
      if (!r.success) throw new Error(r.error!);
      const items = r.data!.items;
      return scopeFilter === 'view' ? items.filter(i => i.scope_view !== null) : items;
    },
  });
  const viewsQ = useQuery({
    queryKey: ['policy', 'views'],
    queryFn: async () => {
      const r = await api.getPolicyViews();
      if (!r.success) throw new Error(r.error!);
      return r.data!.items;
    },
  });
  const feedsQ = useQuery({
    queryKey: ['policy', 'feeds'],
    queryFn: async () => {
      const r = await api.getPolicyFeedSources();
      if (!r.success) throw new Error(r.error!);
      return r.data!.items;
    },
  });

  if (summaryQ.isLoading) return <LoadingState />;

  const summary = summaryQ.data!;
  const rules: PolicyRuleRecord[] = rulesQ.data ?? [];
  const views = viewsQ.data ?? [];
  const feeds = feedsQ.data ?? [];

  const grouped: Record<LayerKey, PolicyRuleRecord[]> = { '100': [], '200': [], '300': [], '400': [] };
  for (const r of rules) {
    const k = String(r.layer) as LayerKey;
    if (grouped[k]) grouped[k].push(r);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Plano de Política Nativo</h1>
        <p className="text-sm text-muted-foreground">
          Visualização somente-leitura. Precedência (alta → baixa):
          <span className="text-destructive font-mono"> 100 judicial </span>→
          <span className="font-mono"> 200 operador </span>→
          <span className="text-blue-500 font-mono"> 300 feeds </span>→
          <span className="text-emerald-500 font-mono"> 400 allowlist </span>
          (allowlist <strong>não sobrepõe</strong> camada 100).
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard icon={Layers} label="Regras totais" value={summary.total_rules} sub={`${summary.enabled_rules} ativas`} />
        <SummaryCard icon={Eye} label="Views" value={summary.views} sub={`${summary.by_scope.view} regras escopadas`} />
        <SummaryCard icon={Building2} label="Tenants" value={summary.tenants} sub={`${summary.by_scope.global} regras globais`} />
        <SummaryCard icon={Rss} label="Feeds" value={summary.feed_sources} sub="fontes de reputação" />
      </div>

      {/* Filters */}
      <div className="noc-panel flex flex-wrap items-center gap-3 py-2 px-3">
        <span className="text-xs text-muted-foreground uppercase">Layer</span>
        {(['all', '100', '200', '300', '400'] as const).map(k => (
          <button
            key={k}
            onClick={() => setLayerFilter(k as any)}
            className={`px-2 py-1 text-xs rounded border ${layerFilter === k ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {k === 'all' ? 'Todos' : k}
          </button>
        ))}
        <span className="mx-3 h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground uppercase">Scope</span>
        {(['all', 'global', 'view'] as const).map(k => (
          <button
            key={k}
            onClick={() => setScopeFilter(k)}
            className={`px-2 py-1 text-xs rounded border ${scopeFilter === k ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {k === 'all' ? 'Todos' : k === 'global' ? 'Global' : 'Por view'}
          </button>
        ))}
      </div>

      {/* Rules by layer */}
      {rules.length === 0 ? (
        <div className="noc-panel py-12 flex flex-col items-center justify-center text-center">
          <ShieldOff size={32} className="text-muted-foreground mb-3" />
          <div className="text-sm font-medium">Nenhuma política nativa configurada</div>
          <div className="text-xs text-muted-foreground mt-1 max-w-md">
            POL-1 entrega apenas o esquema e a leitura. Criação de regras chega no POL-2 (bloqueio) e POL-3 (allowlist).
            AnaBlock judicial continua operando independentemente.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {(['100', '200', '300', '400'] as LayerKey[]).map(layer => {
            const items = grouped[layer];
            if (items.length === 0) return null;
            const meta = LAYER_META[layer];
            const Icon = meta.icon;
            return (
              <div key={layer} className="noc-panel">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
                  <Icon size={16} className={meta.tone.split(' ')[0]} />
                  <span className="text-sm font-medium">Layer {layer} — {meta.label}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{items.length} regra(s)</span>
                </div>
                <div className="divide-y divide-border">
                  {items.map(r => (
                    <div key={r.id} className={`flex items-center gap-3 px-3 py-2 border-l-2 ${meta.tone.split(' ').slice(1).join(' ')}`}>
                      <code className="text-xs font-mono">{r.target}</code>
                      <span className="text-xs text-muted-foreground">→ {r.action}</span>
                      <span className="text-xs text-muted-foreground">[{r.kind}]</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          scope: {r.scope_view ? views.find(v => v.id === r.scope_view)?.name ?? r.scope_view : 'global'}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${r.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                          {r.enabled ? 'ativa' : 'inativa'}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Feed sources */}
      <div className="noc-panel">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
          <Rss size={16} className="text-blue-500" />
          <span className="text-sm font-medium">Feed sources</span>
          <span className="text-xs text-muted-foreground ml-auto">{feeds.length}</span>
        </div>
        {feeds.length === 0 ? (
          <div className="text-xs text-muted-foreground px-3 py-4">
            Nenhum feed nativo configurado (AnaBlock segue operando em paralelo, intocado).
          </div>
        ) : (
          <div className="divide-y divide-border">
            {feeds.map(f => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                <code className="font-mono">{f.name}</code>
                <span className="text-muted-foreground">{f.kind}</span>
                <span className="text-muted-foreground truncate">{f.url}</span>
                {f.is_judicial && <span className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">judicial</span>}
                <span className="ml-auto text-muted-foreground">
                  {f.last_sync_at ? new Date(f.last_sync_at).toLocaleString() : 'nunca'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: number; sub?: string }) {
  return (
    <div className="noc-panel flex items-center gap-3 py-3 px-3">
      <Icon size={18} className="text-muted-foreground" />
      <div>
        <div className="text-lg font-mono font-semibold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {sub && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
