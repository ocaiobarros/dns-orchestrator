import { useNavigate } from 'react-router-dom';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { useInterfaces, useRoutes, useReachability } from '@/lib/hooks';
import { useQuery } from '@tanstack/react-query';
import { api, type ServerTimeMetadata } from '@/lib/api';
import { getIfaceState, getIfaceIpv4, getIfaceIpv6, getIfaceMac } from '@/lib/types';
import {
  CheckCircle2, XCircle, Radio, Network, Star, Wifi, Route as RouteIcon,
  Activity, FileText,
} from 'lucide-react';
import {
  DEFAULT_SERVER_TIME_META,
  formatServerDateTime,
} from '@/lib/server-time';

/* ============================================================
   Helpers
   ============================================================ */
function formatBpsValue(bytes: number | undefined | null): string {
  if (bytes == null || isNaN(bytes)) return '0 bps';
  const bits = bytes * 8;
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbps`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbps`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(0)} Kbps`;
  return `${bits.toFixed(0)} bps`;
}

function MiniSpark({ active, color }: { active: boolean; color: string }) {
  if (!active) {
    return (
      <svg viewBox="0 0 80 16" className="w-full h-4 opacity-25" preserveAspectRatio="none">
        <path d="M0 8 L80 8" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 2" fill="none" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 16" className="w-full h-4" preserveAspectRatio="none">
      <path
        d="M0 10 L8 8 L16 11 L24 6 L32 9 L40 4 L48 7 L56 5 L64 8 L72 6 L80 9"
        stroke={color}
        strokeWidth="1.2"
        fill="none"
        style={{ filter: `drop-shadow(0 0 3px ${color})` }}
      />
    </svg>
  );
}

/* ============================================================
   Panel — print-style (matches Dashboard / DnsPage)
   ============================================================ */
function Panel({
  title, icon, action, children, accentHsl = '162 72% 51%',
}: {
  title: string; icon?: React.ReactNode; action?: React.ReactNode;
  children: React.ReactNode; accentHsl?: string;
}) {
  const colorAlpha = (a: number) => `hsl(${accentHsl} / ${a})`;
  return (
    <div className="relative rounded-xl overflow-hidden min-w-0"
      style={{
        background: 'linear-gradient(160deg, hsl(220 42% 8%), hsl(220 50% 4%))',
        border: `1px solid ${colorAlpha(0.22)}`,
        boxShadow: `0 0 28px -12px ${colorAlpha(0.30)}`,
      }}
    >
      <div className="absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${colorAlpha(0.7)}, transparent)` }} />
      <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 border-t-2 border-l-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 border-t-2 border-r-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-1.5 left-1.5 w-2.5 h-2.5 border-b-2 border-l-2" style={{ borderColor: colorAlpha(0.55) }} />
      <span className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 border-b-2 border-r-2" style={{ borderColor: colorAlpha(0.55) }} />

      <div className="px-5 pt-4 pb-3 flex items-center gap-2">
        {icon && <span style={{ color: `hsl(${accentHsl})` }}>{icon}</span>}
        <span className="text-[11px] font-mono font-bold uppercase tracking-[0.16em] text-muted-foreground/90">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </div>
  );
}

/* ============================================================
   DNS Listener card
   ============================================================ */
