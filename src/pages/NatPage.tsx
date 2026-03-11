import { mockNftCounters } from '@/lib/mock-data';
import MetricCard from '@/components/MetricCard';

export default function NatPage() {
  const totalPackets = mockNftCounters.reduce((a, b) => a + b.packets, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">NAT / Balanceamento</h1>
        <p className="text-sm text-muted-foreground">nftables DNAT e distribuição de carga</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="VIP Entrada" value="4.2.2.5" sub=":53 UDP/TCP" />
        <MetricCard label="Backends" value="4" sub="Todos ativos" />
        <MetricCard label="Total Packets" value={(totalPackets / 1e6).toFixed(1) + 'M'} />
        <MetricCard label="Modo" value="Round-Robin" sub="Sticky 300s" />
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Distribuição DNAT por Backend</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="pb-2 font-medium">Chain</th>
              <th className="pb-2 font-medium">Regra</th>
              <th className="pb-2 font-medium text-right">Packets</th>
              <th className="pb-2 font-medium text-right">Bytes</th>
              <th className="pb-2 font-medium text-right">% Tráfego</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {mockNftCounters.map((c, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                <td className="py-2 text-muted-foreground">{c.chain}</td>
                <td className="py-2">{c.rule}</td>
                <td className="py-2 text-right">{c.packets.toLocaleString()}</td>
                <td className="py-2 text-right">{(c.bytes / 1e6).toFixed(1)}MB</td>
                <td className="py-2 text-right text-primary">{((c.packets / totalPackets) * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Ruleset nftables (resumo)</div>
        <pre className="terminal-output">{`table ip nat {
  chain prerouting {
    type nat hook prerouting priority -100; policy accept;
    ip daddr 4.2.2.5 udp dport 53 numgen inc mod 4 map {
      0 : dnat to 100.126.255.101,
      1 : dnat to 100.126.255.102,
      2 : dnat to 100.126.255.103,
      3 : dnat to 100.126.255.104
    }
    ip daddr 4.2.2.5 tcp dport 53 numgen inc mod 4 map {
      0 : dnat to 100.126.255.101,
      1 : dnat to 100.126.255.102,
      2 : dnat to 100.126.255.103,
      3 : dnat to 100.126.255.104
    }
  }
  chain postrouting {
    type nat hook postrouting priority 100; policy accept;
    masquerade
  }
}`}</pre>
      </div>
    </div>
  );
}
