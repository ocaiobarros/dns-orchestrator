import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { XCircle, AlertTriangle, CheckCircle, Shield, ArrowRight, Radio, Eye, EyeOff, Lock } from 'lucide-react';
import { safeDateShort } from '@/lib/types';
import { useNavigate } from 'react-router-dom';

interface NocEventsTimelineProps {
  events: any[];
}

// Executive-level events only — filter out technical noise
function isExecutiveEvent(ev: any): boolean {
  const type = ev.event_type || '';
  const msg = (ev.message || '').toLowerCase();

  // Always show critical
  if (ev.severity === 'critical') return true;

  // Filter out noise
  if (type === 'login_success' || type === 'auth_login') return false;
  if (type === 'reconciliation_noop') return false;
  if (type === 'health_check' && ev.severity !== 'critical') return false;
  if (msg.includes('expected privilege limitation')) return false;
  if (msg.includes('permission_limited')) return false;
  if (msg.includes('command executed') && ev.severity === 'info') return false;

  return true;
}

// Aggregate similar events
interface AggregatedEvent {
  id: string;
  severity: string;
  message: string;
  created_at: string;
  count: number;
  event_type?: string;
}

function aggregateEvents(events: any[]): AggregatedEvent[] {
  const result: AggregatedEvent[] = [];
  const seen = new Map<string, number>();

  for (const ev of events) {
    // Create a grouping key based on message pattern + severity
    const baseMsg = (ev.message || '').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const key = `${ev.severity}:${baseMsg}`;

    const existingIdx = seen.get(key);
    if (existingIdx !== undefined) {
      result[existingIdx].count++;
    } else {
      seen.set(key, result.length);
      result.push({
        id: ev.id,
        severity: ev.severity,
        message: ev.message,
        created_at: ev.created_at,
        count: 1,
        event_type: ev.event_type,
      });
    }
  }

  return result;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') {
    return (
      <div className="w-[20px] h-[20px] rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 border border-destructive/15">
        <XCircle size={10} className="text-destructive" />
      </div>
    );
  }
  if (severity === 'warning') {
    return (
      <div className="w-[20px] h-[20px] rounded-full bg-warning/8 flex items-center justify-center flex-shrink-0 border border-warning/12">
        <AlertTriangle size={10} className="text-warning/80" />
      </div>
    );
  }
  return (
    <div className="w-[20px] h-[20px] rounded-full bg-muted/20 flex items-center justify-center flex-shrink-0 border border-border/15">
      <CheckCircle size={10} className="text-muted-foreground/35" />
    </div>
  );
}

export default function NocEventsTimeline({ events }: NocEventsTimelineProps) {
  const [showAll, setShowAll] = useState(false);
  const navigate = useNavigate();

  const executiveEvents = useMemo(() =>
    aggregateEvents(events.filter(isExecutiveEvent)),
    [events]
  );

  const allEvents = useMemo(() =>
    aggregateEvents(events),
    [events]
  );

  const displayEvents = showAll ? allEvents : executiveEvents;
  const critCount = events.filter(e => e.severity === 'critical').length;
  const filteredCount = events.length - executiveEvents.reduce((a, e) => a + e.count, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between">
          <div className="noc-section-head flex-1">
            <Shield size={12} className={critCount > 0 ? 'text-destructive/70' : 'text-warning/50'} />
            OPERATIONAL FEED
            {critCount > 0 && (
              <span className="text-[8px] font-mono px-2 py-0.5 rounded-full bg-destructive/8 text-destructive border border-destructive/15 ml-1.5">
                {critCount} CRIT
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Executive / All toggle */}
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/30 hover:text-muted-foreground/60 uppercase tracking-wider transition-colors"
              title={showAll ? 'Show executive feed' : 'Show all events'}
            >
              {showAll ? <EyeOff size={8} /> : <Eye size={8} />}
              {showAll ? 'EXEC' : 'ALL'}
            </button>
            <button
              onClick={() => navigate('/events')}
              className="flex items-center gap-1 text-[9px] font-mono text-primary/40 hover:text-primary uppercase tracking-wider transition-colors"
            >
              ALL <ArrowRight size={8} />
            </button>
          </div>
        </div>
        <div className="noc-divider" />

        <div className="pl-0.5">
          {displayEvents.length > 0 ? displayEvents.slice(0, 8).map((ev, i) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.08 + i * 0.025 }}
              className="noc-feed-item"
            >
              <div className="mt-0.5 relative z-10">
                <SeverityIcon severity={ev.severity} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[11px] text-foreground/80 leading-snug truncate">{ev.message}</p>
                  {ev.count > 1 && (
                    <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-muted/30 text-muted-foreground/40 border border-border/15 shrink-0">
                      ×{ev.count}
                    </span>
                  )}
                </div>
                <span className="text-[9px] font-mono text-muted-foreground/30 mt-0.5 block">{safeDateShort(ev.created_at)}</span>
              </div>
            </motion.div>
          )) : (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <div className="w-10 h-10 rounded-full bg-muted/10 flex items-center justify-center border border-border/10">
                <Radio size={16} className="text-muted-foreground/15" />
              </div>
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground/30 font-mono">No active incidents</p>
                <p className="text-[9px] text-muted-foreground/18 font-mono mt-1">Telemetry stable</p>
              </div>
            </div>
          )}

          {/* Filtered count note */}
          {!showAll && filteredCount > 0 && (
            <div className="flex items-center gap-1.5 pt-2 text-[8px] font-mono text-muted-foreground/20 justify-center">
              <Lock size={7} />
              {filteredCount} technical events filtered
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
