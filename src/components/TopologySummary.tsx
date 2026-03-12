// ============================================================
// DNS Control — Reusable 4-Layer Topology Summary
// Renders the canonical architecture: VIP → Listener → Egress → Transport
// Used in: Wizard Review, Dashboard, History, Health panels
// ============================================================

import type { WizardConfig, DnsInstance, ServiceVip } from '@/lib/types';
import { Globe, Layers, ExternalLink, Route, ArrowRight, Server, Shield, Activity } from 'lucide-react';

interface TopologySummaryProps {
  config: WizardConfig;
  compact?: boolean;
  showFlowArrows?: boolean;
}

function LayerBadge({ children, variant }: { children: React.ReactNode; variant: 'vip' | 'listener' | 'egress' | 'transport' }) {
  const colors = {
    vip: 'bg-primary/10 border-primary/30 text-primary',
    listener: 'bg-accent/10 border-accent/30 text-accent',
    egress: 'bg-warning/10 border-warning/30 text-warning',
    transport: 'bg-secondary border-border text-muted-foreground',
  };
  return <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-mono border ${colors[variant]}`}>{children}</span>;
}

function FlowArrow() {
  return <ArrowRight size={14} className="text-muted-foreground/40 shrink-0 mx-1" />;
}

export default function TopologySummary({ config, compact = false, showFlowArrows = true }: TopologySummaryProps) {
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs font-mono">
        <span className="text-muted-foreground mr-1">VIP</span>
        {config.serviceVips.map((v, i) => (
          <LayerBadge key={i} variant="vip">{v.ipv4}</LayerBadge>
        ))}
        {showFlowArrows && <FlowArrow />}
        <span className="text-muted-foreground mr-1">→</span>
        {config.instances.map((inst, i) => (
          <LayerBadge key={i} variant="listener">{inst.bindIp || '?'}</LayerBadge>
        ))}
        {showFlowArrows && <FlowArrow />}
        {config.instances.map((inst, i) => (
          <LayerBadge key={i} variant="egress">{inst.egressIpv4 || '?'}</LayerBadge>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Layer 1: Service VIPs */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
          <Globe size={12} /> Camada 1 — VIPs de Serviço
          <span className="text-muted-foreground/50 normal-case">(cliente consulta)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.serviceVips.length > 0 ? config.serviceVips.map((v, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-primary/5 border border-primary/20">
              <Globe size={12} className="text-primary" />
              <div>
                <div className="text-xs font-mono text-primary font-medium">{v.ipv4}{v.ipv6 ? ` / ${v.ipv6}` : ''}</div>
                <div className="text-[10px] text-muted-foreground">{v.label || `VIP ${i + 1}`} · {v.deliveryMode}</div>
              </div>
            </div>
          )) : <span className="text-xs text-muted-foreground italic">(nenhum VIP definido)</span>}
        </div>
      </div>

      {/* Flow arrow */}
      {showFlowArrows && (
        <div className="flex items-center gap-2 pl-4">
          <div className="w-px h-4 bg-muted-foreground/20" />
          <ArrowRight size={10} className="text-muted-foreground/30 -rotate-90" />
          <span className="text-[10px] text-muted-foreground/40 uppercase">nftables DNAT ({config.distributionPolicy})</span>
        </div>
      )}

      {/* Layer 2: Listeners */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
          <Layers size={12} /> Camada 2 — Listeners Internos
          <span className="text-muted-foreground/50 normal-case">(Unbound escuta)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.instances.map((inst, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-accent/5 border border-accent/20">
              <Server size={12} className="text-accent" />
              <div>
                <div className="text-xs font-mono font-medium">{inst.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {inst.bindIp || '(vazio)'}
                  {config.enableIpv6 && inst.bindIpv6 ? ` / ${inst.bindIpv6}` : ''}
                </div>
                <div className="text-[10px] text-muted-foreground/60">ctrl: {inst.controlInterface}:{inst.controlPort}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Flow arrow */}
      {showFlowArrows && (
        <div className="flex items-center gap-2 pl-4">
          <div className="w-px h-4 bg-muted-foreground/20" />
          <ArrowRight size={10} className="text-muted-foreground/30 -rotate-90" />
          <span className="text-[10px] text-muted-foreground/40 uppercase">outgoing-interface (recursão para autoritativos)</span>
        </div>
      )}

      {/* Layer 3: Egress */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
          <ExternalLink size={12} /> Camada 3 — Egress Público
          <span className="text-muted-foreground/50 normal-case">(identidade de saída)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.instances.map((inst, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded bg-warning/5 border border-warning/20">
              <ExternalLink size={12} className="text-warning" />
              <div>
                <div className="text-xs font-mono font-medium">{inst.name}</div>
                <div className="text-[10px] font-mono text-muted-foreground">
                  {inst.egressIpv4 || '(vazio)'}
                  {config.enableIpv6 && inst.egressIpv6 ? ` / ${inst.egressIpv6}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Layer 4: Transport */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
          <Route size={12} /> Camada 4 — Transporte / Entrega
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-secondary border border-border">
            <Shield size={12} className="text-muted-foreground" />
            <div>
              <div className="text-xs font-medium">{config.distributionPolicy}</div>
              <div className="text-[10px] text-muted-foreground">
                {config.routingMode === 'static' ? 'Roteamento estático' : config.routingMode === 'frr-ospf' ? 'FRR/OSPF' : 'FRR/BGP'}
                {config.behindFirewall ? ' · Host atrás de firewall' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded bg-secondary border border-border">
            <Activity size={12} className="text-muted-foreground" />
            <div>
              <div className="text-xs font-medium">{config.deploymentMode}</div>
              <div className="text-[10px] text-muted-foreground">
                {config.serviceVips.length} VIPs · {config.instances.length} instâncias
                {config.enableIpv6 ? ' · dual-stack' : ' · IPv4 only'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact one-line summary for tables and lists */
export function TopologyOneLiner({ config }: { config: WizardConfig }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground">
      <span className="text-primary">{config.serviceVips.length} VIP{config.serviceVips.length !== 1 ? 's' : ''}</span>
      <ArrowRight size={8} />
      <span className="text-accent">{config.instances.length} inst</span>
      <ArrowRight size={8} />
      <span className="text-warning">{config.instances.filter(i => i.egressIpv4).length} egress</span>
      <span className="text-muted-foreground/40">· {config.distributionPolicy} · {config.routingMode}</span>
    </div>
  );
}
