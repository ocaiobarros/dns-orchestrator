// ============================================================
// DNS Control — VIP Diagnostics Panel (Audit-Grade)
// Per-VIP entry counters, QPS from delta, cross-validation,
// debug mode with literal nft rules, source timestamps,
// STALE_DATA detection, 4-layer validation display
// ============================================================

import { useState } from 'react';
import { Globe, CheckCircle, AlertTriangle, Radio, Loader2, Shield, Wifi, XCircle, BarChart3, Bug, AlertOctagon, HelpCircle, Clock, Layers } from 'lucide-react';
import { motion } from 'framer-motion';

interface ProtoCounter {
  packets: number;
  bytes: number;
}

interface VipDnsProbe {
  resolves: boolean;
  resolved_ip: string;
  latency_ms: number;
  error: string | null;
}

interface CrossValidation {
  entry_total_packets: number;
  paths_total_packets: number;
  delta: number;
  mismatch: boolean;
  tolerance: string;
}

interface QpsData {
  qps: number | null;
  window_seconds: number | null;
  delta_packets: number | null;
  counter_reset?: boolean;
  history_reset?: boolean;
  reason?: string;
}

interface CounterHistoryEntry {
  ts: number;
  iso: string;
  entry_packets: number;
  entry_bytes: number;
  qps?: number;
  counter_reset?: boolean;
}

interface ValidationLayers {
  configuration_present: boolean;
  traffic_observed: boolean;
  resolution_functional: boolean;
  health_inferred: boolean;
}

interface SourceTimestamp {
  collected_at: string;
  duration_ms: number;
  ok: boolean;
  stale_threshold_s?: number;
}

interface BackendProbe {
  ip: string;
  status: string;
  reason?: string | null;
  packets: number;
  bytes: number;
  udp: ProtoCounter;
  tcp: ProtoCounter;
  unknown?: ProtoCounter;
  resolves: boolean;
  latency_ms: number;
  resolved_ip: string;
  dead: boolean;
  never_selected: boolean;
  traffic_pct: number;
}

interface BackendPath {
  backend_ip: string;
  backend_port: number;
  protocol: string;
  packets: number;
  bytes: number;
  chain: string;
  data_source?: string;
}

interface LiteralRule {
  type: string;
  chain?: string;
  parent_chain?: string;
  protocol_detected?: string;
  protocol_hint?: string;
  literal: string;
  packets: number | null;
  bytes: number | null;
}

interface DebugInfo {
  matched_rules: string[];
  matched_chains: string[];
  parse_notes: string[];
  literal_rules?: LiteralRule[];
}

interface VipDiagResult {
  ip: string;
  ipv6: string;
  description: string;
  vip_type: 'owned' | 'intercepted';
  status: string;
  reason?: string | null;
  reason_code?: string | null;
  healthy: boolean;
  inactive: boolean;
  parse_error: string | null;
  counter_mismatch: boolean;
  validation_layers?: ValidationLayers;
  dns_probe: VipDnsProbe;
  local_bind: { bound: boolean; required: boolean; interface: string | null };
  route: { present: boolean; type: string | null };
  dnat: { active: boolean; rule_count: number };
  entry_counters: { udp: ProtoCounter; tcp: ProtoCounter; unknown?: ProtoCounter };
  traffic: { packets: number; bytes: number; udp: ProtoCounter; tcp: ProtoCounter };
  qps?: QpsData;
  counter_history?: CounterHistoryEntry[];
  cross_validation: CrossValidation;
  backend_paths: BackendPath[];
  backends: BackendProbe[];
  debug?: DebugInfo;
}

interface RootRecursion {
  trace: { status: string; latency_ms: number; reached_root: boolean; error: string | null };
  root_query: { status: string; target: string; latency_ms: number; answer: string; error: string | null };
}

interface VipDiagnosticsData {
  vip_diagnostics: VipDiagResult[];
  root_recursion: RootRecursion;
  source_timestamps?: Record<string, SourceTimestamp>;
  stale_thresholds?: Record<string, number>;
  summary: {
    total_vips: number;
    healthy_vips: number;
    all_healthy: boolean;
    degraded: boolean;
    has_parse_errors?: boolean;
    has_counter_mismatch?: boolean;
    root_recursion_ok: boolean;
    trace_ok: boolean;
  };
}

