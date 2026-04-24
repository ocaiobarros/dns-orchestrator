import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Eye, Server, Globe, Network, ShieldAlert, Wifi, Activity, AlertTriangle, CheckCircle2, XCircle, Loader2, Trash2, RefreshCw, FileText, ListTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

interface ObservedModePanelProps {
  onDisable: () => void;
  disabling: boolean;
}

export default function ObservedModePanel({ onDisable, disabling }: ObservedModePanelProps) {
  const queryClient = useQueryClient();
  const [recollecting, setRecollecting] = useState(false);

  const { data: inventory, isLoading } = useQuery({
    queryKey: ['runtime-inventory-full'],
    queryFn: async () => {
      const res = await api.getRuntimeInventory();
      return res.success ? res.data : null;
    },
    refetchInterval: 30000,
  });

  const handleRecollect = async () => {
    setRecollecting(true);
    try {
      const res = await api.recollectTelemetry();
      if (res.success && res.data?.success) {
        const d = res.data;
        toast.success(
          `Coleta concluída em ${d.duration_ms}ms · ${d.queries_parsed ?? 0} queries · ` +
          `domains=${d.top_domains_count ?? 0} clients=${d.top_clients_count ?? 0}`,
        );
        // Invalidate dependent queries so dashboards refresh.
        queryClient.invalidateQueries({ queryKey: ['runtime-inventory-full'] });
        queryClient.invalidateQueries({ queryKey: ['kiosk-summary'] });
        queryClient.invalidateQueries({ queryKey: ['telemetry-latest'] });
        queryClient.invalidateQueries({ queryKey: ['recent-queries'] });
        queryClient.invalidateQueries({ queryKey: ['log-validation'] });
      } else {
        toast.error(res.data?.steps?.[0]?.error ?? 'Falha ao reexecutar coleta');
      }
    } catch (e: any) {
      toast.error(`Erro: ${e?.message ?? 'desconhecido'}`);
    } finally {
      setRecollecting(false);
    }
  };

  const instances = inventory?.instances ?? [];
  const vips = inventory?.vips ?? [];
  const dnatRules = inventory?.dnat_rules ?? [];
  const listeners = inventory?.listeners ?? [];
  const stickySets = inventory?.sticky_sets ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-blue-400/90">
          <strong>Modo OBSERVAÇÃO ativo</strong> — Descoberta automática via runtime.
          Deploy, apply e rollback estão <strong>bloqueados</strong>.
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
        {[
          { label: 'Instâncias', value: instances.length, icon: <Server size={12} /> },
          { label: 'VIPs', value: vips.length, icon: <Globe size={12} /> },
          { label: 'Listeners', value: listeners.length, icon: <Wifi size={12} /> },
          { label: 'DNAT Rules', value: dnatRules.length, icon: <Network size={12} /> },
          { label: 'Sticky Sets', value: stickySets.length, icon: <Activity size={12} /> },
          { label: 'Auto-sync', value: '60s', icon: <Loader2 size={12} /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-muted/30 rounded p-2 text-center">
            <div className="flex items-center justify-center gap-1 text-muted-foreground text-[10px] mb-1">
              {icon} {label}
            </div>
            <div className="font-mono text-lg font-bold text-primary">{value}</div>
          </div>
        ))}
      </div>

      {/* Instances detail */}
      {instances.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Server size={10} /> Instâncias Unbound
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-1 pr-3">Nome</th>
                  <th className="pb-1 pr-3">Bind IP</th>
                  <th className="pb-1 pr-3">Control</th>
                  <th className="pb-1 pr-3">Outgoing</th>
                  <th className="pb-1">Status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {instances.map((inst: any) => (
                  <tr key={inst.instance_name} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-3 text-primary font-semibold">{inst.instance_name}</td>
                    <td className="py-1.5 pr-3">
                      {(inst.bind_ips ?? [inst.bind_ip]).filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {inst.control_interface}:{inst.control_port}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">
                      {(inst.outgoing_ips ?? [inst.outgoing_ip]).filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="py-1.5">
                      {inst.is_running ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400">
                          <CheckCircle2 size={10} /> running
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-destructive">
                          <XCircle size={10} /> stopped
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIPs detail */}
      {vips.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Globe size={10} /> VIPs Descobertos
          </div>
          <div className="flex flex-wrap gap-1.5">
            {vips.map((vip: any, i: number) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted/40 text-xs font-mono text-primary border border-border"
              >
                {vip.ip}/{vip.prefixlen}
                <span className="text-[9px] text-muted-foreground">({vip.interface})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* DNAT Rules */}
      {dnatRules.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Network size={10} /> Regras DNAT
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-1 pr-3">Backend</th>
                  <th className="pb-1 pr-3">Proto</th>
                  <th className="pb-1 pr-3">Chain</th>
                  <th className="pb-1 pr-3 text-right">Packets</th>
                  <th className="pb-1 text-right">Bytes</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {dnatRules.slice(0, 20).map((rule: any, i: number) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="py-1 pr-3 text-primary">{rule.backend_ip}:{rule.backend_port}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{rule.protocol}</td>
                    <td className="py-1 pr-3 text-muted-foreground">{rule.chain}</td>
                    <td className="py-1 pr-3 text-right">{(rule.packets ?? 0).toLocaleString()}</td>
                    <td className="py-1 text-right text-muted-foreground">{(rule.bytes ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {dnatRules.length > 20 && (
              <div className="text-[10px] text-muted-foreground pt-1">
                ... e mais {dnatRules.length - 20} regras
              </div>
            )}
          </div>
        </div>
      )}

      {dnatRules.length === 0 && (
        <div className="text-xs text-muted-foreground/70 flex items-center gap-1 bg-muted/20 rounded p-2">
          <AlertTriangle size={10} className="text-yellow-500" />
          DNAT Rules: 0 — possível limitação de permissão (nft requer root/sudo) ou nenhuma regra DNAT configurada.
        </div>
      )}

      {/* Listeners */}
      {listeners.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Wifi size={10} /> Listeners DNS (porta 53)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {listeners.map((l: any, i: number) => (
              <span key={i} className="px-2 py-0.5 rounded bg-muted/40 text-xs font-mono text-primary border border-border">
                {l.ip}:{l.port}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <div className="text-[10px] text-muted-foreground/70">
          Nenhuma alteração é feita no host. Leitura passiva apenas.
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={onDisable}
          disabled={disabling}
        >
          {disabling ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Trash2 size={12} className="mr-1" />}
          Desativar Observação
        </Button>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 size={10} className="animate-spin" /> Carregando inventário...
        </div>
      )}
    </div>
  );
}
