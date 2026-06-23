/**
 * TelemetryHealthStrip
 *
 * Global, single-source-of-truth strip that exposes WHO is feeding the UI:
 *   - telemetry_mode   (log | logless)         — from latest.json
 *   - log_source       (journalctl | logfile:* | none) — from latest.json
 *   - file_age_seconds → fresh / stale         — from /api/telemetry/status
 *   - retention_minutes                         — from latest.json
 *
 * Honest degradation: when /api/telemetry/status is unreachable or returns
 * `collector_status !== 'ok'`, this strip shows "indisponível" instead of
 * fabricating a green "OK" badge.
 *
 * Read-only. No backend writes. Reuses the existing NOC chip styling so it
 * drops into any NOC header without new dependencies.
 */

import { Activity, AlertTriangle, Clock, Database, FileText } from 'lucide-react';
import { useTelemetry, useTelemetryStatus } from '@/lib/hooks';

type Props = {
  className?: string;
  /** When false, render as a compact inline row (used inside narrow strips). */
  compact?: boolean;
};

function fmtAge(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

export function TelemetryHealthStrip({ className = '', compact = false }: Props) {
  const { data: telemetry } = useTelemetry();
  const { data: telStatus, isError: statusError } = useTelemetryStatus();

  const qa = telemetry?.query_analytics ?? {};
  const telemetryMode: string = telemetry?.telemetry_mode ?? qa.telemetry_mode ?? 'unknown';
  const logSource: string = qa.log_source ?? telemetry?.log_source ?? 'none';
  const retentionMin: number | null =
    typeof qa.retention_minutes === 'number'
      ? qa.retention_minutes
      : typeof telemetry?.retention_minutes === 'number'
      ? telemetry.retention_minutes
      : null;

  const fileAge: number | null =
    typeof telStatus?.file_age_seconds === 'number' ? telStatus.file_age_seconds : null;
  const stale: boolean = telStatus?.stale === true;
  const statusUnavailable =
    statusError || telStatus == null || telStatus?.collector_status === 'not_running';

  // Mode chip color
  const modeOk = telemetryMode === 'log';
  const modeChipCls = modeOk
    ? 'border-primary/40 bg-primary/10 text-primary'
    : 'border-warning/40 bg-warning/10 text-warning';

  // Freshness chip
  let freshLabel = '—';
  let freshCls = 'border-border/60 bg-secondary/70 text-muted-foreground';
  if (statusUnavailable) {
    freshLabel = 'indisponível';
    freshCls = 'border-destructive/40 bg-destructive/10 text-destructive';
  } else if (stale) {
    freshLabel = `stale (${fmtAge(fileAge)})`;
    freshCls = 'border-warning/40 bg-warning/10 text-warning';
  } else if (fileAge != null) {
    freshLabel = `fresco (${fmtAge(fileAge)})`;
    freshCls = 'border-primary/40 bg-primary/10 text-primary';
  }

  const wrap = compact
    ? 'flex items-center gap-2 flex-wrap text-[10.5px] font-mono'
    : 'flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 font-mono text-[11px]';

  return (
    <div className={`${wrap} ${className}`} data-testid="telemetry-health-strip">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${modeChipCls}`}>
        <Activity size={11} />
        <span className="uppercase tracking-wider font-bold">Modo: {telemetryMode}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/60 bg-secondary/70 text-muted-foreground">
        <FileText size={11} />
        Fonte: <span className="text-foreground/85">{logSource || 'none'}</span>
      </span>
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${freshCls}`}>
        {statusUnavailable ? <AlertTriangle size={11} /> : <Clock size={11} />}
        {freshLabel}
      </span>
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/60 bg-secondary/70 text-muted-foreground">
        <Database size={11} />
        Retenção: <span className="text-foreground/85">{retentionMin != null ? `${retentionMin}min` : '—'}</span>
      </span>
    </div>
  );
}

/**
 * Returns true only when rankings (Top Domains / Top Clients) have NO usable
 * source — i.e. the journalctl-regex path also failed. journalctl é a fonte
 * normal/esperada para rankings (Unbound não loga query por padrão), portanto
 * não deve ser rotulada como "degradado".
 */
export function isRankingsFallback(logSource: string | null | undefined): boolean {
  const v = String(logSource ?? '').toLowerCase().trim();
  return v === '' || v === 'none' || v === 'unavailable' || v === 'error';
}

export function FallbackRankingsBadge({ logSource }: { logSource: string | null | undefined }) {
  if (!isRankingsFallback(logSource)) return null;
  return (
    <span
      title="Fonte de rankings indisponível — verifique o coletor de logs."
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-warning/40 bg-warning/10 text-warning text-[9px] font-mono font-bold uppercase tracking-wider"
    >
      <AlertTriangle size={9} /> fonte indisponível
    </span>
  );
}

export default TelemetryHealthStrip;
