/**
 * POL-1 (read) + POL-2a (operator block CRUD, admin-only).
 *
 * Admin actions: create/toggle/delete layer-200 operator block rules. Backend
 * is the authority on RBAC — the UI gate is complementary. NO config
 * generation; rules exist only in DB until POL-2b lands.
 */

import { useState } from 'react';
import { Shield, ShieldCheck, ShieldAlert, ShieldOff, Layers, Eye, Rss, Building2, Plus, Trash2, FileCheck2, Play, ScrollText, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LoadingState } from '@/components/DataStates';
import { api, type PolicyRuleRecord, type PolicyAuditEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['policy'] });
  };

  const createMut = useMutation({
    mutationFn: async (body: { target: string; action: 'always_nxdomain' | 'always_refuse' }) => {
      const r = await api.createOperatorBlock(body);
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    onSuccess: () => { toast.success('Bloqueio criado'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleMut = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const r = await api.updatePolicyRule(vars.id, { enabled: vars.enabled });
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.deletePolicyRule(id);
      if (!r.success) throw new Error(r.error!);
    },
    onSuccess: () => { toast.success('Bloqueio removido'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // POL-3a: allow_exception mutations (separate hooks — different routes
  // and the create call surfaces a 409 when judicial collision is detected).
  const createAllowMut = useMutation({
    mutationFn: async (body: { target: string; note?: string | null }) => {
      const r = await api.createAllowException(body);
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    onSuccess: () => { toast.success('Exceção criada'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const toggleAllowMut = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const r = await api.updateAllowException(vars.id, { enabled: vars.enabled });
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteAllowMut = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.deleteAllowException(id);
      if (!r.success) throw new Error(r.error!);
    },
    onSuccess: () => { toast.success('Exceção removida'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Plano de Política Nativo</h1>
          <p className="text-sm text-muted-foreground">
            Precedência (alta → baixa):
            <span className="text-destructive font-mono"> 100 judicial </span>→
            <span className="font-mono"> 200 operador </span>→
            <span className="text-blue-500 font-mono"> 300 feeds </span>→
            <span className="text-emerald-500 font-mono"> 400 allowlist </span>
            (allowlist <strong>não sobrepõe</strong> camada 100). Regras vivem no
            banco; <strong>geração de config chega no POL-2b</strong>.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <CreateBlockButton onCreate={(b) => createMut.mutate(b)} pending={createMut.isPending} />
            <CreateAllowButton onCreate={(b) => createAllowMut.mutate(b)} pending={createAllowMut.isPending} />
          </div>
        )}
      </div>

      {/* POL-3a — honest limitation note. The DB validator only rejects
          allow_exception that collides with a layer-100 rule KNOWN in the DB.
          Until the AnaBlock mirror lands (POL-4), judicial domains pulled at
          runtime into anablock.conf are NOT in the DB and the validator
          cannot see them. The real backstop is the include-order at
          resolution time (POL-2b/POL-3b). Be explicit in the UI. */}
      {isAdmin && (
        <div className="noc-panel border-l-2 border-l-amber-500/60 text-xs px-3 py-2 text-muted-foreground">
          <strong className="text-amber-500">Limitação do validador:</strong>{' '}
          A rejeição automática de allowlist só cobre regras judiciais
          presentes no banco (layer 100). O conjunto judicial baixado em
          runtime (<code>anablock.conf</code>) ainda não é espelhado no DB —
          o backstop definitivo é a ordem de include na resolução
          (<code>anablock.conf</code> vence por last-wins).
        </div>
      )}
      


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

      {isAdmin && <PolicyApplyPanel />}



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
                  {items.map(r => {
                    const isOperatorBlock = r.layer === 200 && r.kind === 'block_name' && r.source === 'operator';
                    const isOperatorAllow = r.layer === 400 && r.kind === 'allow_exception' && r.source === 'operator';
                    const canEdit = isAdmin && (isOperatorBlock || isOperatorAllow);
                    const doToggle = (v: boolean) => isOperatorAllow
                      ? toggleAllowMut.mutate({ id: r.id, enabled: v })
                      : toggleMut.mutate({ id: r.id, enabled: v });
                    const doDelete = () => isOperatorAllow
                      ? deleteAllowMut.mutate(r.id)
                      : deleteMut.mutate(r.id);
                    return (
                      <div key={r.id} className={`flex items-center gap-3 px-3 py-2 border-l-2 ${meta.tone.split(' ').slice(1).join(' ')}`}>
                        <code className="text-xs font-mono">{r.target}</code>
                        <span className="text-xs text-muted-foreground">→ {r.action}</span>
                        <span className="text-xs text-muted-foreground">[{r.kind}]</span>
                        <span className="ml-auto flex items-center gap-3">
                          <span className="text-xs text-muted-foreground">
                            scope: {r.scope_view ? views.find(v => v.id === r.scope_view)?.name ?? r.scope_view : 'global'}
                          </span>
                          {canEdit ? (
                            <>
                              <Switch
                                checked={r.enabled}
                                onCheckedChange={doToggle}
                                aria-label={`Ativar ${r.target}`}
                              />
                              <Button
                                size="icon" variant="ghost"
                                onClick={() => { if (confirm(`Remover regra para ${r.target}?`)) doDelete(); }}
                                aria-label={`Remover ${r.target}`}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </>
                          ) : (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${r.enabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                              {r.enabled ? 'ativa' : 'inativa'}
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })}
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

function CreateBlockButton({ onCreate, pending }: { onCreate: (b: { target: string; action: 'always_nxdomain' | 'always_refuse' }) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [action, setAction] = useState<'always_nxdomain' | 'always_refuse'>('always_nxdomain');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus size={14} className="mr-1" /> Adicionar bloqueio</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar bloqueio do operador</DialogTitle>
          <DialogDescription>
            Layer 200 (sobreponível por allowlist). NÃO afeta resolução até o POL-2b
            materializar a configuração.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs text-muted-foreground">FQDN alvo</label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="ads.example.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Ação</label>
            <div className="flex gap-2 mt-1">
              {(['always_nxdomain', 'always_refuse'] as const).map(a => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAction(a)}
                  className={`px-2 py-1 text-xs rounded border ${action === a ? 'bg-primary/10 border-primary text-primary' : 'border-border text-muted-foreground'}`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            disabled={pending || !target.trim()}
            onClick={() => {
              onCreate({ target: target.trim(), action });
              setOpen(false);
              setTarget('');
            }}
          >Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * POL-2b — Preview & Apply panel (admin-only).
 *
 * Surfaces the generated policy.d content and the judicial-precedence
 * omissions BEFORE the operator commits to apply. The apply call reuses the
 * existing deploy pipeline server-side (staging → unbound-checkconf → swap
 * → reload → rollback) — there is no new install path.
 */
function CreateAllowButton({ onCreate, pending }: { onCreate: (b: { target: string; note?: string | null }) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ShieldCheck size={14} className="mr-1" /> Adicionar exceção
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar allow_exception (layer 400)</DialogTitle>
          <DialogDescription>
            Exceção que des-bloqueia um nome. O backend REJEITA (com auditoria)
            qualquer alvo coberto por regra judicial conhecida no banco. Para
            domínios judiciais baixados em runtime, o backstop é a ordem de
            include na resolução.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <label className="text-xs text-muted-foreground">FQDN alvo</label>
            <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="parceiro.example.com" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Nota (opcional, vai para auditoria)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Motivo / ticket" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button
            disabled={pending || !target.trim()}
            onClick={() => {
              onCreate({ target: target.trim(), note: note.trim() || null });
              setOpen(false);
              setTarget('');
              setNote('');
            }}
          >Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PolicyApplyPanel() {
  const [profileId, setProfileId] = useState('');
  const [open, setOpen] = useState(false);
  const previewQ = useQuery({
    queryKey: ['policy-preview'],
    queryFn: async () => {
      const r = await api.getPolicyPreview();
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    enabled: open,
  });
  const applyMut = useMutation({
    mutationFn: async (dryRun: boolean) => {
      const r = await api.applyPolicy({ profile_id: profileId, dry_run: dryRun });
      if (!r.success) throw new Error(r.error!);
      return r.data!;
    },
    onSuccess: (r) => {
      if (r.status === 'success') toast.success(`Apply ${r.dry_run ? '(dry-run)' : ''} OK`);
      else toast.error(`Apply falhou: ${r.error ?? 'erro desconhecido'}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="noc-panel p-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" /> Materialização de política
          </h3>
          <p className="text-xs text-muted-foreground">
            Gera <code>/etc/unbound/policy.d/200-operator-blocks.conf</code> e aplica via
            pipeline existente. Precedência judicial preservada: ancestrais layer-100
            são omitidos na geração e <code>anablock.conf</code> é incluído depois (last-wins).
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">Preview &amp; Aplicar</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Preview do policy.d</DialogTitle>
              <DialogDescription>
                Verifique o conteúdo gerado e os bloqueios omitidos por precedência
                judicial antes de aplicar. O apply executa pelo pipeline padrão (staging
                → <code>unbound-checkconf</code> → swap → reload → rollback se falhar).
              </DialogDescription>
            </DialogHeader>
            {previewQ.isLoading ? <LoadingState /> : previewQ.data ? (
              <div className="space-y-3">
                <pre className="text-xs bg-muted/30 p-3 rounded border border-border max-h-72 overflow-auto whitespace-pre-wrap">
                  {previewQ.data.files[0]?.content ?? ''}
                </pre>
                {previewQ.data.omitted.length > 0 && (
                  <div className="text-xs">
                    <div className="font-semibold text-destructive mb-1">
                      Omitidos por precedência judicial ({previewQ.data.omitted.length})
                    </div>
                    <ul className="space-y-1">
                      {previewQ.data.omitted.map((o, i) => (
                        <li key={i} className="font-mono">
                          {o.target} <span className="text-muted-foreground">←</span>{' '}
                          <span className="text-destructive">{o.judicial_match ?? o.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-2 border-t border-border">
                  <Input
                    placeholder="profile_id do ConfigProfile"
                    value={profileId}
                    onChange={(e) => setProfileId(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline" size="sm"
                disabled={!profileId || applyMut.isPending}
                onClick={() => applyMut.mutate(true)}
              >
                Dry-run (checkconf)
              </Button>
              <Button
                size="sm"
                disabled={!profileId || applyMut.isPending}
                onClick={() => applyMut.mutate(false)}
              >
                <Play className="h-3 w-3 mr-1" /> Aplicar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
