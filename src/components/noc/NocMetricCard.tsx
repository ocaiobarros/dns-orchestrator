import { useEffect, useRef, useState } from 'react';

interface NocMetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  accent?: 'primary' | 'accent' | 'warning' | 'destructive';
}

export default function NocMetricCard({ label, value, sub, icon, accent = 'primary' }: NocMetricCardProps) {
  const [displayed, setDisplayed] = useState(value);
  const [flash, setFlash] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current !== value) {
      prevRef.current = value;
      setFlash(true);
      setDisplayed(value);
      const t = setTimeout(() => setFlash(false), 600);
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
    <div className="noc-card group animate-slide-in-up">
      {/* Subtle top accent line */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, hsl(var(${accentVar[accent]}) / 0.4), transparent)` }}
      />

      {/* Hover glow */}
      <div
        className="noc-card-glow"
        style={{ background: `radial-gradient(ellipse at 50% 0%, hsl(var(${accentVar[accent]}) / 0.06) 0%, transparent 70%)` }}
      />

      <div className="noc-card-body">
        <div className="flex items-center justify-between mb-3">
          <span className="noc-metric-label">{label}</span>
          <span className={`${iconColor[accent]} opacity-40 group-hover:opacity-80 transition-opacity duration-500`}>
            {icon}
          </span>
        </div>

        <div
          className={`noc-metric-xl transition-all duration-300 ${flash ? 'scale-105 opacity-80' : 'scale-100 opacity-100'}`}
          key={String(displayed)}
        >
          {displayed}
        </div>

        {sub && <div className="noc-metric-sub mt-1.5">{sub}</div>}
      </div>
    </div>
  );
}
