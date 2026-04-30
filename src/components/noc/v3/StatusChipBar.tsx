import { CheckCircle2, AlertTriangle, RotateCcw, Clock, RefreshCw, Plus, Globe } from 'lucide-react';

interface Props {
  allHealthy: boolean;
  frontendIp?: string | null;
  distributionLabel?: string;
  collectorActive?: boolean;
  healthyCount: number;
  totalInstances: number;
  uptime?: string | null;
  lastLoginFail?: string | null;
  onReconcile?: () => void;
  reconciling?: boolean;
}

export default function StatusChipBar({
  allHealthy, frontendIp, distributionLabel = 'Round-Robin', collectorActive = true,
  healthyCount, totalInstances, uptime, lastLoginFail, onReconcile, reconciling,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="noc-status-chip" data-state={allHealthy ? 'ok' : 'warn'}>
          <CheckCircle2 size={13} />
          <span>Operacional</span>
          <span className="text-muted-foreground/60 font-normal normal-case ml-1 tracking-normal">
            Todos os sistemas nominais
          </span>
        </div>

        {frontendIp && (
          <div className="noc-status-chip" data-state="ok">
            <Globe size={13} />
            <span>Frontend DNS</span>
            <span className="text-foreground/85 font-normal normal-case ml-1 tracking-normal">
              {frontendIp}:53
            </span>
          </div>
        )}

        <div className="noc-status-chip">
          <span>Distribuição</span>
          <span className="text-foreground/85 font-normal normal-case tracking-normal">{distributionLabel}</span>
        </div>

        <div className="noc-status-chip" data-state={collectorActive ? 'ok' : 'warn'}>
          <span>Coletor</span>
          <span className="font-normal normal-case tracking-normal">{collectorActive ? 'Ativo' : 'Inativo'}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="noc-status-chip">
            <RefreshCw size={11} /><span className="font-normal normal-case tracking-normal">5s</span>
          </div>
          <div className="noc-status-chip">
            <Plus size={11} /><span className="font-normal normal-case tracking-normal">{healthyCount}/{totalInstances}</span>
          </div>
          <div className="noc-status-chip">
            <Clock size={11} /><span className="font-normal normal-case tracking-normal">{new Date().toLocaleTimeString('pt-BR', { hour12: false })}</span>
          </div>
          <button
            onClick={onReconcile}
            disabled={reconciling}
            className="noc-status-chip"
            data-state="info"
          >
            <RotateCcw size={11} className={reconciling ? 'animate-spin' : ''} />
            <span>Reconciliar</span>
          </button>
        </div>
      </div>

      {lastLoginFail && (
        <div className="flex items-center gap-2 text-[11px] font-mono text-warning/85 px-1">
          <AlertTriangle size={12} />
          <span>{lastLoginFail}</span>
        </div>
      )}
    </div>
  );
}
