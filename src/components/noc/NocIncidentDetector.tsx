// ============================================================
// DNS Control — DNS Incident Detection Panel
// Automatic detection of DNS anomalies + VIP diagnostic alerts
// Severity: critical > high > medium > low
// ============================================================

import { useState, useMemo } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle, Settings, Zap, Info, ArrowDown } from 'lucide-react';
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

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface DnsIncident {
  id: string;
  timestamp: string;
  resolver: string;
  type: string;
  severity: IncidentSeverity;
  metric: string;
  value: number;
  threshold: number;
  message: string;
  reason_code?: string;
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
  reason_code?: string | null;
  counter_mismatch: boolean;
  parse_error: string | null;
  nft_unavailable?: boolean;
  backends?: Array<{
    ip: string;
    status: string;
    never_selected: boolean;
    dead: boolean;
    reason?: string | null;
    reason_code?: string | null;
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

const SEVERITY_ORDER: Record<IncidentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const SEVERITY_STYLES: Record<IncidentSeverity, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-destructive/8', text: 'text-destructive', border: 'border-destructive/20' },
  high: { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/25' },
  medium: { bg: 'bg-accent/8', text: 'text-accent', border: 'border-accent/20' },
  low: { bg: 'bg-muted/30', text: 'text-muted-foreground', border: 'border-border' },
};

const SEVERITY_ICONS: Record<IncidentSeverity, typeof Zap> = {
  critical: Zap,
  high: AlertTriangle,
  medium: Info,
  low: ArrowDown,
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
        type: 'upstream_latency', severity: 'medium',
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
        type: 'servfail_spike', severity: 'medium',
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
        type: 'cache_degradation', severity: 'medium',
        metric: 'cache_hit_pct', value: r.cacheHitPct, threshold: t.cacheHitLowPct,
        message: `${r.name} cache hit ${r.cacheHitPct.toFixed(1)}% abaixo de ${t.cacheHitLowPct}%`,
      });
    }

    if (r.previousQps != null && r.previousQps > 0) {
      const dropPct = ((r.previousQps - r.qps) / r.previousQps) * 100;
      if (dropPct > t.qpsDropPct) {
        incidents.push({
          id: `${r.name}-qps-drop`, timestamp: now, resolver: r.name,
          type: 'qps_drop', severity: 'medium',
          metric: 'qps_drop_pct', value: Math.round(dropPct), threshold: t.qpsDropPct,
          message: `${r.name} QPS caiu ${Math.round(dropPct)}% (${r.previousQps} → ${r.qps})`,
        });
      }
    }
  });

  // ── VIP diagnostic incidents (severity per spec) ──
  if (vipData?.vip_diagnostics) {
    for (const vip of vipData.vip_diagnostics) {
      // PARSE_ERROR = critical
      if (vip.parse_error && !vip.nft_unavailable) {
        incidents.push({
          id: `vip-${vip.ip}-parse`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'parse_error', severity: 'critical',
          reason_code: vip.reason_code || 'NFT_PARSE_FAILURE',
          metric: 'nft_parse', value: 1, threshold: 0,
          message: `VIP ${vip.ip}: ${vip.parse_error}`,
        });
      }

      // COUNTER_MISMATCH = high
      if (vip.counter_mismatch) {
        incidents.push({
          id: `vip-${vip.ip}-mismatch`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'counter_mismatch', severity: 'high',
          reason_code: vip.reason_code || 'CROSS_VALIDATION_DIVERGENCE',
          metric: 'counter_cross_validation', value: 1, threshold: 0,
          message: vip.reason || `VIP ${vip.ip} entry/path counter mismatch detectado`,
        });
      }

      // INACTIVE_VIP = medium
      if (vip.status === 'INACTIVE_VIP') {
        incidents.push({
          id: `vip-${vip.ip}-inactive`, timestamp: now, resolver: `VIP ${vip.ip}`,
          type: 'inactive_vip', severity: 'medium',
          reason_code: vip.reason_code || 'ZERO_ENTRY_PACKETS',
          metric: 'vip_traffic', value: 0, threshold: 1,
          message: vip.reason || `VIP ${vip.ip} sem tráfego observado`,
        });
      }

      // Per-backend alerts
      if (vip.backends) {
        for (const backend of vip.backends) {
          // DEAD_BACKEND = high
          if (backend.dead) {
            incidents.push({
              id: `vip-${vip.ip}-dead-${backend.ip}`, timestamp: now, resolver: `VIP ${vip.ip}`,
              type: 'dead_backend', severity: 'high',
              reason_code: backend.reason_code || 'BACKEND_UNREACHABLE_NO_TRAFFIC',
              metric: 'backend_health', value: 0, threshold: 1,
              message: backend.reason || `Backend ${backend.ip} não responde e sem tráfego`,
            });
          }
          // NEVER_SELECTED = low
          if (backend.never_selected) {
            incidents.push({
              id: `vip-${vip.ip}-ns-${backend.ip}`, timestamp: now, resolver: `VIP ${vip.ip}`,
              type: 'never_selected', severity: 'low',
              reason_code: backend.reason_code || 'BACKEND_HEALTHY_ZERO_DNAT',
              metric: 'backend_selection', value: 0, threshold: 1,
              message: backend.reason || `Backend ${backend.ip} configurado mas nunca selecionado via DNAT`,
            });
          }
        }
      }
    }
  }

  return incidents.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export default function NocIncidentDetector({ resolvers, thresholds, vipDiagnostics }: Props) {
  const [showSettings, setShowSettings] = useState(false);
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };

  const incidents = useMemo(() => detectIncidents(resolvers, t, vipDiagnostics), [resolvers, t, vipDiagnostics]);
  const criticals = incidents.filter(i => i.severity === 'critical');
  const highs = incidents.filter(i => i.severity === 'high');
  const mediums = incidents.filter(i => i.severity === 'medium');
  const lows = incidents.filter(i => i.severity === 'low');
  const isClean = incidents.length === 0;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        {isClean ? (
          <CheckCircle size={12} className="text-success" />
        ) : criticals.length > 0 ? (
          <AlertCircle size={12} className="text-destructive animate-pulse" />
        ) : highs.length > 0 ? (
          <AlertTriangle size={12} className="text-warning" />
        ) : (
          <Info size={12} className="text-accent" />
        )}
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
          DNS Incident Detection
        </span>
        <span className="text-[10px] font-mono text-muted-foreground ml-1">
          {isClean
            ? '— All Clear'
            : `— ${criticals.length}C ${highs.length}H ${mediums.length}M ${lows.length}L`
          }
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

              {/* Severity legend */}
              <div className="flex items-center gap-3 mt-2 text-[9px] font-mono text-muted-foreground">
                <span className="font-bold uppercase">Severity:</span>
                <span className="text-destructive">● CRITICAL</span>
                <span className="text-warning">● HIGH</span>
                <span className="text-accent">● MEDIUM</span>
                <span className="text-muted-foreground">● LOW</span>
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
          {incidents.map((inc, i) => {
            const styles = SEVERITY_STYLES[inc.severity];
            const SevIcon = SEVERITY_ICONS[inc.severity];
            return (
              <motion.div
                key={inc.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-start gap-3 p-2.5 rounded mb-1.5 text-xs ${styles.bg} border ${styles.border}`}
              >
                <div className="mt-0.5 shrink-0">
                  <SevIcon size={12} className={styles.text} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-bold ${styles.text}`}>
                      {INCIDENT_LABELS[inc.type] || inc.type}
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 bg-secondary rounded">
                      {inc.resolver}
                    </span>
                    <span className={`text-[10px] font-mono font-bold ${styles.text}`}>
                      {inc.severity.toUpperCase()}
                    </span>
                    {inc.reason_code && (
                      <span className="text-[9px] font-mono text-muted-foreground/60 px-1 py-0.5 bg-muted/40 rounded">
                        {inc.reason_code}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5">{inc.message}</div>
                  <div className="text-[10px] font-mono text-muted-foreground/60 mt-1">
                    metric: {inc.metric} = {inc.value} (threshold: {inc.threshold})
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
