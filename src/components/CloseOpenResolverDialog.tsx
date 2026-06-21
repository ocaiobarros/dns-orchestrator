// ============================================================
// DNS Control — Close Open Resolver Dialog (guided remediation)
// 3-step flow: validate ranges → preview restricted ACLs → apply
// via existing pipeline. Admin-only (the apply endpoint enforces
// require_admin too; this UI also gates the action).
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X, ShieldQuestion } from 'lucide-react';

import { useApplyConfig, useCurrentConfig, usePreviewFiles } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import {
  planOpenResolverMigration,
  parseCidrList,
  detectOpenAccessControl,
} from '@/lib/open-resolver-migration';
import type { WizardConfig } from '@/lib/types';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

type Step = 'validate' | 'preview' | 'apply' | 'done' | 'error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  verified: { label: 'Cobertura verificada', tone: 'text-emerald-500 border-emerald-500/40 bg-emerald-500/10' },
  incomplete: { label: 'Cobertura incompleta', tone: 'text-destructive border-destructive/40 bg-destructive/10' },
  unverifiable: { label: 'Cobertura não verificável', tone: 'text-warning border-warning/40 bg-warning/10' },
  invalid: { label: 'CIDR inválido', tone: 'text-destructive border-destructive/40 bg-destructive/10' },
};

