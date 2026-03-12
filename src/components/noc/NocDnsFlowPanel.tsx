import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Activity, CheckCircle, XCircle, Zap } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';

interface NocDnsFlowPanelProps {
  health: InstanceHealthReport | null | undefined;
}

function latencyColor(ms: number): string {
  if (ms < 30) return 'text-success';
  if (ms < 100) return 'text-warning';
  return 'text-destructive';
}

function latencyBarColor(ms: number): string {
  if (ms < 30) return 'hsl(142, 71%, 45%)';
  if (ms < 100) return 'hsl(38, 92%, 50%)';
  return 'hsl(0, 72%, 51%)';
}

function FlowPath({ healthy, index }: { healthy: boolean; index: number }) {
  const color = healthy ? 'hsl(142, 71%, 45%)' : 'hsl(0, 72%, 51%)';
  const opacity = healthy ? 0.4 : 0.6;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      <defs>
        <linearGradient id={`flow-grad-${index}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={color} stopOpacity={0.05} />
          <stop offset="50%" stopColor={color} stopOpacity={opacity * 0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <line
        x1="10%" y1="50%" x2="90%" y2="50%"
        stroke={`url(#flow-grad-${index})`}
        strokeWidth="1"
        strokeDasharray={healthy ? "none" : "4 3"}
      />
      {/* Animated packet dot */}
      {healthy && (
        <circle r="2" fill={color} opacity="0.6">
          <animate
            attributeName="cx"
            from="10%"
            to="90%"
            dur={`${2 + index * 0.3}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="50%;50%"
            dur="2s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0.8;0.8;0"
            dur={`${2 + index * 0.3}s`}
            repeatCount="indefinite"
          />
        </circle>
      )}
    </svg>
  );
}

export default function NocDnsFlowPanel({ health }: NocDnsFlowPanelProps) {
  if (!health || !Array.isArray(health.instances) || !health.instances.length) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="noc-glass"
      >
        <div className="noc-glass-body">
          <div className="noc-section-title">
            <Activity size={12} className="text-accent" />
            DNS RESOLUTION HEALTH
          </div>
          <div className="noc-section-divider" />
          <div className="flex items-center justify-center py-12">
            <p className="text-[11px] font-mono text-muted-foreground/40">
              Awaiting health telemetry...
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Activity size={12} className="text-accent" />
          DNS RESOLUTION HEALTH
        </div>
        <div className="noc-section-divider" />

        {/* VIP Anycast */}
        {health.vip && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="relative flex items-center justify-between py-3 px-4 mb-3 rounded-lg"
            style={{
              background: 'linear-gradient(135deg, hsl(222 24% 11%), hsl(222 24% 9%))',
              border: '1px solid hsl(var(--border) / 0.4)',
            }}
          >
            <div className="flex items-center gap-3">
              <Zap size={14} className="text-primary" />
              <div>
                <span className="text-sm font-mono font-bold text-foreground">{health.vip.bind_ip}</span>
                <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wider ml-2">VIP ANYCAST</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm font-mono font-bold ${latencyColor(health.vip.latency_ms ?? 0)}`}>
                {health.vip.latency_ms ?? 0}ms
              </span>
              {health.vip.healthy ? (
                <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-success">
                  <CheckCircle size={12} /> OK
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-destructive">
                  <XCircle size={12} /> FAIL
                </span>
              )}
            </div>
          </motion.div>
        )}

        {/* Instance flow rows */}
        <div className="space-y-0">
          {health.instances.map((inst, i) => {
            const ms = inst.latency_ms ?? 0;
            const barWidth = `${Math.min(Math.max((ms / 200) * 100, 4), 100)}%`;

            return (
              <motion.div
                key={inst.instance}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
                className="noc-health-row relative"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className={inst.healthy ? 'noc-dot-running' : 'noc-dot-error'} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono font-medium text-foreground">{inst.instance}</span>
                      <span className="text-[9px] text-muted-foreground/40 font-mono">{inst.bind_ip}:{inst.port}</span>
                    </div>
                    {inst.healthy && inst.resolved_ip && (
                      <span className="text-[9px] text-muted-foreground/50 font-mono">→ {inst.resolved_ip}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Latency bar */}
                  <div className="w-20 h-1 bg-border/20 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: barWidth }}
                      transition={{ duration: 0.8, delay: 0.3 + i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                      className="h-1 rounded-full"
                      style={{ backgroundColor: latencyBarColor(ms) }}
                    />
                  </div>
                  <span className={`text-xs font-mono font-bold tabular-nums min-w-[42px] text-right ${latencyColor(ms)}`}>
                    {ms}ms
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
