import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_CONFIG,
  type WizardConfig,
  type DnsInstance,
  type ServiceVip,
  type InterceptedVip,
  type AccessControlEntry,
  type VipDistributionPolicy,
  type ObservabilityConfig,
  type OperationMode,
  type VipDeliverySubmode,
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
  Plus, Trash2, Info, ExternalLink, Activity, Lock, BarChart3, Download, Upload,
  X, SkipForward, Crosshair, MonitorDown,
} from 'lucide-react';
import type { ApplyResult, ApplyRequest } from '@/lib/types';

// ═══ Dynamic step definitions based on mode + submode ═══
function getSteps(mode: OperationMode, submode: VipDeliverySubmode) {
  if (mode === 'simple') {
    return {
      names: ['Topologia do Host', 'Modo de Operação DNS', 'Frontend DNS', 'Instâncias Resolver', 'Segurança', 'Observabilidade', 'Revisão & Deploy'],
      icons: [Server, Network, Globe, Layers, Shield, BarChart3, FileText],
    };
  }
  if (submode === 'interception-plus-own-vip') {
    return {
      names: ['Topologia do Host', 'Modo de Operação DNS', 'Modelo de Entrega do VIP', 'Instâncias Resolver', 'VIPs de Serviço', 'VIP Interception', 'Egress Público', 'Mapeamento VIP→Instância', 'Segurança', 'Observabilidade', 'Revisão & Deploy'],
      icons: [Server, Network, Globe, Layers, Globe, Crosshair, ExternalLink, Route, Shield, BarChart3, FileText],
    };
  }
  // pure-interception (default)
  return {
    names: ['Topologia do Host', 'Modo de Operação DNS', 'Modelo de Entrega do VIP', 'Instâncias Resolver', 'VIP Interception', 'Egress Público', 'Mapeamento VIP→Instância', 'Segurança', 'Observabilidade', 'Revisão & Deploy'],
    icons: [Server, Network, Globe, Layers, Crosshair, ExternalLink, Route, Shield, BarChart3, FileText],
  };
}

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

