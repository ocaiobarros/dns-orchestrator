import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface MetricCardData {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  accent?: 'primary' | 'accent' | 'warning' | 'destructive';
  unavailable?: boolean;
  healthState?: string;
}

interface NocMetricStripProps {
  cards: MetricCardData[];
  loading?: boolean;
}

function MetricSkeleton() {
  return (
    <div className="noc-surface">
      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-3">
          <div className="noc-skeleton h-2.5 w-16" />
          <div className="noc-skeleton h-4 w-4 rounded" />
        </div>
        <div className="noc-skeleton h-8 w-20 mb-2" />
        <div className="noc-skeleton h-2 w-14 mt-2" />
      </div>
    </div>
  );
}

function HealthDot({ state }: { state?: string }) {
  if (!state) return null;
  const cls = state === 'healthy' ? 'bg-success' : state === 'degraded' ? 'bg-warning' : state === 'critical' ? 'bg-destructive' : 'bg-muted-foreground/25';
  return <span className={`w-1.5 h-1.5 rounded-full ${cls}`} />;
}

function MetricCard({ label, value, sub, icon, accent = 'primary', unavailable, healthState }: MetricCardData) {
  const [displayed, setDisplayed] = useState(value);
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setFlash(true);
      setDisplayed(value);
      const t = setTimeout(() => setFlash(false), 400);
      return () => clearTimeout(t);
    }
  }, [value]);

  const varMap: Record<string, string> = { primary: '--primary', accent: '--accent', warning: '--warning', destructive: '--destructive' };
  const cssVar = varMap[accent] || '--primary';
  const iconColors: Record<string, string> = { primary: 'text-primary', accent: 'text-accent', warning: 'text-warning', destructive: 'text-destructive' };

  return (
    <div className="noc-surface group">
      {/* Accent top line */}
      <div className="absolute inset-x-0 top-0 h-px z-20"
        style={{ background: `linear-gradient(90deg, transparent, hsl(var(${cssVar}) / 0.2), transparent)` }}
      />

      <div className="noc-surface-body py-4 px-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="noc-label">{label}</span>
            <HealthDot state={healthState} />
          </div>
          <span className={`${iconColors[accent]} opacity-15 group-hover:opacity-40 transition-opacity duration-500`}>
            {icon}
          </span>
        </div>

        <div className={`text-[1.75rem] font-extrabold font-mono leading-none tracking-tighter transition-opacity duration-300 ${flash ? 'opacity-50' : 'opacity-100'} ${unavailable ? 'text-muted-foreground/20 text-[1.5rem]' : 'text-foreground'}`}>
          {unavailable ? '—' : displayed}
        </div>

        {sub && (
          <span className={`text-[9px] font-mono mt-2 block uppercase tracking-wider ${
            unavailable ? 'text-muted-foreground/20'
            : healthState === 'critical' ? 'text-destructive/60'
            : healthState === 'degraded' ? 'text-warning/60'
            : 'text-muted-foreground/35'
          }`}>
            {sub}
          </span>
        )}
      </div>
    </div>
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
          transition={{ duration: 0.4, delay: 0.06 + i * 0.04, ease: [0.16, 1, 0.3, 1] }}
        >
          <MetricCard {...card} />
        </motion.div>
      ))}
    </div>
  );
}
