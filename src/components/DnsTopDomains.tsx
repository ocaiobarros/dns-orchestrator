import { useMemo, useState } from 'react';

interface TopDomain {
  domain: string;
  queryCount?: number;
  count?: number;
  queries?: number;
  queryType?: string;
  qtype?: string;
  lastSeen?: string;
}

function getCount(d: TopDomain): number {
  return d.queryCount ?? d.count ?? d.queries ?? 0;
}

function getDomain(d: TopDomain): string {
  return (d.domain || '').replace(/\.$/, '') || '—';
}

const BAR_H = 26;
const PAD_LEFT = 130;
const W = 500;

export default function DnsTopDomains({ topDomains }: { topDomains: TopDomain[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const safeList = Array.isArray(topDomains) ? topDomains : [];
  const maxVal = useMemo(() => Math.max(...safeList.map(d => getCount(d)), 1), [safeList]);
  const totalH = safeList.length * BAR_H + 8;

  if (!safeList.length) return null;

  return (
    <div className="noc-panel">
      <div className="noc-panel-header">Top Domínios Consultados</div>
      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${totalH}`} className="w-full h-auto">
          {safeList.map((d, i) => {
            const cnt = getCount(d);
            const barW = ((cnt / maxVal) * (W - PAD_LEFT - 20));
            const y = i * BAR_H + 4;
            const isHov = hovered === i;
            const label = getDomain(d);
            return (
              <g key={label + i} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                <text x={PAD_LEFT - 6} y={y + BAR_H / 2} textAnchor="end" dominantBaseline="middle"
                  fill="hsl(215 15% 55%)" fontSize="10" fontFamily="monospace">
                  {label.length > 22 ? label.slice(0, 20) + '…' : label}
                </text>
                <rect x={PAD_LEFT} y={y + 2} width={Math.max(barW, 2)} height={BAR_H - 6} rx={3}
                  fill={isHov ? 'hsl(160 70% 55%)' : 'hsl(160 70% 45%)'} opacity={isHov ? 1 : 0.85}
                  className="transition-all duration-150" />
                <text x={PAD_LEFT + barW + 6} y={y + BAR_H / 2} dominantBaseline="middle"
                  fill="hsl(215 15% 65%)" fontSize="9" fontFamily="monospace">
                  {cnt.toLocaleString()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
