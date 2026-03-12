import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface MetricCardData {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  accent?: 'primary' | 'accent' | 'warning' | 'destructive';
  unavailable?: boolean;
}

interface NocMetricStripProps {
  cards: MetricCardData[];
  loading?: boolean;
}

function MetricSkeleton() {
  return (
    <div className="noc-glass">
      <div className="noc-glass-body">
        <div className="flex items-center justify-between mb-3">
          <div className="noc-skeleton h-3 w-16" />
          <div className="noc-skeleton h-5 w-5 rounded" />
        </div>
        <div className="noc-skeleton h-8 w-20 mb-2" />
        <div className="noc-skeleton h-2.5 w-14" />
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon, accent = 'primary', unavailable }: MetricCardData) {
  const [displayed, setDisplayed] = useState(value);
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setFlash(true);
      setDisplayed(value);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
  }, [value]);

  const accentVar: Record<string, string> = {
    primary: '--primary',
    accent: '--accent',
    warning: '--warning',
    destructive: '--destructive',
  };

  const iconColor: Record<string, string> = {
    primary: 'text-primary',
    accent: 'text-accent',
    warning: 'text-warning',
    destructive: 'text-destructive',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="noc-glass group"
    >
      {/* Top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, hsl(var(${accentVar[accent]}) / 0.3), transparent)` }}
      />

      {/* Hover glow */}
      <div
        className="noc-glass-glow"
        style={{ background: `radial-gradient(ellipse at 50% 0%, hsl(var(${accentVar[accent]}) / 0.05) 0%, transparent 70%)` }}
      />

      <div className="noc-glass-body">
        <div className="flex items-center justify-between mb-3">
          <span className="noc-metric-label">{label}</span>
          <motion.span
            className={`${iconColor[accent]} opacity-30 group-hover:opacity-70 transition-opacity duration-500`}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          >
            {icon}
          </motion.span>
        </div>

        <div className={`noc-metric-xl transition-all duration-300 ${flash ? 'opacity-60' : 'opacity-100'} ${unavailable ? 'text-muted-foreground/30' : ''}`}>
          {unavailable ? '—' : displayed}
        </div>

        {sub && (
          <div className={`noc-metric-sub mt-2 ${unavailable ? 'text-muted-foreground/30' : ''}`}>
            {sub}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function NocMetricStrip({ cards, loading }: NocMetricStripProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <MetricSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card, i) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
        >
          <MetricCard {...card} />
        </motion.div>
      ))}
    </div>
  );
}
