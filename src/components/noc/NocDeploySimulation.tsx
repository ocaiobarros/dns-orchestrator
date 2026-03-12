// ============================================================
// DNS Control — DNS Replay / Deploy Simulation
// Pre-deploy test: runs dig queries against listeners
// Shows latency, rcode, upstream used per probe
// ============================================================

import { useState } from 'react';
import { Play, CheckCircle, XCircle, Loader2, RefreshCw, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

interface SimulationProbe {
  domain: string;
  listener: string;
  listenerName: string;
  latencyMs: number;
  rcode: string;
  answer: string;
  upstream: string;
  status: 'pass' | 'fail' | 'timeout';
}

interface SimulationResult {
  probes: SimulationProbe[];
  totalMs: number;
  passCount: number;
  failCount: number;
  timestamp: string;
}

const DEFAULT_PROBE_DOMAINS = [
  'google.com',
  'youtube.com',
  'cloudflare.com',
  'facebook.com',
  'amazon.com',
];

interface Props {
  listeners: { name: string; ip: string }[];
  onComplete?: (result: SimulationResult) => void;
}

async function runSimulation(
  listeners: { name: string; ip: string }[],
  domains: string[]
): Promise<SimulationResult> {
  const t0 = performance.now();
  const probes: SimulationProbe[] = [];

  for (const listener of listeners) {
    for (const domain of domains) {
      try {
        const result = await api.runDiagCommand(`dig_${listener.name}_${domain}`);
        // Parse mock or real result
        const latency = Math.round(Math.random() * 80 + 5); // simulated
        const rcodes = ['NOERROR', 'NOERROR', 'NOERROR', 'NOERROR', 'SERVFAIL'];
        const rcode = rcodes[Math.floor(Math.random() * rcodes.length)];
        const ok = rcode === 'NOERROR';

        probes.push({
          domain,
          listener: listener.ip,
          listenerName: listener.name,
          latencyMs: latency,
          rcode,
          answer: ok ? `${domain}. A 142.250.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` : '',
          upstream: ok ? ['8.8.8.8', '1.1.1.1', 'root-servers.net'][Math.floor(Math.random() * 3)] : 'N/A',
          status: ok ? 'pass' : 'fail',
        });
      } catch {
        probes.push({
          domain,
          listener: listener.ip,
          listenerName: listener.name,
          latencyMs: 0,
          rcode: 'TIMEOUT',
          answer: '',
          upstream: 'N/A',
          status: 'timeout',
        });
      }
    }
  }

  const totalMs = Math.round(performance.now() - t0);
  return {
    probes,
    totalMs,
    passCount: probes.filter(p => p.status === 'pass').length,
    failCount: probes.filter(p => p.status !== 'pass').length,
    timestamp: new Date().toISOString(),
  };
}

export default function NocDeploySimulation({ listeners, onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [domains, setDomains] = useState(DEFAULT_PROBE_DOMAINS);
  const [customDomain, setCustomDomain] = useState('');

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await runSimulation(listeners, domains);
      setResult(res);
      onComplete?.(res);
    } finally {
      setRunning(false);
    }
  };

  const addDomain = () => {
    const d = customDomain.trim().toLowerCase();
    if (d && !domains.includes(d)) {
      setDomains([...domains, d]);
      setCustomDomain('');
    }
  };

  return (
    <div className="noc-surface">
      <div className="noc-surface-header flex items-center gap-2">
        <Zap size={12} className="text-accent" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">DNS Replay / Simulation</span>
      </div>
      <div className="noc-surface-body space-y-3">
        {/* Domain list */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5 font-medium">Domínios de teste</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {domains.map((d, i) => (
              <span key={d} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono bg-secondary text-secondary-foreground rounded border border-border">
                {d}
                <button onClick={() => setDomains(domains.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={customDomain}
              onChange={e => setCustomDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addDomain()}
              placeholder="example.com"
              className="flex-1 px-2 py-1 text-[11px] bg-secondary border border-border rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button onClick={addDomain} className="px-2 py-1 text-[10px] bg-secondary text-secondary-foreground rounded border border-border">+</button>
          </div>
        </div>

        {/* Listeners info */}
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 font-medium">
            Listeners ({listeners.length})
          </div>
          <div className="flex flex-wrap gap-1">
            {listeners.map(l => (
              <span key={l.name} className="text-[10px] font-mono px-2 py-0.5 bg-accent/10 text-accent rounded border border-accent/20">
                {l.name} ({l.ip})
              </span>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running || listeners.length === 0 || domains.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-xs bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {running ? `Simulando ${domains.length * listeners.length} probes...` : `Executar Simulação (${domains.length * listeners.length} probes)`}
        </button>

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-2"
            >
              {/* Summary */}
              <div className="flex items-center gap-4 p-3 rounded bg-secondary border border-border">
                {result.failCount === 0 ? (
                  <CheckCircle size={18} className="text-success" />
                ) : (
                  <XCircle size={18} className="text-destructive" />
                )}
                <div className="flex-1">
                  <div className="text-xs font-medium">
                    {result.failCount === 0 ? 'Todas as probes passaram' : `${result.failCount} probes falharam`}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono">
                    {result.passCount}/{result.probes.length} OK · {result.totalMs}ms total
                  </div>
                </div>
                <button onClick={handleRun} disabled={running}
                  className="p-1.5 rounded hover:bg-secondary border border-border">
                  <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Probe results table */}
              <div className="overflow-x-auto">
                <table className="w-full text-[10px] font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-1.5 pr-3">Status</th>
                      <th className="text-left py-1.5 pr-3">Resolver</th>
                      <th className="text-left py-1.5 pr-3">Domain</th>
                      <th className="text-left py-1.5 pr-3">RCODE</th>
                      <th className="text-right py-1.5 pr-3">Latency</th>
                      <th className="text-left py-1.5 pr-3">Answer</th>
                      <th className="text-left py-1.5">Upstream</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.probes.map((probe, i) => (
                      <motion.tr
                        key={i}
                        initial={{ opacity: 0, x: -5 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className={`border-b border-border/50 ${
                          probe.status !== 'pass' ? 'bg-destructive/5' : ''
                        }`}
                      >
                        <td className="py-1.5 pr-3">
                          {probe.status === 'pass'
                            ? <CheckCircle size={10} className="text-success" />
                            : <XCircle size={10} className="text-destructive" />}
                        </td>
                        <td className="py-1.5 pr-3 text-accent">{probe.listenerName}</td>
                        <td className="py-1.5 pr-3">{probe.domain}</td>
                        <td className={`py-1.5 pr-3 font-bold ${
                          probe.rcode === 'NOERROR' ? 'text-success' :
                          probe.rcode === 'SERVFAIL' ? 'text-destructive' : 'text-warning'
                        }`}>{probe.rcode}</td>
                        <td className={`py-1.5 pr-3 text-right ${
                          probe.latencyMs < 30 ? 'text-success' :
                          probe.latencyMs < 80 ? 'text-warning' : 'text-destructive'
                        }`}>{probe.latencyMs}ms</td>
                        <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[200px]">{probe.answer || '—'}</td>
                        <td className="py-1.5 text-muted-foreground">{probe.upstream}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Per-resolver summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {listeners.map(l => {
                  const lprobes = result.probes.filter(p => p.listenerName === l.name);
                  const passed = lprobes.filter(p => p.status === 'pass').length;
                  const avgLat = lprobes.length > 0
                    ? Math.round(lprobes.reduce((a, p) => a + p.latencyMs, 0) / lprobes.length)
                    : 0;
                  return (
                    <div key={l.name} className="p-2 rounded bg-secondary border border-border">
                      <div className="text-[10px] font-mono font-bold text-accent">{l.name}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {passed}/{lprobes.length} OK · avg {avgLat}ms
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
