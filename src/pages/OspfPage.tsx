import StatusBadge from '@/components/StatusBadge';
import { mockOspfNeighbors } from '@/lib/mock-data';

export default function OspfPage() {
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
          <p className="font-mono mt-1">{mockOspfNeighbors.length}</p>
        </div>
        <div className="noc-panel">
          <span className="metric-label">FRR Status</span>
          <div className="mt-1"><StatusBadge status="running" /></div>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Vizinhos OSPF</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2 font-medium">Neighbor ID</th>
              <th className="pb-2 font-medium">State</th>
              <th className="pb-2 font-medium">Dead Time</th>
              <th className="pb-2 font-medium">Address</th>
              <th className="pb-2 font-medium">Interface</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {mockOspfNeighbors.map((n, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2">{n.neighborId}</td>
                <td className="py-2 text-success">{n.state}</td>
                <td className="py-2">{n.deadTime}</td>
                <td className="py-2">{n.address}</td>
                <td className="py-2">{n.interface}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Rotas Redistribuídas (Connected)</div>
        <div className="space-y-1 font-mono text-sm">
          {['4.2.2.5/32', '100.126.255.101/32', '100.126.255.102/32', '100.126.255.103/32', '100.126.255.104/32',
            '45.232.215.16/32', '45.232.215.17/32', '45.232.215.18/32', '45.232.215.19/32'
          ].map(route => (
            <div key={route} className="flex items-center gap-2 py-1 border-b border-border last:border-0">
              <span className="status-dot-ok" />
              <span>{route}</span>
              <span className="text-muted-foreground ml-auto">via lo0, connected</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">FRR Running Config (resumo)</div>
        <pre className="terminal-output">{`frr version 10.2
frr defaults traditional
hostname dns-rec-01
!
router ospf
 ospf router-id 172.28.22.6
 redistribute connected
 network 172.28.22.4/30 area 0.0.0.0
!
interface lo0
 ip ospf area 0.0.0.0
 ip ospf network point-to-point
!
interface enp6s18
 ip ospf area 0.0.0.0
 ip ospf network point-to-point
 ip ospf cost 10
!`}</pre>
      </div>
    </div>
  );
}
