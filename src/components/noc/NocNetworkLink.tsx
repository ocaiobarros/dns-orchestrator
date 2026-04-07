import { motion } from 'framer-motion';
import { safeNum, safeR, safeSW } from '@/lib/svg-utils';

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  latency?: number;
  qps: number;
  maxQps: number;
  fromStatus: string;
  toStatus: string;
  highlighted: boolean;
  index: number;
}

function latencyColor(latency?: number): string {
  if (latency == null || !Number.isFinite(latency)) return 'hsl(var(--muted-foreground))';
  if (latency < 30) return 'hsl(152, 76%, 45%)';
  if (latency < 100) return 'hsl(38, 95%, 50%)';
  return 'hsl(0, 76%, 50%)';
}

export default function NocNetworkLink({
  x1, y1, x2, y2, latency, qps, maxQps, fromStatus, toStatus, highlighted, index,
}: Props) {
  const sx1 = safeNum(x1), sy1 = safeNum(y1), sx2 = safeNum(x2), sy2 = safeNum(y2);
  const sQps = safeNum(qps, 0);
  const sMaxQps = Math.max(safeNum(maxQps, 1), 1);

  const isFailed = fromStatus === 'failed' || toStatus === 'failed';
  const isDegraded = fromStatus === 'degraded' || toStatus === 'degraded';
  const color = isFailed ? 'hsl(0, 76%, 50%)' : latencyColor(latency);

  // Normalize stroke width: 2–10px
  const strokeW = safeSW(2 + (sQps / sMaxQps) * 8, 2);

  // Curve control point
  const mx = (sx1 + sx2) / 2;
  const my = (sy1 + sy2) / 2;
  const offsetX = (index % 2 === 0 ? 1 : -1) * 30;
  const cx = mx + offsetX;
  const cy = my;

  const pathD = `M ${sx1} ${sy1} Q ${cx} ${cy} ${sx2} ${sy2}`;

  const particleCount = isFailed ? 0 : Math.max(1, Math.min(5, Math.ceil((sQps / sMaxQps) * 5)));
  const particleSpeed = isDegraded ? 6 : 3;

  const bx = mx + offsetX * 0.5;
  const by = my - 12;

  return (
    <g>
      {/* Shadow path */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={strokeW + 4} strokeOpacity={0.06} strokeLinecap="round" />

      {/* Main path */}
      <path d={pathD} fill="none" stroke={color}
        strokeWidth={highlighted ? strokeW + 1 : strokeW}
        strokeOpacity={isFailed ? 0.25 : highlighted ? 0.6 : 0.35}
        strokeLinecap="round"
        strokeDasharray={isDegraded ? '8 6' : isFailed ? '4 8' : 'none'}
      />

      {/* Glow overlay */}
      <path d={pathD} fill="none" stroke={color}
        strokeWidth={safeSW(strokeW * 0.5, 1)}
        strokeOpacity={highlighted ? 0.3 : 0.12}
        strokeLinecap="round" style={{ filter: 'blur(3px)' }}
      />

      {/* Animated flow particles */}
      {!isFailed && Array.from({ length: particleCount }).map((_, pi) => {
        const delay = (pi / particleCount) * particleSpeed;
        return (
          <motion.circle
            key={pi}
            initial={{ r: safeR(isDegraded ? 2 : 2.5, 2) }}
            animate={{ r: safeR(isDegraded ? 2 : 2.5, 2) }}
            fill={color}
            fillOpacity={0.9}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          >
            <animateMotion dur={`${particleSpeed}s`} repeatCount="indefinite" begin={`${delay}s`} path={pathD} />
          </motion.circle>
        );
      })}

      {/* Latency badge */}
      {latency != null && Number.isFinite(latency) && (
        <g opacity={highlighted ? 1 : 0.7}>
          <rect x={bx - 18} y={by - 7} width={36} height={14} rx={3}
            fill="hsl(var(--card))" fillOpacity={0.9} stroke={color} strokeWidth={0.5} strokeOpacity={0.3} />
          <text x={bx} y={by + 1} textAnchor="middle" dominantBaseline="middle"
            fill={color} fontSize="7" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
            {latency}ms
          </text>
        </g>
      )}
    </g>
  );
}
