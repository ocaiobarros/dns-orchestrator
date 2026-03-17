// ============================================================
// DNS Control — DNS Incident Detection Panel
// Automatic detection of DNS anomalies + VIP diagnostic alerts
// ============================================================

import { useState, useMemo } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle, Settings, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface IncidentThresholds {
  latencyWarningMs: number;
  latencyCriticalMs: number;
  servfailWarningPct: number;
  servfailCriticalPct: number;
  cacheHitLowPct: number;
  cacheHitCriticalPct: number;
  qpsDropPct: number;
}

export interface DnsIncident {
  id: string;
  timestamp: string;
  resolver: string;
  type: string;
  severity: 'warning' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
}

interface ResolverMetrics {
  name: string;
  latencyMs: number;
  servfailPct: number;
  cacheHitPct: number;
  qps: number;
  previousQps?: number;
  healthy: boolean;
  upstreamReachable: boolean;
}

interface VipDiagSummary {
  has_parse_errors?: boolean;
  has_counter_mismatch?: boolean;
}

interface VipDiagResult {
  ip: string;
  status: string;
  reason?: string | null;
  counter_mismatch: boolean;
  parse_error: string | null;
  backends?: Array<{
    ip: string;
    status: string;
    never_selected: boolean;
    dead: boolean;
    reason?: string | null;
  }>;
}

interface Props {
  resolvers: ResolverMetrics[];
  thresholds?: Partial<IncidentThresholds>;
  vipDiagnostics?: {
    vip_diagnostics: VipDiagResult[];
    summary: VipDiagSummary;
  } | null;
}

const DEFAULT_THRESHOLDS: IncidentThresholds = {
  latencyWarningMs: 80,
  latencyCriticalMs: 150,
  servfailWarningPct: 2,
  servfailCriticalPct: 5,
  cacheHitLowPct: 50,
  cacheHitCriticalPct: 30,
  qpsDropPct: 50,
};

const INCIDENT_LABELS: Record<string, string> = {
  upstream_latency: 'Upstream Latency',
  servfail_spike: 'SERVFAIL Spike',
  cache_degradation: 'Cache Degradation',
  qps_drop: 'QPS Drop',
  instance_down: 'Instance Down',
  upstream_unreachable: 'Upstream Unreachable',
  counter_mismatch: 'Counter Mismatch',
  parse_error: 'Parse Error',
  never_selected: 'Never Selected',
  dead_backend: 'Dead Backend',
  inactive_vip: 'Inactive VIP',
};

