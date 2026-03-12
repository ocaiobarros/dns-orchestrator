import { motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Radio } from 'lucide-react';
import type { V2Instance } from '@/lib/types';

interface NocInstanceTableProps {
  instances: V2Instance[];
}

export default function NocInstanceTable({ instances }: NocInstanceTableProps) {
  if (!instances.length) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Radio size={12} className="text-primary" />
          INSTANCE STATE
        </div>
        <div className="noc-section-divider" />

        <div className="overflow-x-auto">
          <table className="noc-table">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Bind Address</th>
                <th>Status</th>
                <th>Rotation</th>
                <th className="text-right">Failures</th>
                <th className="text-right">Successes</th>
                <th className="text-right">Cooldown</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {instances.map((inst, i) => (
                <motion.tr
                  key={inst.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: 0.05 + i * 0.04 }}
                >
                  <td className="font-mono text-foreground/90 font-medium">{inst.instance_name ?? '—'}</td>
                  <td className="font-mono text-muted-foreground/50 text-xs">{inst.bind_ip ?? '—'}:{inst.bind_port ?? 53}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-mono font-bold px-2.5 py-1 rounded-full ${
                      inst.current_status === 'healthy' ? 'bg-success/8 text-success border border-success/15' :
                      inst.current_status === 'degraded' ? 'bg-warning/8 text-warning border border-warning/15' :
                      'bg-destructive/8 text-destructive border border-destructive/15'
                    }`}>
                      {inst.current_status === 'healthy' ? <CheckCircle size={9} /> :
                       inst.current_status === 'degraded' ? <AlertTriangle size={9} /> :
                       <XCircle size={9} />}
                      {(inst.current_status ?? 'unknown').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`text-[10px] font-mono font-bold ${inst.in_rotation ? 'text-success/70' : 'text-destructive/70'}`}>
                      {inst.in_rotation ? '● IN' : '○ OUT'}
                    </span>
                  </td>
                  <td className="text-right font-mono text-muted-foreground/50 text-xs">{inst.consecutive_failures ?? 0}</td>
                  <td className="text-right font-mono text-muted-foreground/50 text-xs">{inst.consecutive_successes ?? 0}</td>
                  <td className="text-right">
                    {(inst.cooldown_remaining ?? 0) > 0 ? (
                      <span className="text-[10px] font-mono font-bold text-warning">{inst.cooldown_remaining}s</span>
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground/20">—</span>
                    )}
                  </td>
                  <td className="text-[10px] text-muted-foreground/40 truncate max-w-[180px]">{inst.reason ?? '—'}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
