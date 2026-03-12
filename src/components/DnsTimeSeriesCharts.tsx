import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface ChartDataPoint {
  time: string;
  qps: number;
  latency: number;
  servfail: number;
  nxdomain: number;
  hitRatio: number;
}

const TOOLTIP_STYLE = { backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 };
const GRID_STROKE = 'hsl(220 15% 20%)';
const TICK_STYLE = { fontSize: 10, fill: 'hsl(215 15% 55%)' };

export default function DnsTimeSeriesCharts({ chartData }: { chartData: ChartDataPoint[] }) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="noc-panel">
          <div className="noc-panel-header">QPS ao Longo do Tempo</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="time" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="qps" stroke="hsl(160 70% 45%)" fill="hsl(160 70% 45% / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="noc-panel">
          <div className="noc-panel-header">Latência (ms)</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="time" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="latency" stroke="hsl(38 92% 50%)" fill="hsl(38 92% 50% / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="noc-panel">
          <div className="noc-panel-header">Cache Hit Ratio (%)</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="time" tick={TICK_STYLE} />
              <YAxis domain={[0, 100]} tick={TICK_STYLE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="hitRatio" stroke="hsl(200 80% 55%)" fill="hsl(200 80% 55% / 0.15)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="noc-panel">
          <div className="noc-panel-header">Erros (SERVFAIL + NXDOMAIN)</div>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="time" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="servfail" stroke="hsl(0 70% 50%)" fill="hsl(0 70% 50% / 0.15)" name="SERVFAIL" />
              <Area type="monotone" dataKey="nxdomain" stroke="hsl(280 65% 60%)" fill="hsl(280 65% 60% / 0.15)" name="NXDOMAIN" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
