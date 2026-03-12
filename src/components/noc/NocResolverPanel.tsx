import { motion } from 'framer-motion';
import { Server } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocResolverPanelProps {
  services: ServiceStatus[];
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function statusStyle(status: string): { dot: string; text: string; label: string } {
  switch (status) {
    case 'running': return { dot: 'noc-dot-running', text: 'text-success/80', label: 'RUNNING' };
    case 'error': return { dot: 'noc-dot-error', text: 'text-destructive', label: 'ERROR' };
    case 'stopped': return { dot: 'noc-dot-stopped', text: 'text-muted-foreground/40', label: 'STOPPED' };
    default: return { dot: 'noc-dot-stopped', text: 'text-muted-foreground/40', label: status.toUpperCase() };
  }
}

export default function NocResolverPanel({ services }: NocResolverPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Server size={12} className="text-accent" />
          SERVICE STATUS
        </div>
        <div className="noc-section-divider" />

        <div className="space-y-0">
          {services.map((svc, i) => {
            const s = statusStyle(svc.status);
            return (
              <motion.div
                key={svc.name}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.04 }}
                className="noc-health-row group"
              >
                <div className="flex items-center gap-3">
                  <span className={s.dot} />
                  <div>
                    <span className="text-sm font-mono font-medium text-foreground/90">{svc.name}</span>
                    {svc.uptime && svc.status === 'running' && (
                      <span className="text-[9px] text-muted-foreground/30 font-mono ml-2 hidden group-hover:inline">
                        up {svc.uptime}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[10px] text-muted-foreground/40 font-mono">{formatBytes(svc.memoryBytes)}</span>
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${s.text}`}>
                    {s.label}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
