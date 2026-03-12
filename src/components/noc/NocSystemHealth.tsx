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
    <div className={`noc-card animate-slide-in-up ${allOk ? 'animate-glow-pulse' : ''}`}>
      <div className="noc-section-title mb-3">
        <Shield size={12} />
        System Health
      </div>
      <div className="space-y-0.5">
        {checks.map(c => (
          <div key={c.label} className="flex items-center justify-between py-1.5">
            <span className="text-xs font-mono text-muted-foreground">{c.label}</span>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${c.ok ? 'bg-success' : 'bg-destructive'} ${c.ok ? 'animate-pulse-glow' : ''}`} />
              <span className={`text-[10px] font-mono font-semibold ${c.ok ? 'text-success' : 'text-destructive'}`}>
                {c.ok ? 'OK' : 'FAIL'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
