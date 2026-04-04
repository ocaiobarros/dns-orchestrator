import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AlertTriangle, ShieldX, Ban, Radio, Eye, EyeOff, Info } from 'lucide-react';
import { useState } from 'react';
import { motion } from 'framer-motion';

interface DnsErrorSummary {
  rcode_counts: Record<string, number>;
  total_errors: number;
  top_error_domains: Array<{ domain: string; count: number }>;
  top_error_clients: Array<{ ip: string; count: number }>;
  top_error_instances: Array<{ instance: string; count: number }>;
  error_timeline: Array<{ bucket: string; count: number }>;
  source: string;
  fidelity?: string;
  error_rate_pct?: number;
  total_queries?: number;
}

interface DnstapStatus {
  enabled: boolean;
  status: string;
  fidelity: string;
  message?: string;
  total_events?: number;
  total_errors?: number;
}

const RCODE_COLORS: Record<string, string> = {
  SERVFAIL: 'text-destructive',
  NXDOMAIN: 'text-warning',
  REFUSED: 'text-muted-foreground',
  TIMEOUT: 'text-destructive',
};

const RCODE_ICONS: Record<string, typeof AlertTriangle> = {
  SERVFAIL: ShieldX,
  NXDOMAIN: Ban,
  REFUSED: AlertTriangle,
};

