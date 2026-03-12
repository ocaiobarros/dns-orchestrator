import { motion } from 'framer-motion';
import { XCircle, AlertTriangle, CheckCircle, Bell, ArrowRight, Radio } from 'lucide-react';
import { safeDateShort } from '@/lib/types';
import { useNavigate } from 'react-router-dom';

interface NocEventsTimelineProps {
  events: any[];
}

function EventIcon({ severity }: { severity: string }) {
  if (severity === 'critical') {
    return (
      <div className="w-5 h-5 rounded-full bg-destructive/15 flex items-center justify-center flex-shrink-0 border border-destructive/20">
        <XCircle size={10} className="text-destructive" />
      </div>
    );
  }
  if (severity === 'warning') {
    return (
      <div className="w-5 h-5 rounded-full bg-warning/15 flex items-center justify-center flex-shrink-0 border border-warning/20">
        <AlertTriangle size={10} className="text-warning" />
      </div>
    );
  }
  return (
    <div className="w-5 h-5 rounded-full bg-muted/50 flex items-center justify-center flex-shrink-0 border border-border/30">
      <CheckCircle size={10} className="text-muted-foreground/60" />
    </div>
  );
}

export default function NocEventsTimeline({ events }: NocEventsTimelineProps) {
  const navigate = useNavigate();
  const criticalCount = events.filter(e => e.severity === 'critical').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="flex items-center justify-between">
          <div className="noc-section-title flex-1">
            <Bell size={12} className="text-warning" />
            INCIDENT FEED
            {criticalCount > 0 && (
              <span className="text-[9px] font-mono px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20 normal-case tracking-normal ml-1">
                {criticalCount} critical
              </span>
            )}
          </div>
          <button
            onClick={() => navigate('/events')}
            className="flex items-center gap-1 text-[10px] font-mono text-primary/50 hover:text-primary uppercase tracking-wider transition-colors"
          >
            VIEW ALL <ArrowRight size={9} />
          </button>
        </div>
        <div className="noc-section-divider" />

        <div className="pl-0.5">
          {events.length > 0 ? events.slice(0, 8).map((ev, i) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.03 }}
              className="noc-event-row"
            >
              <div className="mt-0.5 relative z-10">
                <EventIcon severity={ev.severity} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground/85 leading-snug">{ev.message}</p>
                <span className="noc-event-time">{safeDateShort(ev.created_at)}</span>
              </div>
            </motion.div>
          )) : (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Radio size={20} className="text-muted-foreground/20" />
              <p className="text-[11px] text-muted-foreground/40 font-mono text-center">
                No active incidents<br />
                <span className="text-[10px] text-muted-foreground/25">Telemetry stable</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
