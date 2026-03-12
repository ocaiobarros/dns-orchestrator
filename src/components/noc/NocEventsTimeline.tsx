import { XCircle, AlertTriangle, CheckCircle, Bell, ArrowRight } from 'lucide-react';
import { safeDateShort } from '@/lib/types';
import { useNavigate } from 'react-router-dom';

interface NocEventsTimelineProps {
  events: any[];
}

export default function NocEventsTimeline({ events }: NocEventsTimelineProps) {
  const navigate = useNavigate();
  const criticalCount = events.filter(e => e.severity === 'critical').length;

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="flex items-center justify-between">
          <div className="noc-section-title flex-1">
            <Bell size={12} className="text-warning" />
            SYSTEM EVENTS
            {criticalCount > 0 && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm bg-destructive/15 text-destructive border border-destructive/20 normal-case tracking-normal">
                {criticalCount} CRITICAL
              </span>
            )}
          </div>
          <button
            onClick={() => navigate('/events')}
            className="flex items-center gap-1 text-[10px] font-mono text-primary/70 hover:text-primary uppercase tracking-wider transition-colors"
          >
            ALL EVENTS <ArrowRight size={10} />
          </button>
        </div>

        <div className="mt-3 pl-1">
          {events.length > 0 ? events.slice(0, 8).map((ev, i) => (
            <div key={ev.id} className="noc-event-row animate-slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="mt-0.5 relative z-10 flex-shrink-0">
                {ev.severity === 'critical' ? (
                  <div className="w-4 h-4 rounded-full bg-destructive/20 flex items-center justify-center">
                    <XCircle size={10} className="text-destructive" />
                  </div>
                ) : ev.severity === 'warning' ? (
                  <div className="w-4 h-4 rounded-full bg-warning/20 flex items-center justify-center">
                    <AlertTriangle size={10} className="text-warning" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center">
                    <CheckCircle size={10} className="text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-foreground leading-snug">{ev.message}</p>
                <span className="noc-event-time">{safeDateShort(ev.created_at)}</span>
              </div>
            </div>
          )) : (
            <p className="text-xs text-muted-foreground py-6 text-center font-mono">NO RECENT EVENTS</p>
          )}
        </div>
      </div>
    </div>
  );
}
