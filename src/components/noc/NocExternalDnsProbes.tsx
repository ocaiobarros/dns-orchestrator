// ============================================================
// DNS Control — External DNS Probes Panel
// Tests: External reachability, DNS hijack detection, root recursion
// ============================================================

import { Globe, AlertTriangle, CheckCircle, Shield, Radio, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

interface ExternalProbe {
  resolver: string;
  label: string;
  provider: string;
  reachable: boolean;
  latency_ms: number;
  resolved_ip: string;
  error: string | null;
}

interface HijackDetection {
  detected: boolean;
  threshold_ms: number;
  suspicious_probes: Array<{
    resolver: string;
    label: string;
    latency_ms: number;
    reason: string;
  }>;
  message: string;
}

interface RootRecursion {
  trace: { status: string; latency_ms: number; reached_root: boolean; error: string | null };
  root_query: { status: string; target: string; latency_ms: number; answer: string; error: string | null };
}

interface ExternalDnsData {
  external_reachability: ExternalProbe[];
  hijack_detection: HijackDetection;
  root_recursion: RootRecursion;
  summary: {
    external_dns_reachable: boolean;
    hijack_suspected: boolean;
    root_recursion_ok: boolean;
    trace_ok: boolean;
  };
}

interface Props {
  data: ExternalDnsData | null | undefined;
  isLoading?: boolean;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-destructive animate-pulse'}`} />
  );
}

export default function NocExternalDnsProbes({ data, isLoading }: Props) {
  const hasData = !!data;
  const summary = data?.summary;

  const overallOk = summary
    ? summary.external_dns_reachable && !summary.hijack_suspected && summary.root_recursion_ok
    : null;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <Globe size={12} className={overallOk === true ? 'text-success' : overallOk === false ? 'text-destructive' : 'text-muted-foreground'} />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
          External DNS Diagnostics
        </span>
        {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        {overallOk === true && (
          <span className="text-[10px] font-mono text-success ml-1">— All Clear</span>
        )}
        {overallOk === false && (
          <span className="text-[10px] font-mono text-destructive ml-1">— Issues Detected</span>
        )}
      </div>

      <div className="noc-surface-body space-y-4">
        {!hasData && !isLoading && (
          <div className="text-xs text-muted-foreground py-3">Aguardando dados de probes externos...</div>
        )}

        {hasData && (
          <>
            {/* External Reachability */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Radio size={11} className="text-primary" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground/80">
                  External DNS Reachability
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {data.external_reachability.map((probe, i) => (
                  <motion.div
                    key={probe.resolver}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`flex items-center gap-3 p-2.5 rounded text-xs border ${
                      probe.reachable
                        ? 'bg-success/5 border-success/20'
                        : 'bg-destructive/8 border-destructive/20'
                    }`}
                  >
                    <StatusDot ok={probe.reachable} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold">{probe.resolver}</span>
                        <span className="text-[10px] text-muted-foreground">{probe.label}</span>
                      </div>
                      {probe.reachable ? (
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          → {probe.resolved_ip} · <span className="font-bold">{probe.latency_ms}ms</span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-destructive mt-0.5">{probe.error || 'Unreachable'}</div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Hijack Detection */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Shield size={11} className={data.hijack_detection.detected ? 'text-destructive' : 'text-success'} />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground/80">
                  DNS Hijack Detection
                </span>
                <span className="text-[9px] font-mono text-muted-foreground/50">
                  threshold: {data.hijack_detection.threshold_ms}ms
                </span>
              </div>
              <div className={`p-3 rounded text-xs border ${
                data.hijack_detection.detected
                  ? 'bg-destructive/8 border-destructive/20'
                  : 'bg-success/5 border-success/20'
              }`}>
                <div className="flex items-start gap-2">
                  {data.hijack_detection.detected ? (
                    <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle size={14} className="text-success shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className={`font-bold ${data.hijack_detection.detected ? 'text-destructive' : 'text-success'}`}>
                      {data.hijack_detection.detected ? 'Possível Interceptação DNS' : 'Sem Interceptação Detectada'}
                    </div>
                    <div className="text-muted-foreground mt-1">{data.hijack_detection.message}</div>
                    {data.hijack_detection.suspicious_probes.map(s => (
                      <div key={s.resolver} className="mt-1.5 p-2 bg-destructive/5 rounded text-[10px] font-mono">
                        <span className="text-destructive font-bold">{s.resolver}</span>
                        <span className="text-muted-foreground"> — {s.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
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
                {/* dig +trace */}
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

                {/* Root server direct */}
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
