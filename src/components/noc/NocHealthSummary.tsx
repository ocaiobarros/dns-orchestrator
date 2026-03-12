import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle, XCircle, ShieldOff, Info, Clock } from 'lucide-react';
import { safeDateShort } from '@/lib/types';

interface NocHealthSummaryProps {
  incidents: number;
  warnings: number;
  activeServices: number;
  inactiveServices: number;
  errorServices: number;
  resolverState: 'healthy' | 'degraded' | 'critical' | 'unknown';
  dnsAvailable: boolean;
  privilegeLimited: boolean;
  lastEvent?: any;
}

function SummaryPill({ icon, label, count, variant }: {
  icon: React.ReactNode; label: string; count: number; variant: 'ok' | 'warn' | 'crit' | 'muted';
}) {
  const styles = {
    ok: 'bg-success/6 text-success/80 border-success/12',
    warn: 'bg-warning/6 text-warning/80 border-warning/12',
    crit: 'bg-destructive/6 text-destructive/80 border-destructive/12',
    muted: 'bg-muted/30 text-muted-foreground/50 border-border/20',
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono font-semibold ${styles[variant]}`}>
      {icon}
      <span className="uppercase tracking-wider">{label}</span>
      <span className="font-extrabold text-[12px] ml-auto tabular-nums">{count}</span>
    </div>
  );
}

export default function NocHealthSummary({
  incidents, warnings, activeServices, inactiveServices, errorServices,
  resolverState, dnsAvailable, privilegeLimited, lastEvent,
}: NocHealthSummaryProps) {
  const allClear = incidents === 0 && errorServices === 0 && resolverState !== 'critical';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.08 }}
      className="noc-surface"
    >
      <div className="noc-surface-body py-3.5">
        <div className="flex items-center gap-6 flex-wrap">
          {/* Status pills */}
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            {incidents > 0 ? (
              <SummaryPill icon={<XCircle size={11} />} label="Incidents" count={incidents} variant="crit" />
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-success/4 text-success/70 border-success/10 text-[10px] font-mono font-semibold">
                <CheckCircle size={11} />
                <span className="uppercase tracking-wider">No incidents</span>
              </div>
            )}

            {warnings > 0 && (
              <SummaryPill icon={<AlertTriangle size={11} />} label="Warnings" count={warnings} variant="warn" />
            )}

            {errorServices > 0 && (
              <SummaryPill icon={<XCircle size={11} />} label="Svc errors" count={errorServices} variant="crit" />
            )}

            {inactiveServices > 0 && (
              <SummaryPill icon={<Info size={11} />} label="Inactive" count={inactiveServices} variant="muted" />
            )}

            {privilegeLimited && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-warning/4 text-warning/60 border-warning/8 text-[9px] font-mono">
                <ShieldOff size={10} />
                <span className="uppercase tracking-wider">Privilege limited</span>
              </div>
            )}
          </div>

          {/* Last meaningful event */}
          {lastEvent && (
            <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground/35 shrink-0">
              <Clock size={9} />
              <span className="uppercase tracking-wider">Last event</span>
              <span className="text-foreground/50">{safeDateShort(lastEvent.created_at)}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
