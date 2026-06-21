// ============================================================
// DNS Control — Open Resolver Warning Banner (P1)
// Shown when the ACTIVE/RUNNING config is in 'legacy' security
// profile (access-control: 0.0.0.0/0 allow). Read-only; never
// alters the running config — guides the operator to migrate.
// ============================================================

import { AlertTriangle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCurrentConfig } from '@/lib/hooks';

const DISMISS_KEY = 'dns-control:open-resolver-banner-dismissed';

export default function OpenResolverBanner() {
  const { data: config } = useCurrentConfig();
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
        {' '}
        <span className="opacity-80">
          A config em execução não foi alterada automaticamente para evitar outage de
          assinantes legítimos. Migre via Wizard → Segurança → "ISP Hardened" cobrindo os
          CIDRs reais de assinante antes de aplicar.
        </span>
      </div>
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
  );
}
