import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  sub?: string;
  visual?: ReactNode;
  accent?: 'mint' | 'violet';
  glow?: boolean;
}

export default function KpiCard({ label, value, sub, visual, accent = 'mint', glow }: Props) {
  const valueLength = typeof value === 'string' ? value.length : 4;
  const sizeClass =
    valueLength > 12 ? 'text-[15px]'
    : valueLength > 8 ? 'text-[18px]'
    : 'text-[28px]';

  return (
    <div className="noc-kpi-card" data-accent={accent}>
      <div className="flex items-start justify-between gap-3 h-full">
        <div className="flex flex-col justify-between min-w-0 flex-1">
          <div className="noc-kpi-label">{label}</div>
          <div className="min-w-0">
            <div className={`font-bold font-mono leading-none tracking-tight text-foreground mt-2 ${sizeClass} ${glow ? (accent === 'violet' ? 'noc-glow-violet' : 'noc-glow-mint') : ''}`}>
              {value}
            </div>
            {sub && <div className="noc-kpi-sub">{sub}</div>}
          </div>
        </div>
        {visual && (
          <div className="flex-shrink-0 self-center opacity-90">
            {visual}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Decorative visuals (SVG mini-charts) ---- */

export function MiniGlobe() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
      <defs>
        <radialGradient id="g1" cx="35%" cy="35%">
          <stop offset="0%" stopColor="hsl(195 90% 60%)" />
          <stop offset="60%" stopColor="hsl(220 80% 35%)" />
          <stop offset="100%" stopColor="hsl(220 50% 8%)" />
        </radialGradient>
      </defs>
      <circle cx="28" cy="28" r="22" fill="url(#g1)" />
      <g style={{ transformOrigin: '28px 28px', animation: 'noc-rotate 16s linear infinite' }}>
        <ellipse cx="28" cy="28" rx="22" ry="8" fill="none" stroke="hsl(var(--primary) / 0.5)" strokeWidth="0.6" />
        <ellipse cx="28" cy="28" rx="14" ry="22" fill="none" stroke="hsl(var(--primary) / 0.4)" strokeWidth="0.6" />
        <ellipse cx="28" cy="28" rx="8" ry="22" fill="none" stroke="hsl(var(--primary) / 0.3)" strokeWidth="0.5" />
      </g>
      <circle cx="28" cy="28" r="22" fill="none" stroke="hsl(var(--primary) / 0.4)" strokeWidth="0.6" />
    </svg>
  );
}

export function MiniBackends() {
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
      <path d="M14 18 Q28 8 42 18 Q28 28 14 18 Z M14 38 Q28 28 42 38 Q28 48 14 38 Z" stroke="hsl(var(--primary))" strokeWidth="1.6" fill="none" style={{ filter: 'drop-shadow(0 0 4px hsl(var(--primary) / 0.6))' }} />
    </svg>
  );
}

export function MiniBars() {
  const bars = [12, 28, 18, 36, 24, 42, 30, 48, 38];
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none">
      {bars.map((h, i) => (
        <rect key={i} x={i * 7 + 1} y={44 - h} width="5" height={h} rx="1"
          fill="hsl(var(--primary) / 0.85)"
          style={{
            transformOrigin: `${i * 7 + 3.5}px 44px`,
            animation: `noc-bar-flicker ${1.4 + (i % 4) * 0.25}s ease-in-out ${i * 0.08}s infinite`,
          }}
        />
      ))}
    </svg>
  );
}

export function MiniDonut({ pct = 81 }: { pct?: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={r} fill="none" stroke="hsl(var(--noc-depth-3))" strokeWidth="6" />
      <circle
        cx="28" cy="28" r={r}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="6"
        strokeDasharray={`${dash} ${c}`}
        strokeLinecap="round"
        transform="rotate(-90 28 28)"
        style={{ filter: 'drop-shadow(0 0 4px hsl(var(--primary) / 0.6))' }}
      />
      <circle cx="28" cy="28" r="3" fill="hsl(var(--primary))"
        style={{ animation: 'noc-pulse 1.8s ease-in-out infinite', transformOrigin: '28px 28px' }} />
    </svg>
  );
}

export function MiniSpark({ accent = 'violet' }: { accent?: 'mint' | 'violet' }) {
  const color = accent === 'violet' ? 'hsl(var(--accent))' : 'hsl(var(--primary))';
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" fill="none">
      <path d="M2 32 L10 28 L18 30 L26 18 L34 22 L42 10 L50 14 L62 6 L62 44 L2 44 Z"
        fill={color} fillOpacity="0.12" />
      <path d="M2 32 L10 28 L18 30 L26 18 L34 22 L42 10 L50 14 L62 6"
        stroke={color} strokeWidth="1.8" fill="none"
        strokeDasharray="4 3"
        style={{ filter: `drop-shadow(0 0 4px ${color})`, animation: 'noc-spark-dash 4s linear infinite' }} />
      <circle r="2" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }}>
        <animateMotion dur="3s" repeatCount="indefinite"
          path="M2 32 L10 28 L18 30 L26 18 L34 22 L42 10 L50 14 L62 6" />
      </circle>
    </svg>
  );
}

export function MiniShield() {
  return (
    <svg width="48" height="56" viewBox="0 0 48 56" fill="none">
      <path d="M24 4 L42 12 V28 C42 40 34 50 24 54 C14 50 6 40 6 28 V12 Z"
        fill="hsl(var(--primary) / 0.18)" stroke="hsl(var(--primary))" strokeWidth="1.6"
        style={{ filter: 'drop-shadow(0 0 6px hsl(var(--primary) / 0.5))' }} />
      <path d="M16 28 L22 34 L34 22" stroke="hsl(var(--primary))" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