interface Props {
  data: VipDiagnosticsData | null | undefined;
  isLoading?: boolean;
}

const DEFAULT_STALE_THRESHOLD_MS = 120_000; // 2 minutes fallback

/* ── Utility ─────────────────────────────────────────────── */

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-success' : 'bg-destructive animate-pulse'}`} />;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatPackets(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function isStale(ts: SourceTimestamp | undefined): boolean {
  if (!ts) return true;
  const age = Date.now() - new Date(ts.collected_at).getTime();
  return age > STALE_THRESHOLD_MS;
}

/* ── Status badges ───────────────────────────────────────── */

const STATUS_STYLES: Record<string, string> = {
  HEALTHY: 'bg-success/15 text-success border-success/25',
  INACTIVE_VIP: 'bg-warning/15 text-warning border-warning/25',
  COUNTER_MISMATCH: 'bg-accent/15 text-accent border-accent/25',
  PARSE_ERROR: 'bg-destructive/15 text-destructive border-destructive/25',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
  UNHEALTHY: 'bg-destructive/15 text-destructive border-destructive/25',
  DEAD: 'bg-destructive/15 text-destructive border-destructive/25',
  NEVER_SELECTED: 'bg-warning/15 text-warning border-warning/25',
  STALE_DATA: 'bg-warning/15 text-warning border-warning/25',
  OK: 'bg-success/15 text-success border-success/25',
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.UNKNOWN;
  const Icon = status === 'PARSE_ERROR' ? AlertOctagon
    : status === 'UNKNOWN' ? HelpCircle
    : status === 'COUNTER_MISMATCH' ? AlertTriangle
    : status === 'DEAD' ? XCircle
    : status === 'STALE_DATA' ? Clock
    : status === 'HEALTHY' || status === 'OK' ? CheckCircle
    : AlertTriangle;

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${style}`}>
      <Icon size={9} />
      {status.replace(/_/g, ' ')}
    </span>
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

/* ── Data source label ───────────────────────────────────── */

function DataSourceTag({ label, stale }: { label: string; stale?: boolean }) {
  return (
    <span className={`text-[8px] font-mono px-1 py-0.5 rounded border ${
      stale
        ? 'bg-warning/10 text-warning border-warning/30'
        : 'bg-muted/50 text-muted-foreground/70 border-border/50'
    }`}>
      {stale && '⚠ '}{label}
    </span>
  );
}

/* ── Source timestamps bar ───────────────────────────────── */

function SourceTimestampsBar({ sources }: { sources?: Record<string, SourceTimestamp> }) {
  if (!sources) return null;
  const entries = Object.entries(sources);
  if (entries.length === 0) return null;

  return (
    <div className="flex items-center gap-2 flex-wrap mb-2">
      <Clock size={9} className="text-muted-foreground/50" />
      <span className="text-[8px] font-mono text-muted-foreground/50 uppercase">Sources:</span>
      {entries.map(([name, ts]) => {
        const stale = isStale(ts);
        const age = Math.round((Date.now() - new Date(ts.collected_at).getTime()) / 1000);
        return (
          <span
            key={name}
            className={`text-[8px] font-mono px-1 py-0.5 rounded border ${
              stale ? 'bg-warning/10 text-warning border-warning/30' : ts.ok ? 'bg-success/5 text-success border-success/20' : 'bg-destructive/5 text-destructive border-destructive/20'
            }`}
            title={`Collected: ${ts.collected_at}, Duration: ${ts.duration_ms}ms`}
          >
            {name} {age}s ago {!ts.ok && '✗'}
          </span>
        );
      })}
    </div>
  );
}

/* ── Validation layers ───────────────────────────────────── */

function ValidationLayersBar({ layers }: { layers?: ValidationLayers }) {
  if (!layers) return null;
  const items = [
    { label: 'Config', ok: layers.configuration_present },
    { label: 'Traffic', ok: layers.traffic_observed },
    { label: 'Resolution', ok: layers.resolution_functional },
    { label: 'Health', ok: layers.health_inferred },
  ];

  return (
    <div className="flex items-center gap-1 mb-2">
      <Layers size={9} className="text-muted-foreground/50 mr-0.5" />
      {items.map(({ label, ok }) => (
        <span
          key={label}
          className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            ok ? 'bg-success/10 text-success border-success/20' : 'bg-destructive/10 text-destructive border-destructive/20'
          }`}
        >
          {ok ? '✓' : '✗'} {label}
        </span>
      ))}
    </div>
  );
}

