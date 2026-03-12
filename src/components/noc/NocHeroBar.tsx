import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Shield, Clock, ChevronDown, Activity, Maximize2, Minimize2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNoc } from '@/lib/noc-context';

const POLL_INTERVAL = 10; // seconds — matches the main query refetchInterval

interface NocHeroBarProps {
  allHealthy: boolean;
  failedCount: number;
  totalInstances: number;
  healthyCount: number;
  onReconcile: () => void;
  reconciling: boolean;
}

function RadarSweep({ color }: { color: string }) {
  return (
    <div className="absolute right-8 top-1/2 -translate-y-1/2 w-[120px] h-[120px] opacity-[0.07] hidden lg:block">
      <svg viewBox="0 0 120 120" className="w-full h-full">
        {[20, 35, 50].map(r => (
          <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="0.5" opacity="0.5" />
        ))}
        <g style={{ transformOrigin: '60px 60px', animation: 'noc-radar 4s linear infinite' }}>
          <defs>
            <linearGradient id="sweep-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0" />
              <stop offset="100%" stopColor={color} stopOpacity="0.6" />
            </linearGradient>
          </defs>
          <path d={`M60,60 L60,10 A50,50 0 0,1 ${60 + 50 * Math.sin(Math.PI / 6)},${60 - 50 * Math.cos(Math.PI / 6)} Z`}
                fill="url(#sweep-grad)" />
        </g>
        <circle cx="60" cy="60" r="2" fill={color} />
      </svg>
    </div>
  );
}

export default function NocHeroBar({
  allHealthy, failedCount, totalInstances, healthyCount,
  onReconcile, reconciling,
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

  // Reset countdown when reconciliation triggers a refetch
  useEffect(() => {
    if (reconciling) {
      countdownRef.current = POLL_INTERVAL;
      setCountdown(POLL_INTERVAL);
    }
  }, [reconciling]);

  const isCritical = failedCount > 0 && failedCount >= totalInstances;
  const isDegraded = failedCount > 0 && !isCritical;

  const statusText = isCritical ? 'CRITICAL' : isDegraded ? 'DEGRADED' : 'OPERATIONAL';
  const statusSub = isCritical ? 'All resolvers down' : isDegraded ? `${failedCount} resolver${failedCount > 1 ? 's' : ''} failed` : 'All systems nominal';
  const heroClass = isCritical ? 'noc-hero-crit' : isDegraded ? 'noc-hero-warn' : 'noc-hero-ok';
  const accentColor = isCritical ? 'hsl(0, 76%, 50%)' : isDegraded ? 'hsl(38, 95%, 50%)' : 'hsl(152, 76%, 40%)';
  const dotBg = isCritical ? 'bg-destructive' : isDegraded ? 'bg-warning' : 'bg-success';
  const pillClass = isCritical
    ? 'bg-destructive/12 text-destructive border-destructive/20'
    : isDegraded
    ? 'bg-warning/12 text-warning border-warning/20'
    : 'bg-success/12 text-success border-success/20';

  const progressPct = ((POLL_INTERVAL - countdown) / POLL_INTERVAL) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className={`noc-hero ${heroClass} relative`}
    >
      {/* Auto-refresh countdown bar */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] z-20">
        <motion.div
          className="h-full"
          style={{
            background: accentColor.replace(')', ' / 0.35)'),
            width: `${progressPct}%`,
          }}
          animate={{ width: `${progressPct}%` }}
          transition={{ duration: 0.8, ease: 'linear' }}
        />
      </div>

      {/* Sweep light */}
      <div className="absolute inset-0 z-[2] pointer-events-none overflow-hidden">
        <div className="w-1/4 h-full" style={{
          background: `linear-gradient(90deg, transparent, ${accentColor.replace(')', ' / 0.03)')}, transparent)`,
          animation: 'noc-sweep 8s ease-in-out infinite',
        }} />
      </div>

      <RadarSweep color={accentColor} />

      <div className="relative z-10 px-6 py-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Left: Status cluster */}
          <div className="flex items-center gap-5">
            <div className="relative">
              <motion.div
                className={`noc-pulse ${dotBg}`}
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Activity size={10} className="text-muted-foreground/40" />
                <span className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted-foreground/40">
                  DNS CONTROL
                </span>
              </div>

              <div className="flex items-center gap-3">
                <motion.span
                  key={statusText}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[11px] font-mono font-extrabold tracking-wider border ${pillClass}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dotBg}`} />
                  {statusText}
                </motion.span>
                <span className="text-[11px] text-muted-foreground/35 font-mono hidden sm:inline">
                  {statusSub}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Metadata + Actions */}
          <div className="flex items-center gap-4 lg:gap-6">
            {/* Countdown chip */}
            <div className="hidden sm:flex items-center gap-1.5 text-[9px] text-muted-foreground/30 font-mono uppercase tracking-wider" title="Next data refresh">
              <RefreshCw size={8} className="opacity-50" />
              <span className="tabular-nums text-foreground/40 text-[10px]">{countdown}s</span>
            </div>

            <div className="hidden md:flex items-center gap-5 text-[9px] text-muted-foreground/40 uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <Shield size={9} />
                <span className="font-mono font-bold text-foreground/70 text-[11px]">{healthyCount}/{totalInstances}</span>
                <span>resolvers</span>
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

            {/* Fullscreen toggle */}
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
                className="p-2 rounded-lg text-muted-foreground/30 hover:text-foreground/60 hover:bg-secondary/30 transition-colors"
              >
                <ChevronDown size={14} />
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
