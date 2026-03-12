import { motion } from 'framer-motion';
import { Monitor, Cpu, Globe, Server, Shield, Network, GitBranch, Clock, Hash, Calendar } from 'lucide-react';
import type { SystemInfo } from '@/lib/types';
import { safeDate } from '@/lib/types';
import type { ReactNode } from 'react';

interface NocSystemInfoGridProps {
  sysInfo: SystemInfo | null | undefined;
}

interface InfoItem {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  category: 'telemetry' | 'platform';
}

export default function NocSystemInfoGrid({ sysInfo }: NocSystemInfoGridProps) {
  if (!sysInfo) return null;

  const unavailable = (text: string) => (
    <span className="text-muted-foreground/25 italic text-[10px]">{text}</span>
  );

  const items: InfoItem[] = [
    { label: 'HOSTNAME', value: sysInfo.hostname ?? '—', icon: <Server size={11} />, category: 'platform' },
    { label: 'OS', value: sysInfo.os ?? '—', icon: <Monitor size={11} />, category: 'platform' },
    { label: 'KERNEL', value: sysInfo.kernel ?? '—', icon: <Cpu size={11} />, category: 'platform' },
    { label: 'UNBOUND', value: sysInfo.unbound_version ?? sysInfo.unboundVersion ?? '—', icon: <Globe size={11} />, category: 'platform' },
    { label: 'FRR', value: sysInfo.frr_version ?? sysInfo.frrVersion ?? '—', icon: <GitBranch size={11} />, category: 'platform' },
    { label: 'NFTABLES', value: sysInfo.nftables_version ?? sysInfo.nftablesVersion ?? '—', icon: <Shield size={11} />, category: 'platform' },
    { label: 'INTERFACE', value: sysInfo.primary_interface ?? sysInfo.mainInterface ?? '—', icon: <Network size={11} />, category: 'telemetry' },
    {
      label: 'VIP ANYCAST',
      value: sysInfo.vip_anycast_available ? (sysInfo.vip_anycast || '—') : unavailable('Not configured'),
      icon: <Globe size={11} />,
      category: 'telemetry',
    },
    {
      label: 'CONFIG VER',
      value: sysInfo.config_version_available ? (sysInfo.config_version || '—') : unavailable('No version applied'),
      icon: <Hash size={11} />,
      category: 'telemetry',
    },
    {
      label: 'LAST APPLY',
      value: sysInfo.last_apply_available ? safeDate(sysInfo.last_apply_at ?? sysInfo.lastApply) : unavailable('No apply recorded'),
      icon: <Calendar size={11} />,
      category: 'telemetry',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Monitor size={12} className="text-muted-foreground/60" />
          SYSTEM INFORMATION
        </div>
        <div className="noc-section-divider" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
          {items.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.03 }}
              className="noc-info-row"
            >
              <span className="noc-info-label">
                <span className="text-muted-foreground/30">{item.icon}</span>
                {item.label}
              </span>
              <span className="noc-info-value">{item.value || '—'}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