/* ── Protocol split bar ──────────────────────────────────── */

function ProtocolBar({ udp, tcp, unknown, label, stale }: { udp: ProtoCounter; tcp: ProtoCounter; unknown?: ProtoCounter; label?: string; stale?: boolean }) {
  const unknownPkts = unknown?.packets || 0;
  const total = udp.packets + tcp.packets + unknownPkts;
  if (total === 0) return null;
  const udpPct = Math.round(udp.packets / total * 100);
  const tcpPct = Math.round(tcp.packets / total * 100);
  const unkPct = 100 - udpPct - tcpPct;

  return (
    <div className="space-y-0.5">
      {label && (
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase text-muted-foreground/60 font-bold">{label}</span>
          <DataSourceTag label="nft counter" stale={stale} />
        </div>
      )}
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted/30">
        <div className="bg-primary h-full" style={{ width: `${udpPct}%` }} title={`UDP: ${udpPct}%`} />
        <div className="bg-accent h-full" style={{ width: `${tcpPct}%` }} title={`TCP: ${tcpPct}%`} />
        {unkPct > 0 && <div className="bg-muted-foreground/30 h-full" style={{ width: `${unkPct}%` }} title={`Unknown: ${unkPct}%`} />}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground">
        <span>UDP {formatPackets(udp.packets)} ({udpPct}%)</span>
        <span>TCP {formatPackets(tcp.packets)} ({tcpPct}%)</span>
        {unkPct > 0 && <span className="text-muted-foreground/50">UNK {formatPackets(unknownPkts)} ({unkPct}%)</span>}
      </div>
    </div>
  );
}

/* ── QPS display ─────────────────────────────────────────── */

function QpsDisplay({ qps }: { qps?: QpsData }) {
  if (!qps || qps.qps === null) {
    return (
      <div className="text-[9px] text-muted-foreground/50 font-mono">QPS: calculating...</div>
    );
  }
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
        Real QPS <DataSourceTag label="delta/window" />
      </div>
      <div className="font-mono font-bold text-foreground/80">
        {qps.qps.toLocaleString()} q/s
      </div>
      <div className="text-[9px] text-muted-foreground font-mono">
        Δ{qps.delta_packets?.toLocaleString()} in {qps.window_seconds}s
        {qps.counter_reset && <span className="text-warning ml-1">⚠ reset</span>}
      </div>
    </div>
  );
}

/* ── Cross-validation banner ─────────────────────────────── */

