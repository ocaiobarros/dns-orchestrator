import type { SystemInfo } from '@/lib/types';
import { safeDate } from '@/lib/types';

interface NocSystemInfoProps {
  sysInfo: SystemInfo | null | undefined;
}

export default function NocSystemInfo({ sysInfo }: NocSystemInfoProps) {
  if (!sysInfo) return null;

  const rows: [string, React.ReactNode][] = [
    ['Hostname', sysInfo.hostname ?? '—'],
    ['OS', sysInfo.os ?? '—'],
    ['Kernel', sysInfo.kernel ?? '—'],
    ['Unbound', sysInfo.unbound_version ?? sysInfo.unboundVersion ?? '—'],
    ['FRR', sysInfo.frr_version ?? sysInfo.frrVersion ?? '—'],
    ['nftables', sysInfo.nftables_version ?? sysInfo.nftablesVersion ?? '—'],
    ['Interface', sysInfo.primary_interface ?? sysInfo.mainInterface ?? '—'],
    ['VIP Anycast', sysInfo.vip_anycast_available
      ? (sysInfo.vip_anycast || '—')
      : <span className="text-[10px] text-muted-foreground italic">Não configurado</span>],
    ['Config Version', sysInfo.config_version_available
      ? (sysInfo.config_version || '—')
      : <span className="text-[10px] text-muted-foreground italic">Sem versão aplicada</span>],
    ['Última aplicação', sysInfo.last_apply_available
      ? safeDate(sysInfo.last_apply_at ?? sysInfo.lastApply)
      : <span className="text-[10px] text-muted-foreground italic">Nenhuma aplicação registrada</span>],
  ];

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-section-title mb-3">
        Informações do Sistema
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
        {rows.map(([label, value], i) => (
          <div key={label as string} className="flex justify-between py-1.5 border-b border-border/50 last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className="text-xs font-mono text-foreground">{value || '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