function ModeCard({ selected, onClick, label, desc, disabled = false, badge }: { selected: boolean; onClick: () => void; label: string; desc: string; disabled?: boolean; badge?: string }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`text-left p-4 rounded border transition-all ${
        selected ? 'border-primary bg-primary/10 ring-1 ring-primary' :
        disabled ? 'border-border bg-secondary/50 opacity-50 cursor-not-allowed' :
        'border-border bg-secondary hover:border-muted-foreground/30'
      }`}>
      <div className="flex items-center gap-2">
        <div className="font-medium text-sm">{label}</div>
        {badge && <span className="px-1.5 py-0.5 text-[10px] rounded bg-primary/20 text-primary font-medium">{badge}</span>}
      </div>
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

  const isInterception = config.operationMode === 'interception';
  const hasOwnVip = config.vipDeliverySubmode === 'interception-plus-own-vip';
  const { names: STEPS, icons: STEP_ICONS } = getSteps(config.operationMode, config.vipDeliverySubmode);
  const LAST_STEP = STEPS.length - 1;

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

  // Handle mode switch with data cleanup
  const handleModeSwitch = (mode: OperationMode) => {
    if (mode === config.operationMode) return;
    
    const hasInterceptionData = config.serviceVips.length > 0 || config.interceptedVips.length > 0 || config.instances.some(i => i.egressIpv4);
    
    if (mode === 'simple' && hasInterceptionData) {
      if (!confirm('Trocar para Recursivo Simples vai limpar VIPs, interceptação e egress. Continuar?')) return;
    }

    const newConfig: Partial<WizardConfig> = {
      operationMode: mode,
      deploymentMode: mode === 'interception' ? 'vip-routed-border' : 'internal-recursive',
    };

    if (mode === 'simple') {
      newConfig.serviceVips = [];
      newConfig.interceptedVips = [];
      newConfig.vipMappings = [];
      newConfig.vipDeliverySubmode = 'pure-interception';
      newConfig.instances = config.instances.map(inst => ({
        ...inst,
        egressIpv4: '',
        egressIpv6: '',
        publicListenerIp: '',
      }));
    }

    setConfig(prev => ({ ...prev, ...newConfig }));
    setStep(1);
  };

  // Handle VIP delivery submode switch
  const handleSubmodeSwitch = (submode: VipDeliverySubmode) => {
    if (submode === config.vipDeliverySubmode) return;

    if (submode === 'pure-interception' && config.serviceVips.length > 0) {
      if (!confirm('Trocar para Interceptação Pura vai remover os VIPs de serviço próprios cadastrados. Continuar?')) return;
    }

    const newConfig: Partial<WizardConfig> = { vipDeliverySubmode: submode };
    if (submode === 'pure-interception') {
      newConfig.serviceVips = [];
    }

    setConfig(prev => ({ ...prev, ...newConfig }));
  };

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
    setShowValidation(true);
    setSubmitError(null);
    setSubmitState('validating');

    if (!isConfigValid(validationErrors) && !dryRun) {
      const blocking = validationErrors.filter(e => e.severity === 'error');
      const msg = `Deploy bloqueado: ${blocking.length} erro(s). Primeiro: [${STEPS[blocking[0]?.step]}] ${blocking[0]?.message}`;
      setSubmitError(msg);
      setSubmitState('error');
      return;
    }

    setSubmitState('dispatching');
    setDeployProgress({
      phase: dryRun ? 'dry_run_validating' : 'applying',
      currentStep: 'Iniciando...', completedSteps: 0, totalSteps: 0, lastMessage: '',
    });
    startPolling();

    try {
      const apiCall = dryRun ? api.dryRunConfig : api.applyConfig;
      const request: ApplyRequest = { config, scope: 'full', dryRun, comment: '' };
      const result = await apiCall(request);

      if (!result.success) {
        setSubmitError(`Erro da API: ${result.error || 'Erro desconhecido'}`);
        setSubmitState('error');
        setDeployProgress(null);
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        return;
      }

      setApplyResult(result.data);
      setSubmitState('done');
      setDeployProgress(null);
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    } catch (err: any) {
      setSubmitError(`Exceção: ${err?.message || String(err)}`);
      setSubmitState('error');
      setDeployProgress(null);
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }
  };

  const handleTestConnectivity = async () => {
    try {
      const r = await api.getDeployState();
      if (r.success) { setSubmitError(null); alert('✅ API acessível.'); }
      else setSubmitError(`API inacessível: ${r.error}`);
    } catch (err: any) { setSubmitError(`API inacessível: ${err.message}`); }
  };

  const handleCopyPayload = () => {
    navigator.clipboard.writeText(JSON.stringify({ config, scope: 'full', dry_run: false, comment: '' }, null, 2));
    alert('Payload JSON copiado para clipboard.');
  };

  const handleForceDryRun = async () => {
    setSubmitError(null);
    setSubmitState('dispatching');
    try {
      const r = await api.dryRunConfig({ config, scope: 'full', dryRun: true, comment: '' });
      if (r.success) { setApplyResult(r.data); setSubmitState('done'); }
      else { setSubmitError(`Dry-run falhou: ${r.error}`); setSubmitState('error'); }
    } catch (err: any) { setSubmitError(`Dry-run exceção: ${err.message}`); setSubmitState('error'); }
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

  // Track whether config came from host sync
  const [configSource, setConfigSource] = useState<'wizard_form' | 'host_runtime'>('wizard_form');

  const exportConfig = () => {
    const exportPayload = {
      _meta: {
        source: configSource,
        exported_at: new Date().toISOString(),
        version: '1.0',
        dns_control_export: true,
      },
      hostname: config.hostname,
      organization: config.organization,
      project: config.project,
      mainInterface: config.mainInterface,
      ipv4Address: config.ipv4Address,
      ipv4Gateway: config.ipv4Gateway,
      enableIpv6: config.enableIpv6,
      ipv6Address: config.ipv6Address,
      ipv6Gateway: config.ipv6Gateway,
      operationMode: config.operationMode,
      vipDeliverySubmode: config.vipDeliverySubmode,
      deploymentMode: config.deploymentMode,
      securityProfile: config.securityProfile,
      egressDeliveryMode: config.egressDeliveryMode,
      egressMode: config.egressMode,
      distributionPolicy: config.distributionPolicy,
      stickyTimeout: config.stickyTimeout,
      frontendDnsIp: config.frontendDnsIp,
      simpleDistributionStrategy: config.simpleDistributionStrategy,
      simpleStickyTimeout: config.simpleStickyTimeout,
      config,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const srcTag = configSource === 'host_runtime' ? 'host' : 'wizard';
    a.href = url; a.download = `dns-control-${config.hostname || 'config'}-${srcTag}-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importConfigFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);

        // Accept both full export (with _meta + config) and raw WizardConfig
        let importedConfig: Partial<WizardConfig>;
        let source: string = 'unknown';

        if (parsed._meta?.dns_control_export && parsed.config) {
          // Full export format
          importedConfig = parsed.config;
          source = parsed._meta.source || 'imported';
        } else if (parsed.hostname !== undefined || parsed.operationMode !== undefined) {
          // Raw WizardConfig format
          importedConfig = parsed;
          source = 'imported_raw';
        } else {
          alert('❌ Schema inválido: o arquivo não contém uma configuração DNS Control válida.\n\nFormatos aceitos:\n- Exportação DNS Control (com _meta.dns_control_export)\n- WizardConfig direto (com hostname/operationMode)');
          return;
        }

        // Validate required fields minimally
        const errors: string[] = [];
        if (importedConfig.instances && !Array.isArray(importedConfig.instances)) {
          errors.push('Campo "instances" deve ser um array');
        }
        if (importedConfig.operationMode && !['interception', 'simple'].includes(importedConfig.operationMode)) {
          errors.push(`operationMode inválido: "${importedConfig.operationMode}"`);
        }

        if (errors.length > 0) {
          alert(`❌ Erros de validação:\n\n${errors.join('\n')}`);
          return;
        }

        // Merge imported config over defaults
        setConfig(prev => ({
          ...prev,
          ...importedConfig,
          // Ensure instanceCount stays in sync
          instanceCount: importedConfig.instances?.length ?? prev.instanceCount,
        }));
        setConfigSource('wizard_form');
        setStep(0);
        alert(`✅ Configuração importada com sucesso!\n\nOrigem: ${source}\nHostname: ${importedConfig.hostname || '(não definido)'}\nInstâncias: ${importedConfig.instances?.length ?? '(mantidas)'}\n\n⚠ Revise os campos antes de aplicar.`);
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          alert('❌ Arquivo JSON inválido — erro de sintaxe.');
        } else {
          alert(`❌ Erro ao importar: ${err.message}`);
        }
      }
    };
    input.click();
  };

  // ═══ Step renderers ═══

  const renderHostTopology = () => (
    <div className="space-y-4">
      <InfoBox>Configure a topologia de rede do host. IP privado, gateway, interface física.</InfoBox>
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
        <FieldGroup label="VLAN Tag" hint="Opcional">
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
      <Toggle checked={config.behindFirewall} onChange={v => set('behindFirewall', v)} label="Host atrás de firewall / borda" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FieldGroup label="Projeto"><Input value={config.project} onChange={v => set('project', v)} placeholder="DNS Recursivo Produção" /></FieldGroup>
        <FieldGroup label="Timezone"><Input value={config.timezone} onChange={v => set('timezone', v)} /></FieldGroup>
      </div>
    </div>
  );

  const renderOperationMode = () => (
    <div className="space-y-4">
      <InfoBox>
        Selecione o modo de operação do resolver DNS. Esta escolha define quais etapas estarão disponíveis no wizard
        e qual configuração será gerada.
      </InfoBox>
      <div className="grid grid-cols-1 gap-4">
        <ModeCard
          selected={config.operationMode === 'interception'}
          onClick={() => handleModeSwitch('interception')}
          label="Recursivo com Interceptação"
          badge="Padrão"
          desc="O host intercepta tráfego DNS destinado a IPs externos (ex: 4.2.2.5, 4.2.2.6) via nftables DNAT e redireciona para instâncias internas do Unbound (100.x.x.x). Balanceamento sticky por origem. Egress controlado."
        />
        <ModeCard
          selected={config.operationMode === 'simple'}
          onClick={() => handleModeSwitch('simple')}
          label="Recursivo Simples"
          desc="O host recebe queries no IP principal (frontend DNS) e distribui localmente entre instâncias internas do Unbound via balanceamento local. Sem VIP fake, sem interceptação de terceiros."
        />
      </div>

      <div className="p-3 rounded bg-primary/5 border border-primary/15 text-xs space-y-2">
        <div className="font-medium text-primary">Etapas ativas neste modo:</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-muted-foreground">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1"><Check size={10} className="text-primary" /> {s}</div>
          ))}
        </div>
        {config.operationMode === 'simple' && (
          <div className="text-muted-foreground/60 mt-1">
            Etapas removidas: VIP Interception, Egress Público, Mapeamento VIP→Instância.
            <br />Etapa adicionada: <strong>Frontend DNS</strong> — IP real que os clientes consultam.
          </div>
        )}
      </div>
    </div>
  );

  const renderFrontendDns = () => (
    <div className="space-y-4">
      <InfoBox>
        Configure o <strong>Frontend DNS</strong> — o IP real que os clientes consultam para resolução DNS.
        <br />O sistema criará automaticamente <strong>balanceamento local</strong> para distribuir as queries entre as instâncias internas do Unbound.
        <br /><span className="text-accent/70 mt-1 block">
          → <strong>Frontend</strong>: IP que o cliente consulta (ex: {config.ipv4Address ? config.ipv4Address.split('/')[0] : '172.250.40.100'})
          <br />→ <strong>Backends</strong>: IPs internos onde o Unbound escuta (ex: 100.127.255.101, 100.127.255.102)
        </span>
      </InfoBox>

      <FieldGroup label="Frontend DNS IP *" error={fieldError('frontendDnsIp')}
        hint="IP real do servidor que os clientes consultam na porta 53. Ex: o IP principal do host.">
        <Input value={config.frontendDnsIp} onChange={v => set('frontendDnsIp', v)}
          placeholder={config.ipv4Address ? config.ipv4Address.split('/')[0] : '172.250.40.100'} />
      </FieldGroup>

      {/* Distribution Strategy */}
      <div className="border-t border-border pt-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Estratégia de Distribuição</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ModeCard
            selected={config.simpleDistributionStrategy === 'round-robin'}
            onClick={() => set('simpleDistributionStrategy', 'round-robin')}
            label="Round-robin"
            badge="Padrão"
            desc="Distribuição uniforme entre backends. Cada query vai para o próximo backend na fila. Comportamento previsível e equilibrado."
          />
          <ModeCard
            selected={config.simpleDistributionStrategy === 'sticky-source'}
            onClick={() => set('simpleDistributionStrategy', 'sticky-source')}
            label="Afinidade por cliente (sticky)"
            desc="Queries do mesmo IP de origem são enviadas ao mesmo backend por um período configurável. Melhor para cache hit ratio por instância."
          />
        </div>
        {config.simpleDistributionStrategy === 'sticky-source' && (
          <div className="mt-3">
            <FieldGroup label="Sticky Timeout (minutos)" hint="Tempo que o mapeamento cliente→backend permanece ativo">
              <Input type="number" value={Math.floor(config.simpleStickyTimeout / 60)}
                onChange={v => set('simpleStickyTimeout', (parseInt(v) || 20) * 60)} />
            </FieldGroup>
          </div>
        )}
      </div>

      {config.frontendDnsIp && config.instances.length > 0 && (
        <div className="p-3 rounded bg-primary/5 border border-primary/15 text-xs space-y-2">
          <div className="font-medium text-primary">Modelo de distribuição local</div>
          <div className="font-mono text-muted-foreground space-y-1">
            <div>cliente → <span className="text-primary font-bold">{config.frontendDnsIp}:53</span></div>
            <div className="pl-4">↓ balanceamento local (nftables {config.simpleDistributionStrategy === 'sticky-source' ? 'sticky-source' : 'round-robin'})</div>
            {config.instances.map((inst, i) => (
              <div key={i} className="pl-8">→ <span className="text-accent font-bold">{inst.bindIp || '(não definido)'}:53</span> ({inst.name})</div>
            ))}
          </div>
        </div>
      )}

      <div className="p-3 rounded bg-accent/5 border border-accent/15 text-xs text-muted-foreground space-y-1">
        <div className="font-medium text-accent">Como funciona</div>
        <div>• As instâncias do Unbound <strong>não</strong> escutam no Frontend IP — apenas nos IPs internos de backend</div>
        <div>• O nftables local redireciona (DNAT) o tráfego do Frontend IP para os backends</div>
        <div>• O balanceamento é transparente — o cliente vê apenas um único resolver</div>
        <div>• Sem VIP fake, sem interceptação, sem anycast — apenas distribuição local</div>
      </div>
    </div>
  );

  const renderDeliverySubmode = () => (
    <div className="space-y-4">
      <InfoBox>
        Defina como o serviço DNS será exposto aos clientes. Esta escolha controla se o wizard exibirá a etapa de VIPs de serviço próprios.
      </InfoBox>
      <div className="grid grid-cols-1 gap-4">
        <ModeCard
          selected={config.vipDeliverySubmode === 'pure-interception'}
          onClick={() => handleSubmodeSwitch('pure-interception')}
          label="Interceptação Pura"
          badge="Padrão"
          desc="Os clientes consultam IPs DNS externos conhecidos (ex: 4.2.2.5, 4.2.2.6) que são interceptados localmente via nftables. O host NÃO possui VIP público próprio anunciado."
        />
        <ModeCard
          selected={config.vipDeliverySubmode === 'interception-plus-own-vip'}
          onClick={() => handleSubmodeSwitch('interception-plus-own-vip')}
          label="Interceptação + VIP Próprio"
          desc="Além da interceptação de IPs externos, a rede também possui e anuncia IPs públicos próprios para o serviço DNS. Use somente se você realmente anuncia IPs próprios na rede."
        />
      </div>

      {config.vipDeliverySubmode === 'pure-interception' && (
        <div className="p-3 rounded bg-accent/5 border border-accent/15 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-accent">Neste submodo:</div>
          <div>• Nenhum VIP de serviço próprio é necessário</div>
          <div>• Os VIPs interceptados (ex: 4.2.2.5) são configurados na etapa <strong>VIP Interception</strong></div>
          <div>• A etapa "VIPs de Serviço" está oculta</div>
        </div>
      )}

      {config.vipDeliverySubmode === 'interception-plus-own-vip' && (
        <div className="p-3 rounded bg-primary/5 border border-primary/15 text-xs text-muted-foreground space-y-1">
          <div className="font-medium text-primary">Neste submodo:</div>
          <div>• A etapa "VIPs de Serviço" estará disponível para cadastrar IPs <strong>próprios da sua rede</strong></div>
          <div>• IPs de terceiros (8.8.8.8, 4.2.2.5) continuam sendo cadastrados em <strong>VIP Interception</strong></div>
          <div>• Nunca use IPs de resolvedores públicos como VIP de serviço próprio</div>
        </div>
      )}
    </div>
  );

  const renderInstances = () => (
    <div className="space-y-4">
      <InfoBox>
        Cada instância é um processo Unbound independente com listener e interface de controle próprios.
        <br /><span className="text-accent/70 mt-1 block">→ <strong>Listener Privado</strong>: IP interno (RFC 6598, ex: 100.127.255.101) onde o Unbound faz bind. Materializado em <code className="font-mono bg-accent/20 px-1 rounded">lo0</code> (dummy).</span>
        {isInterception && <span className="text-accent/70 block">→ No modo Interceptação, o Unbound <strong>não</strong> escuta em IP público — o IP público é tratado como VIP via nftables.</span>}
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
        <Toggle checked={config.enableBlocklist} onChange={v => set('enableBlocklist', v)} label="AnaBlock (Blocklist Judicial)" />
      </div>

      {config.enableBlocklist && (
        <div className="p-4 rounded bg-secondary/50 border border-border space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Shield size={14} /> Configuração AnaBlock</div>
          <FieldGroup label="Modo de bloqueio *">
            <Select value={config.blocklistMode} onChange={v => set('blocklistMode', v as any)} options={[
              { value: 'always_nxdomain', label: 'always_nxdomain — domínio retorna NXDOMAIN' },
              { value: 'redirect_cname', label: 'redirect_cname — redireciona para FQDN' },
              { value: 'redirect_ip', label: 'redirect_ip — redireciona para IPv4' },
              { value: 'redirect_ip_dualstack', label: 'redirect_ip_dualstack — IPv4 + IPv6' },
            ]} />
          </FieldGroup>
          {config.blocklistMode === 'redirect_cname' && (
            <FieldGroup label="CNAME de redirecionamento *"><Input value={config.blocklistCnameTarget} onChange={v => set('blocklistCnameTarget', v)} placeholder="anatel.gov.br" /></FieldGroup>
          )}
          {(config.blocklistMode === 'redirect_ip' || config.blocklistMode === 'redirect_ip_dualstack') && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="IPv4 de redirecionamento *"><Input value={config.blocklistRedirectIpv4} onChange={v => set('blocklistRedirectIpv4', v)} placeholder="10.255.128.2" /></FieldGroup>
              {config.blocklistMode === 'redirect_ip_dualstack' && (
                <FieldGroup label="IPv6 de redirecionamento *"><Input value={config.blocklistRedirectIpv6} onChange={v => set('blocklistRedirectIpv6', v)} placeholder="2001:db8::1" /></FieldGroup>
              )}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="URL base da API AnaBlock *"><Input value={config.blocklistApiUrl} onChange={v => set('blocklistApiUrl', v)} placeholder="https://api.anablock.net.br" /></FieldGroup>
            <FieldGroup label="Intervalo de sync (horas)"><Input type="number" value={config.blocklistSyncIntervalHours} onChange={v => set('blocklistSyncIntervalHours', parseInt(v) || 1)} /></FieldGroup>
          </div>
          <div className="flex gap-4 flex-wrap">
            <Toggle checked={config.blocklistAutoSync} onChange={v => set('blocklistAutoSync', v)} label="Sync automático" />
            <Toggle checked={config.blocklistValidateBeforeReload} onChange={v => set('blocklistValidateBeforeReload', v)} label="Validar antes de reload" />
            <Toggle checked={config.blocklistAutoReload} onChange={v => set('blocklistAutoReload', v)} label="Reload automático" />
          </div>
        </div>
      )}

      <div className="flex gap-4 flex-wrap">
        <Toggle checked={config.enableIpBlocking} onChange={v => set('enableIpBlocking', v)} label="AnaBlock IP Blocking (rotas blackhole)" />
      </div>

      {config.enableIpBlocking && (
        <div className="p-4 rounded bg-secondary/50 border border-border space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground"><Route size={14} /> Bloqueio de IPs — Rotas Blackhole</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="URL base da API"><Input value={config.ipBlockingApiUrl} onChange={v => set('ipBlockingApiUrl', v)} placeholder="https://api.anablock.net.br" /></FieldGroup>
            <FieldGroup label="Intervalo de sync (horas)"><Input type="number" value={config.ipBlockingSyncIntervalHours} onChange={v => set('ipBlockingSyncIntervalHours', parseInt(v) || 1)} /></FieldGroup>
          </div>
          <Toggle checked={config.ipBlockingAutoSync} onChange={v => set('ipBlockingAutoSync', v)} label="Sync automático" />
        </div>
      )}

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
                <FieldGroup label="Listener Privado *" error={fieldError(`instances[${i}].bindIp`)} hint="IP interno do Unbound (lo0)">
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

  const renderServiceVips = () => (
    <div className="space-y-4">
      <InfoBox>
        Configure apenas os IPs públicos <strong>próprios da sua rede</strong> que serão usados como identidade do serviço DNS.
        <strong> Não use aqui IPs interceptados de terceiros.</strong> IPs como 4.2.2.5 e 4.2.2.6 pertencem exclusivamente à etapa "VIP Interception".
      </InfoBox>
      <div className="space-y-3">
        {config.serviceVips.map((vip, i) => (
          <div key={i} className="p-4 rounded bg-secondary border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase">VIP {i + 1}</span>
              <button onClick={() => set('serviceVips', config.serviceVips.filter((_, j) => j !== i))}
                className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1"><Trash2 size={12} /> Remover</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <FieldGroup label="IPv4 *" error={fieldError(`serviceVips[${i}].ipv4`)}>
                <Input value={vip.ipv4} onChange={v => updateVip(i, 'ipv4', v)} placeholder="IP do serviço DNS" />
              </FieldGroup>
              {config.vipIpv6Enabled && (
                <FieldGroup label="IPv6"><Input value={vip.ipv6} onChange={v => updateVip(i, 'ipv6', v)} /></FieldGroup>
              )}
              <FieldGroup label="Porta"><Input type="number" value={vip.port} onChange={v => updateVip(i, 'port', v)} placeholder="53" /></FieldGroup>
              <FieldGroup label="Protocolo">
                <Select value={vip.protocol} onChange={v => updateVip(i, 'protocol', v)} options={[
                  { value: 'udp+tcp', label: 'UDP + TCP' }, { value: 'udp', label: 'UDP' }, { value: 'tcp', label: 'TCP' },
                ]} />
              </FieldGroup>
              <FieldGroup label="Descrição"><Input value={vip.description} onChange={v => updateVip(i, 'description', v)} placeholder="DNS Público" /></FieldGroup>
            </div>
            <div className="border-t border-border pt-3 mt-2">
              <Toggle checked={vip.healthCheckEnabled} onChange={v => {
                const vips = [...config.serviceVips]; vips[i] = { ...vips[i], healthCheckEnabled: v }; set('serviceVips', vips);
              }} label="Health check ativo" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3 flex-wrap">
        <button onClick={() => set('serviceVips', [...config.serviceVips, {
          ipv4: '', ipv6: '', port: 53, protocol: 'udp+tcp' as const, description: '', label: '',
          vipType: 'owned' as const, deliveryMode: 'firewall-delivered' as const,
          healthCheckEnabled: true, healthCheckDomain: 'google.com', healthCheckInterval: 30,
        }])} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
          <Plus size={12} /> Adicionar VIP
        </button>
        <Toggle checked={config.vipIpv6Enabled} onChange={v => set('vipIpv6Enabled', v)} label="VIPs IPv6" />
      </div>
    </div>
  );

  const renderInterception = () => (
    <div className="space-y-4">
      <InfoBox>
        Configure aqui os IPs DNS externos que serão <strong>interceptados localmente</strong> e redirecionados via nftables para instâncias internas do Unbound.
        <strong> Esta é a feature principal do DNS Control.</strong>
      </InfoBox>

      {config.interceptedVips.some(v => v.vipIp === config.bootstrapDns) && (
        <div className="flex gap-2 p-3 rounded bg-destructive/10 border border-destructive/30 text-xs text-destructive">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <div>
            <strong>Atenção:</strong> O IP <code className="font-mono bg-destructive/20 px-1 rounded">{config.bootstrapDns}</code> está sendo interceptado 
            E é o Bootstrap DNS do host. Durante o boot, antes do Unbound iniciar, o host não conseguirá resolver DNS.
          </div>
        </div>
      )}

      <div className="space-y-3">
        {config.interceptedVips.map((vip, i) => (
          <div key={i} className="p-4 rounded bg-secondary border border-border space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-accent uppercase flex items-center gap-1.5">
                <Crosshair size={12} /> VIP Interceptado {i + 1}
              </span>
              <button onClick={() => set('interceptedVips', config.interceptedVips.filter((_, j) => j !== i))}
                className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1"><Trash2 size={12} /> Remover</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              <FieldGroup label="VIP IPv4 *" error={fieldError(`interceptedVips[${i}].vipIp`)} hint="DNS público a ser sequestrado">
                <Input value={vip.vipIp} onChange={v => {
                  const vips = [...config.interceptedVips]; vips[i] = { ...vips[i], vipIp: v }; set('interceptedVips', vips);
                }} placeholder="4.2.2.5" />
              </FieldGroup>
              {config.enableIpv6 && (
                <FieldGroup label="VIP IPv6" hint="Endereço IPv6 do VIP interceptado">
                  <Input value={vip.vipIpv6} onChange={v => {
                    const vips = [...config.interceptedVips]; vips[i] = { ...vips[i], vipIpv6: v }; set('interceptedVips', vips);
                  }} placeholder="2620:119:35::35" />
                </FieldGroup>
              )}
              <FieldGroup label="Protocolo">
                <Select value={vip.protocol} onChange={v => {
                  const vips = [...config.interceptedVips]; vips[i] = { ...vips[i], protocol: v as any }; set('interceptedVips', vips);
                }} options={[
                  { value: 'udp+tcp', label: 'UDP + TCP' }, { value: 'udp', label: 'UDP' }, { value: 'tcp', label: 'TCP' },
                ]} />
              </FieldGroup>
            </div>
            <FieldGroup label="Descrição">
              <Input value={vip.description} onChange={v => {
                const vips = [...config.interceptedVips]; vips[i] = { ...vips[i], description: v }; set('interceptedVips', vips);
              }} placeholder="DNS público Level3 sequestrado" />
            </FieldGroup>
            <div className="p-2 rounded bg-primary/5 border border-primary/10 text-xs text-muted-foreground">
              <strong>Balanceamento:</strong> Este VIP será distribuído automaticamente entre <strong>todas as {config.instances.length} instâncias</strong> via sticky source + numgen inc mod {config.instances.length}.
            </div>
          </div>
        ))}
      </div>

      <button onClick={() => set('interceptedVips', [...config.interceptedVips, {
        vipIp: '', vipIpv6: '', vipType: 'intercepted', captureMode: 'dnat',
        backendInstance: config.instances[0]?.name || '', backendTargetIp: config.instances[0]?.bindIp || '',
        description: '', expectedLocalLatencyMs: 1, validationMode: 'strict', protocol: 'udp+tcp', port: 53,
      } as InterceptedVip])}
        className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent/20 text-accent rounded border border-accent/30 hover:bg-accent/30">
        <Plus size={12} /> Adicionar VIP Interceptado
      </button>

      {config.interceptedVips.length > 0 && (
        <div className="p-3 rounded bg-accent/5 border border-accent/15 text-xs space-y-1">
          <div className="font-bold text-accent flex items-center gap-1.5"><Crosshair size={12} /> Resumo</div>
          {config.interceptedVips.map((v, i) => (
            <div key={i} className="font-mono text-muted-foreground">
              VIP <span className="text-accent font-bold">{v.vipIp || '?'}</span>
              {' → '}<span className="text-primary">{v.backendInstance || '?'}</span>
              {' ('}{v.backendTargetIp || '?'}{') '}
              <span className="text-muted-foreground/50">[DNAT]</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderEgress = () => (
    <div className="space-y-4">
      <InfoBox>
        Configure o IP público de saída (<code className="font-mono bg-accent/20 px-1 rounded">outgoing-interface</code>) de cada instância.
        Este é o IP que os servidores autoritativos verão ao receber queries recursivas.
        <br /><span className="text-accent/70 mt-1 block">→ Esses IPs são materializados na interface <code className="font-mono bg-accent/20 px-1 rounded">lo</code> (loopback real) do host.</span>
      </InfoBox>

      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Modo de Entrega do Egress</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ModeCard selected={config.egressDeliveryMode === 'host-owned'} onClick={() => set('egressDeliveryMode', 'host-owned')}
            label="Host-Owned" badge="Recomendado" desc="IP público de egress configurado na loopback (lo). Unbound usa outgoing-interface." />
          <ModeCard selected={config.egressDeliveryMode === 'border-routed'} onClick={() => set('egressDeliveryMode', 'border-routed')}
            label="Border-Routed" badge="Avançado" desc="IP de egress NÃO configurado no host. Identidade de saída imposta pelo dispositivo de borda (SNAT)." />
        </div>
        {config.egressDeliveryMode === 'border-routed' && (
          <div className="flex gap-2 p-3 rounded bg-accent/10 border border-accent/20 text-xs text-accent">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div><strong>Border-Routed:</strong> O IP de egress <strong>não será configurado</strong> no host e <code>outgoing-interface</code> será <strong>suprimido</strong> no Unbound. A identidade pública é imposta pelo dispositivo de borda.</div>
          </div>
        )}
      </div>

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
    </div>
  );

  const renderMapping = () => (
    <div className="space-y-4">
      <InfoBox>Define como o tráfego dos VIPs interceptados é distribuído entre as instâncias resolver via nftables.</InfoBox>
      <div className="grid grid-cols-1 gap-3">
        {([
          { value: 'sticky-source', label: 'Sticky por Origem (Recomendado)', desc: 'Memoriza o resolver por IP de origem via nftables sets. Fallback nth balancing.' },
          { value: 'round-robin', label: 'Round Robin (numgen)', desc: 'Distribuição sequencial entre todas as instâncias.' },
          { value: 'nth-balancing', label: 'Nth Balancing', desc: 'Balanceamento nth com numgen e decrementação progressiva.' },
          { value: 'active-passive', label: 'Ativo / Passivo', desc: 'Uma instância primária, demais em standby.' },
        ] as { value: VipDistributionPolicy; label: string; desc: string }[]).map(policy => (
          <ModeCard key={policy.value} selected={config.distributionPolicy === policy.value}
            onClick={() => set('distributionPolicy', policy.value)} label={policy.label} desc={policy.desc} />
        ))}
      </div>
      {config.distributionPolicy === 'sticky-source' && (
        <FieldGroup label="Sticky Timeout (minutos)">
          <Input type="number" value={Math.floor(config.stickyTimeout / 60)} onChange={v => set('stickyTimeout', (parseInt(v) || 20) * 60)} />
        </FieldGroup>
      )}
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-4">
      {/* ── Perfil de Segurança ── */}
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Perfil de Segurança</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ModeCard
            selected={config.securityProfile === 'legacy'}
            onClick={() => set('securityProfile', 'legacy')}
            label="Sem Proteção (Legacy / Open DNS)"
            desc="Reproduz o runtime Part1/Part2. Sem filter table, sem ACL no firewall."
          />
          <ModeCard
            selected={config.securityProfile === 'isp-hardened'}
            onClick={() => set('securityProfile', 'isp-hardened')}
            label="ISP Hardened"
            desc="ACL, rate limit e anti-amplificação no nftables (EDGE)."
          />
        </div>
        {config.securityProfile === 'legacy' && (
          <div className="p-3 rounded border border-yellow-500/30 bg-yellow-500/10 text-sm text-yellow-700 dark:text-yellow-400 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <strong>Atenção:</strong> Este modo não aplica controle de acesso no firewall.
              O servidor pode operar como open resolver.
              Use apenas em ambientes controlados ou para compatibilidade com Part1/Part2.
            </div>
          </div>
        )}
        {config.securityProfile === 'isp-hardened' && (
          <div className="p-3 rounded border border-green-500/30 bg-green-500/10 text-sm text-green-700 dark:text-green-400 flex items-start gap-2">
            <Shield size={16} className="mt-0.5 shrink-0" />
            <div>
              Este modo aplica ACL, rate limit e anti-amplificação no nftables, sem alterar o comportamento do DNS.
            </div>
          </div>
        )}
      </div>

      {/* ── ACL + Proteções (somente ISP Hardened) ── */}
      {config.securityProfile === 'isp-hardened' && (
        <>
          <InfoBox>Configure controle de acesso DNS via nftables (camada EDGE). As ACLs são aplicadas na chain INPUT do nftables ANTES do DNAT, garantindo que tráfego não autorizado seja bloqueado antes de atingir o Unbound.</InfoBox>
          <div className="space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">ACLs IPv4 (nftables filter INPUT — EDGE)</div>
            {config.accessControlIpv4.map((acl, i) => (
              <div key={i} className="grid grid-cols-3 md:grid-cols-4 gap-3 p-3 rounded bg-secondary border border-border">
                <FieldGroup label="Rede" error={fieldError(`accessControlIpv4[${i}].network`)}>
                  <Input value={acl.network} onChange={v => updateAcl('ipv4', i, 'network', v)} placeholder="172.16.0.0/12" />
                </FieldGroup>
                <FieldGroup label="Ação">
                  <Select value={acl.action} onChange={v => updateAcl('ipv4', i, 'action', v)} options={[
                    { value: 'allow', label: 'allow' }, { value: 'refuse', label: 'refuse' },
                    { value: 'deny', label: 'deny' }, { value: 'allow_snoop', label: 'allow_snoop' },
                  ]} />
                </FieldGroup>
                <FieldGroup label="Label"><Input value={acl.label} onChange={v => updateAcl('ipv4', i, 'label', v)} placeholder="Rede interna" /></FieldGroup>
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
                  <FieldGroup label="Rede"><Input value={acl.network} onChange={v => updateAcl('ipv6', i, 'network', v)} /></FieldGroup>
                  <FieldGroup label="Ação">
                    <Select value={acl.action} onChange={v => updateAcl('ipv6', i, 'action', v)} options={[
                      { value: 'allow', label: 'allow' }, { value: 'refuse', label: 'refuse' }, { value: 'deny', label: 'deny' },
                    ]} />
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
              <div className="flex items-center gap-2 text-sm text-destructive font-medium"><AlertTriangle size={14} /> Open Resolver Detectado</div>
              <p className="text-xs text-destructive/80">A ACL 0.0.0.0/0 allow configura um open resolver. Risco de amplificação DNS.</p>
              <Toggle checked={config.openResolverConfirmed} onChange={v => set('openResolverConfirmed', v)} label="Confirmo que quero operar como open resolver" />
            </div>
          )}

          <div className="border-t border-border pt-4 space-y-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Proteção</div>
            <div className="flex gap-4 flex-wrap">
              <Toggle checked={config.enableDnsProtection} onChange={v => set('enableDnsProtection', v)} label="Rate limiting via nftables" />
              <Toggle checked={config.enableAntiAmplification} onChange={v => set('enableAntiAmplification', v)} label="Anti-amplificação DNS" />
            </div>
          </div>
        </>
      )}

      <div className="border-t border-border pt-4 space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Painel de Controle</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FieldGroup label="Usuário Admin *" error={fieldError('adminUser')}><Input value={config.adminUser} onChange={v => set('adminUser', v)} /></FieldGroup>
          <FieldGroup label="Senha Inicial"><Input value={config.adminPassword} onChange={v => set('adminPassword', v)} type="password" placeholder="Definida no primeiro acesso" /></FieldGroup>
          <FieldGroup label="Bind do Painel" error={fieldError('panelBind')}>
            <Select value={config.panelBind} onChange={v => set('panelBind', v)} options={[
              { value: '127.0.0.1', label: '127.0.0.1 — Apenas local (SSH tunnel)' },
              ...(config.ipv4Address ? [{ value: config.ipv4Address, label: `${config.ipv4Address} — Interface do host` }] : []),
              { value: '0.0.0.0', label: '0.0.0.0 — Todas as interfaces' },
            ]} />
            {config.panelBind === '127.0.0.1' && (
              <div className="mt-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
                <strong>Atenção:</strong> O painel ficará acessível apenas localmente. Para acesso remoto, use um SSH tunnel (<code className="font-mono text-[11px]">ssh -L 8443:127.0.0.1:8443 host</code>) ou altere o bind para a interface do host ou 0.0.0.0.
              </div>
            )}
            {config.panelBind === '0.0.0.0' && (
              <div className="mt-2 rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
                <strong>Importante:</strong> O painel ficará exposto em todas as interfaces. Garanta proteção via ACL, firewall ou autenticação forte.
              </div>
            )}
          </FieldGroup>
          <FieldGroup label="Porta *" error={fieldError('panelPort')}><Input type="number" value={config.panelPort} onChange={v => set('panelPort', parseInt(v) || 8443)} /></FieldGroup>
        </div>
      </div>
    </div>
  );

  const renderObservability = () => (
    <div className="space-y-4">
      <InfoBox>Configure quais métricas e sinais operacionais o DNS Control deve coletar.</InfoBox>
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Métricas de Tráfego</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {isInterception && <Toggle checked={config.observability.metricsPerVip} onChange={v => updateObs('metricsPerVip', v)} label="Métricas por VIP de serviço" />}
          <Toggle checked={config.observability.metricsPerInstance} onChange={v => updateObs('metricsPerInstance', v)} label="Métricas por instância resolver" />
          {isInterception && <Toggle checked={config.observability.metricsPerEgress} onChange={v => updateObs('metricsPerEgress', v)} label="Métricas por IP de saída (egress)" />}
          {isInterception && <Toggle checked={config.observability.nftablesCounters} onChange={v => updateObs('nftablesCounters', v)} label="Counters nftables" />}
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Saúde & Status</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Toggle checked={config.observability.systemdStatus} onChange={v => updateObs('systemdStatus', v)} label="Status systemd por instância" />
          <Toggle checked={config.observability.healthChecks} onChange={v => updateObs('healthChecks', v)} label="Health checks ativos" />
        </div>
      </div>
      <div className="space-y-3">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Performance DNS</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <Toggle checked={config.observability.latencyTracking} onChange={v => updateObs('latencyTracking', v)} label="Latência média" />
          <Toggle checked={config.observability.cacheHitTracking} onChange={v => updateObs('cacheHitTracking', v)} label="Cache hit ratio" />
          <Toggle checked={config.observability.recursionTimeTracking} onChange={v => updateObs('recursionTimeTracking', v)} label="Recursion time" />
        </div>
      </div>
      <Toggle checked={config.observability.operationalEvents} onChange={v => updateObs('operationalEvents', v)} label="Eventos operacionais" />
    </div>
  );

  const renderReview = () => {
    if (applyResult) {
      const deployValidationErrors = applyResult.validationErrors ?? [];
      const deployValidationResults = applyResult.validationResults;
      const isSuccess = applyResult.success ?? (applyResult.status === 'success' || (applyResult.status === 'dry-run' && deployValidationErrors.length === 0));
      return (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            {isSuccess ? <><Check size={20} className="text-success" /><span className="font-medium text-success">{applyResult.dryRun ? 'Dry-run concluído' : 'Deploy concluído com sucesso'}</span></>
            : <><AlertCircle size={20} className="text-destructive" /><span className="font-medium text-destructive">Falha no deploy</span></>}
            <span className="text-xs text-muted-foreground ml-auto font-mono">{applyResult.duration}ms · {applyResult.configVersion}</span>
          </div>
          <div className="noc-panel"><div className="noc-panel-header">Pipeline de Execução ({applyResult.steps.length} etapas)</div><ApplyStepsViewer steps={applyResult.steps} /></div>
          {deployValidationResults && (
            <div className="noc-panel"><div className="noc-panel-header">Resultado da Validação</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {[['Unbound', deployValidationResults.unbound || []], ['nftables', deployValidationResults.nftables || []], ['network', deployValidationResults.network || []], ['IP collision', deployValidationResults.ipCollision || []]].map(([label, items]) => {
                  const list = items as Array<{ status: string }>;
                  return (<div key={label as string} className={`p-2 rounded border ${list.some(i => i.status === 'fail') ? 'border-destructive/30 bg-destructive/5' : 'border-border bg-secondary/30'}`}>
                    <div className="font-medium">{label as string}</div><div className="text-muted-foreground font-mono">{list.filter(i => i.status === 'pass').length} ok · {list.filter(i => i.status === 'fail').length} falha</div>
                  </div>);
                })}
              </div>
            </div>
          )}
          {deployValidationErrors.length > 0 && (
            <div className="noc-panel border-destructive/30"><div className="noc-panel-header text-destructive"><AlertCircle size={12} /> Erros ({deployValidationErrors.length})</div>
              {deployValidationErrors.map((ve, i) => (
                <div key={i} className="p-2 rounded bg-destructive/5 border border-destructive/10 text-xs"><pre className="font-mono text-destructive whitespace-pre-wrap">{ve.stderr}</pre></div>
              ))}
            </div>
          )}
          {applyResult.healthResult?.length > 0 && (() => {
            const passed = applyResult.healthResult.filter(h => h.status === 'pass');
            const failed = applyResult.healthResult.filter(h => h.status === 'fail');
            const skipped = applyResult.healthResult.filter(h => h.status === 'skip' || h.status === 'warn');
            const applicable = applyResult.healthResult.length - skipped.length;
            const allOk = failed.length === 0;
            return (
            <div className="noc-panel">
              <div className={`noc-panel-header flex items-center justify-between ${!allOk ? 'text-destructive' : ''}`}>
                <div className="flex items-center gap-2">
                  <Activity size={12} />
                  <span>Verificação Pós-Deploy ({passed.length}/{applicable}{skipped.length > 0 ? ` · ${skipped.length} ignorados` : ''})</span>
                </div>
                {allOk ? (
                  <span className="text-success text-[10px] font-bold uppercase tracking-wider">Tudo OK</span>
                ) : (
                  <span className="text-destructive text-[10px] font-bold uppercase tracking-wider">{failed.length} falha{failed.length !== 1 ? 's' : ''}</span>
                )}
              </div>
              {failed.length > 0 && (
                <div className="mb-3 p-3 rounded-md border border-destructive/30 bg-destructive/5 space-y-1">
                  <div className="text-xs font-semibold text-destructive uppercase tracking-wider">Checks com falha:</div>
                  {failed.map((check, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-destructive">
                      <X size={10} className="shrink-0" />
                      <span className="font-medium">{check.name}</span>
                      <span className="font-mono text-destructive/70">— {check.detail || check.target}</span>
                    </div>
                  ))}
                </div>
              )}
              {applyResult.healthResult.map((check, i) => (
                <div key={i} className={`flex items-center gap-3 p-2 rounded text-xs ${check.status === 'fail' ? 'bg-destructive/5 border border-destructive/20' : ''}`}>
                  {check.status === 'pass' ? <Check size={12} className="text-success" /> : check.status === 'fail' ? <X size={12} className="text-destructive" /> : check.status === 'warn' ? <Info size={12} className="text-accent" /> : <SkipForward size={12} className="text-muted-foreground" />}
                  <span className="font-medium flex-1">{check.name}</span>
                  <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                    check.status === 'pass' ? 'bg-success/10 text-success' :
                    check.status === 'fail' ? 'bg-destructive/10 text-destructive font-bold' :
                    check.status === 'warn' ? 'bg-accent/10 text-accent' :
                    'bg-muted text-muted-foreground'
                  }`}>{check.status === 'pass' ? 'OK' : check.status === 'fail' ? 'FALHA' : check.status === 'warn' ? 'AVISO' : 'IGNORADO'}</span>
                  <span className="font-mono text-muted-foreground">{check.target}</span>
                  <span className="font-mono text-muted-foreground">{check.durationMs}ms</span>
                </div>
              ))}
            </div>
            );
          })()}
          {applyResult.rollbackAvailable && applyResult.backupId && (
            <div className="noc-panel border-accent/20"><Shield size={12} className="text-accent" /><span className="text-accent font-medium text-xs">Rollback disponível: {applyResult.backupId}</span></div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={() => { setApplyResult(null); setStep(0); }} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border">Novo Wizard</button>
            <button onClick={() => navigate('/history')} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border">Ver Histórico</button>
            <button onClick={() => navigate('/')} className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded font-medium">Ir ao Dashboard</button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
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
                  <button onClick={() => { setStep(e.step); setShowValidation(true); }} className="text-accent underline shrink-0">Ir</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="noc-panel">
          <div className="noc-panel-header">
            {isInterception ? 'Recursive DNS Node — Interceptação' : 'Recursive DNS Node — Simples'}
          </div>
          <div className="text-xs text-muted-foreground mb-3 font-mono space-y-1">
            {isInterception
              ? <div>Clients → Service VIPs → nftables PREROUTING (DNAT) → Unbound Resolvers → Public Egress → Global DNS</div>
              : <div>Clients → Unbound Resolver → Global DNS</div>}
            <div className="text-[10px] text-muted-foreground/60">
              {config.instances.length} resolvers{isInterception ? ` · ${config.interceptedVips.length} interceptados${hasOwnVip ? ` + ${config.serviceVips.length} próprios` : ''} · ${config.distributionPolicy} · ${config.egressDeliveryMode} egress` : ''}
            </div>
          </div>
          <TopologySummary config={config} />
        </div>

        <div className="noc-panel">
          <div className="noc-panel-header">Backend Resolver Layer ({config.instances.length} instâncias)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-muted-foreground border-b border-border">
                <th className="text-left py-2 pr-4">Nome</th>
                <th className="text-left py-2 pr-4">Listener Privado</th>
                {isInterception && <th className="text-left py-2 pr-4">Egress</th>}
                <th className="text-left py-2 pr-4">Control</th>
              </tr></thead>
              <tbody>
                {config.instances.map((inst, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-primary">{inst.name}</td>
                    <td className="py-2 pr-4">{inst.bindIp || '—'}</td>
                    {isInterception && <td className="py-2 pr-4">
                      {config.egressDeliveryMode === 'border-routed' ? <span className="text-muted-foreground/50 line-through">{inst.egressIpv4 || '—'}</span> : (inst.egressIpv4 || '—')}
                    </td>}
                    <td className="py-2 pr-4 text-muted-foreground">{inst.controlInterface}:{inst.controlPort}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="noc-panel">
          <div className="noc-panel-header">Resumo do Deploy</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            {[
              ['Modo', isInterception ? 'Interceptação' : 'Simples'],
              ['Hostname', config.hostname || '—'],
              ['Interface', `${config.mainInterface} — ${config.ipv4Address}`],
              ...(isInterception ? [
                ['VIPs', `${config.interceptedVips.length} interceptados${hasOwnVip ? ` + ${config.serviceVips.length} próprios` : ''}`],
                ['Egress', config.egressDeliveryMode === 'border-routed' ? 'Border-Routed' : 'Host-Owned'],
                ['Distribuição', config.distributionPolicy],
              ] : [
              ['Frontend DNS', config.frontendDnsIp || '—'],
              ['Distribuição', config.simpleDistributionStrategy === 'sticky-source' ? `Sticky (${Math.floor(config.simpleStickyTimeout / 60)}min)` : 'Round-robin'],
              ]),
              ['Instâncias', String(config.instances.length)],
              ['IPv6', config.enableIpv6 ? 'Dual-stack' : 'IPv4 only'],
              ['ACLs', `${config.accessControlIpv4.length} IPv4`],
              ['Arquivos', `${generatedFiles.length}`],
            ].map(([k, v]) => (
              <div key={k} className="py-1"><div className="text-muted-foreground uppercase tracking-wider text-[10px]">{k}</div><div className="font-mono font-medium">{v}</div></div>
            ))}
          </div>
        </div>

        <div className="noc-panel">
          <div className="noc-panel-header flex items-center justify-between">
            <span>Artefatos ({generatedFiles.length} arquivos)</span>
            <button onClick={() => setShowFiles(!showFiles)} className="text-[10px] text-accent hover:underline">{showFiles ? 'Ocultar' : 'Mostrar'}</button>
          </div>
          {showFiles ? <FilePreviewAccordion files={generatedFiles} /> : (
            <div className="flex flex-wrap gap-1 max-h-[150px] overflow-y-auto">
              {generatedFiles.map(f => <span key={f.path} className="text-xs font-mono px-2 py-0.5 bg-secondary text-secondary-foreground rounded border border-border">{f.path}</span>)}
            </div>
          )}
        </div>

        {(submitState !== 'idle' || submitError) && (
          <div className={`noc-panel ${submitError ? 'border-destructive/30' : 'border-primary/30'}`}>
            <div className="noc-panel-header"><Settings size={12} /> Estado</div>
            <div className="space-y-2 text-xs">
              {submitError && <div className="p-2 bg-destructive/10 border border-destructive/20 rounded text-destructive font-mono">{submitError}</div>}
            </div>
          </div>
        )}

        <div className="noc-panel border-border/50">
          <div className="noc-panel-header text-muted-foreground"><Settings size={12} /> Diagnóstico</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleCopyPayload} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border">📋 Copiar Payload</button>
            <button onClick={handleTestConnectivity} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border">🔗 Testar API</button>
            <button onClick={handleForceDryRun} className="px-3 py-1.5 text-xs bg-accent/20 text-accent rounded border border-accent/30">⚡ Dry-Run Direto</button>
          </div>
        </div>
      </div>
    );
  };

  // ═══ Step router — dynamic based on step name ═══
  const stepRenderers: Record<string, () => React.ReactNode> = {
    'Topologia do Host': renderHostTopology,
    'Modo de Operação DNS': renderOperationMode,
    'Frontend DNS': renderFrontendDns,
    'Modelo de Entrega do VIP': renderDeliverySubmode,
    'Instâncias Resolver': renderInstances,
    'VIPs de Serviço': renderServiceVips,
    'VIP Interception': renderInterception,
    'Egress Público': renderEgress,
    'Mapeamento VIP→Instância': renderMapping,
    'Segurança': renderSecurity,
    'Observabilidade': renderObservability,
    'Revisão & Deploy': renderReview,
  };

  const renderStep = () => {
    const stepName = STEPS[step];
    const renderer = stepRenderers[stepName];
    return renderer ? renderer() : null;
  };

  const [importLoading, setImportLoading] = useState(false);
  const handleImportHost = async () => {
    setImportLoading(true);
    try {
      const r = await api.importHostState();
      if (r.success && r.data) {
        const imported = r.data as any;
        const newConfig: Partial<WizardConfig> = {};
        if (imported.hostname) newConfig.hostname = imported.hostname;
        if (imported.instances?.length > 0) {
          newConfig.instances = imported.instances.map((inst: any, i: number) => ({
            name: inst.name || `unbound${String(i + 1).padStart(2, '0')}`,
            bindIp: inst.bind_ip || inst.bindIp || '',
            bindIpv6: inst.bind_ipv6 || '',
            publicListenerIp: '',
            controlInterface: inst.control_interface || inst.controlInterface || `127.0.0.${11 + i}`,
            controlPort: inst.control_port || inst.controlPort || 8953,
            egressIpv4: inst.egress_ipv4 || inst.egressIpv4 || '',
            egressIpv6: inst.egress_ipv6 || '',
          }));
          newConfig.instanceCount = newConfig.instances!.length;
        }
        if (imported.egress_delivery_mode) newConfig.egressDeliveryMode = imported.egress_delivery_mode;
        setConfig(prev => ({ ...prev, ...newConfig }));
        alert(`✅ Estado importado: ${newConfig.instances?.length || 0} instâncias`);
      } else { alert(`❌ Falha: ${r.error}`); }
    } catch (err: any) { alert(`❌ Exceção: ${err.message}`); }
    finally { setImportLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {isInterception ? 'DNS Recursivo — Interceptação' : 'DNS Recursivo — Simples'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {isInterception
              ? 'Multi-instância · VIP → nftables DNAT → Unbound → Egress'
              : `Frontend local${config.frontendDnsIp ? ` (${config.frontendDnsIp})` : ''} · balanceamento local → backends internos`}
          </p>
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

      {/* Deploy Progress */}
      {deployProgress && submitState === 'dispatching' && (
        <div className="noc-panel border-primary/30">
          <div className="flex items-center gap-3 mb-2">
            <Loader2 size={14} className="animate-spin text-primary" />
            <span className="text-xs font-medium uppercase tracking-wider">{deployProgress.phase === 'dry_run_validating' ? 'Dry-Run' : 'Deploy'} em andamento</span>
            <span className="text-xs text-muted-foreground ml-auto font-mono">{deployProgress.completedSteps}/{deployProgress.totalSteps || '?'}</span>
          </div>
          <div className="w-full h-2 bg-secondary rounded-full overflow-hidden mb-2">
            <div className="h-full bg-primary rounded-full transition-all duration-500"
              style={{ width: deployProgress.totalSteps > 0 ? `${(deployProgress.completedSteps / deployProgress.totalSteps) * 100}%` : '10%' }} />
          </div>
          <div className="text-xs text-muted-foreground font-mono"><Activity size={10} className="text-primary inline mr-1" />{deployProgress.currentStep || 'Aguardando...'}</div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => { setStep(Math.max(0, step - 1)); setShowValidation(false); }} disabled={step === 0}
          className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80 disabled:opacity-40">
          <ChevronLeft size={16} /> Anterior
        </button>
        <div className="flex gap-2">
          {step === LAST_STEP && !applyResult && (
            <>
              <button onClick={() => handleApply(true)} disabled={submitState === 'dispatching'}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-secondary text-secondary-foreground rounded border border-border disabled:opacity-60">
                <Eye size={16} /> Dry Run
              </button>
              <button onClick={() => handleApply(false)} disabled={submitState === 'dispatching' || !isConfigValid(validationErrors)}
                className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium disabled:opacity-60">
                {submitState === 'dispatching' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                {submitState === 'dispatching' ? 'Aplicando...' : 'Aplicar Deploy'}
              </button>
            </>
          )}
          {step < LAST_STEP && (
            <button onClick={handleNext} className="flex items-center gap-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90">
              Próximo <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