function detectIncidents(
  resolvers: ResolverMetrics[],
  t: IncidentThresholds,
  vipData?: { vip_diagnostics: VipDiagResult[]; summary: VipDiagSummary } | null,
): DnsIncident[] {
  const incidents: DnsIncident[] = [];
  const now = new Date().toISOString();

  // ── Resolver-based incidents ──
  resolvers.forEach(r => {
    if (!r.healthy) {
      incidents.push({
        id: `${r.name}-down`, timestamp: now, resolver: r.name,
        type: 'instance_down', severity: 'critical',
        metric: 'health', value: 0, threshold: 1,
        message: `${r.name} está fora de operação`,
      });
    }

    if (!r.upstreamReachable) {
      incidents.push({
        id: `${r.name}-upstream`, timestamp: now, resolver: r.name,
        type: 'upstream_unreachable', severity: 'critical',
        metric: 'upstream_reachability', value: 0, threshold: 1,
        message: `${r.name} não consegue alcançar upstream DNS`,
      });
    }

    if (r.latencyMs > t.latencyCriticalMs) {
      incidents.push({
        id: `${r.name}-lat-crit`, timestamp: now, resolver: r.name,
        type: 'upstream_latency', severity: 'critical',
        metric: 'latency_ms', value: r.latencyMs, threshold: t.latencyCriticalMs,
        message: `${r.name} latência ${r.latencyMs}ms excede ${t.latencyCriticalMs}ms`,
      });
    } else if (r.latencyMs > t.latencyWarningMs) {
      incidents.push({
        id: `${r.name}-lat-warn`, timestamp: now, resolver: r.name,
        type: 'upstream_latency', severity: 'warning',
        metric: 'latency_ms', value: r.latencyMs, threshold: t.latencyWarningMs,
        message: `${r.name} latência ${r.latencyMs}ms acima de ${t.latencyWarningMs}ms`,
      });
    }

    if (r.servfailPct > t.servfailCriticalPct) {
      incidents.push({
        id: `${r.name}-sf-crit`, timestamp: now, resolver: r.name,
        type: 'servfail_spike', severity: 'critical',
        metric: 'servfail_pct', value: r.servfailPct, threshold: t.servfailCriticalPct,
        message: `${r.name} SERVFAIL ${r.servfailPct.toFixed(1)}% excede ${t.servfailCriticalPct}%`,
      });
    } else if (r.servfailPct > t.servfailWarningPct) {
      incidents.push({
        id: `${r.name}-sf-warn`, timestamp: now, resolver: r.name,
        type: 'servfail_spike', severity: 'warning',
        metric: 'servfail_pct', value: r.servfailPct, threshold: t.servfailWarningPct,
        message: `${r.name} SERVFAIL ${r.servfailPct.toFixed(1)}% acima de ${t.servfailWarningPct}%`,
      });
    }

    if (r.cacheHitPct < t.cacheHitCriticalPct) {
      incidents.push({
        id: `${r.name}-ch-crit`, timestamp: now, resolver: r.name,
        type: 'cache_degradation', severity: 'critical',
        metric: 'cache_hit_pct', value: r.cacheHitPct, threshold: t.cacheHitCriticalPct,
        message: `${r.name} cache hit ${r.cacheHitPct.toFixed(1)}% abaixo de ${t.cacheHitCriticalPct}%`,
      });
    } else if (r.cacheHitPct < t.cacheHitLowPct) {
      incidents.push({
        id: `${r.name}-ch-warn`, timestamp: now, resolver: r.name,
        type: 'cache_degradation', severity: 'warning',
        metric: 'cache_hit_pct', value: r.cacheHitPct, threshold: t.cacheHitLowPct,
        message: `${r.name} cache hit ${r.cacheHitPct.toFixed(1)}% abaixo de ${t.cacheHitLowPct}%`,
      });
    }

    if (r.previousQps != null && r.previousQps > 0) {
      const dropPct = ((r.previousQps - r.qps) / r.previousQps) * 100;
      if (dropPct > t.qpsDropPct) {
        incidents.push({
          id: `${r.name}-qps-drop`, timestamp: now, resolver: r.name,
          type: 'qps_drop', severity: 'warning',
          metric: 'qps_drop_pct', value: Math.round(dropPct), threshold: t.qpsDropPct,
          message: `${r.name} QPS caiu ${Math.round(dropPct)}% (${r.previousQps} → ${r.qps})`,
        });
      }
    }
  });

  // ── VIP diagnostic incidents ──
  if (vipData?.vip_diagnostics) {
    for (const vip of vipData.vip_diagnostics) {
      // COUNTER_MISMATCH
      if (vip.counter_mismatch) {
        incidents.push({
          id: `vip-${vip.ip}-mismatch`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'counter_mismatch', severity: 'warning',
          metric: 'counter_cross_validation', value: 1, threshold: 0,
          message: vip.reason || `VIP ${vip.ip} entry/path counter mismatch detectado`,
        });
      }

      // PARSE_ERROR
      if (vip.parse_error) {
        incidents.push({
          id: `vip-${vip.ip}-parse`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'parse_error', severity: 'critical',
          metric: 'nft_parse', value: 1, threshold: 0,
          message: `VIP ${vip.ip}: ${vip.parse_error}`,
        });
      }

      // INACTIVE_VIP
      if (vip.status === 'INACTIVE_VIP') {
        incidents.push({
          id: `vip-${vip.ip}-inactive`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'inactive_vip', severity: 'warning',
          metric: 'vip_traffic', value: 0, threshold: 1,
          message: vip.reason || `VIP ${vip.ip} sem tráfego observado`,
        });
      }

      // Per-backend alerts
      if (vip.backends) {
        for (const backend of vip.backends) {
          if (backend.never_selected) {
            incidents.push({
              id: `vip-${vip.ip}-ns-${backend.ip}`, timestamp: now, resolver: `VIP ${vip.ip}`,
              type: 'never_selected', severity: 'warning',
              metric: 'backend_selection', value: 0, threshold: 1,
              message: backend.reason || `Backend ${backend.ip} configurado mas nunca selecionado via DNAT`,
            });
          }
          if (backend.dead) {
            incidents.push({
              id: `vip-${vip.ip}-dead-${backend.ip}`, timestamp: now, resolver: `VIP ${vip.ip}`,
              type: 'dead_backend', severity: 'critical',
              metric: 'backend_health', value: 0, threshold: 1,
              message: backend.reason || `Backend ${backend.ip} não responde e sem tráfego`,
            });
          }
        }
      }
    }
  }

  return incidents.sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1));
}

