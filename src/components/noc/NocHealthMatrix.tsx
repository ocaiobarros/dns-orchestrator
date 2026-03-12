import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocHealthMatrixProps {
  services: ServiceStatus[];
  dnsHealthy: boolean;
  networkOk: boolean;
}

export default function NocHealthMatrix({ services, dnsHealthy, networkOk }: NocHealthMatrixProps) {
  const svcByName = (name: string) => services.find(s => s.name.toLowerCase().includes(name));

  const checks: { label: string; ok: boolean; category: string }[] = [
    { label: 'DNS', ok: dnsHealthy, category: 'core' },
    { label: 'NETWORK', ok: networkOk, category: 'core' },
    { label: 'OSPF', ok: svcByName('frr')?.status === 'running', category: 'routing' },
    { label: 'CACHE', ok: svcByName('unbound')?.status === 'running', category: 'core' },
    { label: 'FIREWALL', ok: svcByName('nftables')?.status === 'running' || svcByName('nft')?.status === 'running', category: 'security' },
    { label: 'API', ok: true, category: 'platform' },
    { label: 'AUTH', ok: true, category: 'platform' },
  ];

  const allOk = checks.every(c => c.ok);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Shield size={12} className={allOk ? 'text-success' : 'text-destructive'} />
          SYSTEM HEALTH MATRIX
        </div>
        <div className="noc-section-divider" />

        <div className="space-y-0">
          {checks.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.04 }}
              className="flex items-center justify-between py-3"
              style={{ borderBottom: i < checks.length - 1 ? '1px solid hsl(222 20% 14% / 0.3)' : 'none' }}
            >
              <div className="flex items-center gap-3">
                <span className={c.ok ? 'noc-dot-running' : 'noc-dot-error'} />
                <span className="text-[11px] font-mono font-bold text-foreground/90 tracking-wider">{c.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {/* Mini pulse bar for non-ok */}
                {!c.ok && (
                  <div className="w-8 h-1 rounded-full bg-destructive/20 overflow-hidden">
                    <motion.div
                      className="h-full bg-destructive/60 rounded-full"
                      animate={{ x: ['-100%', '100%'] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      style={{ width: '50%' }}
                    />
                  </div>
                )}
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${c.ok ? 'text-success/80' : 'text-destructive'}`}>
                  {c.ok ? 'OK' : 'FAIL'}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