export default function NocDnsErrors() {
  const [expanded, setExpanded] = useState(false);

  const { data: errorSummary, isLoading } = useQuery<DnsErrorSummary>({
    queryKey: ['dns-error-summary'],
    queryFn: async () => {
      const r = await api.getDnsErrorSummary(60);
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 30000,
  });

  const { data: dnstapStatus } = useQuery<DnstapStatus>({
    queryKey: ['dnstap-status'],
    queryFn: async () => {
      const r = await api.getDnstapStatus();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    refetchInterval: 60000,
  });

  const rcodes = errorSummary?.rcode_counts ?? {};
  const totalErrors = errorSummary?.total_errors ?? 0;
  const topDomains = errorSummary?.top_error_domains ?? [];
  const topClients = errorSummary?.top_error_clients ?? [];
  const topInstances = errorSummary?.top_error_instances ?? [];
  const source = errorSummary?.source ?? 'unknown';
  const fidelity = errorSummary?.fidelity ?? dnstapStatus?.fidelity ?? 'unknown';

  const isDegraded = source === 'stats_delta' || fidelity === 'counters_only';
  const isAggregate = source === 'unbound-control' || fidelity === 'aggregate';

  const dnstapEnabled = dnstapStatus?.enabled ?? false;
  const dnstapState = dnstapStatus?.status ?? 'not_configured';

  const fidelityLabel = fidelity === 'full' ? 'Full (logs)'
    : isDegraded ? 'Degradado (contadores)'
    : isAggregate ? 'Agregado (unbound-control)'
    : source === 'database' ? 'Log-parsed' : 'Degradado';
  const fidelityColor = fidelity === 'full' ? 'text-success'
    : isDegraded ? 'text-warning' : 'text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="noc-surface"
    >
      <div className="noc-surface-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={12} className="text-warning" />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest">DNS Errors & Failures</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Radio size={8} className={dnstapEnabled ? 'text-success animate-pulse' : 'text-muted-foreground/40'} />
            <span className={`text-[8px] font-mono uppercase ${dnstapEnabled ? 'text-success' : 'text-muted-foreground/50'}`}>
              dnstap: {dnstapState}
            </span>
          </div>
          <span className={`text-[8px] font-mono ${fidelityColor}`}>
            {fidelityLabel}
          </span>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground/50 hover:text-foreground/80 transition-colors"
          >
            {expanded ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>

      <div className="noc-surface-body">
        {isLoading ? (
          <div className="text-[10px] text-muted-foreground/50 font-mono py-4 text-center">Collecting error data...</div>
        ) : (
          <>
            {/* Degraded mode banner */}
            {isDegraded && (
              <div className="flex items-center gap-2 text-[9px] font-mono text-warning/80 bg-warning/5 border border-warning/20 rounded px-2 py-1.5 mb-3">
                <Info size={10} className="text-warning shrink-0" />
                <span>Modo degradado (sem logs/dnstap) — apenas contadores por instância disponíveis. Domínios e clientes não visíveis.</span>
              </div>
            )}

            {/* RCODE summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {['SERVFAIL', 'NXDOMAIN', 'REFUSED', 'TIMEOUT'].map(rcode => {
                const count = rcodes[rcode] ?? 0;
                const Icon = RCODE_ICONS[rcode] ?? AlertTriangle;
                const color = RCODE_COLORS[rcode] ?? 'text-muted-foreground';
                return (
                  <div key={rcode} className="flex items-center gap-2 p-2 rounded bg-secondary/30 border border-border/30">
                    <Icon size={14} className={color} />
                    <div>
                      <div className={`text-sm font-mono font-bold ${color}`}>{count.toLocaleString()}</div>
                      <div className="text-[8px] font-mono text-muted-foreground/50 uppercase">{rcode}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total errors & rate */}
            <div className="flex items-center gap-4 mb-3 text-[10px] font-mono">
              <span className="text-muted-foreground/60">Total errors: <span className="text-foreground/85 font-bold">{totalErrors.toLocaleString()}</span></span>
              {errorSummary?.error_rate_pct != null && (
                <span className="text-muted-foreground/60">Error rate: <span className={`font-bold ${(errorSummary.error_rate_pct ?? 0) > 5 ? 'text-destructive' : (errorSummary.error_rate_pct ?? 0) > 1 ? 'text-warning' : 'text-success'}`}>{errorSummary.error_rate_pct}%</span></span>
              )}
              <span className="text-muted-foreground/40">Source: {source}</span>
            </div>

            {/* Fidelity warning for aggregate */}
            {isAggregate && !isDegraded && (
              <div className="text-[9px] font-mono text-warning/70 bg-warning/5 border border-warning/20 rounded px-2 py-1.5 mb-3">
                ⚠ Fidelidade reduzida — apenas contadores agregados disponíveis. Habilite dnstap para visibilidade por domínio/cliente.
              </div>
            )}

            {/* Expanded details */}
            {expanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-4 pt-2 border-t border-border/30"
              >
                {/* Top failing domains — hidden in degraded mode */}
                {!isDegraded && topDomains.length > 0 && (
                  <div>
                    <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Top Domínios com Falha</div>
                    <div className="space-y-1">
                      {topDomains.slice(0, 10).map((d) => (
                        <div key={d.domain} className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-foreground/80 truncate max-w-[200px]">{d.domain}</span>
                          <span className="text-destructive font-bold">{d.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top failing clients — hidden in degraded mode */}
                {!isDegraded && topClients.length > 0 && (
                  <div>
                    <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Top Clientes com Falha</div>
                    <div className="space-y-1">
                      {topClients.slice(0, 10).map((c) => (
                        <div key={c.ip} className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-foreground/80">{c.ip}</span>
                          <span className="text-warning font-bold">{c.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top failing instances — always shown */}
                {topInstances.length > 0 && (
                  <div>
                    <div className="text-[9px] font-mono font-bold uppercase tracking-wider text-muted-foreground/60 mb-2">Top Instâncias com Falha</div>
                    <div className="space-y-1">
                      {topInstances.slice(0, 5).map((inst) => (
                        <div key={inst.instance} className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-foreground/80">{inst.instance}</span>
                          <span className="text-destructive font-bold">{inst.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* dnstap hint */}
                {!dnstapEnabled && (
                  <div className="text-[9px] font-mono text-muted-foreground/50 bg-secondary/30 border border-border/20 rounded px-2 py-2">
                    <span className="font-bold">dnstap não configurado.</span> Para visibilidade completa de eventos DNS, adicione ao unbound.conf:
                    <pre className="mt-1 text-[8px] text-muted-foreground/40">
{`dnstap:
    dnstap-enable: yes
    dnstap-socket-path: "/var/run/unbound/dnstap.sock"
    dnstap-send-identity: yes
    dnstap-send-version: yes
    dnstap-log-client-query-messages: yes
    dnstap-log-client-response-messages: yes`}
                    </pre>
                  </div>
                )}
              </motion.div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
