import { Shield } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocSystemHealthProps {
  services: ServiceStatus[];
  dnsHealthy: boolean;
  networkOk: boolean;
}

export default function NocSystemHealth({ services, dnsHealthy, networkOk }: NocSystemHealthProps) {
  const svcByName = (name: string) => services.find(s => s.name.toLowerCase().includes(name));

  const checks: { label: string; ok: boolean }[] = [
    { label: 'DNS', ok: dnsHealthy },
    { label: 'NETWORK', ok: networkOk },
    { label: 'OSPF', ok: svcByName('frr')?.status === 'running' },
    { label: 'CACHE', ok: svcByName('unbound')?.status === 'running' },
    { label: 'FIREWALL', ok: svcByName('nftables')?.status === 'running' || svcByName('nft')?.status === 'running' },
  ];

  const allOk = checks.every(c => c.ok);

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title">
          <Shield size={12} className={allOk ? 'text-success' : 'text-destructive'} />
          SYSTEM HEALTH MATRIX
        </div>
        <div className="mt-3 space-y-0">
          {checks.map((c, i) => (
            <div
              key={c.label}
              className="flex items-center justify-between py-3 border-b border-border/30 last:border-0 animate-slide-in-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className={c.ok ? 'noc-dot-running' : 'noc-dot-error'} />
                <span className="text-[11px] font-mono font-bold text-foreground tracking-wider">{c.label}</span>
              </div>
              <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${c.ok ? 'text-success' : 'text-destructive'}`}>
                {c.ok ? 'OPERATIONAL' : 'FAILURE'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
