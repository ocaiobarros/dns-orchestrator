import { useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import ApplyStepsViewer from '@/components/ApplyStepsViewer';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useHistory, useDeployBackups, useRollback, useHistoryDetail } from '@/lib/hooks';
import { safeDate } from '@/lib/types';
import { RotateCcw, ChevronDown, ChevronUp, Check, X, SkipForward, FileText, Shield } from 'lucide-react';

/** Normalize a history item from real API (snake_case) or mock (camelCase) */
function normalizeHistoryItem(raw: any) {
  return {
    id: String(raw.id ?? ''),
    timestamp: raw.timestamp ?? raw.created_at ?? raw.started_at ?? null,
    user: raw.user ?? raw.created_by ?? '—',
    status: raw.status ?? 'unknown',
    scope: raw.scope ?? raw.job_type ?? 'full',
    dryRun: raw.dryRun ?? raw.dry_run ?? raw.job_type === 'dry-run',
    comment: raw.comment ?? '',
    steps: raw.steps ?? [],
    duration: raw.duration ?? raw.duration_ms ?? 0,
    configVersion: raw.configVersion ?? raw.config_version ?? '',
    changedFiles: raw.changedFiles ?? raw.changed_files ?? [],
    healthResult: raw.healthResult ?? raw.health_result ?? [],
    rollbackAvailable: raw.rollbackAvailable ?? raw.rollback_available ?? false,
    backupId: raw.backupId ?? raw.backup_id ?? null,
    exitCode: raw.exit_code ?? raw.exitCode ?? null,
    finishedAt: raw.finished_at ?? raw.finishedAt ?? null,
  };
}

export default function HistoryPage() {
  const { data, isLoading, error, refetch } = useHistory();
  const { data: backups } = useDeployBackups();
  const rollbackMutation = useRollback();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { data: detail, isLoading: detailLoading } = useHistoryDetail(expandedId);
  const [showBackups, setShowBackups] = useState(false);

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  // Normalize: real API may return { items: [...] } or just an array
  const rawItems = data?.items ?? (Array.isArray(data) ? data : []);
  const total = data?.total ?? rawItems.length;

  if (rawItems.length === 0) return <EmptyState title="Nenhuma aplicação registrada" description="Execute o wizard para criar a primeira configuração" />;

  const items = rawItems.map(normalizeHistoryItem);

  const handleRollback = (backupId: string) => {
    if (confirm(`Confirma rollback para snapshot ${backupId}?`)) {
      rollbackMutation.mutate({ backupId, reason: 'Manual rollback from history page' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Histórico de Deploys</h1>
          <p className="text-sm text-muted-foreground">{total} registros</p>
        </div>
        <button onClick={() => setShowBackups(!showBackups)}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
          <RotateCcw size={12} /> Backups ({backups?.length ?? 0})
        </button>
      </div>

      {/* Rollback result */}
      {rollbackMutation.data && (
        <div className={`noc-panel ${rollbackMutation.data.success ? 'border-success/30' : 'border-destructive/30'}`}>
          <div className="noc-panel-header flex items-center gap-2">
            {rollbackMutation.data.success ? <Check size={12} className="text-success" /> : <X size={12} className="text-destructive" />}
            Rollback {rollbackMutation.data.success ? 'concluído' : 'falhou'} — {rollbackMutation.data.duration}ms
          </div>
          <ApplyStepsViewer steps={rollbackMutation.data.steps} />
          {rollbackMutation.data.restoredFiles?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {rollbackMutation.data.restoredFiles.map((f: string) => (
                <span key={f} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">{f}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Backups panel */}
      {showBackups && backups && backups.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Snapshots Disponíveis para Rollback</div>
          <div className="space-y-2">
            {backups.map((b: any) => (
              <div key={b.backupId ?? b.backup_id} className="flex items-center gap-3 p-2 rounded bg-secondary border border-border text-xs">
                <Shield size={12} className="text-accent shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-mono truncate">{b.backupId ?? b.backup_id}</div>
                  <div className="text-muted-foreground">{safeDate(b.timestamp)} · {b.operator} · {b.fileCount ?? b.file_count} arquivos</div>
                </div>
                <button onClick={() => handleRollback(b.backupId ?? b.backup_id)} disabled={rollbackMutation.isPending}
                  className="px-2.5 py-1 text-xs bg-accent text-accent-foreground rounded font-medium hover:bg-accent/90 disabled:opacity-50 shrink-0">
                  <RotateCcw size={10} className="inline mr-1" /> Rollback
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History entries */}
      <div className="space-y-4">
        {items.map((h: any) => {
          const expanded = expandedId === h.id;
          return (
            <div key={h.id} className="noc-panel">
              <div className="flex items-center justify-between mb-1 cursor-pointer" onClick={() => setExpandedId(expanded ? null : h.id)}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="font-mono text-sm truncate max-w-[120px]">{h.id}</span>
                  <StatusBadge status={h.status} />
                  {h.dryRun && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 shrink-0">dry-run</span>
                  )}
                  <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border shrink-0">{h.scope}</span>
                  {h.exitCode != null && (
                    <span className={`text-xs font-mono ${h.exitCode === 0 ? 'text-success' : 'text-destructive'}`}>exit:{h.exitCode}</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground font-mono block">{safeDate(h.timestamp)}</span>
                    <span className="text-xs text-muted-foreground">{h.duration ? `${h.duration}ms · ` : ''}{h.user}</span>
                  </div>
                  {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </div>
              </div>

              {h.comment && (
                <p className="text-sm text-muted-foreground mb-3">"{h.comment}"</p>
              )}

              {expanded && (
                <div className="space-y-3 mt-3 border-t border-border pt-3">
                  {/* Execution pipeline */}
                  <div>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Pipeline de Execução</span>
                    <div className="mt-1">
                      {detailLoading ? (
                        <p className="text-xs text-muted-foreground">Carregando...</p>
                      ) : (detail?.steps ?? h.steps ?? []).length > 0 ? (
                        <ApplyStepsViewer steps={detail?.steps || h.steps} showCommands />
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhuma etapa registrada</p>
                      )}
                    </div>
                  </div>

                  {/* Health checks */}
                  {(detail?.healthResult ?? h.healthResult ?? []).length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Verificação Pós-Deploy</span>
                      <div className="mt-1 space-y-1">
                        {(detail?.healthResult ?? h.healthResult).map((check: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 p-1.5 text-xs">
                            {check.status === 'pass' ? <Check size={10} className="text-success" /> :
                             check.status === 'fail' ? <X size={10} className="text-destructive" /> :
                             <SkipForward size={10} className="text-muted-foreground" />}
                            <span className="flex-1">{check.name}</span>
                            <span className="font-mono text-muted-foreground">{check.target}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Changed files */}
                  {h.changedFiles?.length > 0 && (
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Arquivos Alterados ({h.changedFiles.length})</span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {h.changedFiles.map((f: string) => (
                          <span key={f} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                    {h.rollbackAvailable && h.backupId && (
                      <button onClick={() => handleRollback(h.backupId!)} disabled={rollbackMutation.isPending}
                        className="px-2.5 py-1 text-xs bg-accent text-accent-foreground rounded border border-accent/30 hover:bg-accent/90 flex items-center gap-1">
                        <RotateCcw size={10} /> Rollback
                      </button>
                    )}
                    <button className="px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 flex items-center gap-1">
                      <FileText size={10} /> Ver Arquivos
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
