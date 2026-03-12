import { Server } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocServicesPanelProps {
  services: ServiceStatus[];
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export default function NocServicesPanel({ services }: NocServicesPanelProps) {
  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title">
          <Server size={12} className="text-accent" />
          RESOLVER SERVICES
        </div>
        <div className="mt-3 space-y-0">
          {services.map((svc, i) => (
            <div
              key={svc.name}
              className="noc-health-row animate-slide-in-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <span className={
                  svc.status === 'running' ? 'noc-dot-running' :
                  svc.status === 'error' ? 'noc-dot-error' :
                  'noc-dot-stopped'
                } />
                <span className="text-sm font-mono font-medium text-foreground">{svc.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-muted-foreground font-mono">{formatBytes(svc.memoryBytes)}</span>
                <span className={`text-[10px] font-mono font-bold uppercase tracking-wider ${
                  svc.status === 'running' ? 'text-success' :
                  svc.status === 'error' ? 'text-destructive' :
                  'text-muted-foreground'
                }`}>
                  {svc.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
