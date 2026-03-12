import { motion } from 'framer-motion';
import { Monitor, Cpu, Globe, Server, Shield, Network, GitBranch, Hash, Calendar } from 'lucide-react';
import type { SystemInfo } from '@/lib/types';
import { safeDate } from '@/lib/types';
import type { ReactNode } from 'react';

interface NocSystemInfoGridProps {
  sysInfo: SystemInfo | null | undefined;
}

export default function NocSystemInfoGrid({ sysInfo }: NocSystemInfoGridProps) {
  if (!sysInfo) return null;

  const na = (text: string) => <span className="text-muted-foreground/18 italic text-[9px]">{text}</span>;

  const items: { label: string; value: ReactNode; icon: ReactNode }[] = [
    { label: 'HOSTNAME', value: sysInfo.hostname ?? '—', icon: <Server size={10} /> },
    { label: 'OS', value: sysInfo.os ?? '—', icon: <Monitor size={10} /> },
    { label: 'KERNEL', value: sysInfo.kernel ?? '—', icon: <Cpu size={10} /> },
    { label: 'UNBOUND', value: sysInfo.unbound_version ?? sysInfo.unboundVersion ?? '—', icon: <Globe size={10} /> },
    { label: 'FRR', value: sysInfo.frr_version ?? sysInfo.frrVersion ?? '—', icon: <GitBranch size={10} /> },
    { label: 'NFTABLES', value: sysInfo.nftables_version ?? sysInfo.nftablesVersion ?? '—', icon: <Shield size={10} /> },
    { label: 'INTERFACE', value: sysInfo.primary_interface ?? sysInfo.mainInterface ?? '—', icon: <Network size={10} /> },
    { label: 'VIP ANYCAST', value: sysInfo.vip_anycast_available ? (sysInfo.vip_anycast || '—') : na('Not configured'), icon: <Globe size={10} /> },
    { label: 'CONFIG VER', value: sysInfo.config_version_available ? (sysInfo.config_version || '—') : na('No version applied'), icon: <Hash size={10} /> },
    { label: 'LAST APPLY', value: sysInfo.last_apply_available ? safeDate(sysInfo.last_apply_at ?? sysInfo.lastApply) : na('No apply recorded'), icon: <Calendar size={10} /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="noc-section-head">
          <Monitor size={12} className="text-muted-foreground/40" />
          PLATFORM METADATA
        </div>
        <div className="noc-divider" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {items.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.025 }}
              className="noc-info-row"
            >
              <span className="noc-label flex items-center gap-2">
                <span className="text-muted-foreground/20">{item.icon}</span>
                {item.label}
              </span>
              <span className="text-[11px] font-mono text-foreground/80">{item.value || '—'}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
