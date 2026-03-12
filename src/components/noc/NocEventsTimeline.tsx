import { CheckCircle, XCircle, AlertTriangle, Bell } from 'lucide-react';
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
      <div className="flex items-center justify-between mb-3">
        <div className="noc-section-title">
          <Bell size={12} />
          Eventos Recentes
          {criticalCount > 0 && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-destructive/10 text-destructive normal-case tracking-normal">
              {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={() => navigate('/events')} className="text-[10px] text-primary hover:underline uppercase tracking-wider">
          Ver todos →
        </button>
      </div>

      <div>
        {events.length > 0 ? events.slice(0, 6).map((ev, i) => (
          <div key={ev.id} className="noc-event-row animate-slide-in-up" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="mt-0.5">
              {ev.severity === 'critical' ? <XCircle size={12} className="text-destructive" /> :
               ev.severity === 'warning' ? <AlertTriangle size={12} className="text-warning" /> :
               <CheckCircle size={12} className="text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground truncate">{ev.message}</p>
              <span className="noc-event-time">{safeDateShort(ev.created_at)}</span>
            </div>
          </div>
        )) : (
          <p className="text-xs text-muted-foreground py-4 text-center">Nenhum evento recente</p>
        )}
      </div>
    </div>
  );
}
