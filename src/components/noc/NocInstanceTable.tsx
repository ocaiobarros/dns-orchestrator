import { CheckCircle, XCircle, AlertTriangle, Radio } from 'lucide-react';
import type { V2Instance } from '@/lib/types';

interface NocInstanceTableProps {
  instances: V2Instance[];
}

export default function NocInstanceTable({ instances }: NocInstanceTableProps) {
  if (!instances.length) return null;

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title">
          <Radio size={12} className="text-primary" />
          INSTANCE OPERATIONAL STATE
        </div>
        <div className="overflow-x-auto mt-3">
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
                <tr key={inst.id} style={{ animationDelay: `${i * 60}ms` }} className="animate-slide-in-up">
                  <td className="font-mono text-foreground font-medium">{inst.instance_name ?? '—'}</td>
                  <td className="font-mono text-muted-foreground text-xs">{inst.bind_ip ?? '—'}:{inst.bind_port ?? 53}</td>
                  <td>
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-bold px-2 py-1 rounded ${
                      inst.current_status === 'healthy' ? 'bg-success/10 text-success border border-success/20' :
                      inst.current_status === 'degraded' ? 'bg-warning/10 text-warning border border-warning/20' :
                      'bg-destructive/10 text-destructive border border-destructive/20'
                    }`}>
                      {inst.current_status === 'healthy' ? <CheckCircle size={10} /> :
                       inst.current_status === 'degraded' ? <AlertTriangle size={10} /> :
                       <XCircle size={10} />}
                      {(inst.current_status ?? 'unknown').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span className={`text-[11px] font-mono font-bold ${inst.in_rotation ? 'text-success' : 'text-destructive'}`}>
                      {inst.in_rotation ? '● IN' : '○ OUT'}
                    </span>
                  </td>
                  <td className="text-right font-mono text-muted-foreground">{inst.consecutive_failures ?? 0}</td>
                  <td className="text-right font-mono text-muted-foreground">{inst.consecutive_successes ?? 0}</td>
                  <td className="text-right">
                    {(inst.cooldown_remaining ?? 0) > 0 ? (
                      <span className="text-[11px] font-mono font-bold text-warning">{inst.cooldown_remaining}s</span>
                    ) : (
                      <span className="text-xs font-mono text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="text-[11px] text-muted-foreground truncate max-w-[180px]">{inst.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
