// ============================================================
// DNS Control — Open Resolver Warning Banner (P1)
// Shown when the ACTIVE/RUNNING config is in 'legacy' security
// profile (access-control: 0.0.0.0/0 allow). Offers a 1-click
// guided remediation via CloseOpenResolverDialog (admin-only).
// ============================================================

import { AlertTriangle, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCurrentConfig } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import CloseOpenResolverDialog from '@/components/CloseOpenResolverDialog';

const DISMISS_KEY = 'dns-control:open-resolver-banner-dismissed';

export default function OpenResolverBanner() {
  const { data: config } = useCurrentConfig();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  });

  // If the running profile changes back to hardened, clear the dismissal.
  useEffect(() => {
    if (config && (config as any).securityProfile !== 'legacy') {
      sessionStorage.removeItem(DISMISS_KEY);
    }
  }, [config]);

  if (!config || dismissed) return null;
  if ((config as any).securityProfile !== 'legacy') return null;

  return (
    <>
      <div
        role="alert"
        className="border-b border-destructive/40 bg-destructive/10 text-destructive px-4 py-2 flex items-start gap-3 text-xs"
      >
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <div className="flex-1 leading-relaxed">
          <strong className="font-bold uppercase tracking-wider">P1 · Open Resolver Detectado</strong>
          {' — '}
          A configuração em execução está no perfil <code className="font-mono">legacy</code>{' '}
          (<code className="font-mono">access-control: 0.0.0.0/0 allow</code>). Qualquer IP da
          internet pode consultar este resolver, expondo o serviço a abuso e amplificação DDoS.
        </div>
        <Button
          size="sm"
          variant="destructive"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setDialogOpen(true)}
          disabled={!isAdmin}
          title={isAdmin ? 'Migrar para isp-hardened' : 'Apenas administradores'}
          data-testid="close-open-resolver-cta"
        >
          <ShieldCheck size={12} />
          Fechar resolver aberto
        </Button>
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(DISMISS_KEY, '1');
            setDismissed(true);
          }}
          className="shrink-0 p-1 rounded hover:bg-destructive/20"
          title="Ocultar nesta sessão"
          aria-label="Ocultar aviso"
        >
          <X size={12} />
        </button>
      </div>
      <CloseOpenResolverDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