function ListenerCard({ l, timeMeta }: { l: any; timeMeta: ServerTimeMetadata }) {
  const ok = !!l.resolving;
  const accent = ok ? '162 72% 51%' : '0 75% 60%';
  const colorAlpha = (a: number) => `hsl(${accent} / ${a})`;
  const ip = l.ip ?? '—';
  const port = l.port ?? 53;
  const resolved = l.resolved_ip ?? l.resolvedIp ?? '—';
  const latency = l.latency_ms ?? l.latencyMs;
  const result = l.result ?? l.rcode ?? (ok ? 'NOERROR' : (l.error ?? 'ERROR'));
  const checkedAt = l.checked_at ?? l.checkedAt ?? l.timestamp;
  const checkLabel = checkedAt
    ? formatServerDateTime(checkedAt, timeMeta, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <div
      className="relative rounded-lg p-4 transition-all hover:translate-y-[-1px]"
      style={{
        background: 'linear-gradient(160deg, hsl(220 38% 10%), hsl(220 45% 6%))',
        border: `1px solid ${colorAlpha(0.28)}`,
        boxShadow: `0 0 20px -10px ${colorAlpha(0.4)}`,
      }}
    >
      <div className="flex items-center gap-2">
        {ok
          ? <CheckCircle2 size={16} style={{ color: `hsl(${accent})`, filter: `drop-shadow(0 0 6px ${colorAlpha(0.7)})` }} />
          : <XCircle size={16} style={{ color: `hsl(${accent})` }} />}
        <span
          className="text-[10px] font-mono font-bold uppercase tracking-widest"
          style={{ color: `hsl(${accent})` }}
        >
          {ok ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="mt-2 font-mono text-base font-semibold tabular-nums text-foreground/95">
        {ip}:{port}
      </div>
      <div className="mt-1 text-[11px] font-mono text-muted-foreground">
        Resolvendo <span style={{ color: `hsl(${accent})` }}>→</span>{' '}
        <span className="text-foreground/80">{resolved}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">Latência</div>
          <div className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground/90">
            {typeof latency === 'number' ? `${latency} ms` : '—'}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">Resultado</div>
          <div className="mt-0.5 font-mono text-[12px] font-bold" style={{ color: ok ? `hsl(${accent})` : 'hsl(0 75% 65%)' }}>
            {result}
          </div>
        </div>
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70">Último check</div>
          <div className="mt-0.5 font-mono text-[12px] tabular-nums text-foreground/90">
            {checkLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Page
   ============================================================ */
export default function NetworkPage() {
  const navigate = useNavigate();
  const { data: interfaces, isLoading: ifLoading, error: ifError } = useInterfaces();
  const { data: routes, isLoading: rtLoading } = useRoutes();
  const reachability = useReachability();

  // Server time metadata
  const { data: serverTimeMeta } = useQuery<ServerTimeMetadata>({
    queryKey: ['system', 'time'],
    queryFn: async () => {
      const r = await api.getSystemTime();
      if (!r.success) throw new Error(r.error!);
      return r.data as ServerTimeMetadata;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });
  const timeMeta: ServerTimeMetadata = serverTimeMeta ?? DEFAULT_SERVER_TIME_META;

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
    refetchInterval: 5000,
  });

  if (ifLoading || rtLoading) return <LoadingState />;
  if (ifError) return <ErrorState message={ifError.message} />;

  const ifaceList = Array.isArray(interfaces) ? interfaces : [];
  const routeList = Array.isArray(routes) ? routes : [];
  const reachabilityList = Array.isArray(reachability.data) ? reachability.data : [];
  const listenerList = Array.isArray(listeners) ? listeners : [];

  // Derive VIP / Loopback list from interfaces (lo0 with /32)
  const vipList: Array<{ ip: string; prefix: string; type: string }> = [];
  ifaceList.forEach((iface: any) => {
    const name: string = iface.name || '';
    const ifType = iface.type || '';
    const isLoopbackLike = ifType === 'loopback' || ifType === 'dummy' || name === 'lo0' || name.startsWith('lo0') || name.startsWith('dummy');
    if (!isLoopbackLike) return;
    const ipv4List = iface.ipv4Addresses || getIfaceIpv4(iface);
    ipv4List.forEach((cidr: string) => {
      const [ip, prefix] = cidr.split('/');
      if (!ip || ip === '127.0.0.1') return;
      vipList.push({ ip, prefix: prefix || '32', type: 'VIP / LOOPBACK' });
    });
  });

  return (
    <div className="space-y-4">
      {/* Header strip — title + last update */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Rede</h1>
          <p className="text-[12px] font-mono text-muted-foreground mt-0.5">
            Interfaces, endereços, listeners DNS e rotas reais do host
          </p>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono text-muted-foreground">
          <span>Última atualização: <span className="text-foreground/90 tabular-nums">{formatServerDateTime(Date.now(), timeMeta, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1">
            <Activity size={11} className="text-primary" />
            <span className="text-primary font-bold">Auto-refresh: 5s</span>
          </span>
        </div>
      </div>

      {/* DNS LISTENERS — full width */}
      <Panel
        title="DNS Listeners (Porta 53)"
        icon={<Radio size={14} />}
        accentHsl="162 72% 51%"
        action={
          <button className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/60 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
            <FileText size={11} /> Ver logs DNS
          </button>
        }
      >
        {listenerList.length === 0 ? (
          <EmptyState title="Nenhum listener detectado" />
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {listenerList.map((l: any) => (
              <ListenerCard key={`${l.ip}:${l.port}`} l={l} timeMeta={timeMeta} />
            ))}
          </div>
        )}
      </Panel>

      {/* Main grid: left = interfaces+routes, right = vips+diagnostic */}
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 2.4fr) minmax(0, 1fr)' }}>
        {/* LEFT COLUMN */}
        <div className="space-y-4 min-w-0">
          {/* Interfaces table */}
          <Panel title="Interfaces" icon={<Network size={14} />} accentHsl="200 90% 60%">
            {ifaceList.length === 0 ? (
              <EmptyState title="Nenhuma interface encontrada" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-muted-foreground/80 font-mono text-[10px] uppercase tracking-wider">
                      <th className="pb-3 pr-3 font-semibold">Interface</th>
                      <th className="pb-3 pr-3 font-semibold">Status</th>
                      <th className="pb-3 pr-3 font-semibold">Tipo</th>
                      <th className="pb-3 pr-3 font-semibold">Endereço IP</th>
                      <th className="pb-3 pr-3 font-semibold">MTU</th>
                      <th className="pb-3 pr-3 font-semibold">MAC Address</th>
                      <th className="pb-3 pr-3 font-semibold">RX (bps)</th>
                      <th className="pb-3 font-semibold">TX (bps)</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {ifaceList.map((iface: any) => {
                      const state = iface.state || iface.status || getIfaceState(iface);
                      const ipv4List = iface.ipv4Addresses || getIfaceIpv4(iface);
                      const ipv6List = (iface.ipv6Addresses || getIfaceIpv6(iface)).filter(Boolean);
                      const mac = iface.mac || getIfaceMac(iface);
                      const ifType = iface.type || '';
                      const flags: string[] = iface.flags || [];
                      const name: string = iface.name || '';

                      const isLoopbackOrVirtual = ifType === 'loopback' || ifType === 'dummy' || name === 'lo' || name.startsWith('lo') || name.startsWith('dummy');
                      const hasLowerUp = flags.includes('LOWER_UP');
                      const isUp = state === 'UP' || state === 'up';
                      const isUnknown = state === 'UNKNOWN' || state === 'unknown';

                      let statusLabel = state;
                      let statusColor = '0 75% 60%'; // red
                      if (isUp && hasLowerUp) { statusColor = '162 72% 51%'; statusLabel = 'UP'; }
                      else if (isUp && !hasLowerUp) { statusColor = '38 92% 55%'; statusLabel = 'UP'; }
                      else if (isUnknown && isLoopbackOrVirtual) { statusColor = '162 72% 51%'; statusLabel = 'UP'; }
                      else if (isUnknown) { statusColor = '215 15% 55%'; }

                      const typeColor = ifType === 'physical' ? '270 75% 65%' : '290 65% 60%';
                      const hasTraffic = (iface.rxBytes ?? 0) > 0 || (iface.txBytes ?? 0) > 0;

                      return (
                        <tr
                          key={iface.name}
                          className="border-t border-border/30 hover:bg-primary/5 transition-colors"
                        >
                          <td className="py-3 pr-3 align-top">
                            <div className="font-semibold text-foreground/95">{name}</div>
                            {ifType && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{ifType}</div>}
                          </td>
                          <td className="py-3 pr-3 align-top">
                            <span
                              className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                              style={{
                                background: `hsl(${statusColor} / 0.12)`,
                                color: `hsl(${statusColor})`,
                                border: `1px solid hsl(${statusColor} / 0.35)`,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </td>
                          <td className="py-3 pr-3 align-top">
                            {ifType ? (
                              <span
                                className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                style={{
                                  background: `hsl(${typeColor} / 0.12)`,
                                  color: `hsl(${typeColor})`,
                                  border: `1px solid hsl(${typeColor} / 0.30)`,
                                }}
                              >
                                {ifType}
                              </span>
                            ) : <span className="text-muted-foreground/60">—</span>}
                          </td>
                          <td className="py-3 pr-3 align-top">
                            {ipv4List.length === 0 && ipv6List.length === 0 ? (
                              <span className="text-muted-foreground/60 italic text-[11px]">Sem IP</span>
                            ) : (
                              <div className="space-y-0.5">
                                {ipv4List.map((ip: string) => (
                                  <div key={ip} className="text-foreground/90 tabular-nums text-[11px]">{ip}</div>
                                ))}
                                {ipv6List.map((ip: string) => (
                                  <div key={ip} className="text-accent/80 tabular-nums text-[10px]">{ip}</div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-3 pr-3 align-top text-foreground/85 tabular-nums">
                            {iface.mtu ?? '—'}
                          </td>
                          <td className="py-3 pr-3 align-top text-foreground/85 tabular-nums text-[11px]">
                            {mac && mac !== '00:00:00:00:00:00' ? mac : <span className="text-muted-foreground/60">—</span>}
                          </td>
                          <td className="py-3 pr-3 align-top w-[120px]">
                            <div className="text-primary" style={{ color: 'hsl(162 72% 51%)' }}>
                              <MiniSpark active={hasTraffic} color="hsl(162 72% 51%)" />
                            </div>
                            <div className="text-[11px] tabular-nums text-foreground/85 mt-0.5">
                              {formatBpsValue(iface.rxBytes)}
                            </div>
                          </td>
                          <td className="py-3 align-top w-[120px]">
                            <div style={{ color: 'hsl(200 90% 60%)' }}>
                              <MiniSpark active={hasTraffic} color="hsl(200 90% 60%)" />
                            </div>
                            <div className="text-[11px] tabular-nums text-foreground/85 mt-0.5">
                              {formatBpsValue(iface.txBytes)}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {/* Routes */}
          <Panel
            title="Tabela de Rotas"
            icon={<RouteIcon size={14} />}
            accentHsl="290 65% 60%"
            action={
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-secondary/60 px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors">
                Ver todas as rotas
              </button>
            }
          >
            {routeList.length === 0 ? (
              <EmptyState title="Nenhuma rota" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-left text-muted-foreground/80 font-mono text-[10px] uppercase tracking-wider">
                      <th className="pb-3 pr-3 font-semibold">Destino</th>
                      <th className="pb-3 pr-3 font-semibold">Via</th>
                      <th className="pb-3 pr-3 font-semibold">Dev</th>
                      <th className="pb-3 pr-3 font-semibold">Proto</th>
                      <th className="pb-3 pr-3 font-semibold">Scope</th>
                      <th className="pb-3 pr-3 font-semibold">Metric</th>
                      <th className="pb-3 font-semibold">Fonte</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {routeList.map((r: any, i: number) => {
                      const dest = r.destination ?? '—';
                      const isDefault = dest === 'default';
                      return (
                        <tr key={i} className="border-t border-border/30 hover:bg-primary/5 transition-colors">
                          <td className="py-2.5 pr-3" style={{ color: isDefault ? 'hsl(162 72% 51%)' : undefined }}>
                            {dest}
                          </td>
                          <td className="py-2.5 pr-3 text-foreground/85 tabular-nums">{r.via || r.gateway || <span className="text-muted-foreground/60">—</span>}</td>
                          <td className="py-2.5 pr-3 text-foreground/90">{r.device ?? r.interface ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{r.protocol ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-muted-foreground">{r.scope ?? '—'}</td>
                          <td className="py-2.5 pr-3 text-muted-foreground tabular-nums">{r.metric ?? '—'}</td>
                          <td className="py-2.5 text-muted-foreground/70">{r.source ?? r.fonte ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4 min-w-0">
          {/* Loopback / VIPs */}
          <Panel title="Loopback / VIPs" icon={<Star size={14} />} accentHsl="290 65% 60%">
            {vipList.length === 0 ? (
              <p className="text-[11px] font-mono text-muted-foreground">Nenhum VIP de loopback ativo</p>
            ) : (
              <div className="space-y-2">
                {vipList.map((v) => (
                  <div
                    key={v.ip}
                    className="flex items-center gap-3 rounded-lg p-3"
                    style={{
                      background: 'linear-gradient(160deg, hsl(220 38% 10%), hsl(220 45% 6%))',
                      border: '1px solid hsl(290 65% 60% / 0.25)',
                    }}
                  >
                    <span
                      className="rounded-md px-2 py-1 text-[10px] font-mono font-bold"
                      style={{
                        background: 'hsl(290 65% 60% / 0.15)',
                        color: 'hsl(290 80% 75%)',
                        border: '1px solid hsl(290 65% 60% / 0.35)',
                      }}
                    >
                      /{v.prefix}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[13px] font-semibold text-foreground/95 tabular-nums truncate">{v.ip}</div>
                      <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-0.5">{v.type}</div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider"
                      style={{ color: 'hsl(162 72% 51%)' }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'hsl(162 72% 51%)', boxShadow: '0 0 6px hsl(162 72% 51%)' }} />
                      Ativo
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* Diagnostic */}
          <Panel title="Diagnóstico de Conectividade" icon={<Wifi size={14} />} accentHsl="162 72% 51%">
            <div className="space-y-2">
              {reachabilityList.length === 0 ? (
                <p className="text-[11px] font-mono text-muted-foreground">Clique em "Testar tudo" para verificar conectividade</p>
              ) : (
                reachabilityList.map((target: any) => {
                  const ok = !!target.reachable;
                  const accent = ok ? '162 72% 51%' : '0 75% 60%';
                  return (
                    <div
                      key={target.target}
                      className="flex items-center gap-3 rounded-lg p-3"
                      style={{
                        background: 'linear-gradient(160deg, hsl(220 38% 10%), hsl(220 45% 6%))',
                        border: `1px solid hsl(${accent} / 0.22)`,
                      }}
                    >
                      {ok
                        ? <CheckCircle2 size={16} style={{ color: `hsl(${accent})`, filter: `drop-shadow(0 0 4px hsl(${accent} / 0.7))` }} />
                        : <XCircle size={16} style={{ color: `hsl(${accent})` }} />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-foreground/95 truncate">{target.label ?? target.target}</div>
                        <div className="text-[10px] font-mono text-muted-foreground/80 truncate">{target.target}</div>
                      </div>
                      <div className="text-right">
                        <div className="inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider"
                          style={{ color: `hsl(${accent})` }}>
                          {ok ? 'OK' : 'FALHOU'}
                        </div>
                        <div className="font-mono text-[11px] tabular-nums text-foreground/80 mt-0.5">
                          {typeof target.latencyMs === 'number' ? `${target.latencyMs} ms` : '—'}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <button
              onClick={() => reachability.mutate()}
              disabled={reachability.isPending}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-lg py-3 font-mono text-[12px] font-bold uppercase tracking-widest transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, hsl(162 72% 38%), hsl(162 72% 28%))',
                color: 'hsl(220 50% 6%)',
                border: '1px solid hsl(162 72% 51% / 0.7)',
                boxShadow: '0 0 24px -8px hsl(162 72% 51% / 0.7)',
              }}
            >
              <Activity size={14} />
              {reachability.isPending ? 'Testando…' : 'Testar tudo'}
            </button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
