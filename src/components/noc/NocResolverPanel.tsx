import { motion } from 'framer-motion';
import { Server } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocResolverPanelProps {
  services: ServiceStatus[];
}

function formatMemory(value: number | string | null | undefined): string {
  if (value == null) return '—';
  // Backend may send a string like "28.5M" or "1.2G"
  if (typeof value === 'string' && value) return value;
  const bytes = typeof value === 'number' ? value : 0;
  if (bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

type SvcState = 'running' | 'stopped' | 'error' | 'unknown';

function statusMeta(s: string): { dot: string; text: string; cls: string; state: SvcState } {
  if (s === 'running') return { dot: 'noc-dot-live', text: 'RUNNING', cls: 'text-success/60', state: 'running' };
  if (s === 'error') return { dot: 'noc-dot-fail', text: 'ERROR', cls: 'text-destructive', state: 'error' };
  if (s === 'stopped') return { dot: 'noc-dot-dead', text: 'INACTIVE', cls: 'text-muted-foreground/30', state: 'stopped' };
  return { dot: 'noc-dot-dead', text: s.toUpperCase(), cls: 'text-muted-foreground/30', state: 'unknown' };
}

export default function NocResolverPanel({ services }: NocResolverPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.18 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="noc-section-head">
          <Server size={12} className="text-accent/60" />
          SERVICE STATUS
        </div>
        <div className="noc-divider" />

        <div className="space-y-0">
          {services.map((svc, i) => {
            const meta = statusMeta(svc.status);
            return (
              <motion.div
                key={svc.name}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25, delay: 0.08 + i * 0.03 }}
                className="noc-row group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={meta.dot} />
                  <span className="text-[12px] font-mono font-semibold text-foreground/85 truncate">{svc.name}</span>
                  {svc.uptime && meta.state === 'running' && (
                    <span className="text-[8px] text-muted-foreground/20 font-mono hidden group-hover:inline transition-opacity">
                      up {svc.uptime}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-[9px] text-muted-foreground/20 font-mono w-[40px] text-right">{formatBytes(svc.memoryBytes)}</span>
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider min-w-[58px] text-right ${meta.cls}`}>
                    {meta.text}
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
