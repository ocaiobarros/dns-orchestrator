import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_CONFIG,
  type WizardConfig,
  type DnsInstance,
  type ServiceVip,
  type AccessControlEntry,
  type DeploymentMode,
  type VipDeliveryMode,
  type VipDistributionPolicy,
  type RoutingMode,
} from '@/lib/types';
import { validateConfig, getStepErrors, isConfigValid } from '@/lib/validation';
import { generateAllFiles } from '@/lib/config-generator';
import { useApplyConfig } from '@/lib/hooks';
import ApplyStepsViewer from '@/components/ApplyStepsViewer';
import {
  Check, ChevronLeft, ChevronRight, AlertTriangle, Play, Eye, AlertCircle,
  Loader2, Server, Network, Shield, Globe, Layers, Route, Settings, FileText,
  Plus, Trash2, Info,
} from 'lucide-react';
import type { ApplyResult } from '@/lib/types';

const STEPS = [
  'Topologia do Host',
  'Modo de Deploy',
  'VIPs de Serviço',
  'Instâncias Resolver',
  'Política de Entrega',
  'Controle de Acesso',
  'Roteamento',
  'Revisão & Deploy',
];

const STEP_ICONS = [Server, Network, Globe, Layers, Route, Shield, Settings, FileText];

// ---- Reusable form components ----

