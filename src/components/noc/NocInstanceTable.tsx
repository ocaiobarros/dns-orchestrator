import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { V2Instance } from '@/lib/types';

interface NocInstanceTableProps {
  instances: V2Instance[];
}

export default function NocInstanceTable({ instances }: NocInstanceTableProps) {
  if (!instances.length) return null;

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-section-title mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-glow" />
        Estado Operacional — Instâncias
      </div>
      <div className="overflow-x-auto">
        <table className="noc-table">
          <thead>
            <tr>
              <th>Instância</th>
              <th>Bind IP</th>
              <th>Status</th>
              <th>Rotação</th>
              <th className="text-right">Falhas</th>
              <th className="text-right">Sucessos</th>
              <th className="text-right">Cooldown</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {instances.map((inst, i) => (
              <tr key={inst.id} style={{ animationDelay: `${i * 50}ms` }} className="animate-slide-in-up">
                <td className="font-mono text-foreground">{inst.instance_name ?? '—'}</td>
                <td className="font-mono text-muted-foreground">{inst.bind_ip ?? '—'}:{inst.bind_port ?? 53}</td>
                <td>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
                    inst.current_status === 'healthy' ? 'bg-success/10 text-success' :
                    inst.current_status === 'degraded' ? 'bg-warning/10 text-warning' :
                    'bg-destructive/10 text-destructive'
                  }`}>
                    {inst.current_status === 'healthy' ? <CheckCircle size={11} /> :
                     inst.current_status === 'degraded' ? <AlertTriangle size={11} /> :
                     <XCircle size={11} />}
                    {inst.current_status ?? 'unknown'}
                  </span>
                </td>
                <td>
                  <span className={`text-xs font-mono font-medium ${inst.in_rotation ? 'text-success' : 'text-destructive'}`}>
                    {inst.in_rotation ? 'SIM' : 'NÃO'}
                  </span>
                </td>
                <td className="text-right font-mono text-muted-foreground">{inst.consecutive_failures ?? 0}</td>
                <td className="text-right font-mono text-muted-foreground">{inst.consecutive_successes ?? 0}</td>
                <td className="text-right">
                  {(inst.cooldown_remaining ?? 0) > 0 ? (
                    <span className="text-xs font-mono text-warning">{inst.cooldown_remaining}s</span>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">—</span>
                  )}
                </td>
                <td className="text-xs text-muted-foreground truncate max-w-[200px]">{inst.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
