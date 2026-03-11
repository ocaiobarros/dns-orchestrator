import MetricCard from '@/components/MetricCard';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useNftCounters, useStickyTable } from '@/lib/hooks';
import { generateNftablesConf } from '@/lib/config-generator';
import { DEFAULT_CONFIG } from '@/lib/types';

export default function NatPage() {
  const { data: counters, isLoading, error } = useNftCounters();
  const { data: sticky } = useStickyTable();

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  const totalPackets = counters?.reduce((a, b) => a + b.packets, 0) ?? 0;
  const totalBytes = counters?.reduce((a, b) => a + b.bytes, 0) ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">NAT / Balanceamento</h1>
        <p className="text-sm text-muted-foreground">nftables DNAT e distribuição de carga</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="VIP Entrada" value="4.2.2.5" sub=":53 UDP/TCP" />
        <MetricCard label="Backends" value={String(counters?.length ?? 0)} sub="Ativos" />
        <MetricCard label="Total Packets" value={`${(totalPackets / 1e6).toFixed(1)}M`} />
        <MetricCard label="Total Bytes" value={`${(totalBytes / 1e6).toFixed(0)}MB`} />
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Distribuição DNAT por Backend</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Backend</th>
                <th className="pb-2 font-medium">Chain</th>
                <th className="pb-2 font-medium text-right">Packets</th>
                <th className="pb-2 font-medium text-right">Bytes</th>
                <th className="pb-2 font-medium text-right">% Tráfego</th>
                <th className="pb-2 font-medium">Barra</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {counters?.map((c, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2 text-primary">{c.backend}</td>
                  <td className="py-2 text-muted-foreground">{c.chain}</td>
                  <td className="py-2 text-right">{c.packets.toLocaleString()}</td>
                  <td className="py-2 text-right">{(c.bytes / 1e6).toFixed(1)}MB</td>
                  <td className="py-2 text-right">{totalPackets > 0 ? ((c.packets / totalPackets) * 100).toFixed(1) : 0}%</td>
                  <td className="py-2 w-32">
                    <div className="h-2 bg-secondary rounded overflow-hidden">
                      <div className="h-full bg-primary rounded" style={{ width: `${totalPackets > 0 ? (c.packets / totalPackets) * 100 : 0}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sticky && sticky.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Sticky Table ({sticky.length} entradas)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Source IP</th>
                  <th className="pb-2 font-medium">Backend</th>
                  <th className="pb-2 font-medium text-right">Packets</th>
                  <th className="pb-2 font-medium text-right">Expires (s)</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {sticky.map((s, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2">{s.sourceIp}</td>
                    <td className="py-2 text-primary">{s.backend}</td>
                    <td className="py-2 text-right">{s.packets}</td>
                    <td className="py-2 text-right text-muted-foreground">{s.expires}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="noc-panel">
        <div className="noc-panel-header">Ruleset nftables (preview)</div>
        <pre className="terminal-output max-h-[400px]">{generateNftablesConf(DEFAULT_CONFIG)}</pre>
      </div>
    </div>
  );
}
