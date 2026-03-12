import { useMemo, useState, useCallback, useRef } from 'react';
import { safeNum } from '@/lib/svg-utils';

interface ChartDataPoint {
  time: string;
  qps: number;
  latency: number;
  servfail: number;
  nxdomain: number;
  hitRatio: number;
}

/* ── Lightweight SVG area chart ── */

interface AreaChartProps {
  data: ChartDataPoint[];
  dataKey: keyof ChartDataPoint;
  stroke: string;
  fill: string;
  yDomain?: [number, number];
  label: string;
  secondaryKey?: keyof ChartDataPoint;
  secondaryStroke?: string;
  secondaryFill?: string;
  secondaryLabel?: string;
}

const W = 460;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function formatTick(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(1);
}

function MiniAreaChart({ data, dataKey, stroke, fill, yDomain, label, secondaryKey, secondaryStroke, secondaryFill, secondaryLabel }: AreaChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; idx: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { path: pathD, areaD, yTicks, secondPath, secondArea, maxY } = useMemo(() => {
    if (!data.length) return { path: '', areaD: '', yTicks: [] as number[], secondPath: '', secondArea: '', maxY: 0 };
    const vals = data.map(d => Number(d[dataKey]) || 0);
    const vals2 = secondaryKey ? data.map(d => Number(d[secondaryKey]) || 0) : [];
    const allVals = [...vals, ...vals2];
    const minY = yDomain?.[0] ?? 0;
    let maxYVal = yDomain?.[1] ?? Math.max(...allVals, 1);
    if (maxYVal === minY) maxYVal = minY + 1;

    const xStep = data.length > 1 ? INNER_W / (data.length - 1) : INNER_W;
    const scaleY = (v: number) => PAD.top + INNER_H - ((v - minY) / (maxYVal - minY)) * INNER_H;

    const pts = vals.map((v, i) => `${PAD.left + i * xStep},${scaleY(v)}`);
    const pathStr = 'M' + pts.join('L');
    const areaStr = pathStr + `L${PAD.left + (data.length - 1) * xStep},${PAD.top + INNER_H}L${PAD.left},${PAD.top + INNER_H}Z`;

    let secondPathStr = '';
    let secondAreaStr = '';
    if (secondaryKey && vals2.length) {
      const pts2 = vals2.map((v, i) => `${PAD.left + i * xStep},${scaleY(v)}`);
      secondPathStr = 'M' + pts2.join('L');
      secondAreaStr = secondPathStr + `L${PAD.left + (data.length - 1) * xStep},${PAD.top + INNER_H}L${PAD.left},${PAD.top + INNER_H}Z`;
    }

    const tickCount = 4;
    const ticks: number[] = [];
    for (let i = 0; i <= tickCount; i++) ticks.push(minY + (maxYVal - minY) * (i / tickCount));

    return { path: pathStr, areaD: areaStr, yTicks: ticks, secondPath: secondPathStr, secondArea: secondAreaStr, maxY: maxYVal };
  }, [data, dataKey, yDomain, secondaryKey]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !data.length) return;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((x - PAD.left) / INNER_W) * (data.length - 1));
    if (idx >= 0 && idx < data.length) setTooltip({ x, idx });
  }, [data]);

  const xStep = data.length > 1 ? INNER_W / (data.length - 1) : INNER_W;
  const xLabels = useMemo(() => {
    if (!data.length) return [];
    const step = Math.max(1, Math.floor(data.length / 6));
    return data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d, _, arr) => ({
      label: d.time,
      x: PAD.left + data.indexOf(d) * xStep,
    }));
  }, [data, xStep]);

  if (!data.length) return null;

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      {/* grid lines */}
      {useMemo(() => (yDomain ? [0, maxY] : []).length, [yDomain, maxY]) !== -1 &&
        Array.from({ length: 5 }).map((_, i) => {
          const y = PAD.top + (INNER_H / 4) * i;
          return <line key={i} x1={PAD.left} x2={PAD.left + INNER_W} y1={y} y2={y} stroke="hsl(220 15% 20%)" strokeDasharray="3 3" />;
        })}

      {/* Y axis ticks */}
      {useMemo(() => {
        const yScale = (v: number) => PAD.top + INNER_H - ((v - (yDomain?.[0] ?? 0)) / (maxY - (yDomain?.[0] ?? 0))) * INNER_H;
        return (
          <>
            {[0, 1, 2, 3, 4].map(i => {
              const val = (yDomain?.[0] ?? 0) + (maxY - (yDomain?.[0] ?? 0)) * (i / 4);
              return (
                <text key={i} x={PAD.left - 6} y={yScale(val)} textAnchor="end" dominantBaseline="middle"
                  fill="hsl(215 15% 55%)" fontSize="9" fontFamily="monospace">
                  {formatTick(val)}
                </text>
              );
            })}
          </>
        );
      }, [maxY, yDomain])}

      {/* X axis labels */}
      {xLabels.map(({ label: l, x }) => (
        <text key={l} x={x} y={H - 4} textAnchor="middle" fill="hsl(215 15% 55%)" fontSize="9" fontFamily="monospace">{l}</text>
      ))}

      {/* secondary area */}
      {secondArea && <>
        <path d={secondArea} fill={secondaryFill} />
        <path d={secondPath} fill="none" stroke={secondaryStroke} strokeWidth={1.5} />
      </>}

      {/* primary area */}
      <path d={areaD} fill={fill} />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth={1.5} />

      {/* tooltip */}
      {tooltip && tooltip.idx >= 0 && tooltip.idx < data.length && (() => {
        const d = data[tooltip.idx];
        const cx = safeNum(PAD.left + tooltip.idx * xStep, PAD.left);
        const val = Number(d[dataKey]) || 0;
        const range = (maxY - (yDomain?.[0] ?? 0)) || 1;
        const cy = safeNum(PAD.top + INNER_H - ((val - (yDomain?.[0] ?? 0)) / range) * INNER_H, PAD.top);
        return (
          <>
            <line x1={cx} x2={cx} y1={PAD.top} y2={PAD.top + INNER_H} stroke="hsl(215 15% 40%)" strokeWidth={0.5} />
            <circle cx={cx} cy={cy} r={3} fill={stroke} />
            <rect x={cx + 6} y={cy - 28} width={110} height={secondaryKey ? 38 : 24} rx={4}
              fill="hsl(220 18% 13%)" stroke="hsl(220 15% 20%)" />
            <text x={cx + 12} y={cy - 14} fill="hsl(215 15% 75%)" fontSize="9" fontFamily="monospace">
              {label}: {val.toLocaleString()}
            </text>
            {secondaryKey && (
              <text x={cx + 12} y={cy} fill="hsl(215 15% 75%)" fontSize="9" fontFamily="monospace">
                {secondaryLabel}: {(Number(d[secondaryKey]) || 0).toLocaleString()}
              </text>
            )}
            <text x={cx + 12} y={cy + (secondaryKey ? 12 : -2)} fill="hsl(215 15% 55%)" fontSize="8" fontFamily="monospace">
              {d.time}
            </text>
          </>
        );
      })()}
    </svg>
  );
}

