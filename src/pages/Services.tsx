import StatusBadge from '@/components/StatusBadge';
import { mockServices } from '@/lib/mock-data';

export default function Services() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Serviços</h1>
        <p className="text-sm text-muted-foreground">Estado dos serviços do sistema</p>
      </div>

      <div className="grid gap-4">
        {mockServices.map(svc => (
          <div key={svc.name} className="noc-panel">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono font-medium">{svc.name}</h3>
              <StatusBadge status={svc.status} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
              <div>
                <span className="metric-label">PID</span>
                <p className="font-mono">{svc.pid || 'N/A'}</p>
              </div>
              <div>
                <span className="metric-label">Memória</span>
                <p className="font-mono">{svc.memory}</p>
              </div>
              <div>
                <span className="metric-label">CPU</span>
                <p className="font-mono">{svc.cpu}</p>
              </div>
              <div>
                <span className="metric-label">Restarts</span>
                <p className="font-mono">{svc.restartCount}</p>
              </div>
              <div>
                <span className="metric-label">Uptime</span>
                <p className="font-mono">{svc.uptime}</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Restart</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Logs</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Status</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
