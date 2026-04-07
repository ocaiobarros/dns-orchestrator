import { motion } from 'framer-motion';
import { Activity, Wifi } from 'lucide-react';
import type { InstanceHealthReport } from '@/lib/types';
import NocTopologyColumnMap from './NocTopologyColumnMap';

interface NocTopologyPanelProps {
  health: InstanceHealthReport | null | undefined;
  vipConfigured?: boolean;
  vipAddress?: string | null;
  dnsAvailable?: boolean;
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatency?: number;
  dnsMetricsAvailable?: boolean;
}

function UnavailableState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3">
      <div className="w-12 h-12 rounded-full bg-muted/10 flex items-center justify-center border border-border/10">
        <Wifi size={18} className="text-muted-foreground/20" />
      </div>
      <p className="text-[11px] font-mono text-muted-foreground/45">{message}</p>
      <p className="text-[9px] font-mono text-muted-foreground/30">{sub}</p>
    </div>
  );
}

export default function NocTopologyPanel({
  health,
  vipConfigured,
  vipAddress,
  dnsAvailable,
  totalQueries,
  cacheHitRatio,
  avgLatency,
  dnsMetricsAvailable,
}: NocTopologyPanelProps) {
  const hasData = Boolean(health && Array.isArray(health.instances) && health.instances.length > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.12 }}
      className="noc-surface-elevated h-full"
    >
      <div className="noc-surface-body">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="noc-section-head">
            <Wifi size={12} className="text-accent/70" />
            DNS NETWORK MAP
          </div>

          <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/40 uppercase tracking-wider">
            {hasData && (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" /> ok
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive" /> falha
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" /> inativo
                </span>
                {dnsMetricsAvailable && (
                  <span className="flex items-center gap-1.5">
                    <Activity size={8} className="text-accent/70" /> telemetria
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="h-px bg-border/50" />

        {hasData ? (
          <div className="mt-4">
            <NocTopologyColumnMap
              health={health!}
              vipConfigured={vipConfigured}
              vipAddress={vipAddress}
              totalQueries={totalQueries}
              cacheHitRatio={cacheHitRatio}
              avgLatency={avgLatency}
              dnsMetricsAvailable={dnsMetricsAvailable}
            />
          </div>
        ) : !dnsAvailable ? (
          <UnavailableState message="Network map unavailable" sub="DNS health data requires privileged access" />
        ) : (
          <UnavailableState message="Awaiting health telemetry" sub="Waiting for instance probe results" />
        )}
      </div>
    </motion.div>
  );
}
