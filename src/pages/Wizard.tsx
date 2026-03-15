import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_CONFIG,
  type WizardConfig,
  type DnsInstance,
  type ServiceVip,
  type AccessControlEntry,
  type DeploymentMode,
  type VipDistributionPolicy,
  type RoutingMode,
  type ObservabilityConfig,
} from '@/lib/types';
import { validateConfig, getStepErrors, isConfigValid, getValidationSummary } from '@/lib/validation';
import { generateAllFiles, createDefaultInstance } from '@/lib/config-generator';
import { useApplyConfig } from '@/lib/hooks';
import { api } from '@/lib/api';
import ApplyStepsViewer from '@/components/ApplyStepsViewer';
import TopologySummary from '@/components/TopologySummary';
import FilePreviewAccordion from '@/components/FilePreviewAccordion';
import {
  Check, ChevronLeft, ChevronRight, AlertTriangle, Play, Eye, AlertCircle,
  Loader2, Server, Network, Shield, Globe, Layers, Route, Settings, FileText,
  Plus, Trash2, Info, ExternalLink, Activity, Lock, BarChart3, Download,
  X, SkipForward,
} from 'lucide-react';
import type { ApplyResult, ApplyRequest } from '@/lib/types';

const STEPS = [
  'Topologia do Host',
  'Publicação DNS',
  'VIPs de Serviço',
  'Instâncias Resolver',
  'Egress Público',
  'Mapeamento VIP→Instância',
  'Roteamento',
  'Segurança',
  'Observabilidade',
  'Revisão & Deploy',
];

const STEP_ICONS = [Server, Network, Globe, Layers, ExternalLink, Route, Settings, Shield, BarChart3, FileText];
const LAST_STEP = STEPS.length - 1;

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

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
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

