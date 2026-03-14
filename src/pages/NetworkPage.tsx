import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useInterfaces, useRoutes, useReachability } from '@/lib/hooks';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getIfaceState, getIfaceIpv4, getIfaceIpv6, getIfaceMac } from '@/lib/types';
import { RefreshCw, CheckCircle2, XCircle, Radio } from 'lucide-react';

function formatTraffic(bytes: number | undefined | null): string {
  if (bytes == null || isNaN(bytes)) return '—';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(2)} Gbps`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)} Mbps`;
  if (bytes > 1e3) return `${(bytes / 1e3).toFixed(0)} Kbps`;
  return `${bytes} B`;
}

export default function NetworkPage() {
  const { data: interfaces, isLoading: ifLoading, error: ifError } = useInterfaces();
  const { data: routes, isLoading: rtLoading } = useRoutes();
  const reachability = useReachability();

  // DNS listeners
  const { data: listeners } = useQuery({
    queryKey: ['network', 'listeners'],
    queryFn: async () => {
      const res = await fetch(
        `${(import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')}/api/network/listeners`,
        { headers: { 'Authorization': `Bearer ${localStorage.getItem('dns-control-token') || ''}` } }
      );
      if (!res.ok) return [];
      return res.json();
    },
    refetchInterval: 15000,
  });

  if (ifLoading || rtLoading) return <LoadingState />;
  if (ifError) return <ErrorState message={ifError.message} />;

  const ifaceList = Array.isArray(interfaces) ? interfaces : [];
  const routeList = Array.isArray(routes) ? routes : [];
  const reachabilityList = Array.isArray(reachability.data) ? reachability.data : [];
  const listenerList = Array.isArray(listeners) ? listeners : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Rede</h1>
        <p className="text-sm text-muted-foreground">Interfaces, endereços, listeners DNS e rotas reais do host</p>
      </div>

      {/* DNS Listeners */}
      {listenerList.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header flex items-center gap-2">
            <Radio size={14} /> Listeners DNS (Porta 53)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            {listenerList.map((l: any) => (
              <div key={l.ip} className="flex items-center gap-2 p-2 rounded bg-secondary border border-border">
                {l.resolving ? <CheckCircle2 size={14} className="text-success shrink-0" /> : <XCircle size={14} className="text-destructive shrink-0" />}
                <div className="min-w-0">
                  <span className="text-xs font-mono block truncate">{l.ip}:{l.port}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {l.resolving ? `Resolvendo → ${l.resolved_ip}` : l.error || 'Sem resposta'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interfaces */}
      <div className="noc-panel">
        <div className="noc-panel-header">Interfaces</div>
        {ifaceList.length === 0 ? <EmptyState title="Nenhuma interface encontrada" /> : (
          <div className="space-y-4">
            {ifaceList.map((iface: any) => {
              const state = iface.state || iface.status || getIfaceState(iface);
              const ipv4List = iface.ipv4Addresses || getIfaceIpv4(iface);
              const ipv6List = iface.ipv6Addresses || getIfaceIpv6(iface);
              const mac = iface.mac || getIfaceMac(iface);
              const hasTraffic = iface.rxBytes != null || iface.txBytes != null;
              const ifType = iface.type || '';

              return (
                <div key={iface.name} className="border-b border-border last:border-0 pb-3 last:pb-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <span className="font-mono font-medium">{iface.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      state === 'UP' || state === 'up' ? 'bg-success/15 text-success border-success/30' : 'bg-destructive/15 text-destructive border-destructive/30'
                    }`}>{state}</span>
                    {ifType && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{ifType}</span>}
                    {iface.mtu != null && <span className="text-xs text-muted-foreground">MTU {iface.mtu}</span>}
                    {mac && mac !== '00:00:00:00:00:00' && <span className="text-xs text-muted-foreground font-mono">{mac}</span>}
                    {hasTraffic && (
                      <span className="text-xs text-muted-foreground ml-auto">↓{formatTraffic(iface.rxBytes)} ↑{formatTraffic(iface.txBytes)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ipv4List.map((ip: string) => (
                      <span key={ip} className="text-xs font-mono px-2 py-0.5 rounded bg-secondary text-secondary-foreground">{ip}</span>
                    ))}
                    {ipv6List.filter(Boolean).map((ip: string) => (
                      <span key={ip} className="text-xs font-mono px-2 py-0.5 rounded bg-accent/15 text-accent">{ip}</span>
                    ))}
                    {ipv4List.length === 0 && ipv6List.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">Sem endereço IP</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Routes */}
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
              {routeList.map((r: any, i: number) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="py-2">{r.destination ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.via || r.gateway || '—'}</td>
                  <td className="py-2">{r.device ?? r.interface ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.protocol ?? '—'}</td>
                  <td className="py-2 text-muted-foreground">{r.scope ?? '—'}</td>
                  <td className="py-2 text-right text-muted-foreground">{r.metric ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reachability */}
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
          {reachabilityList.map((target: any) => (
            <div key={target.target} className="flex items-center gap-2 p-2 rounded bg-secondary border border-border">
              <span className={target.reachable ? 'status-dot-ok' : 'status-dot-error'} />
              <div className="min-w-0">
                <span className="text-xs font-mono block truncate">{target.target}</span>
                <span className="text-xs text-muted-foreground">
                  {target.label ?? '—'} {typeof target.latencyMs === 'number' ? `${target.latencyMs}ms` : ''}
                </span>
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
