// ============================================================
// DNS Control — VIP Diagnostics Panel
// Shows Service VIPs (owned + intercepted) with health,
// resolution status, DNAT routing, local bind, and traffic.
// ============================================================

import { Globe, CheckCircle, AlertTriangle, Radio, Loader2, Shield, Wifi, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

interface VipDnsProbe {
  resolves: boolean;
  resolved_ip: string;
  latency_ms: number;
  error: string | null;
}

interface VipDiagResult {
  ip: string;
  ipv6: string;
  description: string;
  vip_type: 'owned' | 'intercepted';
  healthy: boolean;
  dns_probe: VipDnsProbe;
  local_bind: { bound: boolean; interface: string | null };
  route: { present: boolean; type: string | null };
  dnat: { active: boolean; backend_ip: string | null };
  traffic: { packets: number };
}

interface RootRecursion {
  trace: { status: string; latency_ms: number; reached_root: boolean; error: string | null };
  root_query: { status: string; target: string; latency_ms: number; answer: string; error: string | null };
}

interface VipDiagnosticsData {
  vip_diagnostics: VipDiagResult[];
  root_recursion: RootRecursion;
  summary: {
    total_vips: number;
    healthy_vips: number;
    all_healthy: boolean;
    degraded: boolean;
    root_recursion_ok: boolean;
    trace_ok: boolean;
  };
}

interface Props {
  data: VipDiagnosticsData | null | undefined;
  isLoading?: boolean;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-destructive animate-pulse'}`} />
  );
}

