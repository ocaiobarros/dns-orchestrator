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
    <div className="noc-surface">
      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-4">
          <div className="noc-skeleton h-2.5 w-16" />
          <div className="noc-skeleton h-5 w-5 rounded" />
        </div>
        <div className="noc-skeleton h-9 w-24 mb-2" />
        <div className="noc-skeleton h-2 w-14 mt-3" />
      </div>
    </div>
  );
}

function MiniSparkline({ accent }: { accent: string }) {
  const varMap: Record<string, string> = { primary: '--primary', accent: '--accent', warning: '--warning', destructive: '--destructive' };
  const color = `hsl(var(${varMap[accent] || '--primary'}) / 0.3)`;
  // Decorative micro-sparkline
  const points = '0,8 4,6 8,7 12,3 16,5 20,2 24,4 28,1 32,3 36,2';
  return (
    <svg width="36" height="10" viewBox="0 0 36 10" className="noc-sparkline mt-2 opacity-50" style={{ color }}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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

  const varMap: Record<string, string> = { primary: '--primary', accent: '--accent', warning: '--warning', destructive: '--destructive' };
  const cssVar = varMap[accent] || '--primary';
  const iconColors: Record<string, string> = { primary: 'text-primary', accent: 'text-accent', warning: 'text-warning', destructive: 'text-destructive' };

  return (
    <div className="noc-surface group">
      {/* Accent top line */}
      <div className="absolute inset-x-0 top-0 h-px z-20"
        style={{ background: `linear-gradient(90deg, transparent, hsl(var(${cssVar}) / 0.25), transparent)` }}
      />
      {/* Hover radial glow */}
      <div className="noc-hover-glow"
        style={{ background: `radial-gradient(ellipse at 50% 0%, hsl(var(${cssVar}) / 0.06) 0%, transparent 65%)` }}
      />

      <div className="noc-surface-body">
        <div className="flex items-center justify-between mb-4">
          <span className="noc-label">{label}</span>
          <motion.span
            className={`${iconColors[accent]} opacity-20 group-hover:opacity-60 transition-opacity duration-500`}
            animate={{ y: [0, -3, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          >
            {icon}
          </motion.span>
        </div>

        <div className={`noc-display transition-all duration-300 ${flash ? 'opacity-50' : 'opacity-100'} ${unavailable ? 'text-muted-foreground/20 text-[1.8rem]' : ''}`}>
          {unavailable ? '—' : displayed}
        </div>

        <div className="flex items-center justify-between mt-2">
          {sub && (
            <span className={`noc-sublabel ${unavailable ? 'text-muted-foreground/20' : ''}`}>
              {sub}
            </span>
          )}
          {!unavailable && <MiniSparkline accent={accent} />}
        </div>
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
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
        >
          <MetricCard {...card} />
        </motion.div>
      ))}
    </div>
  );
}
