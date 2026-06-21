// ============================================================
// DNS Control — Close Open Resolver Dialog (guided remediation)
// 3-step flow: validate ranges → preview restricted ACLs → apply
// via existing pipeline. Admin-only (the apply endpoint enforces
// require_admin too; this UI also gates the action).
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';

import { useApplyConfig, useCurrentConfig, usePreviewFiles } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { planOpenResolverMigration, parseCidrList } from '@/lib/open-resolver-migration';
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

type Step = 'validate' | 'preview' | 'apply' | 'done' | 'error';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CloseOpenResolverDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: config } = useCurrentConfig();
  const previewMut = usePreviewFiles();
  const applyMut = useApplyConfig();

  const [step, setStep] = useState<Step>('validate');
  const [cidrInput, setCidrInput] = useState('');
  const [migrated, setMigrated] = useState<WizardConfig | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('validate');
      setCidrInput('');
      setMigrated(null);
      setErrorMsg(null);
    }
  }, [open]);

  const plan = useMemo(() => {
    if (!config) return null;
    return planOpenResolverMigration(config as WizardConfig, parseCidrList(cidrInput));
  }, [config, cidrInput]);

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

  if (!config) return null;

  const handleGoPreview = async () => {
    if (!plan?.sufficient || !plan.migrated) return;
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
    if (!migrated) return;
    setErrorMsg(null);
    setStep('apply');
    try {
      const result = await applyMut.mutateAsync({
        config: migrated,
        scope: 'dns',
        dryRun: false,
        comment: 'Migração guiada: fechar resolver aberto (legacy → isp-hardened)',
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

  const restrictedPreview = previewAcls.length > 0 && !previewAcls.some((l) => l.includes('0.0.0.0/0'));

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
            <code className="font-mono">{user?.role || 'desconhecido'}</code>.
          </div>
        )}

        {step === 'validate' && (
          <div className="space-y-4 text-sm">
            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                O que será permitido após a migração
              </div>
              <ul className="space-y-0.5 font-mono text-xs">
                {plan?.effectiveAcls.map((a) => (
                  <li key={`${a.network}-${a.action}`}>
                    <span className="text-emerald-500">access-control:</span> {a.network} {a.action}
                    {a.label && <span className="text-muted-foreground"> · {a.label}</span>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cidrs">
                CIDRs adicionais de assinante (um por linha, vírgula ou espaço)
              </Label>
              <Textarea
                id="cidrs"
                value={cidrInput}
                onChange={(e) => setCidrInput(e.target.value)}
                placeholder="ex.: 198.51.100.0/24, 192.0.2.0/22"
                className="font-mono text-xs"
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                Loopback e CGNAT (100.64.0.0/10) entram automaticamente. A rede do host
                ({config.ipv4Address || 'não definida'}) também, quando disponível.
              </p>
            </div>

            {plan && !plan.sufficient && (
              <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <strong className="font-bold">Bloqueado: </strong>
                  {plan.reason}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleGoPreview}
                disabled={!isAdmin || !plan?.sufficient || previewMut.isPending}
              >
                {previewMut.isPending && <Loader2 size={14} className="mr-2 animate-spin" />}
                Gerar preview
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4 text-sm">
            <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
              <div className="font-semibold uppercase tracking-wider text-xs">
                Preview do access-control gerado (todas as instâncias)
              </div>
              {previewAcls.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma diretiva access-control encontrada.</p>
              ) : (
                <ul className="space-y-0.5 font-mono text-xs max-h-64 overflow-auto">
                  {previewAcls.map((line) => (
                    <li
                      key={line}
                      className={line.includes('0.0.0.0/0') ? 'text-destructive' : ''}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {!restrictedPreview ? (
              <div className="border border-destructive/40 bg-destructive/10 text-destructive p-3 rounded text-xs">
                Preview ainda contém <code>0.0.0.0/0</code> ou está vazio — não é seguro aplicar.
              </div>
            ) : (
              <div className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 p-3 rounded text-xs flex items-start gap-2">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                <div>
                  Preview restrito confirmado. O apply executará o pipeline existente
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
