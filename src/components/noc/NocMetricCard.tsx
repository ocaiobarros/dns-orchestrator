import { useEffect, useRef, useState } from 'react';

interface NocMetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  trend?: 'up' | 'down' | 'flat';
  accent?: 'primary' | 'accent' | 'warning' | 'destructive';
}

export default function NocMetricCard({ label, value, sub, icon, accent = 'primary' }: NocMetricCardProps) {
  const [displayed, setDisplayed] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setDisplayed(value);
    }
  }, [value]);

  const glowColor: Record<string, string> = {
    primary: 'from-primary/5 to-transparent',
    accent: 'from-accent/5 to-transparent',
    warning: 'from-warning/5 to-transparent',
    destructive: 'from-destructive/5 to-transparent',
  };

  const iconColor: Record<string, string> = {
    primary: 'text-primary',
    accent: 'text-accent',
    warning: 'text-warning',
    destructive: 'text-destructive',
  };

  return (
    <div className="noc-card group animate-slide-in-up">
      <div className={`noc-card-glow bg-gradient-to-br ${glowColor[accent]}`} />
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <span className="noc-metric-label">{label}</span>
          <span className={`${iconColor[accent]} opacity-60 group-hover:opacity-100 transition-opacity`}>{icon}</span>
        </div>
        <div className="noc-metric-xl animate-count-up" key={String(displayed)}>
          {displayed}
        </div>
        {sub && <div className="noc-metric-sub mt-1">{sub}</div>}
      </div>
    </div>
  );
}
