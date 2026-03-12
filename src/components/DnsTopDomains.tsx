import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface TopDomain {
  domain: string;
  queryCount: number;
  queryType: string;
  lastSeen: string;
}

const TOOLTIP_STYLE = { backgroundColor: 'hsl(220 18% 13%)', border: '1px solid hsl(220 15% 20%)', borderRadius: 6, fontSize: 12 };
const GRID_STROKE = 'hsl(220 15% 20%)';

export default function DnsTopDomains({ topDomains }: { topDomains: TopDomain[] }) {
  if (!topDomains.length) return null;
  return (
    <div className="noc-panel">
      <div className="noc-panel-header">Top Domínios Consultados</div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={topDomains} layout="vertical" margin={{ left: 120 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(215 15% 55%)' }} />
          <YAxis dataKey="domain" type="category" tick={{ fontSize: 11, fill: 'hsl(215 15% 55%)' }} width={120} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Bar dataKey="queryCount" fill="hsl(160 70% 45%)" radius={[0, 4, 4, 0]} name="Queries" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