export default function NocIncidentDetector({ resolvers, thresholds, vipDiagnostics }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const incidents = useMemo(() => detectIncidents(resolvers, t, vipDiagnostics), [resolvers, t, vipDiagnostics]);
  const criticals = incidents.filter(i => i.severity === 'critical');
  const warnings = incidents.filter(i => i.severity === 'warning');
  const isClean = incidents.length === 0;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        {isClean ? (
          <CheckCircle size={12} className="text-success" />
        ) : criticals.length > 0 ? (
          <AlertCircle size={12} className="text-destructive animate-pulse" />
        ) : (
          <AlertTriangle size={12} className="text-warning" />
        )}
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
          DNS Incident Detection
        </span>
        <span className="text-[10px] font-mono text-muted-foreground ml-1">
          {isClean ? '— All Clear' : `— ${criticals.length} critical, ${warnings.length} warning`}
        </span>
        <button onClick={() => setShowSettings(!showSettings)} className="ml-auto p-1 rounded hover:bg-secondary">
          <Settings size={10} className="text-muted-foreground" />
        </button>
      </div>
      <div className="noc-surface-body">
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-3"
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded bg-secondary border border-border text-[10px] font-mono">
                <div>
                  <div className="text-muted-foreground uppercase">Latency Warn</div>
                  <div className="font-bold text-warning">{t.latencyWarningMs}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">Latency Crit</div>
                  <div className="font-bold text-destructive">{t.latencyCriticalMs}ms</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">SERVFAIL Warn</div>
                  <div className="font-bold text-warning">{t.servfailWarningPct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">SERVFAIL Crit</div>
                  <div className="font-bold text-destructive">{t.servfailCriticalPct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">Cache Low</div>
                  <div className="font-bold text-warning">{t.cacheHitLowPct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">Cache Crit</div>
                  <div className="font-bold text-destructive">{t.cacheHitCriticalPct}%</div>
                </div>
                <div>
                  <div className="text-muted-foreground uppercase">QPS Drop</div>
                  <div className="font-bold text-warning">{t.qpsDropPct}%</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isClean && (
          <div className="flex items-center gap-2 py-3 text-xs text-success">
            <CheckCircle size={14} />
            <span>Nenhum incidente detectado — todos os resolvers e VIPs operando dentro dos limiares</span>
          </div>
        )}

        <AnimatePresence>
          {incidents.map((inc, i) => (
            <motion.div
              key={inc.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ delay: i * 0.05 }}
              className={`flex items-start gap-3 p-2.5 rounded mb-1.5 text-xs ${
                inc.severity === 'critical'
                  ? 'bg-destructive/8 border border-destructive/20'
                  : 'bg-warning/8 border border-warning/20'
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {inc.severity === 'critical'
                  ? <Zap size={12} className="text-destructive" />
                  : <AlertTriangle size={12} className="text-warning" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`font-bold ${inc.severity === 'critical' ? 'text-destructive' : 'text-warning'}`}>
                    {INCIDENT_LABELS[inc.type] || inc.type}
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 bg-secondary rounded">
                    {inc.resolver}
                  </span>
                  <span className={`text-[10px] font-mono font-bold ${inc.severity === 'critical' ? 'text-destructive' : 'text-warning'}`}>
                    {inc.severity.toUpperCase()}
                  </span>
                </div>
                <div className="text-muted-foreground mt-0.5">{inc.message}</div>
                <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
                  metric: {inc.metric} = {inc.value} (threshold: {inc.threshold})
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
