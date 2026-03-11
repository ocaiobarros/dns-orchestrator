export default function NetworkPage() {
  const interfaces = [
    { name: 'enp6s18', ips: ['172.28.22.6/30'], status: 'UP', type: 'Physical' },
    { name: 'lo0', ips: ['4.2.2.5/32', '100.126.255.101/32', '100.126.255.102/32', '100.126.255.103/32', '100.126.255.104/32', '45.232.215.16/32', '45.232.215.17/32', '45.232.215.18/32', '45.232.215.19/32'], status: 'UP', type: 'Dummy' },
    { name: 'lo', ips: ['127.0.0.1/8'], status: 'UP', type: 'Loopback' },
  ];

  const routes = [
    { dest: 'default', via: '172.28.22.5', dev: 'enp6s18', proto: 'static' },
    { dest: '172.28.22.4/30', via: '-', dev: 'enp6s18', proto: 'kernel' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Rede</h1>
        <p className="text-sm text-muted-foreground">Interfaces, endereços e rotas</p>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Interfaces</div>
        <div className="space-y-4">
          {interfaces.map(iface => (
            <div key={iface.name} className="border-b border-border last:border-0 pb-3 last:pb-0">
              <div className="flex items-center gap-3 mb-1">
                <span className="font-mono font-medium">{iface.name}</span>
                <span className="text-xs px-1.5 py-0.5 rounded bg-success/15 text-success border border-success/30">{iface.status}</span>
                <span className="text-xs text-muted-foreground">{iface.type}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {iface.ips.map(ip => (
                  <span key={ip} className="text-xs font-mono px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{ip}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Tabela de Rotas</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2 font-medium">Destino</th>
              <th className="pb-2 font-medium">Via</th>
              <th className="pb-2 font-medium">Dev</th>
              <th className="pb-2 font-medium">Proto</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {routes.map((r, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2">{r.dest}</td>
                <td className="py-2">{r.via}</td>
                <td className="py-2">{r.dev}</td>
                <td className="py-2 text-muted-foreground">{r.proto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Diagnóstico de Conectividade</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {['172.28.22.5 (GW)', '8.8.8.8', '1.1.1.1', '4.2.2.5 (VIP)'].map(target => (
            <div key={target} className="flex items-center gap-2 p-2 rounded bg-secondary border border-border">
              <span className="status-dot-ok" />
              <span className="text-xs font-mono">{target}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
