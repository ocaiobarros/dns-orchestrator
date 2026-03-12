import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocHealthMatrixProps {
  services: ServiceStatus[];
  dnsHealthy: boolean;
  networkOk: boolean;
}

/** Decorative micro-sparkline for warning/failing items */
function PulseBar({ failing }: { failing: boolean }) {
  if (!failing) return null;
  return (
    <svg width="32" height="8" viewBox="0 0 32 8" className="opacity-60">
      <rect width="32" height="8" rx="4" fill="hsl(0, 76%, 50%)" opacity="0.1" />
      <rect width="16" height="8" rx="4" fill="hsl(0, 76%, 50%)" opacity="0.25">
        <animate attributeName="x" values="-16;32" dur="1.8s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.4;0.1" dur="1.8s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

function Sparkline({ ok }: { ok: boolean }) {
  if (!ok) return null;
  const color = 'hsl(152, 76%, 40%)';
  return (
    <svg width="28" height="8" viewBox="0 0 28 8" className="opacity-30">
      <polyline points="0,6 4,4 8,5 12,2 16,3 20,1 24,3 28,2" fill="none" stroke={color} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export default function NocHealthMatrix({ services, dnsHealthy, networkOk }: NocHealthMatrixProps) {
  const svcByName = (name: string) => services.find(s => s.name.toLowerCase().includes(name));

  const checks = [
    { label: 'DNS', ok: dnsHealthy },
    { label: 'NETWORK', ok: networkOk },
    { label: 'OSPF', ok: svcByName('frr')?.status === 'running' },
    { label: 'CACHE', ok: svcByName('unbound')?.status === 'running' },
    { label: 'FIREWALL', ok: svcByName('nftables')?.status === 'running' || svcByName('nft')?.status === 'running' },
    { label: 'API', ok: true },
    { label: 'AUTH', ok: true },
  ];

  const allOk = checks.every(c => c.ok);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="noc-section-head">
          <Shield size={12} className={allOk ? 'text-success' : 'text-destructive'} />
          SUBSYSTEM MATRIX
        </div>
        <div className="noc-divider" />

        <div className="space-y-0">
          {checks.map((c, i) => (
            <motion.div
              key={c.label}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.12 + i * 0.04 }}
              className="noc-row"
            >
              <div className="flex items-center gap-3">
                <span className={c.ok ? 'noc-dot-live' : 'noc-dot-fail'} />
                <span className="text-[11px] font-mono font-bold text-foreground/85 tracking-wider">{c.label}</span>
              </div>
              <div className="flex items-center gap-3">
                {c.ok ? <Sparkline ok /> : <PulseBar failing />}
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider min-w-[32px] text-right ${c.ok ? 'text-success/70' : 'text-destructive'}`}>
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