function FieldGroup({ label, children, error, hint }: { label: string; children: React.ReactNode; error?: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={10} />{error}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', disabled = false }: {
  value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean;
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; description?: string }[] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-primary' : 'bg-secondary border border-border'}`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full transition-transform ${checked ? 'translate-x-4 bg-primary-foreground' : 'translate-x-0.5 bg-muted-foreground'}`} />
      </div>
      <span className="text-sm">{label}</span>
    </label>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded bg-accent/10 border border-accent/20 text-xs text-accent">
      <Info size={14} className="shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

function ListInput({ items, onChange, placeholder }: { items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    if (draft.trim() && !items.includes(draft.trim())) { onChange([...items, draft.trim()]); setDraft(''); }
  };
  return (
    <div>
      <div className="flex gap-2 mb-2">
        <Input value={draft} onChange={setDraft} placeholder={placeholder} />
        <button onClick={add} className="px-3 py-2 text-xs bg-primary text-primary-foreground rounded font-medium shrink-0">+</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-secondary text-secondary-foreground rounded border border-border">
            {item}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- Main Wizard ----

export default function Wizard() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<WizardConfig>({ ...DEFAULT_CONFIG });
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const applyMutation = useApplyConfig();
  const navigate = useNavigate();

  const validationErrors = validateConfig(config);
  const stepErrors = (s: number) => getStepErrors(validationErrors, s);

  const set = <K extends keyof WizardConfig>(key: K, val: WizardConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const updateInstance = (idx: number, field: keyof DnsInstance, val: string | number) => {
    const instances = [...config.instances];
    instances[idx] = { ...instances[idx], [field]: val };
    set('instances', instances);
  };

  const updateVip = (idx: number, field: keyof ServiceVip, val: string) => {
    const vips = [...config.serviceVips];
    vips[idx] = { ...vips[idx], [field]: val };
    set('serviceVips', vips);
  };

  const updateAcl = (type: 'ipv4' | 'ipv6', idx: number, field: keyof AccessControlEntry, val: string) => {
    const key = type === 'ipv4' ? 'accessControlIpv4' : 'accessControlIpv6';
    const acls = [...config[key]];
    acls[idx] = { ...acls[idx], [field]: val };
    set(key, acls);
  };

  const fieldError = (field: string): string | undefined => {
    if (!showValidation) return undefined;
    return validationErrors.find(e => e.field === field && e.severity === 'error')?.message;
  };

  const handleApply = (dryRun: boolean) => {
    setShowValidation(true);
    if (!isConfigValid(validationErrors) && !dryRun) return;
    applyMutation.mutate(
      { config, scope: 'full', dryRun, comment: '' },
      { onSuccess: (result) => setApplyResult(result) }
    );
  };

  const handleNext = () => {
    setShowValidation(true);
    const errs = stepErrors(step).filter(e => e.severity === 'error');
    if (errs.length === 0) {
      setShowValidation(false);
      setStep(Math.min(7, step + 1));
    }
  };

  const addInstance = () => {
    const n = config.instances.length + 1;
    const newInst: DnsInstance = {
      name: `unbound${String(n).padStart(2, '0')}`,
      bindIp: `100.127.255.${100 + n}`,
      bindIpv6: '',
      controlInterface: `127.0.0.${10 + n}`,
      controlPort: 8953,
      egressIpv4: '',
      egressIpv6: '',
    };
    set('instances', [...config.instances, newInst]);
  };

  const generatedFiles = generateAllFiles(config);

  const renderStep = () => {
    switch (step) {
      // ═══ STEP 1: Host Topology ═══
      case 0:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure a topologia do host onde o DNS recursivo será implantado.
              Para hosts atrás de firewall, os IPs públicos permanecem no equipamento de borda.
            </InfoBox>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="Hostname *" error={fieldError('hostname')} hint="FQDN do servidor">
                <Input value={config.hostname} onChange={v => set('hostname', v)} placeholder="dns-rec-01.example.com" />
              </FieldGroup>
              <FieldGroup label="Organização *" error={fieldError('organization')}>
                <Input value={config.organization} onChange={v => set('organization', v)} placeholder="MinhaOperadora" />
              </FieldGroup>
              <FieldGroup label="Interface principal *" error={fieldError('mainInterface')} hint="NIC primária do host">
                <Input value={config.mainInterface} onChange={v => set('mainInterface', v)} placeholder="ens192" />
              </FieldGroup>
              <FieldGroup label="VLAN Tag" hint="Opcional — deixe vazio se não usar VLAN">
                <Input value={config.vlanTag} onChange={v => set('vlanTag', v)} placeholder="Ex: 100" />
              </FieldGroup>
              <FieldGroup label="Endereço IPv4 (CIDR) *" error={fieldError('ipv4Address')} hint="IP privado do host">
                <Input value={config.ipv4Address} onChange={v => set('ipv4Address', v)} placeholder="172.29.22.6/30" />
              </FieldGroup>
              <FieldGroup label="Gateway IPv4 *" error={fieldError('ipv4Gateway')}>
                <Input value={config.ipv4Gateway} onChange={v => set('ipv4Gateway', v)} placeholder="172.29.22.5" />
              </FieldGroup>
            </div>
            <Toggle checked={config.enableIpv6} onChange={v => set('enableIpv6', v)} label="Habilitar IPv6" />
            {config.enableIpv6 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldGroup label="Endereço IPv6" error={fieldError('ipv6Address')}>
                  <Input value={config.ipv6Address} onChange={v => set('ipv6Address', v)} placeholder="2804:4AFC:8844::2/64" />
                </FieldGroup>
                <FieldGroup label="Gateway IPv6" error={fieldError('ipv6Gateway')}>
                  <Input value={config.ipv6Gateway} onChange={v => set('ipv6Gateway', v)} placeholder="2804:4AFC:8844::1" />
                </FieldGroup>
              </div>
            )}
            <Toggle checked={config.behindFirewall} onChange={v => set('behindFirewall', v)} label="Host atrás de firewall (IPs públicos ficam no equipamento de borda)" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="Projeto" hint="Nome do projeto de deploy">
                <Input value={config.project} onChange={v => set('project', v)} placeholder="DNS Recursivo Produção" />
              </FieldGroup>
              <FieldGroup label="Timezone">
                <Input value={config.timezone} onChange={v => set('timezone', v)} />
              </FieldGroup>
            </div>
          </div>
        );

      // ═══ STEP 2: Deployment Mode ═══
      case 1:
        return (
          <div className="space-y-4">
            <InfoBox>
              Escolha o modelo de exposição do serviço DNS. O modo define como os clientes alcançam o resolver.
            </InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'internal-recursive', label: 'DNS Recursivo Interno', desc: 'Resolvers acessíveis apenas na rede interna. Sem VIP público.' },
                { value: 'public-recursive', label: 'DNS Recursivo Público', desc: 'Resolvers expostos diretamente com IPs públicos.' },
                { value: 'vip-recursive', label: 'DNS Recursivo via VIP', desc: 'Clientes consultam VIPs de serviço. Tráfego entregue via NAT/DNAT aos resolvers internos. Recomendado para ISP.' },
                { value: 'routed-vip', label: 'VIP Roteado', desc: 'VIPs anunciados via roteamento estático. Resolvers internos recebem tráfego diretamente.' },
                { value: 'frr-ospf-vip', label: 'VIP via FRR/OSPF', desc: 'VIPs anunciados via OSPF usando FRR. Para ambientes com roteamento dinâmico.' },
              ] as { value: DeploymentMode; label: string; desc: string }[]).map(mode => (
                <button
                  key={mode.value}
                  onClick={() => set('deploymentMode', mode.value)}
                  className={`text-left p-4 rounded border transition-all ${
                    config.deploymentMode === mode.value
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border bg-secondary hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="font-medium text-sm">{mode.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{mode.desc}</div>
                </button>
              ))}
            </div>
          </div>
        );

      // ═══ STEP 3: Service VIPs ═══
      case 2:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure os endereços DNS que os clientes usarão (ex: 4.2.2.5, 4.2.2.6).
              Estes VIPs são os IPs de serviço — não necessariamente os IPs reais dos resolvers.
            </InfoBox>
            <div className="space-y-3">
              {config.serviceVips.map((vip, i) => (
                <div key={i} className="p-4 rounded bg-secondary border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase">VIP {i + 1}</span>
                    {config.serviceVips.length > 1 && (
                      <button onClick={() => set('serviceVips', config.serviceVips.filter((_, j) => j !== i))}
                        className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1">
                        <Trash2 size={12} /> Remover
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <FieldGroup label="IPv4 *" error={fieldError(`serviceVips[${i}].ipv4`)}>
                      <Input value={vip.ipv4} onChange={v => updateVip(i, 'ipv4', v)} placeholder="4.2.2.5" />
                    </FieldGroup>
                    {config.vipIpv6Enabled && (
                      <FieldGroup label="IPv6">
                        <Input value={vip.ipv6} onChange={v => updateVip(i, 'ipv6', v)} placeholder="2620:119:35::35" />
                      </FieldGroup>
                    )}
                    <FieldGroup label="Label">
                      <Input value={vip.label} onChange={v => updateVip(i, 'label', v)} placeholder="DNS Primário" />
                    </FieldGroup>
                    <FieldGroup label="Modo de Entrega">
                      <Select value={vip.deliveryMode} onChange={v => updateVip(i, 'deliveryMode', v)}
                        options={[
                          { value: 'local-vip', label: 'VIP Local' },
                          { value: 'routed-vip', label: 'VIP Roteado' },
                          { value: 'firewall-delivered', label: 'Entregue via Firewall' },
                        ]} />
                    </FieldGroup>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => set('serviceVips', [...config.serviceVips, { ipv4: '', ipv6: '', label: '', deliveryMode: 'firewall-delivered' }])}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                <Plus size={12} /> Adicionar VIP
              </button>
              <Toggle checked={config.vipIpv6Enabled} onChange={v => set('vipIpv6Enabled', v)} label="VIPs IPv6" />
            </div>
          </div>
        );

      // ═══ STEP 4: Resolver Instances ═══
      case 3:
        return (
          <div className="space-y-4">
            <InfoBox>
              Cada instância é um processo Unbound separado com listener, interface de controle e IP de saída (egress) próprios.
              O IP de egress é a identidade pública do resolver ao fazer recursão.
            </InfoBox>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FieldGroup label="Threads por instância *" error={fieldError('threads')}>
                <Input type="number" value={config.threads} onChange={v => set('threads', parseInt(v) || 1)} />
              </FieldGroup>
              <FieldGroup label="Msg Cache"><Input value={config.msgCacheSize} onChange={v => set('msgCacheSize', v)} /></FieldGroup>
              <FieldGroup label="RRset Cache"><Input value={config.rrsetCacheSize} onChange={v => set('rrsetCacheSize', v)} /></FieldGroup>
              <FieldGroup label="Max TTL"><Input type="number" value={config.maxTtl} onChange={v => set('maxTtl', parseInt(v) || 0)} /></FieldGroup>
              <FieldGroup label="Root Hints"><Input value={config.rootHintsPath} onChange={v => set('rootHintsPath', v)} /></FieldGroup>
              <FieldGroup label="DNS Identity"><Input value={config.dnsIdentity} onChange={v => set('dnsIdentity', v)} placeholder="67-DNS" /></FieldGroup>
            </div>
            <div className="flex gap-4">
              <Toggle checked={config.enableDetailedLogs} onChange={v => set('enableDetailedLogs', v)} label="Logs detalhados" />
              <Toggle checked={config.enableBlocklist} onChange={v => set('enableBlocklist', v)} label="Blocklist" />
            </div>

            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Instâncias ({config.instances.length})</span>
                <button onClick={addInstance}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                  <Plus size={12} /> Adicionar instância
                </button>
              </div>
              <div className="space-y-3">
                {config.instances.map((inst, i) => (
                  <div key={i} className="p-4 rounded bg-secondary border border-border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-primary uppercase">Instância {i + 1}</span>
                      {config.instances.length > 1 && (
                        <button onClick={() => set('instances', config.instances.filter((_, j) => j !== i))}
                          className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1">
                          <Trash2 size={12} /> Remover
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      <FieldGroup label="Nome *" error={fieldError(`instances[${i}].name`)}>
                        <Input value={inst.name} onChange={v => updateInstance(i, 'name', v)} />
                      </FieldGroup>
                      <FieldGroup label="Listener IPv4 *" error={fieldError(`instances[${i}].bindIp`)} hint="IP interno na loopback">
                        <Input value={inst.bindIp} onChange={v => updateInstance(i, 'bindIp', v)} placeholder="100.127.255.101" />
                      </FieldGroup>
                      {config.enableIpv6 && (
                        <FieldGroup label="Listener IPv6" hint="IP IPv6 na loopback">
                          <Input value={inst.bindIpv6} onChange={v => updateInstance(i, 'bindIpv6', v)} placeholder="2001:db8:ffff:ffff:100:127:255:101" />
                        </FieldGroup>
                      )}
                      <FieldGroup label="Egress IPv4 *" error={fieldError(`instances[${i}].egressIpv4`)} hint="IP público de saída para recursão">
                        <Input value={inst.egressIpv4} onChange={v => updateInstance(i, 'egressIpv4', v)} placeholder="45.232.215.20" />
                      </FieldGroup>
                      {config.enableIpv6 && (
                        <FieldGroup label="Egress IPv6" hint="IP público IPv6 de saída">
                          <Input value={inst.egressIpv6} onChange={v => updateInstance(i, 'egressIpv6', v)} placeholder="2804:4afc:8888::1000" />
                        </FieldGroup>
                      )}
                      <FieldGroup label="Control Interface" hint="IP do remote-control">
                        <Input value={inst.controlInterface} onChange={v => updateInstance(i, 'controlInterface', v)} placeholder="127.0.0.11" />
                      </FieldGroup>
                      <FieldGroup label="Control Port">
                        <Input type="number" value={inst.controlPort} onChange={v => updateInstance(i, 'controlPort', parseInt(v) || 8953)} />
                      </FieldGroup>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );

      // ═══ STEP 5: VIP Delivery Policy ═══
      case 4:
        return (
          <div className="space-y-4">
            <InfoBox>
              Define como o tráfego dos VIPs é distribuído entre as instâncias resolver.
              O modo "Sticky por Origem" memoriza o resolver associado a cada IP de cliente (recomendado para DNS).
            </InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'fixed-mapping', label: 'Mapeamento Fixo', desc: 'Cada VIP é associado a uma instância específica. Ex: VIP1→unbound01, VIP2→unbound02.' },
                { value: 'round-robin', label: 'Round Robin', desc: 'Distribuição sequencial entre todas as instâncias via numgen.' },
                { value: 'sticky-source', label: 'Sticky por Origem (Recomendado)', desc: 'Memoriza o resolver por IP de origem. Usa sets nftables com timeout. Fallback round-robin.' },
                { value: 'nth-balancing', label: 'Nth Balancing', desc: 'Balanceamento nth com numgen e decrementação progressiva do módulo.' },
                { value: 'active-passive', label: 'Ativo/Passivo', desc: 'Uma instância primária, demais em standby para failover.' },
              ] as { value: VipDistributionPolicy; label: string; desc: string }[]).map(policy => (
                <button
                  key={policy.value}
                  onClick={() => set('distributionPolicy', policy.value)}
                  className={`text-left p-4 rounded border transition-all ${
                    config.distributionPolicy === policy.value
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border bg-secondary hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="font-medium text-sm">{policy.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{policy.desc}</div>
                </button>
              ))}
            </div>
            {config.distributionPolicy === 'sticky-source' && (
              <FieldGroup label="Sticky Timeout (minutos)" hint="Tempo que o IP de origem permanece vinculado ao resolver">
                <Input type="number" value={config.stickyTimeout / 60} onChange={v => set('stickyTimeout', (parseInt(v) || 20) * 60)} />
              </FieldGroup>
            )}
            <Toggle checked={config.enableDnsProtection} onChange={v => set('enableDnsProtection', v)} label="Proteção DNS (rate limiting via nftables)" />
          </div>
        );

      // ═══ STEP 6: Access Control ═══
      case 5:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure as redes autorizadas a usar o resolver. ACLs abertas (0.0.0.0/0 allow) configuram um open resolver — exige confirmação explícita.
            </InfoBox>

            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ACLs IPv4</div>
              {config.accessControlIpv4.map((acl, i) => (
                <div key={i} className="grid grid-cols-3 md:grid-cols-4 gap-3 p-3 rounded bg-secondary border border-border">
                  <FieldGroup label="Rede">
                    <Input value={acl.network} onChange={v => updateAcl('ipv4', i, 'network', v)} placeholder="172.16.0.0/12" />
                  </FieldGroup>
                  <FieldGroup label="Ação">
                    <Select value={acl.action} onChange={v => updateAcl('ipv4', i, 'action', v)}
                      options={[
                        { value: 'allow', label: 'allow' },
                        { value: 'refuse', label: 'refuse' },
                        { value: 'deny', label: 'deny' },
                        { value: 'allow_snoop', label: 'allow_snoop' },
                      ]} />
                  </FieldGroup>
                  <FieldGroup label="Label">
                    <Input value={acl.label} onChange={v => updateAcl('ipv4', i, 'label', v)} placeholder="Rede interna" />
                  </FieldGroup>
                  <div className="flex items-end">
                    <button onClick={() => set('accessControlIpv4', config.accessControlIpv4.filter((_, j) => j !== i))}
                      className="px-2 py-2 text-xs text-destructive hover:bg-destructive/10 rounded"><Trash2 size={12} /></button>
                  </div>
                </div>
              ))}
              <button onClick={() => set('accessControlIpv4', [...config.accessControlIpv4, { network: '', action: 'allow', label: '' }])}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                <Plus size={12} /> Adicionar ACL IPv4
              </button>
            </div>

            {config.enableIpv6 && (
              <div className="space-y-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ACLs IPv6</div>
                {config.accessControlIpv6.map((acl, i) => (
                  <div key={i} className="grid grid-cols-3 md:grid-cols-4 gap-3 p-3 rounded bg-secondary border border-border">
                    <FieldGroup label="Rede">
                      <Input value={acl.network} onChange={v => updateAcl('ipv6', i, 'network', v)} placeholder="::/0" />
                    </FieldGroup>
                    <FieldGroup label="Ação">
                      <Select value={acl.action} onChange={v => updateAcl('ipv6', i, 'action', v)}
                        options={[
                          { value: 'allow', label: 'allow' },
                          { value: 'refuse', label: 'refuse' },
                          { value: 'deny', label: 'deny' },
                        ]} />
                    </FieldGroup>
                    <FieldGroup label="Label">
                      <Input value={acl.label} onChange={v => updateAcl('ipv6', i, 'label', v)} />
                    </FieldGroup>
                    <div className="flex items-end">
                      <button onClick={() => set('accessControlIpv6', config.accessControlIpv6.filter((_, j) => j !== i))}
                        className="px-2 py-2 text-xs text-destructive hover:bg-destructive/10 rounded"><Trash2 size={12} /></button>
                    </div>
                  </div>
                ))}
                <button onClick={() => set('accessControlIpv6', [...config.accessControlIpv6, { network: '', action: 'allow', label: '' }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                  <Plus size={12} /> Adicionar ACL IPv6
                </button>
              </div>
            )}

            {config.accessControlIpv4.some(a => a.network === '0.0.0.0/0' && a.action === 'allow') && (
              <div className="p-3 rounded bg-destructive/10 border border-destructive/30 space-y-2">
                <div className="flex items-center gap-2 text-sm text-destructive font-medium">
                  <AlertTriangle size={14} /> Open Resolver Detectado
                </div>
                <p className="text-xs text-destructive/80">
                  A ACL 0.0.0.0/0 allow configura um open resolver. Isso pode ser explorado para ataques de amplificação DNS.
                </p>
                <Toggle checked={config.openResolverConfirmed} onChange={v => set('openResolverConfirmed', v)}
                  label="Confirmo que quero operar como open resolver" />
              </div>
            )}
          </div>
        );

      // ═══ STEP 7: Routing Mode ═══
      case 6:
        return (
          <div className="space-y-4">
            <InfoBox>
              Define como os VIPs serão alcançáveis na rede. Em modo estático, o roteamento é configurado manualmente.
              Com FRR/OSPF, os VIPs são anunciados automaticamente via roteamento dinâmico.
            </InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'static', label: 'Roteamento Estático', desc: 'VIPs alcançáveis via rotas estáticas configuradas no firewall/router. DNS Control não gera configuração de roteamento.' },
                { value: 'frr-ospf', label: 'FRR / OSPF', desc: 'FRR anuncia VIPs via OSPF. Gera configuração completa do FRR com redistribute connected.' },
                { value: 'frr-bgp', label: 'FRR / BGP (Futuro)', desc: 'Suporte a BGP via FRR. Em desenvolvimento.' },
              ] as { value: RoutingMode; label: string; desc: string }[]).map(mode => (
                <button
                  key={mode.value}
                  onClick={() => mode.value !== 'frr-bgp' && set('routingMode', mode.value)}
                  disabled={mode.value === 'frr-bgp'}
                  className={`text-left p-4 rounded border transition-all ${
                    config.routingMode === mode.value
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : mode.value === 'frr-bgp'
                      ? 'border-border bg-secondary/50 opacity-50 cursor-not-allowed'
                      : 'border-border bg-secondary hover:border-muted-foreground/30'
                  }`}
                >
                  <div className="font-medium text-sm">{mode.label}</div>
                  <div className="text-xs text-muted-foreground mt-1">{mode.desc}</div>
                </button>
              ))}
            </div>

            {config.routingMode === 'frr-ospf' && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldGroup label="Router ID *" error={fieldError('routerId')}>
                    <Input value={config.routerId} onChange={v => set('routerId', v)} placeholder="172.29.22.6" />
                  </FieldGroup>
                  <FieldGroup label="Área OSPF *" error={fieldError('ospfArea')}>
                    <Input value={config.ospfArea} onChange={v => set('ospfArea', v)} placeholder="0.0.0.0" />
                  </FieldGroup>
                  <FieldGroup label="Custo OSPF" error={fieldError('ospfCost')}>
                    <Input type="number" value={config.ospfCost} onChange={v => set('ospfCost', parseInt(v) || 1)} />
                  </FieldGroup>
                  <FieldGroup label="Network Type">
                    <Select value={config.networkType} onChange={v => set('networkType', v as 'point-to-point' | 'broadcast')}
                      options={[
                        { value: 'point-to-point', label: 'Point-to-Point' },
                        { value: 'broadcast', label: 'Broadcast' },
                      ]} />
                  </FieldGroup>
                </div>
                <Toggle checked={config.redistributeConnected} onChange={v => set('redistributeConnected', v)} label="Redistribuir connected" />
                <FieldGroup label="Interfaces OSPF *" error={fieldError('ospfInterfaces')}>
                  <ListInput items={config.ospfInterfaces} onChange={v => set('ospfInterfaces', v)} placeholder="lo" />
                </FieldGroup>
              </div>
            )}
          </div>
        );

      // ═══ STEP 8: Review & Deploy ═══
      case 7:
        if (applyResult) {
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                {applyResult.status === 'success' || applyResult.status === 'dry-run' ? (
                  <><Check size={20} className="text-success" /><span className="font-medium text-success">{applyResult.dryRun ? 'Dry-run concluído' : 'Aplicação concluída com sucesso'}</span></>
                ) : (
                  <><AlertCircle size={20} className="text-destructive" /><span className="font-medium text-destructive">Falha na aplicação</span></>
                )}
                <span className="text-xs text-muted-foreground ml-auto font-mono">{applyResult.duration}ms</span>
              </div>
              <ApplyStepsViewer steps={applyResult.steps} />
              <div className="flex gap-2 mt-4">
                <button onClick={() => { setApplyResult(null); setStep(0); }}
                  className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Novo Wizard</button>
                <button onClick={() => navigate('/history')}
                  className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">Ver Histórico</button>
                <button onClick={() => navigate('/')}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90">Ir ao Dashboard</button>
              </div>
            </div>
          );
        }
        return (
          <div className="space-y-4">
            {validationErrors.length > 0 && (
              <div className="noc-panel border-warning/30">
                <div className="noc-panel-header">Validação ({validationErrors.filter(e => e.severity === 'error').length} erros, {validationErrors.filter(e => e.severity === 'warning').length} avisos)</div>
                <div className="space-y-1">
                  {validationErrors.map((e, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs py-1 ${e.severity === 'error' ? 'text-destructive' : 'text-warning'}`}>
                      {e.severity === 'error' ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                      <span className="font-mono">[Etapa {e.step + 1}]</span>
                      <span>{e.message}</span>
                      <button onClick={() => { setStep(e.step); setShowValidation(true); }}
                        className="ml-auto text-accent underline">Ir</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Architecture Summary */}
            <div className="noc-panel">
              <div className="noc-panel-header">Arquitetura do Deploy</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {[
                  ['Hostname', config.hostname || '(não definido)'],
                  ['Interface', `${config.mainInterface} — ${config.ipv4Address}`],
                  ['Modo de Deploy', config.deploymentMode],
                  ['Atrás de Firewall', config.behindFirewall ? 'Sim' : 'Não'],
                  ['VIPs de Serviço', config.serviceVips.map(v => v.ipv4).join(', ')],
                  ['Instâncias Resolver', String(config.instances.length)],
                  ['Política de Entrega', config.distributionPolicy],
                  ['Roteamento', config.routingMode],
                  ['IPv6', config.enableIpv6 ? 'Habilitado' : 'Desabilitado'],
                  ['Proteção DNS', config.enableDnsProtection ? 'Ativo' : 'Inativo'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-b border-border">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono text-right">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Instance Summary */}
            <div className="noc-panel">
              <div className="noc-panel-header">Instâncias Resolver</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-4">Nome</th>
                      <th className="text-left py-2 pr-4">Listener IPv4</th>
                      <th className="text-left py-2 pr-4">Egress IPv4</th>
                      <th className="text-left py-2 pr-4">Control</th>
                      {config.enableIpv6 && <th className="text-left py-2 pr-4">Listener IPv6</th>}
                      {config.enableIpv6 && <th className="text-left py-2">Egress IPv6</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {config.instances.map((inst, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 text-primary">{inst.name}</td>
                        <td className="py-2 pr-4">{inst.bindIp}</td>
                        <td className="py-2 pr-4">{inst.egressIpv4}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{inst.controlInterface}:{inst.controlPort}</td>
                        {config.enableIpv6 && <td className="py-2 pr-4">{inst.bindIpv6 || '—'}</td>}
                        {config.enableIpv6 && <td className="py-2">{inst.egressIpv6 || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Generated Files */}
            <div className="noc-panel">
              <div className="noc-panel-header">Arquivos que serão gerados ({generatedFiles.length})</div>
              <div className="flex flex-wrap gap-1">
                {generatedFiles.map(f => (
                  <span key={f.path} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">{f.path}</span>
                ))}
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Wizard de Deploy DNS Recursivo</h1>
        <p className="text-sm text-muted-foreground">Implante infraestrutura DNS recursiva multi-instância para ambientes ISP, enterprise e telecom</p>
      </div>

      {/* Step Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const hasErrors = showValidation && stepErrors(i).some(e => e.severity === 'error');
          const Icon = STEP_ICONS[i];
          return (
            <button key={i} onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border whitespace-nowrap transition-colors ${
                i === step ? 'wizard-step-active' :
                i < step && !hasErrors ? 'wizard-step-done' :
                hasErrors ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'wizard-step-pending'
              }`}>
              {i < step && !hasErrors ? <Check size={12} /> : hasErrors ? <AlertCircle size={12} /> : <Icon size={12} />}
              {s}
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <div className="noc-panel min-h-[300px]">
        <div className="noc-panel-header flex items-center gap-2">
          {(() => { const Icon = STEP_ICONS[step]; return <Icon size={14} />; })()}
          Etapa {step + 1} — {STEPS[step]}
        </div>
        {renderStep()}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button onClick={() => { setStep(Math.max(0, step - 1)); setShowValidation(false); }}
          disabled={step === 0}
          className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-40">
          <ChevronLeft size={16} /> Anterior
        </button>

        <div className="flex gap-2">
          {step === 7 && !applyResult && (
            <>
              <button onClick={() => handleApply(true)} disabled={applyMutation.isPending}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-60">
                <Eye size={16} /> Dry Run
              </button>
              <button onClick={() => handleApply(false)} disabled={applyMutation.isPending || !isConfigValid(validationErrors)}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-60">
                {applyMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {applyMutation.isPending ? 'Aplicando...' : 'Aplicar Deploy'}
              </button>
            </>
          )}
          {step < 7 && (
            <button onClick={handleNext}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90">
              Próximo <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
