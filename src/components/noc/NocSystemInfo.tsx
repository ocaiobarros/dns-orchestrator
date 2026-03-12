import { Monitor } from 'lucide-react';
import type { SystemInfo } from '@/lib/types';
import { safeDate } from '@/lib/types';

interface NocSystemInfoProps {
  sysInfo: SystemInfo | null | undefined;
}

export default function NocSystemInfo({ sysInfo }: NocSystemInfoProps) {
  if (!sysInfo) return null;

  const rows: [string, React.ReactNode][] = [
    ['HOSTNAME', sysInfo.hostname ?? '—'],
    ['OS', sysInfo.os ?? '—'],
    ['KERNEL', sysInfo.kernel ?? '—'],
    ['UNBOUND', sysInfo.unbound_version ?? sysInfo.unboundVersion ?? '—'],
    ['FRR', sysInfo.frr_version ?? sysInfo.frrVersion ?? '—'],
    ['NFTABLES', sysInfo.nftables_version ?? sysInfo.nftablesVersion ?? '—'],
    ['INTERFACE', sysInfo.primary_interface ?? sysInfo.mainInterface ?? '—'],
    ['VIP ANYCAST', sysInfo.vip_anycast_available
      ? (sysInfo.vip_anycast || '—')
      : <span className="text-muted-foreground/50 italic">not configured</span>],
    ['CONFIG VER', sysInfo.config_version_available
      ? (sysInfo.config_version || '—')
      : <span className="text-muted-foreground/50 italic">no version applied</span>],
    ['LAST APPLY', sysInfo.last_apply_available
      ? safeDate(sysInfo.last_apply_at ?? sysInfo.lastApply)
      : <span className="text-muted-foreground/50 italic">no apply recorded</span>],
  ];

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title">
          <Monitor size={12} className="text-muted-foreground" />
          SYSTEM INFORMATION
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 mt-3">
          {rows.map(([label, value]) => (
            <div key={label as string} className="noc-sysinfo-row">
              <span className="noc-sysinfo-label">{label}</span>
              <span className="noc-sysinfo-value">{value || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
