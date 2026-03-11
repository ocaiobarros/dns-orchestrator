import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useOspfNeighbors, useOspfRoutes } from '@/lib/hooks';
import { generateFrrConf } from '@/lib/config-generator';
import { DEFAULT_CONFIG } from '@/lib/types';

export default function OspfPage() {
  const { data: neighbors, isLoading: nLoading, error: nError } = useOspfNeighbors();
  const { data: routes, isLoading: rLoading } = useOspfRoutes();

  if (nLoading || rLoading) return <LoadingState />;
  if (nError) return <ErrorState message={nError.message} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">OSPF / FRR</h1>
        <p className="text-sm text-muted-foreground">Estado do roteamento dinâmico</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="noc-panel">
          <span className="metric-label">Router ID</span>
          <p className="font-mono mt-1">172.28.22.6</p>
        </div>
        <div className="noc-panel">
          <span className="metric-label">Área OSPF</span>
          <p className="font-mono mt-1">0.0.0.0</p>
        </div>
        <div className="noc-panel">
          <span className="metric-label">Vizinhos</span>
          <p className="font-mono mt-1">{neighbors?.length ?? 0}</p>
        </div>
        <div className="noc-panel">
          <span className="metric-label">FRR Status</span>
          <div className="mt-1"><StatusBadge status="running" /></div>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Vizinhos OSPF</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Neighbor ID</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Dead Time</th>
                <th className="pb-2 font-medium">Address</th>
                <th className="pb-2 font-medium">Interface</th>
                <th className="pb-2 font-medium">Area</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {neighbors?.map((n, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2">{n.neighborId}</td>
                  <td className="py-2 text-success">{n.state}</td>
                  <td className="py-2">{n.deadTime}</td>
                  <td className="py-2">{n.address}</td>
                  <td className="py-2">{n.interfaceName}</td>
                  <td className="py-2 text-muted-foreground">{n.area}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Rotas Redistribuídas ({routes?.length ?? 0})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Prefix</th>
                <th className="pb-2 font-medium">Next Hop</th>
                <th className="pb-2 font-medium">Device</th>
                <th className="pb-2 font-medium text-right">Cost</th>
                <th className="pb-2 font-medium">Type</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {routes?.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2">
                    <span className="status-dot-ok mr-2" />
                    {r.prefix}
                  </td>
                  <td className="py-2 text-muted-foreground">{r.nextHop}</td>
                  <td className="py-2">{r.device}</td>
                  <td className="py-2 text-right">{r.cost}</td>
                  <td className="py-2 text-muted-foreground">{r.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">FRR Running Config (preview)</div>
        <pre className="terminal-output max-h-[400px]">{generateFrrConf(DEFAULT_CONFIG)}</pre>
      </div>
    </div>
  );
}