export default function CloseOpenResolverDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: config } = useCurrentConfig();
  const previewMut = usePreviewFiles();
  const applyMut = useApplyConfig();

  const [step, setStep] = useState<Step>('validate');
  const [cidrInput, setCidrInput] = useState('');
  const [unverifiableConfirmed, setUnverifiableConfirmed] = useState(false);
  const [migrated, setMigrated] = useState<WizardConfig | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('validate');
      setCidrInput('');
      setUnverifiableConfirmed(false);
      setMigrated(null);
      setErrorMsg(null);
    }
  }, [open]);

  const plan = useMemo(() => {
    if (!config) return null;
    return planOpenResolverMigration(
      config as WizardConfig,
      parseCidrList(cidrInput),
      { unverifiableConfirmed },
    );
  }, [config, cidrInput, unverifiableConfirmed]);

  const previewAcls = useMemo(() => {
    const files = previewMut.data || [];
    const unboundFiles = files.filter((f) => f.path.match(/unbound\d*\.conf$/));
    const acls: string[] = [];
    for (const f of unboundFiles) {
      for (const line of f.content.split('\n')) {
        if (/^\s*access-control:/.test(line)) acls.push(line.trim());
      }
    }
    return Array.from(new Set(acls));
  }, [previewMut.data]);

  const previewOpenness = useMemo(() => {
    const files = previewMut.data || [];
    const unboundFiles = files.filter((f) => f.path.match(/unbound\d*\.conf$/));
    let ipv4Open = false;
    let ipv6Open = false;
    for (const f of unboundFiles) {
      const r = detectOpenAccessControl(f.content);
      ipv4Open = ipv4Open || r.ipv4Open;
      ipv6Open = ipv6Open || r.ipv6Open;
    }
    return { ipv4Open, ipv6Open };
  }, [previewMut.data]);

  if (!config) return null;

  const handleGoPreview = async () => {
    if (!plan?.sufficient) return;
    setErrorMsg(null);
    setMigrated(plan.migrated);
    try {
      await previewMut.mutateAsync(plan.migrated);
      setStep('preview');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Falha ao gerar preview');
      setStep('error');
    }
  };

  const handleApply = async () => {
    if (!migrated || !plan) return;
    setErrorMsg(null);
    setStep('apply');
    const auditNote =
      plan.state === 'unverifiable'
        ? ' [admin confirmou explicitamente cobertura não verificável]'
        : '';
    try {
      const result = await applyMut.mutateAsync({
        config: migrated,
        scope: 'dns',
        dryRun: false,
        comment:
          `Migração guiada: fechar resolver aberto (legacy → isp-hardened) — ` +
          `estado=${plan.state}, redes_conhecidas=${plan.knownNetworks.length}, ` +
          `não_cobertas=${plan.uncovered.length}${auditNote}`,
      });
      if (result && (result as { status?: string }).status === 'failed') {
        setErrorMsg('O apply terminou com status "failed". Verifique o histórico de jobs.');
        setStep('error');
        return;
      }
      setStep('done');
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Falha ao aplicar');
      setStep('error');
    }
  };

  const restrictedPreview =
    previewAcls.length > 0 && !previewOpenness.ipv4Open && !previewOpenness.ipv6Open;

  const stateMeta = plan ? STATE_LABEL[plan.state] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-destructive" />
            Fechar Resolver Aberto
          </DialogTitle>
          <DialogDescription>
            Migração guiada do perfil <code>legacy</code> para <code>isp-hardened</code> sem
            recusar assinantes legítimos.
          </DialogDescription>
        </DialogHeader>

        {!isAdmin && (
          <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-xs">
            Esta operação é restrita a administradores. Seu papel atual é{' '}
            <code className="font-mono">{user?.role || 'desconhecido'}</code>. O backend rejeitará
            a requisição (HTTP 403) mesmo se forçada.
          </div>
        )}

        {step === 'validate' && plan && stateMeta && (
          <div className="space-y-4 text-sm">
            <div className={`rounded border p-3 ${stateMeta.tone}`}>
              <div className="flex items-center gap-2 font-semibold uppercase tracking-wider text-xs">
                {plan.state === 'verified' && <CheckCircle2 size={14} />}
                {plan.state === 'incomplete' && <AlertTriangle size={14} />}
                {plan.state === 'unverifiable' && <ShieldQuestion size={14} />}
                {plan.state === 'invalid' && <X size={14} />}
                Estado: {stateMeta.label}
              </div>
              {plan.reason && <div className="mt-1.5 text-xs opacity-90">{plan.reason}</div>}
            </div>

            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                Redes conhecidas avaliadas ({plan.knownNetworks.length})
              </div>
              {plan.knownNetworks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma fonte real disponível. Informe os CIDRs dos assinantes abaixo.
                </p>
              ) : (
                <ul className="space-y-0.5 font-mono text-xs">
                  {plan.knownNetworks.map((k) => (
                    <li key={`${k.origin}-${k.cidr}`} className="flex items-center gap-2">
                      <span className={k.covered ? 'text-emerald-500' : 'text-destructive'}>
                        {k.covered ? '✓' : '✗'}
                      </span>
                      <span>{k.cidr}</span>
                      <span className="text-muted-foreground">[{k.origin}]</span>
                      {k.covered && k.coveredBy && (
                        <span className="text-muted-foreground">→ coberta por {k.coveredBy}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                Permissões efetivas (IPv4 + IPv6)
              </div>
              <ul className="space-y-0.5 font-mono text-xs">
                {plan.effectiveAclsIpv4.map((a) => (
                  <li key={`v4-${a.network}`}>
                    <span className="text-emerald-500">access-control:</span> {a.network} {a.action}
                    {a.label && <span className="text-muted-foreground"> · {a.label}</span>}
                  </li>
                ))}
                {plan.effectiveAclsIpv6.map((a) => (
                  <li key={`v6-${a.network}`}>
                    <span className="text-emerald-500">access-control:</span> {a.network} {a.action}
                    {a.label && <span className="text-muted-foreground"> · {a.label}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cidrs">
                CIDRs adicionais de assinante — IPv4 e/ou IPv6 (separe por linha, vírgula ou espaço)
              </Label>
              <Textarea
                id="cidrs"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="ex.: 198.51.100.0/24, 192.0.2.0/22, 2001:db8:abcd::/48"
                className="font-mono text-xs"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Loopback e CGNAT (100.64.0.0/10) entram automaticamente. Rede do host
                ({config.ipv4Address || 'não definida'}
                {config.enableIpv6 && config.ipv6Address ? `, ${config.ipv6Address}` : ''}) também,
                quando disponível.
              </p>
            </div>

            {plan.state === 'unverifiable' && (
              <label className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-xs cursor-pointer">
                <Checkbox
                  checked={unverifiableConfirmed}
                  onCheckedChange={(v) => setUnverifiableConfirmed(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Confirmo, como administrador, que revisei a lista de redes de assinantes acima e
                  ela está completa. Esta confirmação ficará registrada no comentário do apply
                  (audit trail).
                </span>
              </label>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleGoPreview}
                disabled={!isAdmin || !plan.sufficient || previewMut.isPending}
              >
                {previewMut.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
                Gerar preview
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && plan && (
          <div className="space-y-4 text-sm">
            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                Confirmação final
              </div>
              <div className="font-mono text-xs space-y-1">
                <div>Perfil atual: <span className="text-destructive">legacy</span></div>
                <div>Perfil futuro: <span className="text-emerald-500">isp-hardened</span></div>
                <div>Redes autorizadas: {plan.knownNetworks.filter(k => k.covered).length} cobertas + loopback/CGNAT</div>
                <div className={plan.uncovered.length === 0 ? 'text-emerald-500' : 'text-destructive'}>
                  Redes conhecidas não cobertas: {plan.uncovered.length} (deve ser zero)
                </div>
                <div className="text-warning">
                  Origens fora dessa lista receberão <code>REFUSED</code>.
                </div>
              </div>
            </div>

            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                Preview do access-control gerado (todas as instâncias)
              </div>
              {previewAcls.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma diretiva access-control encontrada.</p>
              ) : (
                <ul className="space-y-0.5 font-mono text-xs max-h-64 overflow-auto">
                  {previewAcls.map((line) => {
                    const flagged =
                      /\b0\.0\.0\.0\/0\b/.test(line) || /(^|\s)::\/0(\s|$)/.test(line);
                    return (
                      <li key={line} className={flagged ? 'text-destructive font-bold' : ''}>
                        {line}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {!restrictedPreview ? (
              <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-xs">
                Preview ainda contém abertura global
                {previewOpenness.ipv4Open && <code className="ml-1">0.0.0.0/0</code>}
                {previewOpenness.ipv4Open && previewOpenness.ipv6Open && ' e '}
                {previewOpenness.ipv6Open && <code className="ml-1">::/0</code>}
                {previewAcls.length === 0 && ' ou está vazio'} — não é seguro aplicar.
              </div>
            ) : (
              <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 p-3 rounded text-xs flex items-start gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                <div>
                  Preview restrito confirmado (IPv4 e IPv6). O apply executará o pipeline existente
                  (staging → unbound-checkconf → swap → reload).
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('validate')}>
                Voltar
              </Button>
              <Button
                onClick={handleApply}
                disabled={!isAdmin || !restrictedPreview || applyMut.isPending}
              >
                Aplicar agora
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'apply' && (
          <div className="py-8 text-center text-sm flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-primary" />
            <div>Aplicando configuração restrita…</div>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4 text-sm">
            <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 p-3 rounded text-xs flex items-start gap-2">
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              <div>
                Resolver fechado com sucesso. A config em execução agora está em
                <code className="font-mono ml-1">isp-hardened</code>.
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Concluir</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'error' && (
          <div className="space-y-4 text-sm">
            <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-xs flex items-start gap-2">
              <X size={14} className="mt-0.5 shrink-0" />
              <div>
                <strong className="font-bold">Falha: </strong>
                {errorMsg || 'erro desconhecido'}
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setStep('validate')}>
                Voltar
              </Button>
              <Button onClick={() => onOpenChange(false)}>Fechar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
