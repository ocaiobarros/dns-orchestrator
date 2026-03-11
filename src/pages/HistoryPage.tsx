import StatusBadge from '@/components/StatusBadge';
import { mockHistory } from '@/lib/mock-data';

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Histórico de Aplicações</h1>
        <p className="text-sm text-muted-foreground">Registro de todas as execuções</p>
      </div>

      <div className="space-y-4">
        {mockHistory.map(h => (
          <div key={h.id} className="noc-panel">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">{h.id}</span>
                <StatusBadge status={h.status} />
              </div>
              <span className="text-xs text-muted-foreground font-mono">{new Date(h.timestamp).toLocaleString('pt-BR')}</span>
            </div>

            <div className="text-sm mb-2">
              <span className="text-muted-foreground">Usuário: </span>
              <span className="font-mono">{h.user}</span>
            </div>

            <div className="mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Arquivos modificados</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {h.files.map(f => (
                  <span key={f} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded">{f}</span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Logs</span>
              <div className="terminal-output mt-1 max-h-32">
                {h.logs.map((l, i) => (
                  <div key={i} className={l.includes('[OK]') ? 'text-success' : ''}>{l}</div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-3">
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Reaplicar</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Ver Diff</button>
              <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Exportar</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
