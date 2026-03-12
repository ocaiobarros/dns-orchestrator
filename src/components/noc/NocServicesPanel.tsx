import { Server } from 'lucide-react';
import type { ServiceStatus } from '@/lib/types';

interface NocServicesPanelProps {
  services: ServiceStatus[];
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'N/A';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export default function NocServicesPanel({ services }: NocServicesPanelProps) {
  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-section-title mb-3">
        <Server size={12} />
        Resolver Health
      </div>
      <div>
        {services.map((svc, i) => (
          <div key={svc.name} className="noc-health-row animate-slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-center gap-2.5">
              <span className={`w-2 h-2 rounded-full ${
                svc.status === 'running' ? 'bg-success' :
                svc.status === 'error' ? 'bg-destructive' :
                'bg-muted-foreground'
              }`} />
              <span className="text-sm font-mono text-foreground">{svc.name}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[10px] text-muted-foreground font-mono">{formatBytes(svc.memoryBytes)}</span>
              <span className={`text-[10px] font-mono font-medium uppercase ${
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
  );
}
