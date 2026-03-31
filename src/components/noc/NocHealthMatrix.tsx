import { motion } from 'framer-motion';
import { Shield, ShieldOff } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocHealthMatrixProps {
  services: ServiceStatus[];
  dnsHealthy: boolean;
  networkOk: boolean;
  dnsAvailable?: boolean;
  privilegeLimited?: boolean;
}

type CheckState = 'ok' | 'warn' | 'inactive' | 'limited' | 'fail';

function dotClass(state: CheckState) {
  switch (state) {
    case 'ok': return 'noc-dot-live';
    case 'warn': return 'noc-dot-warn';
    case 'inactive': return 'noc-dot-dead';
    case 'limited': return 'noc-dot-warn';
    case 'fail': return 'noc-dot-fail';
  }
}

function stateLabel(state: CheckState): { text: string; className: string } {
  switch (state) {
    case 'ok': return { text: 'OK', className: 'text-success/60' };
    case 'warn': return { text: 'WARN', className: 'text-warning/70' };
    case 'inactive': return { text: 'INACTIVE', className: 'text-muted-foreground/30' };
    case 'limited': return { text: 'LIMITED', className: 'text-warning/50' };
    case 'fail': return { text: 'FAIL', className: 'text-destructive' };
  }
}

export default function NocHealthMatrix({ services, dnsHealthy, networkOk, dnsAvailable, privilegeLimited }: NocHealthMatrixProps) {
  const svcByName = (name: string) => services.find(s => s.name.toLowerCase().includes(name));

  const frrSvc = svcByName('frr');
  const unboundSvc = svcByName('unbound');
  const nftSvc = svcByName('nftables') || svcByName('nft');

  const checks: { label: string; state: CheckState; detail?: string }[] = [
    {
      label: 'DNS',
      state: dnsHealthy ? 'ok' : !dnsAvailable && privilegeLimited ? 'limited' : 'fail',
      detail: !dnsAvailable && privilegeLimited ? 'Privilege limited' : undefined,
    },
    {
      label: 'NETWORK',
      state: networkOk ? 'ok' : 'warn',
    },
    {
      label: 'OSPF',
      state: frrSvc?.status === 'running' ? 'ok' : frrSvc?.status === 'stopped' ? 'inactive' : frrSvc ? 'fail' : 'inactive',
      detail: frrSvc?.status === 'stopped' ? 'Service stopped' : !frrSvc ? 'Not installed' : undefined,
    },
    {
      label: 'CACHE',
      state: unboundSvc?.status === 'running' ? 'ok' : unboundSvc?.status === 'stopped' ? 'inactive' : 'fail',
    },
    {
      label: 'FIREWALL',
      state: (nftSvc?.status === 'running' || nftSvc?.status === 'active') ? 'ok' : nftSvc?.status === 'stopped' || nftSvc?.status === 'no ruleset' ? 'inactive' : nftSvc ? 'fail' : 'inactive',
      detail: !nftSvc ? 'Not detected' : (nftSvc?.status === 'stopped' || nftSvc?.status === 'no ruleset') ? 'Inactive' : undefined,
    },
    { label: 'API', state: 'ok' },
    { label: 'AUTH', state: 'ok' },
  ];

  const failCount = checks.filter(c => c.state === 'fail').length;
  const limitedCount = checks.filter(c => c.state === 'limited').length;
  const inactiveCount = checks.filter(c => c.state === 'inactive').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between">
          <div className="noc-section-head">
            <Shield size={12} className={failCount > 0 ? 'text-destructive' : 'text-success/70'} />
            SUBSYSTEM MATRIX
          </div>
          <div className="flex items-center gap-2 text-[8px] font-mono text-muted-foreground/25 uppercase tracking-wider">
            {failCount > 0 && <span className="text-destructive">{failCount} fail</span>}
            {limitedCount > 0 && <span className="text-warning/50">{limitedCount} limited</span>}
            {inactiveCount > 0 && <span>{inactiveCount} inactive</span>}
          </div>
        </div>
        <div className="noc-divider" />

        <div className="space-y-0">
          {checks.map((c, i) => {
            const st = stateLabel(c.state);
            return (
              <motion.div
                key={c.label}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.1 + i * 0.03 }}
                className="noc-row"
              >
                <div className="flex items-center gap-3">
                  <span className={dotClass(c.state)} />
                  <span className="text-[11px] font-mono font-bold text-foreground/85 tracking-wider">{c.label}</span>
                  {c.detail && (
                    <span className="text-[8px] font-mono text-muted-foreground/25 hidden sm:inline">{c.detail}</span>
                  )}
                </div>
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${st.className}`}>
                  {st.text}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
