import { motion } from 'framer-motion';
import { XCircle, AlertTriangle, CheckCircle, Shield, ArrowRight, Radio } from 'lucide-react';
import { safeDateShort } from '@/lib/types';
import { useNavigate } from 'react-router-dom';

interface NocEventsTimelineProps {
  events: any[];
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') {
    return (
      <div className="w-[22px] h-[22px] rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0 border border-destructive/15 shadow-[0_0_8px_hsl(0_76%_50%/0.15)]">
        <XCircle size={10} className="text-destructive" />
      </div>
    );
  }
  if (severity === 'warning') {
    return (
      <div className="w-[22px] h-[22px] rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0 border border-warning/15">
        <AlertTriangle size={10} className="text-warning" />
      </div>
    );
  }
  return (
    <div className="w-[22px] h-[22px] rounded-full bg-muted/30 flex items-center justify-center flex-shrink-0 border border-border/20">
      <CheckCircle size={10} className="text-muted-foreground/40" />
    </div>
  );
}

export default function NocEventsTimeline({ events }: NocEventsTimelineProps) {
  const navigate = useNavigate();
  const critCount = events.filter(e => e.severity === 'critical').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.25 }}
      className="noc-surface"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between">
          <div className="noc-section-head flex-1">
            <Shield size={12} className="text-warning/70" />
            LIVE OPS FEED
            {critCount > 0 && (
              <span className="text-[8px] font-mono px-2 py-0.5 rounded-full bg-destructive/8 text-destructive border border-destructive/15 ml-1.5">
                {critCount} CRIT
              </span>
            )}
          </div>
          <button
            onClick={() => navigate('/events')}
            className="flex items-center gap-1 text-[9px] font-mono text-primary/40 hover:text-primary uppercase tracking-wider transition-colors"
          >
            ALL <ArrowRight size={8} />
          </button>
        </div>
        <div className="noc-divider" />

        <div className="pl-0.5">
          {events.length > 0 ? events.slice(0, 8).map((ev, i) => (
            <motion.div
              key={ev.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.1 + i * 0.03 }}
              className="noc-feed-item"
            >
              <div className="mt-0.5 relative z-10">
                <SeverityIcon severity={ev.severity} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-foreground/80 leading-snug">{ev.message}</p>
                <span className="text-[9px] font-mono text-muted-foreground/35 mt-0.5 block">{safeDateShort(ev.created_at)}</span>
              </div>
            </motion.div>
          )) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <motion.div
                animate={{ scale: [1, 1.08, 1], opacity: [0.12, 0.2, 0.12] }}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Radio size={24} className="text-muted-foreground/15" />
              </motion.div>
              <div className="text-center">
                <p className="text-[11px] text-muted-foreground/30 font-mono">No active incidents</p>
                <p className="text-[9px] text-muted-foreground/18 font-mono mt-1">Telemetry stable</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