/* ── Exported component ── */

export default function DnsTimeSeriesCharts({ chartData }: { chartData: ChartDataPoint[] }) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="noc-panel">
          <div className="noc-panel-header">QPS ao Longo do Tempo</div>
          <div className="p-3">
            <MiniAreaChart data={chartData} dataKey="qps" stroke="hsl(160 70% 45%)" fill="hsl(160 70% 45% / 0.15)" label="QPS" />
          </div>
        </div>
        <div className="noc-panel">
          <div className="noc-panel-header">Latência (ms)</div>
          <div className="p-3">
            <MiniAreaChart data={chartData} dataKey="latency" stroke="hsl(38 92% 50%)" fill="hsl(38 92% 50% / 0.15)" label="Latência" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="noc-panel">
          <div className="noc-panel-header">Cache Hit Ratio (%)</div>
          <div className="p-3">
            <MiniAreaChart data={chartData} dataKey="hitRatio" stroke="hsl(200 80% 55%)" fill="hsl(200 80% 55% / 0.15)" yDomain={[0, 100]} label="Hit Ratio" />
          </div>
        </div>
        <div className="noc-panel">
          <div className="noc-panel-header">Erros (SERVFAIL + NXDOMAIN)</div>
          <div className="p-3">
            <MiniAreaChart data={chartData} dataKey="servfail" stroke="hsl(0 70% 50%)" fill="hsl(0 70% 50% / 0.15)" label="SERVFAIL"
              secondaryKey="nxdomain" secondaryStroke="hsl(280 65% 60%)" secondaryFill="hsl(280 65% 60% / 0.15)" secondaryLabel="NXDOMAIN" />
          </div>
        </div>
      </div>
    </>
  );
}
