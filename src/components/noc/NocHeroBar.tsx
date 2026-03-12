import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Radio, Shield, Clock, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface NocHeroBarProps {
  allHealthy: boolean;
  failedCount: number;
  totalInstances: number;
  healthyCount: number;
  onReconcile: () => void;
  reconciling: boolean;
}

export default function NocHeroBar({
  allHealthy, failedCount, totalInstances, healthyCount,
  onReconcile, reconciling,
}: NocHeroBarProps) {
  const [now, setNow] = useState(new Date());
  const [showActions, setShowActions] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const isCritical = failedCount > 0 && failedCount >= totalInstances;
  const isDegraded = failedCount > 0 && !isCritical;

  const statusLabel = isCritical
    ? 'CRITICAL'
    : isDegraded
    ? 'DEGRADED'
    : 'OPERATIONAL';

  const statusDetail = isCritical
    ? 'All resolvers down'
    : isDegraded
    ? `${failedCount} resolver${failedCount > 1 ? 's' : ''} failed`
    : 'All systems nominal';

  const heroClass = isCritical
    ? 'noc-hero-critical'
    : isDegraded
    ? 'noc-hero-degraded'
    : 'noc-hero-operational';

  const dotColor = isCritical ? 'bg-destructive' : isDegraded ? 'bg-warning' : 'bg-success';
  const pillBg = isCritical ? 'bg-destructive/15 text-destructive border-destructive/25' : isDegraded ? 'bg-warning/15 text-warning border-warning/25' : 'bg-success/15 text-success border-success/25';

  const secondaryActions = [
    { label: 'Diagnostics', path: '/troubleshoot' },
    { label: 'Wizard', path: '/wizard' },
    { label: 'Gen Files', path: '/files' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`noc-hero ${heroClass}`}
    >
      {/* Scanning glow */}
      <div className="noc-scan-line" />

      <div className="relative z-10 px-5 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Left: brand + status */}
          <div className="flex items-center gap-5">
            {/* Status dot with ping */}
            <div className="relative">
              <motion.div
                className={`noc-status-dot ${dotColor}`}
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>

            <div>
              <div className="flex items-center gap-2.5 mb-1">
                <Radio size={11} className="text-muted-foreground/60" />
                <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground/60">
                  DNS CONTROL
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Operational pill */}
                <motion.span
                  key={statusLabel}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold tracking-wider border ${pillBg}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                  {statusLabel}
                </motion.span>
                <span className="text-[11px] text-muted-foreground/50 font-mono hidden sm:inline">
                  {statusDetail}
                </span>
              </div>
            </div>
          </div>

          {/* Right: metadata + actions */}
          <div className="flex items-center gap-5">
            {/* Telemetry metadata */}
            <div className="hidden md:flex items-center gap-4 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
              <div className="flex items-center gap-1.5">
                <Shield size={10} />
                <span className="font-mono font-bold text-foreground/80">{healthyCount}/{totalInstances}</span>
                <span>resolvers</span>
              </div>
              <div className="w-px h-4 bg-border/40" />
              <div className="flex items-center gap-1.5">
                <Clock size={10} />
                <span className="font-mono tabular-nums text-foreground/70">
                  {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Reconcile */}
            <button
              onClick={onReconcile}
              disabled={reconciling}
              className="noc-btn-reconcile"
            >
              <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
              Reconcile
            </button>

            {/* Secondary actions dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowActions(!showActions)}
                className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <ChevronDown size={14} />
              </button>
              <AnimatePresence>
                {showActions && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border border-border/50 overflow-hidden"
                    style={{ background: 'hsl(222 24% 10%)' }}
                  >
                    {secondaryActions.map(a => (
                      <button
                        key={a.label}
                        onClick={() => { navigate(a.path); setShowActions(false); }}
                        className="block w-full text-left px-4 py-2.5 text-[11px] font-mono text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
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
