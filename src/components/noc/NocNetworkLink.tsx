import { motion } from 'framer-motion';

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
  if (latency == null) return 'hsl(var(--muted-foreground))';
  if (latency < 30) return 'hsl(152, 76%, 45%)';
  if (latency < 100) return 'hsl(38, 95%, 50%)';
  return 'hsl(0, 76%, 50%)';
}

export default function NocNetworkLink({
  x1, y1, x2, y2, latency, qps, maxQps, fromStatus, toStatus, highlighted, index,
}: Props) {
  const isFailed = fromStatus === 'failed' || toStatus === 'failed';
  const isDegraded = fromStatus === 'degraded' || toStatus === 'degraded';
  const color = isFailed ? 'hsl(0, 76%, 50%)' : latencyColor(latency);

  // Normalize stroke width: 2–10px
  const strokeW = Math.max(2, Math.min(10, 2 + (qps / maxQps) * 8));

  // Curve control point
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  // Add slight curve
  const offsetX = (index % 2 === 0 ? 1 : -1) * 30;
  const cx = mx + offsetX;
  const cy = my;

  const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  // Number of flow particles based on QPS
  const particleCount = isFailed ? 0 : Math.max(1, Math.min(5, Math.ceil((qps / maxQps) * 5)));
  const particleSpeed = isDegraded ? 6 : 3;

  // Badge position
  const bx = mx + offsetX * 0.5;
  const by = my - 12;

  return (
    <g>
      {/* Shadow path */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeW + 4}
        strokeOpacity={0.06}
        strokeLinecap="round"
      />

      {/* Main path */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={highlighted ? strokeW + 1 : strokeW}
        strokeOpacity={isFailed ? 0.25 : highlighted ? 0.6 : 0.35}
        strokeLinecap="round"
        strokeDasharray={isDegraded ? '8 6' : isFailed ? '4 8' : 'none'}
      />

      {/* Glow overlay */}
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeW * 0.5}
        strokeOpacity={highlighted ? 0.3 : 0.12}
        strokeLinecap="round"
        style={{ filter: 'blur(3px)' }}
      />

      {/* Animated flow particles */}
      {!isFailed && Array.from({ length: particleCount }).map((_, pi) => {
        const delay = (pi / particleCount) * particleSpeed;
        return (
          <motion.circle
            key={pi}
            r={isDegraded ? 2 : 2.5}
            fill={color}
            fillOpacity={0.9}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }}
          >
            <animateMotion
              dur={`${particleSpeed}s`}
              repeatCount="indefinite"
              begin={`${delay}s`}
              path={pathD}
            />
          </motion.circle>
        );
      })}

      {/* Latency badge */}
      {latency != null && (
        <g>
          <rect
            x={bx - 20}
            y={by - 8}
            width={40}
            height={16}
            rx={4}
            fill="hsl(var(--card))"
            fillOpacity={0.9}
            stroke={color}
            strokeWidth={0.5}
            strokeOpacity={0.3}
          />
          <text
            x={bx}
            y={by + 1}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={color}
            fontSize="8"
            fontWeight="700"
            fontFamily="'JetBrains Mono', monospace"
          >
            {latency}ms
          </text>
        </g>
      )}

      {/* QPS badge */}
      {qps > 0 && (
        <g>
          <text
            x={bx}
            y={by + 18}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="hsl(var(--foreground))"
            fillOpacity={0.3}
            fontSize="7"
            fontFamily="'JetBrains Mono', monospace"
          >
            {qps >= 1000 ? `${(qps / 1000).toFixed(0)}k` : qps} qps
          </text>
        </g>
      )}
    </g>
  );
}