function CrossValidationBanner({ cv }: { cv: CrossValidation }) {
  if (!cv.mismatch) {
    return (
      <div className="flex items-center gap-2 p-2 rounded bg-success/5 border border-success/15 text-[10px] font-mono">
        <CheckCircle size={10} className="text-success" />
        <span className="text-success">Cross-validation OK</span>
        <span className="text-muted-foreground">
          entry={formatPackets(cv.entry_total_packets)} paths={formatPackets(cv.paths_total_packets)} (Δ={cv.delta}, tol={cv.tolerance})
        </span>
        <DataSourceTag label="entry vs path counters" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 p-2 rounded bg-accent/10 border border-accent/25 text-[10px] font-mono">
      <AlertTriangle size={10} className="text-accent" />
      <span className="text-accent font-bold">COUNTER MISMATCH</span>
      <span className="text-muted-foreground">
        entry={formatPackets(cv.entry_total_packets)} vs paths={formatPackets(cv.paths_total_packets)} (Δ={cv.delta}, tol={cv.tolerance})
      </span>
      <DataSourceTag label="entry vs path counters" />
    </div>
  );
}

/* ── Debug panel (with literal rules) ────────────────────── */

function DebugPanel({ debug, paths }: { debug: DebugInfo; paths: BackendPath[] }) {
  return (
    <div className="mt-3 p-2 rounded bg-muted/20 border border-border/50 space-y-2">
      <div className="flex items-center gap-1.5">
        <Bug size={10} className="text-accent" />
        <span className="text-[9px] font-mono font-bold uppercase text-accent">Debug — Rule/Chain Associations</span>
      </div>

      {debug.parse_notes.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold text-muted-foreground">Parse Notes:</div>
          {debug.parse_notes.map((n, i) => (
            <div key={i} className="text-[9px] font-mono text-warning pl-2">{n}</div>
          ))}
        </div>
      )}

      {debug.matched_rules.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold text-muted-foreground">Matched Entry Rules:</div>
          {debug.matched_rules.map((r, i) => (
            <div key={i} className="text-[9px] font-mono text-muted-foreground/80 pl-2 break-all">{r}</div>
          ))}
        </div>
      )}

      {debug.matched_chains.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold text-muted-foreground">Chain Traversal:</div>
          {debug.matched_chains.map((c, i) => (
            <div key={i} className="text-[9px] font-mono text-muted-foreground/80 pl-2 break-all">{c}</div>
          ))}
        </div>
      )}

      {/* Literal nft rules */}
      {debug.literal_rules && debug.literal_rules.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold text-muted-foreground">Literal nft Rules:</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[8px] font-mono">
              <thead>
                <tr className="text-muted-foreground/60 border-b border-border/50">
                  <th className="text-left pb-0.5">Type</th>
                  <th className="text-left pb-0.5">Chain</th>
                  <th className="text-left pb-0.5">Proto</th>
                  <th className="text-right pb-0.5">Pkts</th>
                  <th className="text-right pb-0.5">Bytes</th>
                  <th className="text-left pb-0.5">Rule</th>
                </tr>
              </thead>
              <tbody>
                {debug.literal_rules.map((r, i) => (
                  <tr key={i} className="border-b border-border/20 last:border-0">
                    <td className="py-0.5">
                      <span className={`px-1 rounded ${
                        r.type === 'dnat' || r.type === 'backend_dnat' || r.type === 'nested_dnat'
                          ? 'bg-accent/15 text-accent'
                          : r.type === 'dispatch' ? 'bg-primary/15 text-primary'
                          : r.type === 'entry_counter' ? 'bg-success/15 text-success'
                          : 'bg-muted text-muted-foreground'
                      }`}>{r.type}</span>
                    </td>
                    <td className="py-0.5 text-muted-foreground/60">{r.chain || r.parent_chain || '—'}</td>
                    <td className={`py-0.5 ${r.protocol_detected === 'unknown' ? 'text-warning' : ''}`}>
                      {r.protocol_detected || r.protocol_hint || '?'}
                    </td>
                    <td className="text-right py-0.5">{r.packets != null ? formatPackets(r.packets) : '—'}</td>
                    <td className="text-right py-0.5">{r.bytes != null ? formatBytes(r.bytes) : '—'}</td>
                    <td className="py-0.5 text-muted-foreground/60 max-w-[300px] truncate" title={r.literal}>{r.literal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {paths.length > 0 && (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold text-muted-foreground">Backend Path Detail:</div>
          <table className="w-full text-[9px] font-mono">
            <thead>
              <tr className="text-muted-foreground/60 border-b border-border/50">
                <th className="text-left pb-0.5">Backend</th>
                <th className="text-left pb-0.5">Proto</th>
                <th className="text-right pb-0.5">Pkts</th>
                <th className="text-right pb-0.5">Bytes</th>
                <th className="text-left pb-0.5">Chain</th>
                <th className="text-left pb-0.5">Source</th>
              </tr>
            </thead>
            <tbody>
              {paths.map((p, i) => (
                <tr key={i} className="border-b border-border/30 last:border-0">
                  <td className="py-0.5">{p.backend_ip}:{p.backend_port}</td>
                  <td className={`py-0.5 ${p.protocol === 'unknown' ? 'text-warning' : ''}`}>{p.protocol}</td>
                  <td className="text-right py-0.5">{formatPackets(p.packets)}</td>
                  <td className="text-right py-0.5">{formatBytes(p.bytes)}</td>
                  <td className="py-0.5 text-muted-foreground/60">{p.chain || '—'}</td>
                  <td className="py-0.5"><DataSourceTag label={p.data_source || 'unknown'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Backend distribution ────────────────────────────────── */

function BackendTable({ backends }: { backends: BackendProbe[] }) {
  if (backends.length === 0) return null;
  const colors = ['bg-primary', 'bg-accent', 'bg-success', 'bg-warning'];

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <BarChart3 size={10} className="text-muted-foreground" />
        <span className="text-[9px] font-mono font-bold uppercase text-muted-foreground/60">
          Per-Backend Distribution (VIP→Backend×Protocol)
        </span>
        <DataSourceTag label="path counters" />
      </div>

      {/* Stacked bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-muted/30">
        {backends.map((b, i) => (
          <div
            key={b.ip}
            className={`${colors[i % colors.length]} ${b.dead || b.never_selected ? 'opacity-20' : ''}`}
            style={{ width: `${Math.max(b.traffic_pct, 0.5)}%` }}
            title={`${b.ip}: ${b.traffic_pct}%`}
          />
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-muted-foreground/60 border-b border-border">
              <th className="text-left pb-1 font-bold">Backend</th>
              <th className="text-right pb-1 font-bold">UDP pkts</th>
              <th className="text-right pb-1 font-bold">TCP pkts</th>
              <th className="text-right pb-1 font-bold">Total</th>
              <th className="text-right pb-1 font-bold">Bytes</th>
              <th className="text-right pb-1 font-bold">%</th>
              <th className="text-right pb-1 font-bold">Latency</th>
              <th className="text-left pb-1 font-bold">Status</th>
            </tr>
          </thead>
          <tbody>
            {backends.map((b, i) => (
              <tr key={b.ip} className="border-b border-border/50 last:border-0">
                <td className="py-1.5">
                  <span className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-sm ${colors[i % colors.length]} ${b.dead || b.never_selected ? 'opacity-20' : ''}`} />
                    <span className="font-bold text-foreground">{b.ip}</span>
                  </span>
                </td>
                <td className="text-right py-1.5 text-primary">{formatPackets(b.udp.packets)}</td>
                <td className="text-right py-1.5 text-accent">{formatPackets(b.tcp.packets)}</td>
                <td className="text-right py-1.5 font-bold">{formatPackets(b.packets)}</td>
                <td className="text-right py-1.5 text-muted-foreground">{formatBytes(b.bytes)}</td>
                <td className="text-right py-1.5 font-bold">{b.traffic_pct}%</td>
                <td className="text-right py-1.5">
                  {b.resolves ? (
                    <span className="text-success">{b.latency_ms}ms</span>
                  ) : (
                    <span className="text-destructive">FAIL</span>
                  )}
                </td>
                <td className="py-1.5">
                  <div className="flex flex-col gap-0.5">
                    <StatusBadge status={b.status} />
                    {b.reason && (
                      <span className="text-[8px] text-muted-foreground/60 max-w-[200px] truncate" title={b.reason}>
                        {b.reason}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Mini QPS sparkline ──────────────────────────────────── */

function QpsSparkline({ history }: { history?: CounterHistoryEntry[] }) {
  if (!history || history.length < 2) return null;
  const qpsValues = history.filter(h => h.qps != null).map(h => h.qps!);
  if (qpsValues.length < 2) return null;

  const max = Math.max(...qpsValues, 1);
  const w = 120;
  const h = 24;
  const step = w / (qpsValues.length - 1);
  const pts = qpsValues.map((v, i) => `${i * step},${h - (v / max) * h}`).join(' ');

  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
        QPS History <DataSourceTag label="counter delta" />
      </div>
      <svg width={w} height={h} className="overflow-visible">
        <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth={1.5} />
      </svg>
      <div className="text-[8px] font-mono text-muted-foreground">
        {qpsValues.length} samples, max {Math.round(max)} q/s
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export default function NocVipDiagnostics({ data, isLoading }: Props) {
  const [showDebug, setShowDebug] = useState(false);
  const hasData = !!data;
  const summary = data?.summary;
  const overallOk = summary ? summary.all_healthy && summary.root_recursion_ok : null;

  // Check for stale data
  const anyStale = data?.source_timestamps
    ? Object.values(data.source_timestamps).some(ts => isStale(ts))
    : false;

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <Shield size={12} className={overallOk === true ? 'text-success' : overallOk === false ? 'text-destructive' : 'text-muted-foreground'} />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
          Service VIP Diagnostics
        </span>
        {isLoading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
        {summary && (
          <>
            <span className={`text-[10px] font-mono ml-1 ${overallOk ? 'text-success' : 'text-destructive'}`}>
              — {summary.healthy_vips}/{summary.total_vips} VIPs healthy
            </span>
            {summary.has_parse_errors && <StatusBadge status="PARSE_ERROR" />}
            {summary.has_counter_mismatch && <StatusBadge status="COUNTER_MISMATCH" />}
            {anyStale && <StatusBadge status="STALE_DATA" />}
          </>
        )}
        <button
          onClick={() => setShowDebug(d => !d)}
          className={`ml-auto text-[9px] font-mono px-2 py-0.5 rounded border transition-colors ${
            showDebug
              ? 'bg-accent/15 text-accent border-accent/30'
              : 'bg-muted/30 text-muted-foreground border-border hover:border-accent/30'
          }`}
        >
          <Bug size={9} className="inline mr-1" />
          {showDebug ? 'DEBUG ON' : 'DEBUG'}
        </button>
      </div>

      <div className="noc-surface-body space-y-4">
        {!hasData && !isLoading && (
          <div className="text-xs text-muted-foreground py-3">Aguardando dados de diagnóstico de VIPs...</div>
        )}

        {hasData && (
          <>
            {/* Source timestamps */}
            <SourceTimestampsBar sources={data.source_timestamps} />

            {/* VIP Health Grid */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Radio size={11} className="text-primary" />
                <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-foreground/80">
                  Service VIPs — Per-VIP Counters
                </span>
                <DataSourceTag label="nft list ruleset + dig probes" stale={data.source_timestamps ? isStale(data.source_timestamps.nft) : false} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                {data.vip_diagnostics.map((vip, i) => (
                  <motion.div
                    key={vip.ip}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`p-3 rounded text-xs border ${
                      vip.status === 'HEALTHY' ? 'bg-success/5 border-success/20'
                      : vip.status === 'INACTIVE_VIP' ? 'bg-warning/5 border-warning/20'
                      : vip.status === 'COUNTER_MISMATCH' ? 'bg-accent/5 border-accent/20'
                      : vip.status === 'PARSE_ERROR' ? 'bg-destructive/5 border-destructive/15'
                      : vip.status === 'UNKNOWN' ? 'bg-muted/30 border-border'
                      : 'bg-destructive/8 border-destructive/20'
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <StatusDot ok={vip.healthy} />
                      <span className="font-mono font-bold text-sm">{vip.ip}</span>
                      <VipTypeBadge type={vip.vip_type} />
                      <StatusBadge status={vip.status} />
                      <span className="text-[10px] text-muted-foreground ml-auto">{vip.description}</span>
                    </div>

                    {/* Reason for non-healthy */}
                    {vip.reason && (
                      <div className="flex items-start gap-2 p-2 mb-2 rounded bg-muted/30 border border-border/50 text-[10px] font-mono text-muted-foreground">
                        <HelpCircle size={10} className="shrink-0 mt-0.5" />
                        <span>{vip.reason}</span>
                      </div>
                    )}

                    {/* Parse error banner */}
                    {vip.parse_error && !vip.reason && (
                      <div className="flex items-center gap-2 p-2 mb-2 rounded bg-destructive/10 border border-destructive/20 text-[10px] font-mono text-destructive">
                        <AlertOctagon size={10} />
                        <span className="font-bold">PARSE ERROR:</span>
                        <span>{vip.parse_error}</span>
                      </div>
                    )}

                    {/* Validation layers */}
                    <ValidationLayersBar layers={vip.validation_layers} />

                    {/* Status grid */}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
                          DNS Probe <DataSourceTag label="dig" stale={data.source_timestamps ? isStale(data.source_timestamps.dig) : false} />
                        </div>
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

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
                          Local Bind <DataSourceTag label="ip addr" stale={data.source_timestamps ? isStale(data.source_timestamps.ip_addr) : false} />
                        </div>
                        {vip.local_bind.required ? (
                          <div className={`flex items-center gap-1 ${vip.local_bind.bound ? 'text-success' : 'text-destructive'}`}>
                            {vip.local_bind.bound ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                            <span className="font-mono">{vip.local_bind.bound ? vip.local_bind.interface : 'NOT BOUND'}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Wifi size={10} />
                            <span className="font-mono text-[10px]">DNAT only</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
                          Route /32 <DataSourceTag label="ip route" stale={data.source_timestamps ? isStale(data.source_timestamps.ip_route) : false} />
                        </div>
                        <div className={`flex items-center gap-1 ${vip.route.present ? 'text-success' : 'text-warning'}`}>
                          {vip.route.present ? <CheckCircle size={10} /> : <AlertTriangle size={10} />}
                          <span className="font-mono">{vip.route.present ? 'OK' : 'MISSING'}</span>
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
                          DNAT Rules <DataSourceTag label="nft" stale={data.source_timestamps ? isStale(data.source_timestamps.nft) : false} />
                        </div>
                        <div className={`flex items-center gap-1 ${vip.dnat.active ? 'text-success' : 'text-muted-foreground'}`}>
                          {vip.dnat.active ? <CheckCircle size={10} /> : <Wifi size={10} />}
                          <span className="font-mono">
                            {vip.dnat.active ? `${vip.dnat.rule_count} paths` : 'N/A'}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-[9px] uppercase text-muted-foreground/60 font-bold">
                          VIP Entry <DataSourceTag label="entry counter" />
                        </div>
                        <div className={`font-mono font-bold ${
                          vip.traffic.packets > 0 ? 'text-foreground/80' : 'text-warning'
                        }`}>
                          {formatPackets(vip.traffic.packets)} pkts
                        </div>
                        <div className="text-[9px] text-muted-foreground font-mono">
                          {formatBytes(vip.traffic.bytes)}
                        </div>
                      </div>

                      {/* QPS from delta */}
                      <QpsDisplay qps={vip.qps} />
                    </div>

                    {/* QPS sparkline */}
                    <QpsSparkline history={vip.counter_history} />

                    {/* Per-VIP protocol split */}
                    <ProtocolBar
                      udp={vip.traffic.udp}
                      tcp={vip.traffic.tcp}
                      unknown={vip.entry_counters.unknown}
                      label="VIP Entry — UDP vs TCP"
                      stale={data.source_timestamps ? isStale(data.source_timestamps.nft) : false}
                    />

                    {/* Cross-validation */}
                    {vip.cross_validation && (
                      <div className="mt-2">
                        <CrossValidationBanner cv={vip.cross_validation} />
                      </div>
                    )}

                    {/* Backend distribution */}
                    <BackendTable backends={vip.backends} />

                    {/* Debug panel */}
                    {showDebug && vip.debug && (
                      <DebugPanel debug={vip.debug} paths={vip.backend_paths} />
                    )}
                    {showDebug && !vip.debug && (
                      <div className="mt-3 p-2 rounded bg-muted/20 border border-border/50 text-[9px] font-mono text-muted-foreground">
                        <Bug size={9} className="inline mr-1" />
                        Debug data not available — enable <code>?debug=1</code> on API call
                      </div>
                    )}

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
                <DataSourceTag label="dig +trace / dig @root-servers" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div className={`p-2.5 rounded text-xs border ${
                  data.root_recursion.trace.status === 'ok'
                    ? 'bg-success/5 border-success/20'
                    : 'bg-destructive/8 border-destructive/20'
                }`}>
                  <div className="flex items-center gap-2">
                    <StatusDot ok={data.root_recursion.trace.status === 'ok'} />
                    <span className="font-mono font-bold">dig +trace google.com</span>
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
