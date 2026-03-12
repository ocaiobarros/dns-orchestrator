import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface ChartDataPoint {
  ts: string;
  time: string;
  qps: number;
  hits: number;
  misses: number;
  latency: number;
  servfail: number;
  nxdomain: number;
  hitRatio: number;
  count: number;
}

interface TopDomain {
  domain: string;
  queryCount: number;
  queryType: string;
  lastSeen: string;
}

const TOOLTIP_STYLE = { backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 };
const GRID_STROKE = 'hsl(220 15% 20%)';
const TICK_STYLE = { fontSize: 10, fill: 'hsl(215 15% 55%)' };

export default function DnsCharts({ chartData, topDomains }: { chartData: ChartDataPoint[]; topDomains?: TopDomain[] }) {
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

      {Array.isArray(topDomains) && topDomains.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Top Domínios Consultados</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topDomains} layout="vertical" margin={{ left: 120 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis type="number" tick={TICK_STYLE} />
              <YAxis dataKey="domain" type="category" tick={{ fontSize: 11, fill: 'hsl(215 15% 55%)' }} width={120} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Bar dataKey="queryCount" fill="hsl(160 70% 45%)" radius={[0, 4, 4, 0]} name="Queries" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
