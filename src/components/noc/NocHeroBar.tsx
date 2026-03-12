import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Shield, Clock, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNoc } from '@/lib/noc-context';
import { safeDateShort } from '@/lib/types';

const POLL_INTERVAL = 10;

interface NocHeroBarProps {
  allHealthy: boolean;
  failedCount: number;
  totalInstances: number;
  healthyCount: number;
  onReconcile: () => void;
  reconciling: boolean;
  dnsAvailable?: boolean;
  dnsStatus?: string;
  lastEvent?: any;
  activeIncidents?: number;
}

export default function NocHeroBar({
  allHealthy, failedCount, totalInstances, healthyCount,
  onReconcile, reconciling, dnsAvailable, dnsStatus, lastEvent, activeIncidents = 0,
}: NocHeroBarProps) {
  const [now, setNow] = useState(new Date());
  const [showMenu, setShowMenu] = useState(false);
  const [countdown, setCountdown] = useState(POLL_INTERVAL);
  const countdownRef = useRef(POLL_INTERVAL);
  const navigate = useNavigate();
  const { fullscreen, toggleFullscreen } = useNoc();

  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      countdownRef.current -= 1;
      if (countdownRef.current <= 0) countdownRef.current = POLL_INTERVAL;
      setCountdown(countdownRef.current);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (reconciling) {
      countdownRef.current = POLL_INTERVAL;
      setCountdown(POLL_INTERVAL);
    }
  }, [reconciling]);

  const isCritical = failedCount > 0 && failedCount >= totalInstances;
  const isDegraded = failedCount > 0 && !isCritical;
  const hasIncidents = activeIncidents > 0;

  const statusText = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : hasIncidents ? 'INCIDENT' : 'OPERATIONAL';
  const statusSub = isCritical ? 'All resolvers down'
    : isDegraded ? `${failedCount} resolver${failedCount > 1 ? 's' : ''} failed`
    : hasIncidents ? `${activeIncidents} active incident${activeIncidents > 1 ? 's' : ''}`
    : 'All systems nominal';

  const heroClass = isCritical || hasIncidents ? 'noc-hero-crit' : isDegraded ? 'noc-hero-warn' : 'noc-hero-ok';
  const accentColor = isCritical || hasIncidents ? 'hsl(0, 76%, 50%)' : isDegraded ? 'hsl(38, 95%, 50%)' : 'hsl(152, 76%, 40%)';
  const dotBg = isCritical || hasIncidents ? 'bg-destructive' : isDegraded ? 'bg-warning' : 'bg-success';
  const pillClass = isCritical || hasIncidents
    ? 'bg-destructive/12 text-destructive border-destructive/20'
    : isDegraded
    ? 'bg-warning/12 text-warning border-warning/20'
    : 'bg-success/12 text-success border-success/20';

  const progressPct = ((POLL_INTERVAL - countdown) / POLL_INTERVAL) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`noc-hero ${heroClass} relative`}
    >
      {/* Auto-refresh countdown bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] z-20">
        <div
          className="h-full transition-[width] duration-1000 ease-linear"
          style={{
            background: accentColor.replace(')', ' / 0.3)'),
            width: `${progressPct}%`,
          }}
        />
      </div>

      <div className="relative z-10 px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Left: Status cluster */}
          <div className="flex items-center gap-4">
            <div className="relative">
              <motion.div
                className={`noc-pulse ${dotBg}`}
                animate={isCritical ? { scale: [1, 1.3, 1] } : { scale: [1, 1.1, 1] }}
                transition={{ duration: isCritical ? 1.5 : 3, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <motion.span
                  key={statusText}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono font-extrabold tracking-wider border ${pillClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />
                  {statusText}
                </motion.span>
                <span className="text-[11px] text-muted-foreground/40 font-mono hidden sm:inline">
                  {statusSub}
                </span>
              </div>

              {/* Last meaningful event */}
              {lastEvent && (
                <div className="text-[9px] font-mono text-muted-foreground/25 hidden md:block">
                  Last: {lastEvent.message?.substring(0, 60)}{lastEvent.message?.length > 60 ? '…' : ''} — {safeDateShort(lastEvent.created_at)}
                </div>
              )}
            </div>
          </div>

          {/* Right: Metadata + Actions */}
          <div className="flex items-center gap-3 lg:gap-5">
            {/* Countdown */}
            <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-muted-foreground/30 font-mono" title="Next refresh">
              <RefreshCw size={8} className="opacity-50" />
              <span className="tabular-nums text-foreground/40 text-[10px]">{countdown}s</span>
            </div>

            <div className="hidden md:flex items-center gap-4 text-[9px] text-muted-foreground/40 uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <Shield size={9} />
                <span className="font-mono font-bold text-foreground/70 text-[11px]">{healthyCount}/{totalInstances}</span>
              </div>
              <div className="w-px h-4 bg-border/30" />
              <div className="flex items-center gap-1.5">
                <Clock size={9} />
                <span className="font-mono tabular-nums text-foreground/60 text-[11px]">
                  {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>

            <button onClick={onReconcile} disabled={reconciling} className="noc-btn-action">
              <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
              Reconcile
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg text-muted-foreground/30 hover:text-foreground/60 hover:bg-secondary/30 transition-colors"
              title={fullscreen ? 'Exit NOC mode' : 'NOC fullscreen'}
            >
              {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="p-2 rounded-lg border-0 outline-none bg-transparent text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/30 transition-colors"
              >
                <ChevronDown size={14} className={showMenu ? 'rotate-180 transition-transform' : 'transition-transform'} />
              </button>
              <AnimatePresence>
                {showMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 z-50 min-w-[160px] rounded-lg border border-border/40 bg-card overflow-hidden"
                  >
                    {[
                      { label: 'Diagnostics', path: '/troubleshoot' },
                      { label: 'Wizard', path: '/wizard' },
                      { label: 'Files', path: '/files' },
                    ].map(a => (
                      <button
                        key={a.label}
                        onClick={() => { navigate(a.path); setShowMenu(false); }}
                        className="block w-full text-left px-4 py-2.5 text-[11px] font-mono text-muted-foreground/60 hover:text-foreground hover:bg-secondary/40 transition-colors"
                      >
                        {a.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
