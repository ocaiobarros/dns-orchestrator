import MetricCard from '@/components/MetricCard';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface NatBackend {
  backend?: string;
  name?: string;
  chain?: string;
  rule?: string;
  packets?: number;
  bytes?: number;
}

function safeNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export default function NatPage() {
  const { data: rawSummary, isLoading, error } = useQuery({
    queryKey: ['nat', 'summary'],
    queryFn: async () => {
      const r = await api.getNftCounters();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
  });

  const { data: rawSticky } = useQuery({
    queryKey: ['nat', 'sticky'],
    queryFn: async () => {
      const r = await api.getStickyTable();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 10000,
  });

  const { data: rawRuleset } = useQuery({
    queryKey: ['nat', 'ruleset'],
    queryFn: async () => {
      const r = await api.getNftRuleset();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={error.message} />;

  // Normalize counters: real backend returns { ruleset_loaded, counters: "" | [] | object }
  const counters: NatBackend[] = (() => {
    if (Array.isArray(rawSummary)) return rawSummary;
    if (rawSummary && typeof rawSummary === 'object') {
      const s = rawSummary as Record<string, unknown>;
      if (Array.isArray(s.counters)) return s.counters;
      if (Array.isArray(s.items)) return s.items;
      if (Array.isArray(s.backends)) return s.backends;
    }
    return [];
  })();

  const rulesetLoaded = rawSummary && typeof rawSummary === 'object' && !Array.isArray(rawSummary)
    ? Boolean((rawSummary as Record<string, unknown>).ruleset_loaded)
    : counters.length > 0;

  const sticky = Array.isArray(rawSticky) ? rawSticky : [];

  const totalPackets = counters.reduce((a, b) => a + safeNum(b.packets), 0);
  const totalBytes = counters.reduce((a, b) => a + safeNum(b.bytes), 0);

  const rulesetText = (() => {
    if (!rawRuleset) return '';
    if (typeof rawRuleset === 'string') return rawRuleset;
    if (typeof rawRuleset === 'object') {
      const r = rawRuleset as Record<string, unknown>;
      return String(r.ruleset ?? r.content ?? r.output ?? '');
    }
    return '';
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">NAT / Balanceamento</h1>
        <p className="text-sm text-muted-foreground">nftables DNAT e distribuição de carga</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Ruleset" value={rulesetLoaded ? 'Carregado' : 'Não carregado'} sub={rulesetLoaded ? 'nftables ativo' : 'nftables inativo'} />
        <MetricCard label="Backends" value={String(counters.length)} sub="Ativos" />
        <MetricCard label="Total Packets" value={totalPackets > 0 ? `${(totalPackets / 1e6).toFixed(1)}M` : '0'} />
        <MetricCard label="Total Bytes" value={totalBytes > 0 ? `${(totalBytes / 1e6).toFixed(0)}MB` : '0'} />
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Distribuição DNAT por Backend</div>
        <div className="overflow-x-auto">
          {counters.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              Nenhum counter DNAT encontrado. O ruleset nftables pode não estar carregado.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Backend</th>
                  <th className="pb-2 font-medium">Chain/Rule</th>
                  <th className="pb-2 font-medium text-right">Packets</th>
                  <th className="pb-2 font-medium text-right">Bytes</th>
                  <th className="pb-2 font-medium text-right">% Tráfego</th>
                  <th className="pb-2 font-medium">Barra</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {counters.map((c, i) => {
                  const pkt = safeNum(c.packets);
                  const byt = safeNum(c.bytes);
                  const pct = totalPackets > 0 ? (pkt / totalPackets) * 100 : 0;
                  return (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="py-2 text-primary">{c.backend || c.name || `backend-${i}`}</td>
                      <td className="py-2 text-muted-foreground">{c.chain || c.rule || '—'}</td>
                      <td className="py-2 text-right">{pkt.toLocaleString()}</td>
                      <td className="py-2 text-right">{(byt / 1e6).toFixed(1)}MB</td>
                      <td className="py-2 text-right">{pct.toFixed(1)}%</td>
                      <td className="py-2 w-32">
                        <div className="h-2 bg-secondary rounded overflow-hidden">
                          <div className="h-full bg-primary rounded" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {sticky.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header">Sticky Table ({sticky.length} entradas)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Source IP</th>
                  <th className="pb-2 font-medium">Backend</th>
                  <th className="pb-2 font-medium text-right">Packets</th>
                  <th className="pb-2 font-medium text-right">Expires</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {sticky.map((s: Record<string, unknown>, i: number) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2">{String(s.sourceIp ?? s.source_ip ?? s.client_ip ?? '—')}</td>
                    <td className="py-2 text-primary">{String(s.backend ?? s.backend_ip ?? '—')}</td>
                    <td className="py-2 text-right">{safeNum(s.packets).toLocaleString()}</td>
                    <td className="py-2 text-right text-muted-foreground">{String(s.expires ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rulesetText && (
        <div className="noc-panel">
          <div className="noc-panel-header">Ruleset nftables</div>
          <pre className="terminal-output max-h-[400px]">{rulesetText}</pre>
        </div>
      )}
    </div>
  );
}
