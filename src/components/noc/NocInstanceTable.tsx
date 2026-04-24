import { motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Radio } from 'lucide-react';
import type { V2Instance } from '@/lib/types';
import IpAddressStack from '@/components/IpAddressStack';

interface NocInstanceTableProps {
  instances: V2Instance[];
}

export default function NocInstanceTable({ instances }: NocInstanceTableProps) {
  if (!instances.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="noc-section-head">
          <Radio size={12} className="text-primary/70" />
          INSTANCE STATE
        </div>
        <div className="noc-divider" />

        <div className="overflow-x-auto">
          <table className="noc-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Bind</th>
                <th>Status</th>
                <th>Rotation</th>
                <th className="text-right">Fail</th>
                <th className="text-right">Pass</th>
                <th className="text-right">Cool</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst, i) => (
                <motion.tr
                  key={inst.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.06 + i * 0.04 }}
                >
                  <td className="font-mono text-foreground/85 font-semibold text-[12px]">{inst.instance_name ?? '—'}</td>
                  <td className="py-3 pr-3 align-top">
                    <div className="min-w-[220px] max-w-[320px]">
                      <IpAddressStack
                        ipv4={inst.bind_ipv4}
                        ipv6={inst.bind_ipv6}
                        fallback={inst.bind_ip}
                        valueClassName="text-[11px] text-muted-foreground/80"
                      />
                      <div className="mt-1 pl-2 text-[10px] font-mono text-muted-foreground/45">
                        porta {inst.bind_port ?? 53}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 text-[9px] font-mono font-bold px-2.5 py-1 rounded-full ${
                      inst.current_status === 'healthy' ? 'bg-success/6 text-success border border-success/12' :
                      inst.current_status === 'degraded' ? 'bg-warning/6 text-warning border border-warning/12' :
                      'bg-destructive/6 text-destructive border border-destructive/12'
                    }`}>
                      {inst.current_status === 'healthy' ? <CheckCircle size={8} /> :
                       inst.current_status === 'degraded' ? <AlertTriangle size={8} /> :
                       <XCircle size={8} />}
                      {(inst.current_status ?? 'unknown').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`text-[10px] font-mono font-bold ${inst.in_rotation ? 'text-success/60' : 'text-destructive/60'}`}>
                      {inst.in_rotation ? '● IN' : '○ OUT'}
                    </span>
                  </td>
                  <td className="text-right font-mono text-muted-foreground/35 text-[10px]">{inst.consecutive_failures ?? 0}</td>
                  <td className="text-right font-mono text-muted-foreground/35 text-[10px]">{inst.consecutive_successes ?? 0}</td>
                  <td className="text-right">
                    {(inst.cooldown_remaining ?? 0) > 0 ? (
                      <span className="text-[10px] font-mono font-bold text-warning">{inst.cooldown_remaining}s</span>
                    ) : (
                      <span className="text-[10px] font-mono text-muted-foreground/15">—</span>
                    )}
                  </td>
                  <td className="text-[10px] text-muted-foreground/30 truncate max-w-[160px]">{inst.reason ?? '—'}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