function VipTypeBadge({ type }: { type: 'owned' | 'intercepted' }) {
  return (
    <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
      type === 'intercepted'
        ? 'bg-accent/15 text-accent border border-accent/25'
        : 'bg-primary/10 text-primary border border-primary/20'
    }`}>
      {type === 'intercepted' ? 'INTERCEPTED' : 'OWNED'}
    </span>
  );
}

export default function NocVipDiagnostics({ data, isLoading }: Props) {
  const hasData = !!data;
  const summary = data?.summary;

  const overallOk = summary
    ? summary.all_healthy && summary.root_recursion_ok
    : null;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <Shield size={12} className={overallOk === true ? 'text-success' : overallOk === false ? 'text-destructive' : 'text-muted-foreground'} />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
          Service VIP Diagnostics
        </span>
        {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        {summary && (
          <span className={`text-[10px] font-mono ml-1 ${overallOk ? 'text-success' : 'text-destructive'}`}>
            — {summary.healthy_vips}/{summary.total_vips} VIPs healthy
          </span>
        )}
      </div>

      <div className="noc-surface-body space-y-4">
        {!hasData && !isLoading && (
          <div className="text-xs text-muted-foreground py-3">Aguardando dados de diagnóstico de VIPs...</div>
        )}

        {hasData && (
          <>
            {/* VIP Health Grid */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Radio size={11} className="text-primary" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground/80">
                  Service VIPs
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {data.vip_diagnostics.map((vip, i) => (
                  <motion.div
                    key={vip.ip}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`p-3 rounded text-xs border ${
                      vip.healthy
                        ? 'bg-success/5 border-success/20'
                        : 'bg-destructive/8 border-destructive/20'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-2">
                      <StatusDot ok={vip.healthy} />
                      <span className="font-mono font-bold text-sm">{vip.ip}</span>
                      <VipTypeBadge type={vip.vip_type} />
                      <span className="text-[10px] text-muted-foreground ml-auto">{vip.description}</span>
                    </div>

                    {/* Status grid */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      {/* DNS Resolution */}
                      <div className="space-y-0.5">
                        <div className="text-[9px] uppercase text-muted-foreground/60 font-bold">DNS Probe</div>
                        {vip.dns_probe.resolves ? (
                          <div className="flex items-center gap-1 text-success">
                            <CheckCircle size={10} />
                            <span className="font-mono font-bold">{vip.dns_probe.latency_ms}ms</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-destructive">
                            <AlertTriangle size={10} />
                            <span className="font-mono">FAIL</span>
                          </div>
                        )}
                        {vip.dns_probe.resolves && (
                          <div className="text-[9px] text-muted-foreground font-mono">→ {vip.dns_probe.resolved_ip}</div>
                        )}
                      </div>

                      {/* Local Bind */}
                      <div className="space-y-0.5">
                        <div className="text-[9px] uppercase text-muted-foreground/60 font-bold">Local Bind</div>
                        <div className={`flex items-center gap-1 ${vip.local_bind.bound ? 'text-success' : 'text-destructive'}`}>
                          {vip.local_bind.bound ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                          <span className="font-mono">{vip.local_bind.bound ? vip.local_bind.interface : 'NOT BOUND'}</span>
                        </div>
                      </div>

                      {/* Route */}
                      <div className="space-y-0.5">
                        <div className="text-[9px] uppercase text-muted-foreground/60 font-bold">Route /32</div>
                        <div className={`flex items-center gap-1 ${vip.route.present ? 'text-success' : 'text-warning'}`}>
                          {vip.route.present ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                          <span className="font-mono">{vip.route.present ? 'OK' : 'MISSING'}</span>
                        </div>
                      </div>

                      {/* DNAT */}
                      <div className="space-y-0.5">
                        <div className="text-[9px] uppercase text-muted-foreground/60 font-bold">DNAT</div>
                        <div className={`flex items-center gap-1 ${vip.dnat.active ? 'text-success' : 'text-muted-foreground'}`}>
                          {vip.dnat.active ? <CheckCircle size={10} /> : <Wifi size={10} />}
                          <span className="font-mono">{vip.dnat.active ? 'ACTIVE' : 'N/A'}</span>
                        </div>
                        {vip.dnat.backend_ip && (
                          <div className="text-[9px] text-muted-foreground font-mono flex items-center gap-0.5">
                            <ArrowRight size={8} /> {vip.dnat.backend_ip}
                          </div>
                        )}
                      </div>

                      {/* Traffic */}
                      <div className="space-y-0.5">
                        <div className="text-[9px] uppercase text-muted-foreground/60 font-bold">Traffic</div>
                        <div className="font-mono font-bold text-foreground/80">
                          {vip.traffic.packets > 0 ? vip.traffic.packets.toLocaleString() : '—'} pkts
                        </div>
                      </div>
                    </div>

                    {/* Error detail */}
                    {!vip.dns_probe.resolves && vip.dns_probe.error && (
                      <div className="mt-2 p-2 bg-destructive/5 rounded text-[10px] font-mono text-destructive">
                        {vip.dns_probe.error}
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Root Recursion */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Globe size={11} className="text-accent" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground/80">
                  Root Recursion Tests
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className={`p-2.5 rounded text-xs border ${
                  data.root_recursion.trace.status === 'ok'
                    ? 'bg-success/5 border-success/20'
                    : 'bg-destructive/8 border-destructive/20'
                }`}>
                  <div className="flex items-center gap-2">
                    <StatusDot ok={data.root_recursion.trace.status === 'ok'} />
                    <span className="font-mono font-bold">dig +trace {PROBE_DOMAIN}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {data.root_recursion.trace.status === 'ok' ? (
                      <>
                        Latência: <span className="font-bold">{data.root_recursion.trace.latency_ms}ms</span>
                        {data.root_recursion.trace.reached_root && ' · Alcançou root servers'}
                      </>
                    ) : (
                      <span className="text-destructive">{data.root_recursion.trace.error || 'Trace failed'}</span>
                    )}
                  </div>
                </div>

                <div className={`p-2.5 rounded text-xs border ${
                  data.root_recursion.root_query.status === 'ok'
                    ? 'bg-success/5 border-success/20'
                    : 'bg-destructive/8 border-destructive/20'
                }`}>
                  <div className="flex items-center gap-2">
                    <StatusDot ok={data.root_recursion.root_query.status === 'ok'} />
                    <span className="font-mono font-bold">dig @{data.root_recursion.root_query.target} . NS</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {data.root_recursion.root_query.status === 'ok' ? (
                      <>
                        Latência: <span className="font-bold">{data.root_recursion.root_query.latency_ms}ms</span>
                        {' · Root NS respondeu'}
                      </>
                    ) : (
                      <span className="text-destructive">{data.root_recursion.root_query.error || 'Root query failed'}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const PROBE_DOMAIN = 'google.com';
