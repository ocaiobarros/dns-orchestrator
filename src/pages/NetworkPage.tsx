import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useInterfaces, useRoutes, useReachability } from '@/lib/hooks';
import { getIfaceState, getIfaceIpv4, getIfaceIpv6, getIfaceMac } from '@/lib/types';
import { RefreshCw } from 'lucide-react';

function formatTraffic(bytes: number | undefined | null): string {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${(bytes / 1e3).toFixed(0)}KB`;
}

export default function NetworkPage() {
  const { data: interfaces, isLoading: ifLoading, error: ifError } = useInterfaces();
  const { data: routes, isLoading: rtLoading } = useRoutes();
  const reachability = useReachability();

  if (ifLoading || rtLoading) return <LoadingState />;
  if (ifError) return <ErrorState message={ifError.message} />;

  const ifaceList = Array.isArray(interfaces) ? interfaces : [];
  const routeList = Array.isArray(routes) ? routes : [];
  const reachabilityList = Array.isArray(reachability.data) ? reachability.data : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Rede</h1>
        <p className="text-sm text-muted-foreground">Interfaces, endereços e rotas</p>
      </div>
      <div className="noc-panel">
        <div className="noc-panel-header">Interfaces</div>
        {ifaceList.length === 0 ? <EmptyState title="Nenhuma interface encontrada" /> : (
          <div className="space-y-4">
            {ifaceList.map(iface => {
              const state = getIfaceState(iface);
              const ipv4List = getIfaceIpv4(iface);
              const ipv6List = getIfaceIpv6(iface);
              const mac = getIfaceMac(iface);
              const hasTraffic = iface.rxBytes != null || iface.txBytes != null;

              return (
                <div key={iface.name} className="border-b border-border last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-mono font-medium">{iface.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      state === 'UP' ? 'bg-success/15 text-success border-success/30' : 'bg-destructive/15 text-destructive border-destructive/30'
                    }`}>{state}</span>
                    {iface.type && <span className="text-xs text-muted-foreground">{iface.type}</span>}
                    {iface.mtu != null && <span className="text-xs text-muted-foreground">MTU {iface.mtu}</span>}
                    {mac && <span className="text-xs text-muted-foreground font-mono">{mac}</span>}
                    {hasTraffic && (
                      <span className="text-xs text-muted-foreground ml-auto">↓{formatTraffic(iface.rxBytes)} ↑{formatTraffic(iface.txBytes)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ipv4List.map(ip => (
                      <span key={ip} className="text-xs font-mono px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{ip}</span>
                    ))}
                    {ipv6List.filter(Boolean).map(ip => (
                      <span key={ip} className="text-xs font-mono px-2 py-0.5 rounded bg-accent/15 text-accent">{ip}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Tabela de Rotas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Destino</th>
                <th className="pb-2 font-medium">Via</th>
                <th className="pb-2 font-medium">Dev</th>
                <th className="pb-2 font-medium">Proto</th>
                <th className="pb-2 font-medium">Scope</th>
                <th className="pb-2 font-medium text-right">Metric</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {routeList.map((r, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2">{r.destination ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.via || '—'}</td>
                  <td className="py-2">{r.device ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.protocol ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.scope ?? '—'}</td>
                  <td className="py-2 text-right text-muted-foreground">{r.metric ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="noc-panel">
        <div className="flex items-center justify-between mb-3">
          <span className="noc-panel-header mb-0">Diagnóstico de Conectividade</span>
          <button
            onClick={() => reachability.mutate()}
            disabled={reachability.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-50"
          >
            <RefreshCw size={12} className={reachability.isPending ? 'animate-spin' : ''} /> Testar
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {reachabilityList.map(target => (
            <div key={target.target} className="flex items-center gap-2 p-2 rounded bg-secondary border border-border">
              <span className={target.reachable ? 'status-dot-ok' : 'status-dot-error'} />
              <div className="min-w-0">
                <span className="text-xs font-mono block truncate">{target.target}</span>
                <span className="text-xs text-muted-foreground">{target.label} {target.latencyMs !== null ? `${target.latencyMs}ms` : ''}</span>
              </div>
            </div>
          ))}
          {reachabilityList.length === 0 && (
            <p className="text-xs text-muted-foreground col-span-full">Clique em "Testar" para verificar conectividade</p>
          )}
        </div>
      </div>
    </div>
  );
}
