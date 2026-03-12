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

function statusDot(s: string) {
  if (s === 'running') return 'noc-dot-live';
  if (s === 'error') return 'noc-dot-fail';
  return 'noc-dot-dead';
}

function statusLabel(s: string): { text: string; className: string } {
  if (s === 'running') return { text: 'RUNNING', className: 'text-success/60' };
  if (s === 'error') return { text: 'ERROR', className: 'text-destructive' };
  if (s === 'stopped') return { text: 'STOPPED', className: 'text-muted-foreground/30' };
  return { text: s.toUpperCase(), className: 'text-muted-foreground/30' };
}

/** Running animation line */
function RunLine({ running }: { running: boolean }) {
  if (!running) return null;
  return (
    <svg width="24" height="4" viewBox="0 0 24 4" className="opacity-40">
      <rect width="24" height="4" rx="2" fill="hsl(152, 76%, 40%)" opacity="0.08" />
      <rect width="8" height="4" rx="2" fill="hsl(152, 76%, 40%)" opacity="0.3">
        <animate attributeName="x" values="-8;24" dur="2s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

export default function NocResolverPanel({ services }: NocResolverPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
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
            const st = statusLabel(svc.status);
            return (
              <motion.div
                key={svc.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + i * 0.04 }}
                className="noc-row group"
              >
                <div className="flex items-center gap-3">
                  <span className={statusDot(svc.status)} />
                  <div>
                    <span className="text-[12px] font-mono font-semibold text-foreground/85">{svc.name}</span>
                    {svc.uptime && svc.status === 'running' && (
                      <span className="text-[8px] text-muted-foreground/20 font-mono ml-2 hidden group-hover:inline transition-opacity">
                        up {svc.uptime}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <RunLine running={svc.status === 'running'} />
                  <span className="text-[9px] text-muted-foreground/25 font-mono w-[40px] text-right">{formatBytes(svc.memoryBytes)}</span>
                  <span className={`text-[10px] font-mono font-bold uppercase tracking-wider min-w-[52px] text-right ${st.className}`}>
                    {st.text}
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
