/**
 * NocPoolOperationalState
 *
 * Composite operational truth of the DNS pool, READ-ONLY:
 *   - Drift banner (desejado vs runtime) — /api/system/drift
 *   - InstanceState table (cooldown countdown anti-flap) — /api/health/instances
 *   - DNAT counters per backend joined with instance bind_ip — /api/nat/summary
 *
 * Reuses existing NocInstanceTable and NoDataPlaceholder; no new dependencies.
 * Cooldown countdown decrements via the existing v2-instances react-query
 * refetch (10s) — no parallel client-side timer that could drift from server.
 *
 * NO mutating controls (remove/restore backend stays out of this view).
 */

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileWarning, GitCompareArrows, Network } from 'lucide-react';
import { api } from '@/lib/api';
import NocInstanceTable from '@/components/noc/NocInstanceTable';

import type { V2Instance } from '@/lib/types';

// Inline honest empty-state — mirrors the look/feel of the DnsPage NoDataPlaceholder.
function NoDataPlaceholder({ minHeight = 120, reason }: { minHeight?: number; reason?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded border border-border/40 bg-card/40 text-muted-foreground/70 font-mono text-[10.5px] gap-1"
      style={{ minHeight }}
    >
      <span className="uppercase tracking-wider">sem dados</span>
      {reason ? <span className="text-[10px] text-muted-foreground/60">{reason}</span> : null}
    </div>
  );
}

function formatNumber(n: number | undefined | null): string {
  if (!n || !Number.isFinite(n)) return '0';
  return n.toLocaleString('de-DE');
}