function ModeCard({ selected, onClick, label, desc, disabled = false }: { selected: boolean; onClick: () => void; label: string; desc: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-left p-4 rounded border transition-all ${
        selected ? 'border-primary bg-primary/10 ring-1 ring-primary' :
        disabled ? 'border-border bg-secondary/50 opacity-50 cursor-not-allowed' :
        'border-border bg-secondary hover:border-muted-foreground/30'
      }`}>
      <div className="font-medium text-sm">{label}</div>
      <div className="text-xs text-muted-foreground mt-1">{desc}</div>
    </button>
  );
}

// ---- Main Wizard ----

export default function Wizard() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<WizardConfig>({ ...DEFAULT_CONFIG });
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [deployProgress, setDeployProgress] = useState<{
    phase: string; currentStep: string | null; completedSteps: number; totalSteps: number; lastMessage: string;
  } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const applyMutation = useApplyConfig();
  const navigate = useNavigate();

  const validationErrors = validateConfig(config);
  const validationSummary = getValidationSummary(validationErrors);
  const stepErrors = (s: number) => getStepErrors(validationErrors, s);

  const set = <K extends keyof WizardConfig>(key: K, val: WizardConfig[K]) =>
    setConfig(prev => ({ ...prev, [key]: val }));

  const updateInstance = (idx: number, field: keyof DnsInstance, val: string | number) => {
    const instances = [...config.instances];
    instances[idx] = { ...instances[idx], [field]: val };
    set('instances', instances);
  };

  const updateVip = (idx: number, field: keyof ServiceVip, val: string | number) => {
    const vips = [...config.serviceVips];
    vips[idx] = { ...vips[idx], [field]: field === 'port' ? (parseInt(String(val)) || 53) : val };
    set('serviceVips', vips);
  };

  const updateAcl = (type: 'ipv4' | 'ipv6', idx: number, field: keyof AccessControlEntry, val: string) => {
    const key = type === 'ipv4' ? 'accessControlIpv4' : 'accessControlIpv6';
    const acls = [...config[key]];
    acls[idx] = { ...acls[idx], [field]: val };
    set(key, acls);
  };

  const updateObs = (field: keyof ObservabilityConfig, val: boolean) => {
    set('observability', { ...config.observability, [field]: val });
  };

  const fieldError = (field: string): string | undefined => {
    if (!showValidation) return undefined;
    return validationErrors.find(e => e.field === field && e.severity === 'error')?.message;
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, []);

  const startPolling = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const r = await api.getDeployState();
        if (r.success && r.data) {
          const d = r.data as any;
          setDeployProgress({
            phase: d.phase || 'idle',
            currentStep: d.currentStep || null,
            completedSteps: d.completedSteps || 0,
            totalSteps: d.totalSteps || 0,
            lastMessage: d.lastMessage || '',
          });
          // Stop polling when done
          if (['idle', 'success', 'failed', 'rollback_success', 'rollback_failed'].includes(d.phase)) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch { /* ignore */ }
    }, 1000);
  };

  const [submitState, setSubmitState] = useState<'idle' | 'validating' | 'dispatching' | 'polling' | 'done' | 'error'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleApply = async (dryRun: boolean) => {
    const mode = dryRun ? 'dry-run' : 'apply';
    console.info(`[DNS Control] Deploy submit: mode=${mode}`, {
      configHostname: config.hostname,
      instances: config.instances.length,
      vips: config.serviceVips.length,
      deploymentMode: config.deploymentMode,
    });

    setShowValidation(true);
    setSubmitError(null);
    setSubmitState('validating');

    if (!isConfigValid(validationErrors) && !dryRun) {
      const blocking = validationErrors.filter(e => e.severity === 'error');
      const msg = `Deploy bloqueado: ${blocking.length} erro(s) de validação. Primeiro: [${STEPS[blocking[0]?.step]}] ${blocking[0]?.message}`;
      console.error(`[DNS Control] ${msg}`);
      setSubmitError(msg);
      setSubmitState('error');
      return;
    }

    setSubmitState('dispatching');
    console.info(`[DNS Control] Dispatching ${mode} request to backend...`);

    setDeployProgress({
      phase: dryRun ? 'dry_run_validating' : 'applying',
      currentStep: 'Iniciando...',
      completedSteps: 0, totalSteps: 0, lastMessage: '',
    });
    startPolling();

    try {
      // Use dedicated endpoint for dry-run vs apply
      const apiCall = dryRun ? api.dryRunConfig : api.applyConfig;
      const request: ApplyRequest = { config, scope: 'full', dryRun, comment: '' };
      console.info(`[DNS Control] Calling ${dryRun ? 'POST /api/deploy/dry-run' : 'POST /api/deploy/apply'}`, { payloadKeys: Object.keys(config) });

      const result = await apiCall(request);

      if (!result.success) {
        const errMsg = result.error || 'Erro desconhecido na API';
        console.error(`[DNS Control] API error:`, errMsg);
        setSubmitError(`Erro da API: ${errMsg}`);
        setSubmitState('error');
        setDeployProgress(null);
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        return;
      }

      console.info(`[DNS Control] ${mode} success:`, { id: result.data?.id, status: result.data?.status });
      setApplyResult(result.data);
      setSubmitState('done');
      setDeployProgress(null);
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      console.error(`[DNS Control] ${mode} exception:`, errMsg);
      setSubmitError(`Exceção: ${errMsg}`);
      setSubmitState('error');
      setDeployProgress(null);
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }
  };

  const handleTestConnectivity = async () => {
    try {
      console.info('[DNS Control] Testing API connectivity...');
      const r = await api.getDeployState();
      if (r.success) {
        setSubmitError(null);
        alert('✅ API acessível — GET /api/deploy/state respondeu com sucesso.');
        console.info('[DNS Control] API connectivity OK', r.data);
      } else {
        setSubmitError(`API inacessível: ${r.error}`);
        console.error('[DNS Control] API connectivity failed:', r.error);
      }
    } catch (err: any) {
      setSubmitError(`API inacessível: ${err.message}`);
      console.error('[DNS Control] API connectivity exception:', err);
    }
  };

  const handleCopyPayload = () => {
    const payload = { config, scope: 'full', dry_run: false, comment: '' };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    alert('Payload JSON copiado para clipboard.');
    console.info('[DNS Control] Payload copied to clipboard');
  };

  const handleForceDryRun = async () => {
    console.info('[DNS Control] Force dry-run bypass...');
    setSubmitError(null);
    setSubmitState('dispatching');
    try {
      const r = await api.dryRunConfig({ config, scope: 'full', dryRun: true, comment: '' });
      if (r.success) {
        console.info('[DNS Control] Force dry-run success:', r.data);
        setApplyResult(r.data);
        setSubmitState('done');
      } else {
        setSubmitError(`Dry-run falhou: ${r.error}`);
        setSubmitState('error');
        console.error('[DNS Control] Force dry-run failed:', r.error);
      }
    } catch (err: any) {
      setSubmitError(`Dry-run exceção: ${err.message}`);
      setSubmitState('error');
      console.error('[DNS Control] Force dry-run exception:', err);
    }
  };

  const handleNext = () => {
    setShowValidation(true);
    const errs = stepErrors(step).filter(e => e.severity === 'error');
    if (errs.length === 0) {
      setShowValidation(false);
      setStep(Math.min(LAST_STEP, step + 1));
    }
  };

  const addInstance = () => {
    const n = config.instances.length;
    set('instances', [...config.instances, createDefaultInstance(n)]);
  };

  const generatedFiles = generateAllFiles(config);

  const exportConfig = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dns-control-${config.hostname || 'config'}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderStep = () => {
    switch (step) {
      // ═══ STEP 1: Topologia do Host ═══
      case 0:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure a topologia de rede do host. IP privado, gateway, interface física.
              Se o host está atrás de firewall, os IPs públicos permanecem no equipamento de borda.
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
                <Input value={config.vlanTag} onChange={v => set('vlanTag', v)} placeholder="100" />
              </FieldGroup>
              <FieldGroup label="Endereço IPv4 (CIDR) *" error={fieldError('ipv4Address')} hint="IP privado do host com máscara">
                <Input value={config.ipv4Address} onChange={v => set('ipv4Address', v)} placeholder="172.29.22.6/30" />
              </FieldGroup>
              <FieldGroup label="Gateway IPv4 *" error={fieldError('ipv4Gateway')}>
                <Input value={config.ipv4Gateway} onChange={v => set('ipv4Gateway', v)} placeholder="172.29.22.5" />
              </FieldGroup>
            </div>
            <Toggle checked={config.enableIpv6} onChange={v => set('enableIpv6', v)} label="Habilitar dual-stack IPv6" />
            {config.enableIpv6 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldGroup label="Endereço IPv6 (CIDR)" error={fieldError('ipv6Address')}>
                  <Input value={config.ipv6Address} onChange={v => set('ipv6Address', v)} placeholder="2804:4AFC:8844::2/64" />
                </FieldGroup>
                <FieldGroup label="Gateway IPv6" error={fieldError('ipv6Gateway')}>
                  <Input value={config.ipv6Gateway} onChange={v => set('ipv6Gateway', v)} placeholder="2804:4AFC:8844::1" />
                </FieldGroup>
              </div>
            )}
            <Toggle checked={config.behindFirewall} onChange={v => set('behindFirewall', v)} label="Host atrás de firewall / borda (IPs públicos ficam no equipamento de borda)" />
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

      // ═══ STEP 2: Modelo de Publicação DNS ═══
      case 1:
        return (
          <div className="space-y-4">
            <InfoBox>
              Defina como o serviço DNS será publicado e alcançado pelos clientes.
              Este modo determina a arquitetura de entrega do tráfego DNS.
            </InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'internal-recursive', label: 'DNS Recursivo Interno', desc: 'Resolvers acessíveis apenas na rede interna. Sem VIP público.' },
                { value: 'public-controlled', label: 'DNS Público Controlado', desc: 'Resolvers com IPs públicos atribuídos diretamente. Sem VIP ou NAT intermediário.' },
                { value: 'pseudo-anycast-local', label: 'Pseudo-Anycast com VIP Local', desc: 'VIP na dummy interface do host. Tráfego entregue via nftables DNAT.' },
                { value: 'vip-routed-border', label: 'VIP Roteado via Borda / Firewall', desc: 'VIPs no firewall/router. Tráfego entregue ao host via rota estática ou NAT. Recomendado para ISP.' },
                { value: 'vip-local-dummy', label: 'VIP Local em Dummy Interface', desc: 'VIPs em dummy interface. Host responde diretamente.' },
                { value: 'anycast-frr-ospf', label: 'Anycast com FRR / OSPF', desc: 'VIPs anunciados via OSPF usando FRR.' },
                { value: 'anycast-frr-bgp', label: 'Anycast com FRR / BGP (futuro)', desc: 'VIPs anunciados via BGP usando FRR. Em desenvolvimento.' },
              ] as { value: DeploymentMode; label: string; desc: string }[]).map(mode => (
                <ModeCard key={mode.value}
                  selected={config.deploymentMode === mode.value}
                  onClick={() => mode.value !== 'anycast-frr-bgp' && set('deploymentMode', mode.value)}
                  label={mode.label} desc={mode.desc}
                  disabled={mode.value === 'anycast-frr-bgp'} />
              ))}
            </div>
          </div>
        );

      // ═══ STEP 3: VIPs de Serviço ═══
      case 2:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure os IPs que os clientes usarão como servidor DNS.
              Estes são os IPs de serviço — a identidade pública do resolver.
            </InfoBox>
            <div className="space-y-3">
              {config.serviceVips.map((vip, i) => (
                <div key={i} className="p-4 rounded bg-secondary border border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground uppercase">VIP {i + 1}</span>
                    <button onClick={() => set('serviceVips', config.serviceVips.filter((_, j) => j !== i))}
                      className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1">
                      <Trash2 size={12} /> Remover
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                    <FieldGroup label="IPv4 *" error={fieldError(`serviceVips[${i}].ipv4`)}>
                      <Input value={vip.ipv4} onChange={v => updateVip(i, 'ipv4', v)} placeholder="IP do serviço DNS" />
                    </FieldGroup>
                    {config.vipIpv6Enabled && (
                      <FieldGroup label="IPv6">
                        <Input value={vip.ipv6} onChange={v => updateVip(i, 'ipv6', v)} placeholder="IPv6 do serviço DNS" />
                      </FieldGroup>
                    )}
                    <FieldGroup label="Porta" hint="Default: 53">
                      <Input type="number" value={vip.port} onChange={v => updateVip(i, 'port', v)} placeholder="53" />
                    </FieldGroup>
                    <FieldGroup label="Protocolo">
                      <Select value={vip.protocol} onChange={v => updateVip(i, 'protocol', v)}
                        options={[
                          { value: 'udp+tcp', label: 'UDP + TCP' },
                          { value: 'udp', label: 'UDP only' },
                          { value: 'tcp', label: 'TCP only' },
                        ]} />
                    </FieldGroup>
                    <FieldGroup label="Descrição">
                      <Input value={vip.description} onChange={v => updateVip(i, 'description', v)} placeholder="DNS Público" />
                    </FieldGroup>
                    <FieldGroup label="Modo de Entrega">
                      <Select value={vip.deliveryMode} onChange={v => updateVip(i, 'deliveryMode', v)}
                        options={[
                          { value: 'local-vip', label: 'VIP Local (dummy)' },
                          { value: 'routed-vip', label: 'VIP Roteado' },
                          { value: 'firewall-delivered', label: 'Entregue via Firewall' },
                        ]} />
                    </FieldGroup>
                  </div>
                  {/* Health Check Config */}
                  <div className="border-t border-border pt-3 mt-2">
                    <Toggle checked={vip.healthCheckEnabled} onChange={v => {
                      const vips = [...config.serviceVips];
                      vips[i] = { ...vips[i], healthCheckEnabled: v };
                      set('serviceVips', vips);
                    }} label="Health check ativo para este VIP" />
                    {vip.healthCheckEnabled && (
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <FieldGroup label="Domínio de probe" hint="dig @VIP <domínio>">
                          <Input value={vip.healthCheckDomain} onChange={v => {
                            const vips = [...config.serviceVips];
                            vips[i] = { ...vips[i], healthCheckDomain: v };
                            set('serviceVips', vips);
                          }} placeholder="google.com" />
                        </FieldGroup>
                        <FieldGroup label="Intervalo (s)">
                          <Input type="number" value={vip.healthCheckInterval} onChange={v => {
                            const vips = [...config.serviceVips];
                            vips[i] = { ...vips[i], healthCheckInterval: parseInt(v) || 30 };
                            set('serviceVips', vips);
                          }} placeholder="30" />
                        </FieldGroup>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 flex-wrap">
              <button onClick={() => set('serviceVips', [...config.serviceVips, { ipv4: '', ipv6: '', port: 53, protocol: 'udp+tcp' as const, description: '', label: '', deliveryMode: 'firewall-delivered' as const, healthCheckEnabled: true, healthCheckDomain: 'google.com', healthCheckInterval: 30 }])}
                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                <Plus size={12} /> Adicionar VIP
              </button>
              <Toggle checked={config.vipIpv6Enabled} onChange={v => set('vipIpv6Enabled', v)} label="VIPs IPv6" />
            </div>
          </div>
        );

      // ═══ STEP 4: Instâncias de Resolução ═══
      case 3:
        return (
          <div className="space-y-4">
            <InfoBox>
              Cada instância é um processo Unbound independente com listener e interface de controle próprios.
            </InfoBox>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FieldGroup label="Threads por instância *" error={fieldError('threads')}>
                <Input type="number" value={config.threads} onChange={v => set('threads', parseInt(v) || 1)} />
              </FieldGroup>
              <FieldGroup label="Msg Cache"><Input value={config.msgCacheSize} onChange={v => set('msgCacheSize', v)} /></FieldGroup>
              <FieldGroup label="RRset Cache"><Input value={config.rrsetCacheSize} onChange={v => set('rrsetCacheSize', v)} /></FieldGroup>
              <FieldGroup label="Max TTL"><Input type="number" value={config.maxTtl} onChange={v => set('maxTtl', parseInt(v) || 0)} /></FieldGroup>
              <FieldGroup label="Root Hints"><Input value={config.rootHintsPath} onChange={v => set('rootHintsPath', v)} /></FieldGroup>
              <FieldGroup label="DNS Identity" hint="Valor do campo identity">
                <Input value={config.dnsIdentity} onChange={v => set('dnsIdentity', v)} placeholder="67-DNS" />
              </FieldGroup>
            </div>
            <div className="flex gap-4 flex-wrap">
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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <FieldGroup label="Nome *" error={fieldError(`instances[${i}].name`)}>
                        <Input value={inst.name} onChange={v => updateInstance(i, 'name', v)} />
                      </FieldGroup>
                      <FieldGroup label="Listener IPv4 *" error={fieldError(`instances[${i}].bindIp`)} hint="IP interno (loopback)">
                        <Input value={inst.bindIp} onChange={v => updateInstance(i, 'bindIp', v)} placeholder="100.127.255.101" />
                      </FieldGroup>
                      {config.enableIpv6 && (
                        <FieldGroup label="Listener IPv6">
                          <Input value={inst.bindIpv6} onChange={v => updateInstance(i, 'bindIpv6', v)} />
                        </FieldGroup>
                      )}
                      <FieldGroup label="Control Interface" error={fieldError(`instances[${i}].controlInterface`)} hint="IP do remote-control">
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

      // ═══ STEP 5: Egress Público ═══
      case 4:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure o IP público de saída (outgoing-interface) de cada instância.
              Este é o IP que os servidores autoritativos verão ao receber queries recursivas.
            </InfoBox>

            {/* Egress Delivery Mode */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Modo de Entrega do Egress</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ModeCard selected={config.egressDeliveryMode === 'host-owned'}
                  onClick={() => set('egressDeliveryMode', 'host-owned')}
                  label="Host-Owned (IP Local)" desc="O IP público de egress é configurado localmente no host (loopback). O host é dono do IP." />
                <ModeCard selected={config.egressDeliveryMode === 'border-routed'}
                  onClick={() => set('egressDeliveryMode', 'border-routed')}
                  label="Border-Routed (Lógico)" desc="O IP público de egress NÃO é configurado no host. Unbound NÃO emite outgoing-interface. A identidade de saída é imposta pelo dispositivo de borda (SNAT/roteamento estático)." />
              </div>
              {config.egressDeliveryMode === 'border-routed' && (
                <div className="flex gap-2 p-3 rounded bg-accent/10 border border-accent/20 text-xs text-accent">
                  <Info size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <strong>Border-Routed:</strong> O IP público de egress <strong>não é configurado localmente</strong> no host
                    e <strong>não será emitido</strong> como <code className="font-mono bg-accent/20 px-1 rounded">outgoing-interface</code> no Unbound.
                    <br />
                    <span className="text-accent/70 mt-1 block">→ O Unbound usará o IP padrão do host para queries recursivas.</span>
                    <span className="text-accent/70 block">→ A identidade pública é imposta pelo dispositivo de borda (SNAT/policy routing/rota estática de retorno).</span>
                    <span className="text-accent/70 block">→ nftables NÃO gerará masquerade genérico.</span>
                  </div>
                </div>
              )}
            </div>

            {/* Egress Mode Selection */}
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Modo de Alocação</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ModeCard selected={config.egressMode === 'fixed-per-instance'}
                  onClick={() => set('egressMode', 'fixed-per-instance')}
                  label="Fixo por Instância" desc="Cada instância usa 1 IP público fixo de saída. Recomendado para rastreabilidade." />
                <ModeCard selected={config.egressMode === 'shared-pool'}
                  onClick={() => set('egressMode', 'shared-pool')}
                  label="Pool Compartilhado" desc="Todas as instâncias compartilham um pool de IPs de saída." />
                <ModeCard selected={config.egressMode === 'randomized'}
                  onClick={() => set('egressMode', 'randomized')}
                  label="Randomizado" desc="IP de saída selecionado aleatoriamente do pool a cada query." />
              </div>
            </div>

            {config.egressMode === 'fixed-per-instance' && (
              <div className="space-y-3">
                {config.instances.map((inst, i) => (
                  <div key={i} className="p-4 rounded bg-secondary border border-border">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-xs font-medium text-primary uppercase">{inst.name}</span>
                      <span className="text-xs text-muted-foreground font-mono">listener: {inst.bindIp || '(não definido)'}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <FieldGroup label="Egress IPv4 *" error={fieldError(`instances[${i}].egressIpv4`)} hint="IP público de saída para recursão">
                        <Input value={inst.egressIpv4} onChange={v => updateInstance(i, 'egressIpv4', v)} placeholder="IP público do bloco /29" />
                      </FieldGroup>
                      {config.enableIpv6 && (
                        <FieldGroup label="Egress IPv6">
                          <Input value={inst.egressIpv6} onChange={v => updateInstance(i, 'egressIpv6', v)} placeholder="IPv6 de saída" />
                        </FieldGroup>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(config.egressMode === 'shared-pool' || config.egressMode === 'randomized') && (
              <div className="space-y-3">
                <FieldGroup label="Pool de IPs Públicos de Saída" hint="Adicione os IPs do bloco que serão compartilhados entre instâncias">
                  <ListInput items={config.egressSharedPool} onChange={v => set('egressSharedPool', v)} placeholder="45.160.X.X" />
                </FieldGroup>
                <InfoBox>
                  {config.egressMode === 'shared-pool'
                    ? 'Todas as instâncias farão round-robin entre os IPs do pool via outgoing-interface.'
                    : 'Cada query sairá por um IP aleatório do pool. Útil para distribuir carga em blocos grandes.'}
                </InfoBox>
              </div>
            )}
          </div>
        );

      // ═══ STEP 6: Mapeamento VIP → Instância ═══
      case 5:
        return (
          <div className="space-y-4">
            <InfoBox>
              Define como o tráfego dos VIPs de serviço é distribuído entre as instâncias resolver.
            </InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'fixed-mapping', label: 'Mapeamento Fixo', desc: 'Cada VIP associado a uma instância específica.' },
                { value: 'round-robin', label: 'Round Robin (numgen)', desc: 'Distribuição sequencial entre todas as instâncias.' },
                { value: 'sticky-source', label: 'Sticky por Origem (Recomendado)', desc: 'Memoriza o resolver por IP de origem via nftables sets. Fallback nth balancing.' },
                { value: 'nth-balancing', label: 'Nth Balancing', desc: 'Balanceamento nth com numgen e decrementação progressiva.' },
                { value: 'active-passive', label: 'Ativo / Passivo', desc: 'Uma instância primária, demais em standby.' },
              ] as { value: VipDistributionPolicy; label: string; desc: string }[]).map(policy => (
                <ModeCard key={policy.value}
                  selected={config.distributionPolicy === policy.value}
                  onClick={() => set('distributionPolicy', policy.value)}
                  label={policy.label} desc={policy.desc} />
              ))}
            </div>
            {config.distributionPolicy === 'sticky-source' && (
              <FieldGroup label="Sticky Timeout (minutos)">
                <Input type="number" value={Math.floor(config.stickyTimeout / 60)} onChange={v => set('stickyTimeout', (parseInt(v) || 20) * 60)} />
              </FieldGroup>
            )}
          </div>
        );

      // ═══ STEP 7: Roteamento ═══
      case 6:
        return (
          <div className="space-y-4">
            <InfoBox>Define como os VIPs serão alcançáveis na rede.</InfoBox>
            <div className="grid grid-cols-1 gap-3">
              {([
                { value: 'static', label: 'Sem Roteamento Dinâmico', desc: 'VIPs alcançáveis via rotas estáticas.' },
                { value: 'frr-ospf', label: 'FRR / OSPF', desc: 'VIPs anunciados via OSPF com redistribute connected.' },
                { value: 'frr-bgp', label: 'FRR / BGP (futuro)', desc: 'Em desenvolvimento.' },
              ] as { value: RoutingMode; label: string; desc: string }[]).map(mode => (
                <ModeCard key={mode.value}
                  selected={config.routingMode === mode.value}
                  onClick={() => mode.value !== 'frr-bgp' && set('routingMode', mode.value)}
                  label={mode.label} desc={mode.desc}
                  disabled={mode.value === 'frr-bgp'} />
              ))}
            </div>
            {config.routingMode === 'frr-ospf' && (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldGroup label="Router ID *" error={fieldError('routerId')}>
                    <Input value={config.routerId} onChange={v => set('routerId', v)} placeholder="IP do router-id" />
                  </FieldGroup>
                  <FieldGroup label="Área OSPF *" error={fieldError('ospfArea')}>
                    <Input value={config.ospfArea} onChange={v => set('ospfArea', v)} placeholder="0.0.0.0" />
                  </FieldGroup>
                  <FieldGroup label="Custo OSPF" error={fieldError('ospfCost')}>
                    <Input type="number" value={config.ospfCost} onChange={v => set('ospfCost', parseInt(v) || 1)} />
                  </FieldGroup>
                  <FieldGroup label="Network Type">
                    <Select value={config.networkType} onChange={v => set('networkType', v as 'point-to-point' | 'broadcast')}
                      options={[{ value: 'point-to-point', label: 'Point-to-Point' }, { value: 'broadcast', label: 'Broadcast' }]} />
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

      // ═══ STEP 8: Segurança ═══
      case 7:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure controle de acesso, proteção contra amplificação e autenticação do painel.
            </InfoBox>
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ACLs IPv4 (access-control do Unbound)</div>
              {config.accessControlIpv4.map((acl, i) => (
                <div key={i} className="grid grid-cols-3 md:grid-cols-4 gap-3 p-3 rounded bg-secondary border border-border">
                  <FieldGroup label="Rede" error={fieldError(`accessControlIpv4[${i}].network`)}>
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
                    <FieldGroup label="Rede"><Input value={acl.network} onChange={v => updateAcl('ipv6', i, 'network', v)} placeholder="::/0" /></FieldGroup>
                    <FieldGroup label="Ação">
                      <Select value={acl.action} onChange={v => updateAcl('ipv6', i, 'action', v)}
                        options={[{ value: 'allow', label: 'allow' }, { value: 'refuse', label: 'refuse' }, { value: 'deny', label: 'deny' }]} />
                    </FieldGroup>
                    <FieldGroup label="Label"><Input value={acl.label} onChange={v => updateAcl('ipv6', i, 'label', v)} /></FieldGroup>
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
                  A ACL 0.0.0.0/0 allow configura um open resolver. Risco de amplificação DNS.
                </p>
                <Toggle checked={config.openResolverConfirmed} onChange={v => set('openResolverConfirmed', v)}
                  label="Confirmo que quero operar como open resolver" />
              </div>
            )}

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proteção</div>
              <div className="flex gap-4 flex-wrap">
                <Toggle checked={config.enableDnsProtection} onChange={v => set('enableDnsProtection', v)} label="Rate limiting via nftables" />
                <Toggle checked={config.enableAntiAmplification} onChange={v => set('enableAntiAmplification', v)} label="Anti-amplificação DNS" />
                <Toggle checked={config.recursionAllowed} onChange={v => set('recursionAllowed', v)} label="Recursão permitida" />
              </div>
            </div>

            <div className="border-t border-border pt-4 space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Painel de Controle</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FieldGroup label="Usuário Admin *" error={fieldError('adminUser')}>
                  <Input value={config.adminUser} onChange={v => set('adminUser', v)} />
                </FieldGroup>
                <FieldGroup label="Senha Inicial">
                  <Input value={config.adminPassword} onChange={v => set('adminPassword', v)} type="password" placeholder="Definida no primeiro acesso" />
                </FieldGroup>
                <FieldGroup label="Bind do Painel" error={fieldError('panelBind')}>
                  <Select value={config.panelBind} onChange={v => set('panelBind', v)}
                    options={[
                      { value: '127.0.0.1', label: '127.0.0.1 (local only)' },
                      { value: '0.0.0.0', label: '0.0.0.0 (all interfaces)' },
                    ]} />
                </FieldGroup>
                <FieldGroup label="Porta *" error={fieldError('panelPort')}>
                  <Input type="number" value={config.panelPort} onChange={v => set('panelPort', parseInt(v) || 8443)} />
                </FieldGroup>
              </div>
            </div>
          </div>
        );

      // ═══ STEP 9: Observabilidade ═══
      case 8:
        return (
          <div className="space-y-4">
            <InfoBox>
              Configure quais métricas e sinais operacionais o DNS Control deve coletar.
            </InfoBox>
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Métricas de Tráfego</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Toggle checked={config.observability.metricsPerVip} onChange={v => updateObs('metricsPerVip', v)} label="Métricas por VIP de serviço" />
                <Toggle checked={config.observability.metricsPerInstance} onChange={v => updateObs('metricsPerInstance', v)} label="Métricas por instância resolver" />
                <Toggle checked={config.observability.metricsPerEgress} onChange={v => updateObs('metricsPerEgress', v)} label="Métricas por IP de saída (egress)" />
                <Toggle checked={config.observability.nftablesCounters} onChange={v => updateObs('nftablesCounters', v)} label="Counters nftables (pacotes/bytes por VIP)" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Saúde & Status</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Toggle checked={config.observability.systemdStatus} onChange={v => updateObs('systemdStatus', v)} label="Status systemd por instância" />
                <Toggle checked={config.observability.healthChecks} onChange={v => updateObs('healthChecks', v)} label="Health checks ativos (DNS probe)" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Performance DNS</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Toggle checked={config.observability.latencyTracking} onChange={v => updateObs('latencyTracking', v)} label="Latência média de resolução" />
                <Toggle checked={config.observability.cacheHitTracking} onChange={v => updateObs('cacheHitTracking', v)} label="Cache hit ratio" />
                <Toggle checked={config.observability.recursionTimeTracking} onChange={v => updateObs('recursionTimeTracking', v)} label="Recursion time (avg/median)" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Eventos</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Toggle checked={config.observability.operationalEvents} onChange={v => updateObs('operationalEvents', v)} label="Eventos operacionais" />
              </div>
            </div>
          </div>
        );

      // ═══ STEP 10: Revisão & Deploy ═══
      case 9:
        if (applyResult) {
          const deployValidationErrors = applyResult.validationErrors ?? [];
          const deployValidationResults = applyResult.validationResults;
          const isSuccess = applyResult.success ?? (
            applyResult.status === 'success' ||
            (applyResult.status === 'dry-run' && deployValidationErrors.length === 0)
          );
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-2">
                {isSuccess ? (
                  <><Check size={20} className="text-success" /><span className="font-medium text-success">{applyResult.dryRun ? 'Dry-run concluído' : 'Deploy concluído com sucesso'}</span></>
                ) : (
                  <><AlertCircle size={20} className="text-destructive" /><span className="font-medium text-destructive">Falha no deploy</span></>
                )}
                <span className="text-xs text-muted-foreground ml-auto font-mono">{applyResult.duration}ms · {applyResult.configVersion}</span>
              </div>

              {/* Step-by-step execution */}
              <div className="noc-panel">
                <div className="noc-panel-header">Pipeline de Execução ({applyResult.steps.length} etapas)</div>
                <ApplyStepsViewer steps={applyResult.steps} />
              </div>

              {/* Validation result section by category */}
              {deployValidationResults && (
                <div className="noc-panel">
                  <div className="noc-panel-header">Resultado da Validação de Deploy</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {[
                      ['Unbound validation', deployValidationResults.unbound || []],
                      ['nftables validation', deployValidationResults.nftables || []],
                      ['network file validation', deployValidationResults.network || []],
                      ['IP collision validation', deployValidationResults.ipCollision || []],
                    ].map(([label, items]) => {
                      const list = items as Array<{ status: string }>;
                      const failed = list.filter(i => i.status === 'fail').length;
                      const passed = list.filter(i => i.status === 'pass').length;
                      return (
                        <div key={label as string} className={`p-2 rounded border ${failed > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-secondary/30'}`}>
                          <div className="font-medium">{label as string}</div>
                          <div className="text-muted-foreground font-mono">{passed} ok · {failed} falha</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Structured validation errors from staging */}
              {deployValidationErrors.length > 0 && (
                <div className="noc-panel border-destructive/30">
                  <div className="noc-panel-header flex items-center gap-2 text-destructive">
                    <AlertCircle size={12} />
                    Erros de Validação em Staging ({deployValidationErrors.length})
                  </div>
                  <div className="space-y-2">
                    {deployValidationErrors.map((ve, i) => (
                      <div key={i} className="p-2 rounded bg-destructive/5 border border-destructive/10 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium uppercase text-[10px]">
                            {ve.category || 'validation'}
                          </span>
                          {ve.file && <span className="font-mono text-muted-foreground">{ve.file}</span>}
                        </div>
                        {ve.command && <code className="block font-mono text-muted-foreground opacity-70">$ {ve.command}</code>}
                        <pre className="font-mono text-destructive whitespace-pre-wrap break-all">{ve.stderr}</pre>
                        {ve.remediation && <p className="text-muted-foreground italic">💡 {ve.remediation}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Post-deploy health checks */}
              {applyResult.healthResult && applyResult.healthResult.length > 0 && (
                <div className="noc-panel">
                  <div className="noc-panel-header flex items-center gap-2">
                    <Activity size={12} />
                    Verificação Pós-Deploy ({applyResult.healthResult.filter(h => h.status === 'pass').length}/{applyResult.healthResult.length})
                  </div>
                  <div className="space-y-1">
                    {applyResult.healthResult.map((check, i) => (
                      <div key={i} className={`flex items-center gap-3 p-2 rounded text-xs ${
                        check.status === 'fail' ? 'bg-destructive/5' : check.status === 'skip' ? 'bg-secondary/50' : ''
                      }`}>
                        {check.status === 'pass' ? <Check size={12} className="text-success" /> :
                         check.status === 'fail' ? <X size={12} className="text-destructive" /> :
                         <SkipForward size={12} className="text-muted-foreground" />}
                        <span className="font-medium flex-1">{check.name}</span>
                        <span className="font-mono text-muted-foreground">{check.target}</span>
                        <span className="font-mono text-muted-foreground">{check.durationMs}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rollback info */}
              {applyResult.rollbackAvailable && applyResult.backupId && (
                <div className="noc-panel border-accent/20">
                  <div className="flex items-center gap-2 text-xs">
                    <Shield size={12} className="text-accent" />
                    <span className="text-accent font-medium">Rollback disponível</span>
                    <span className="text-muted-foreground font-mono ml-auto">{applyResult.backupId}</span>
                  </div>
                </div>
              )}

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
            {/* Validation Summary */}
            {validationErrors.length > 0 && (
              <div className={`noc-panel ${validationSummary.totalErrors > 0 ? 'border-destructive/30' : 'border-warning/30'}`}>
                <div className="noc-panel-header flex items-center gap-3">
                  {validationSummary.totalErrors > 0 ? <AlertCircle size={14} className="text-destructive" /> : <AlertTriangle size={14} className="text-warning" />}
                  Validação — {validationSummary.totalErrors} erro{validationSummary.totalErrors !== 1 ? 's' : ''}, {validationSummary.totalWarnings} aviso{validationSummary.totalWarnings !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {validationErrors.map((e, i) => (
                    <div key={i} className={`flex items-center gap-2 text-xs py-1 ${e.severity === 'error' ? 'text-destructive' : 'text-warning'}`}>
                      {e.severity === 'error' ? <AlertCircle size={10} /> : <AlertTriangle size={10} />}
                      <span className="font-mono text-muted-foreground">[{STEPS[e.step]?.slice(0, 12)}]</span>
                      <span className="flex-1">{e.message}</span>
                      <button onClick={() => { setStep(e.step); setShowValidation(true); }}
                        className="text-accent underline shrink-0">Ir</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Architecture Blueprint */}
            <div className="noc-panel">
              <div className="noc-panel-header">Recursive DNS Node — Architecture Blueprint</div>
              <div className="text-xs text-muted-foreground mb-3 font-mono space-y-1">
                <div>Clients → Service VIPs → nftables PREROUTING (DNAT) → Unbound Resolvers → Public Egress → Global DNS</div>
                <div className="text-[10px] text-muted-foreground/60">
                  {config.instances.length} resolvers · {config.serviceVips.length} VIPs · {config.distributionPolicy} · {config.egressDeliveryMode} egress · {config.routingMode} routing
                </div>
              </div>
              <TopologySummary config={config} />
            </div>

            {/* Instance Table */}
            <div className="noc-panel">
              <div className="noc-panel-header">Instâncias Resolver ({config.instances.length})</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="text-muted-foreground border-b border-border">
                      <th className="text-left py-2 pr-4">Nome</th>
                      <th className="text-left py-2 pr-4">Listener</th>
                      <th className="text-left py-2 pr-4">Egress</th>
                      <th className="text-left py-2 pr-4">Control</th>
                      {config.enableIpv6 && <th className="text-left py-2 pr-4">Listener v6</th>}
                      {config.enableIpv6 && <th className="text-left py-2">Egress v6</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {config.instances.map((inst, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4 text-primary">{inst.name}</td>
                        <td className="py-2 pr-4">{inst.bindIp || '—'}</td>
                        <td className="py-2 pr-4">{inst.egressIpv4 || '—'}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{inst.controlInterface}:{inst.controlPort}</td>
                        {config.enableIpv6 && <td className="py-2 pr-4">{inst.bindIpv6 || '—'}</td>}
                        {config.enableIpv6 && <td className="py-2">{inst.egressIpv6 || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Compatibility Matrix (border-routed) */}
            {/* Compatibility Matrix — always shown, adapts to mode */}
            <div className="noc-panel border-accent/20">
              <div className="noc-panel-header flex items-center gap-2 text-accent">
                <Info size={12} /> Matriz de Compatibilidade — {config.egressDeliveryMode === 'border-routed' ? 'Border-Routed' : 'Host-Owned'}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                {[
                  ['Entrega VIP', 'nftables DNAT (prerouting)'],
                  ['Listener Bind', 'Host-local loopback/dummy'],
                  ['Listener local no host', '✅ Obrigatório'],
                  ['outgoing-interface emitido', config.egressDeliveryMode === 'border-routed' ? '❌ Suprimido' : '✅ Emitido no Unbound'],
                  ['IP Egress local obrigatório', config.egressDeliveryMode === 'border-routed' ? '❌ Não (lógico)' : '✅ Sim (deve existir no host)'],
                  ['Caminho de Retorno', config.egressDeliveryMode === 'border-routed' ? 'Rota estática na borda' : 'Masquerade/SNAT local'],
                  ['IP Público local no host', config.egressDeliveryMode === 'border-routed' ? '❌ Não configurado' : '✅ Configurado em loopback'],
                  ['Masquerade/SNAT', config.egressDeliveryMode === 'border-routed' ? '❌ Não gerado' : '✅ Gerado em postrouting'],
                  ['NAT de borda obrigatório', config.egressDeliveryMode === 'border-routed' ? '✅ Sim (SNAT/policy)' : '❌ Não necessário'],
                  ['Post-up listener IPs', '✅ ip addr add no loopback'],
                  ['Post-up egress IPs', config.egressDeliveryMode === 'border-routed' ? '❌ Comentado (lógico)' : '✅ ip addr add no loopback'],
                  ['Deploy check egress', config.egressDeliveryMode === 'border-routed' ? 'IP não presente (esperado)' : 'IP presente no host'],
                  ['Deploy check listener', 'dig @listenerIP deve responder'],
                ].map(([k, v]) => (
                  <div key={k} className="py-1">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px]">{k}</div>
                    <div className="font-mono font-medium">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deployment Summary */}
            <div className="noc-panel">
              <div className="noc-panel-header">Resumo do Deploy</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                {[
                  ['Hostname', config.hostname || '—'],
                  ['Interface', `${config.mainInterface} — ${config.ipv4Address}`],
                  ['Modo', config.deploymentMode],
                  ['Egress', config.egressDeliveryMode === 'border-routed' ? 'Border-Routed (lógico)' : 'Host-Owned (local)'],
                  ['Roteamento', config.routingMode],
                  ['VIPs', `${config.serviceVips.length} IPv4${config.vipIpv6Enabled ? ' + IPv6' : ''}`],
                  ['Instâncias', String(config.instances.length)],
                  ['Distribuição', config.distributionPolicy],
                  ['Firewall', config.behindFirewall ? 'Sim' : 'Não'],
                  ['Rate Limit', config.enableDnsProtection ? 'Ativo' : 'Inativo'],
                  ['IPv6', config.enableIpv6 ? 'Dual-stack' : 'IPv4 only'],
                  ['ACLs', `${config.accessControlIpv4.length} IPv4`],
                  ['Arquivos', `${generatedFiles.length}`],
                ].map(([k, v]) => (
                  <div key={k} className="py-1">
                    <div className="text-muted-foreground uppercase tracking-wider text-[10px]">{k}</div>
                    <div className="font-mono font-medium">{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Generated Files Preview — Grouped */}
            <div className="noc-panel">
              <div className="noc-panel-header flex items-center justify-between">
                <span>Artefatos de Deploy ({generatedFiles.length} arquivos)</span>
                <button onClick={() => setShowFiles(!showFiles)}
                  className="text-[10px] text-accent hover:underline">{showFiles ? 'Ocultar conteúdo' : 'Mostrar conteúdo'}</button>
              </div>
              {/* Category summary */}
              {(() => {
                const cats = new Map<string, number>();
                generatedFiles.forEach(f => {
                  let cat = 'Config';
                  if (f.path.includes('/unbound/')) cat = 'Unbound configs';
                  else if (f.path.includes('/nftables')) cat = 'NFTables rules';
                  else if (f.path.includes('/sysctl')) cat = 'Sysctl tuning';
                  else if (f.path.includes('/network/') || f.path.includes('interfaces')) cat = 'Network';
                  else if (f.path.includes('/frr/')) cat = 'FRR routing';
                  else if (f.path.includes('systemd') || f.path.endsWith('.service')) cat = 'Systemd units';
                  else if (f.path.endsWith('.sh') || f.path.endsWith('.txt')) cat = 'Scripts / Manifests';
                  cats.set(cat, (cats.get(cat) || 0) + 1);
                });
                return (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[...cats.entries()].map(([cat, count]) => (
                      <span key={cat} className="text-xs px-2 py-1 bg-secondary border border-border rounded font-mono">
                        {cat} ({count})
                      </span>
                    ))}
                  </div>
                );
              })()}
              {showFiles ? (
                <FilePreviewAccordion files={generatedFiles} />
              ) : (
                <div className="flex flex-wrap gap-1 max-h-[150px] overflow-y-auto">
                  {generatedFiles.map(f => (
                    <span key={f.path} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">{f.path}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Risk Warnings */}
            <div className="noc-panel border-warning/20">
              <div className="noc-panel-header flex items-center gap-2 text-warning">
                <AlertTriangle size={12} /> Ações Privilegiadas
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <Lock size={10} className="text-muted-foreground" />
                  <span>systemctl daemon-reload</span>
                </div>
                {config.instances.map(inst => (
                  <div key={inst.name} className="flex items-center gap-2">
                    <Lock size={10} className="text-muted-foreground" />
                    <span>systemctl restart {inst.name}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <Lock size={10} className="text-muted-foreground" />
                  <span>nft -f /etc/nftables.conf</span>
                </div>
                {config.routingMode === 'frr-ospf' && (
                  <div className="flex items-center gap-2">
                    <Lock size={10} className="text-muted-foreground" />
                    <span>systemctl restart frr</span>
                  </div>
                )}
              </div>
            </div>

            {/* Submit State & Error Panel */}
            {(submitState !== 'idle' || submitError) && (
              <div className={`noc-panel ${submitError ? 'border-destructive/30' : 'border-primary/30'}`}>
                <div className="noc-panel-header flex items-center gap-2">
                  {submitError ? <AlertCircle size={12} className="text-destructive" /> : <Activity size={12} className="text-primary" />}
                  Estado da Submissão
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-3">
                    {['validating', 'dispatching', 'polling', 'done'].map(phase => (
                      <span key={phase} className={`px-2 py-0.5 rounded font-mono ${
                        submitState === phase ? 'bg-primary text-primary-foreground' :
                        submitState === 'error' ? 'bg-destructive/10 text-destructive' :
                        'bg-secondary text-muted-foreground'
                      }`}>{phase}</span>
                    ))}
                  </div>
                  {submitError && (
                    <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive font-mono text-xs">
                      {submitError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Debug Actions */}
            <div className="noc-panel border-border/50">
              <div className="noc-panel-header flex items-center gap-2 text-muted-foreground">
                <Settings size={12} /> Diagnóstico de Deploy
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={handleCopyPayload}
                  className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                  📋 Copiar Payload JSON
                </button>
                <button onClick={handleTestConnectivity}
                  className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                  🔗 Testar Conectividade API
                </button>
                <button onClick={handleForceDryRun}
                  className="px-3 py-1.5 text-xs bg-accent/20 text-accent rounded border border-accent/30 hover:bg-accent/30">
                  ⚡ Enviar Dry-Run Direto
                </button>
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground/60 font-mono">
                Validação: {isConfigValid(validationErrors) ? '✅ OK' : `❌ ${validationErrors.filter(e => e.severity === 'error').length} erro(s)`}
                {' · '}Arquivos: {generatedFiles.length}
                {' · '}Mutation pending: {applyMutation.isPending ? 'sim' : 'não'}
                {' · '}Submit state: {submitState}
              </div>
            </div>
          </div>
        );
    }
  };

  const [importLoading, setImportLoading] = useState(false);
  const handleImportHost = async () => {
    setImportLoading(true);
    try {
      const r = await api.importHostState();
      if (r.success && r.data) {
        const imported = r.data as any;
        // Map imported state to WizardConfig
        const newConfig: Partial<WizardConfig> = {};
        if (imported.hostname) newConfig.hostname = imported.hostname;
        if (imported.instances?.length > 0) {
          newConfig.instances = imported.instances.map((inst: any, i: number) => ({
            name: inst.name || `unbound${String(i + 1).padStart(2, '0')}`,
            bindIp: inst.bind_ip || inst.bindIp || '',
            bindIpv6: inst.bind_ipv6 || '',
            controlInterface: inst.control_interface || inst.controlInterface || `127.0.0.${11 + i}`,
            controlPort: inst.control_port || inst.controlPort || 8953,
            egressIpv4: inst.egress_ipv4 || inst.egressIpv4 || '',
            egressIpv6: inst.egress_ipv6 || '',
          }));
          newConfig.instanceCount = newConfig.instances!.length;
        }
        if (imported.egress_delivery_mode) newConfig.egressDeliveryMode = imported.egress_delivery_mode;
        if (imported.service_vips?.length > 0) {
          newConfig.serviceVips = imported.service_vips.map((v: any) => ({
            ipv4: v.ipv4 || '', ipv6: v.ipv6 || '', port: v.port || 53,
            protocol: 'udp+tcp' as const, description: v.description || '',
            label: '', deliveryMode: 'firewall-delivered' as const,
            healthCheckEnabled: true, healthCheckDomain: 'google.com', healthCheckInterval: 30,
          }));
        }
        setConfig(prev => ({ ...prev, ...newConfig }));
        alert(`✅ Estado importado: ${newConfig.instances?.length || 0} instâncias, ${newConfig.serviceVips?.length || 0} VIPs`);
      } else {
        alert(`❌ Falha ao importar: ${r.error || 'Erro desconhecido'}`);
      }
    } catch (err: any) {
      alert(`❌ Exceção: ${err.message}`);
    } finally {
      setImportLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Recursive DNS Node — Architecture Blueprint</h1>
          <p className="text-sm text-muted-foreground">Nó recursivo multi-instância · VIP → nftables DNAT → Unbound resolvers → Egress</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleImportHost} disabled={importLoading}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded border border-accent/30 hover:bg-accent/30 disabled:opacity-50">
            {importLoading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            {importLoading ? 'Importando...' : 'Sincronizar com Host'}
          </button>
          <button onClick={exportConfig} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <Download size={12} /> Exportar JSON
          </button>
        </div>
      </div>

      {/* Step Navigation */}
      <div className="flex gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const hasErrors = showValidation && stepErrors(i).some(e => e.severity === 'error');
          const Icon = STEP_ICONS[i];
          return (
            <button key={i} onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border whitespace-nowrap transition-colors ${
                i === step ? 'wizard-step-active' :
                i < step && !hasErrors ? 'wizard-step-done' :
                hasErrors ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'wizard-step-pending'
              }`}>
              {i < step && !hasErrors ? <Check size={11} /> : hasErrors ? <AlertCircle size={11} /> : <Icon size={11} />}
              <span className="hidden lg:inline">{s}</span>
              <span className="lg:hidden">{i + 1}</span>
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

      {/* Deploy Progress Bar */}
      {deployProgress && submitState === 'dispatching' && (
        <div className="noc-panel border-primary/30">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider">
              {deployProgress.phase === 'dry_run_validating' ? 'Dry-Run em andamento' : 'Deploy em andamento'}
            </span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">
              {deployProgress.completedSteps}/{deployProgress.totalSteps || '?'} etapas
            </span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: deployProgress.totalSteps > 0 ? `${(deployProgress.completedSteps / deployProgress.totalSteps) * 100}%` : '10%' }}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
            <Activity size={10} className="text-primary" />
            <span>{deployProgress.currentStep || 'Aguardando...'}</span>
          </div>
          {deployProgress.lastMessage && (
            <div className="text-[10px] text-muted-foreground/60 mt-1 font-mono">{deployProgress.lastMessage}</div>
          )}
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button onClick={() => { setStep(Math.max(0, step - 1)); setShowValidation(false); }}
          disabled={step === 0}
          className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-40">
          <ChevronLeft size={16} /> Anterior
        </button>

        <div className="flex gap-2">
          {step === LAST_STEP && !applyResult && (
            <>
              <button onClick={() => handleApply(true)} disabled={submitState === 'dispatching'}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-60">
                <Eye size={16} /> Dry Run
              </button>
              <button onClick={() => handleApply(false)} disabled={submitState === 'dispatching' || !isConfigValid(validationErrors)}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-60">
                {submitState === 'dispatching' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {submitState === 'dispatching' ? 'Aplicando...' : 'Aplicar Deploy'}
              </button>
            </>
          )}
          {step < LAST_STEP && (
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