function formatBytes(n: number | undefined | null): string {
  if (!n || !Number.isFinite(n)) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function NocPoolOperationalState() {
  const { data: instances, isError: instancesError, isLoading: instancesLoading } = useQuery({
    queryKey: ['v2-instances', 'pool-state'],
    queryFn: async () => {
      const r = await api.getV2Instances();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 10000, // server-driven cooldown decrement; no parallel timer.
  });

  const { data: drift } = useQuery({
    queryKey: ['system', 'drift'],
    queryFn: async () => {
      const r = await api.getSystemDrift();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 30000,
    retry: false,
  });

  const { data: nat } = useQuery({
    queryKey: ['nat', 'summary', 'pool-state'],
    queryFn: async () => {
      const r = await api.getNftCounters();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 15000,
  });

  const safeInstances: V2Instance[] = Array.isArray(instances) ? instances.filter(Boolean) : [];
  const natBackends = nat?.backends ?? [];

  // Join: per instance, find matching nat backend by bind_ip.
  const correlation = safeInstances.map((inst) => {
    const bindIp = (inst as any).bind_ipv4 || inst.bind_ip;
    const match = natBackends.find((b) => String(b?.backend || b?.name) === String(bindIp));
    return {
      name: inst.instance_name ?? '—',
      bind_ip: bindIp ?? '—',
      in_rotation: !!inst.in_rotation,
      status: inst.current_status ?? 'unknown',
      packets: Number(match?.packets ?? 0),
      bytes: Number(match?.bytes ?? 0),
      tcp_packets: Number(match?.tcp_packets ?? 0),
      udp_packets: Number(match?.udp_packets ?? 0),
      hasMatch: Boolean(match),
    };
  });

  const totalPackets = correlation.reduce((a, r) => a + r.packets, 0);

  const driftStatus = (drift as any)?.status ?? 'unknown';
  const driftCount =
    ((drift as any)?.drifted_files?.length ?? 0) + ((drift as any)?.missing_files?.length ?? 0);
  const hasDrift = driftStatus === 'drift_detected' && driftCount > 0;
  const driftUnavailable =
    driftStatus === 'unavailable' || driftStatus === 'unknown' || drift == null;

  return (
    <div className="space-y-4">
      {/* Drift banner — visible only when there's something honest to say */}
      <div
        className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 font-mono text-[11px] ${
          hasDrift
            ? 'border-warning/40 bg-warning/10 text-warning'
            : driftUnavailable
            ? 'border-border/60 bg-secondary/70 text-muted-foreground'
            : 'border-primary/40 bg-primary/10 text-primary'
        }`}
        data-testid="pool-drift-banner"
      >
        <div className="flex items-center gap-2">
          {hasDrift ? <FileWarning size={13} /> : driftUnavailable ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
          <span className="uppercase tracking-wider font-bold">Drift:</span>
          {hasDrift ? (
            <span>{driftCount} arquivo(s) divergente(s) entre runtime e manifest</span>
          ) : driftUnavailable ? (
            <span>{(drift as any)?.message ?? 'Indisponível (manifest ausente ou endpoint inacessível)'}</span>
          ) : (
            <span>Runtime alinhado com manifest</span>
          )}
        </div>
        <span className="inline-flex items-center gap-1.5 text-[10px]">
          <GitCompareArrows size={11} />
          {hasDrift ? 'desired ≠ live' : driftUnavailable ? 'estado desconhecido' : 'desired = live'}
        </span>
      </div>

      {/* Drift detail list */}
      {hasDrift && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 font-mono text-[10.5px] space-y-1">
          {(drift as any)?.drifted_files?.slice(0, 8).map((f: any) => (
            <div key={`d-${f.path}`} className="flex items-center justify-between gap-3">
              <span className="text-foreground/85 truncate">{f.path}</span>
              <span className="text-warning/80 text-[10px]">{f.reason ?? 'modificado'}</span>
            </div>
          ))}
          {(drift as any)?.missing_files?.slice(0, 8).map((p: string) => (
            <div key={`m-${p}`} className="flex items-center justify-between gap-3">
              <span className="text-foreground/85 truncate">{p}</span>
              <span className="text-destructive/80 text-[10px]">ausente</span>
            </div>
          ))}
        </div>
      )}

      {/* Instance state table — reuses existing NocInstanceTable (cooldown column built-in) */}
      {instancesError || (!instancesLoading && safeInstances.length === 0) ? (
        <div className="rounded-lg border border-border/60 bg-card/80 px-4 py-6">
          <NoDataPlaceholder minHeight={120} />
          <p className="mt-2 text-center text-[10.5px] font-mono text-muted-foreground/80">
            /api/health/instances indisponível
          </p>
        </div>
      ) : (
        <NocInstanceTable instances={safeInstances} />
      )}

      {/* DNAT counters per backend correlated with resolver instance */}
      <div className="rounded-lg border border-border/60 bg-card/80 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
            <Network size={12} className="text-primary/70" />
            <span>Contadores DNAT por backend (nftables)</span>
          </div>
          <span className="text-[10px] font-mono text-muted-foreground/70">
            Total: {formatNumber(totalPackets)} pkts
          </span>
        </div>
        {correlation.length === 0 ? (
          <NoDataPlaceholder minHeight={80} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[10.5px] font-mono">
              <thead>
                <tr className="text-muted-foreground/60 uppercase text-[9.5px]">
                  <th className="text-left py-1.5 pr-2">Instância</th>
                  <th className="text-left py-1.5 pr-2">Bind</th>
                  <th className="text-left py-1.5 pr-2">DNAT</th>
                  <th className="text-right py-1.5 pr-2">Packets</th>
                  <th className="text-right py-1.5 pr-2">Bytes</th>
                  <th className="text-right py-1.5 pr-2">TCP</th>
                  <th className="text-right py-1.5">UDP</th>
                </tr>
              </thead>
              <tbody>
                {correlation.map((row) => (
                  <tr key={row.name + row.bind_ip} className="border-t border-border/30">
                    <td className="py-1.5 pr-2 text-primary font-bold">{row.name}</td>
                    <td className="py-1.5 pr-2 text-muted-foreground/85">{row.bind_ip}</td>
                    <td className="py-1.5 pr-2">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] uppercase tracking-wider ${
                          row.in_rotation
                            ? 'border-primary/30 bg-primary/10 text-primary'
                            : 'border-destructive/40 bg-destructive/10 text-destructive'
                        }`}
                      >
                        {row.in_rotation ? '● IN' : '○ OUT'}
                      </span>
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${row.hasMatch ? 'text-foreground/90' : 'text-muted-foreground/40'}`}>
                      {row.hasMatch ? formatNumber(row.packets) : '—'}
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${row.hasMatch ? 'text-foreground/90' : 'text-muted-foreground/40'}`}>
                      {row.hasMatch ? formatBytes(row.bytes) : '—'}
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${row.hasMatch ? 'text-foreground/75' : 'text-muted-foreground/40'}`}>
                      {row.hasMatch ? formatNumber(row.tcp_packets) : '—'}
                    </td>
                    <td className={`py-1.5 text-right tabular-nums ${row.hasMatch ? 'text-foreground/75' : 'text-muted-foreground/40'}`}>
                      {row.hasMatch ? formatNumber(row.udp_packets) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[9.5px] font-mono text-muted-foreground/60">
              Correlação por bind_ip ↔ DNAT target. Linhas sem match exibem "—" em vez de zero
              (fonte nftables não retornou backend para o IP).
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
