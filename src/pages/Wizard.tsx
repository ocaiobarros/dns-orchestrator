import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEFAULT_CONFIG, type WizardConfig, type DnsInstance } from '@/lib/types';
import { validateConfig, getStepErrors, isConfigValid } from '@/lib/validation';
import { generateAllFiles } from '@/lib/config-generator';
import { useApplyConfig } from '@/lib/hooks';
import ApplyStepsViewer from '@/components/ApplyStepsViewer';
import { Check, ChevronLeft, ChevronRight, AlertTriangle, Play, Eye, AlertCircle, Loader2 } from 'lucide-react';
import type { ApplyResult, ValidationError as ValError } from '@/lib/types';

const STEPS = ['Identificação', 'Rede', 'Loopback & VIP', 'Instâncias DNS', 'nftables', 'FRR / OSPF', 'Segurança', 'Revisão'];

function FieldGroup({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
      {children}
      {error && <p className="text-xs text-destructive flex items-center gap-1"><AlertCircle size={10} />{error}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string | number; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring" />
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

  const generatedFiles = generateAllFiles(config);

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="Hostname *" error={fieldError('hostname')}><Input value={config.hostname} onChange={v => set('hostname', v)} placeholder="dns-rec-01.example.com" /></FieldGroup>
            <FieldGroup label="Organização *" error={fieldError('organization')}><Input value={config.organization} onChange={v => set('organization', v)} placeholder="MinhaOperadora" /></FieldGroup>
            <FieldGroup label="Projeto" error={fieldError('project')}><Input value={config.project} onChange={v => set('project', v)} placeholder="DNS Recursivo Produção" /></FieldGroup>
            <FieldGroup label="Timezone"><Input value={config.timezone} onChange={v => set('timezone', v)} /></FieldGroup>
            <FieldGroup label="Interface principal *" error={fieldError('mainInterface')}><Input value={config.mainInterface} onChange={v => set('mainInterface', v)} /></FieldGroup>
            <FieldGroup label="Descrição"><Input value={config.description} onChange={v => set('description', v)} placeholder="Servidor DNS recursivo principal" /></FieldGroup>
          </div>
        );
      case 1:
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="Endereço IPv4 (CIDR) *" error={fieldError('ipv4Address')}><Input value={config.ipv4Address} onChange={v => set('ipv4Address', v)} placeholder="172.28.22.6/30" /></FieldGroup>
            <FieldGroup label="Gateway IPv4 *" error={fieldError('ipv4Gateway')}><Input value={config.ipv4Gateway} onChange={v => set('ipv4Gateway', v)} /></FieldGroup>
            <FieldGroup label="DNS Bootstrap *" error={fieldError('bootstrapDns')}><Input value={config.bootstrapDns} onChange={v => set('bootstrapDns', v)} /></FieldGroup>
            <div />
            <div className="col-span-full"><Toggle checked={config.enableIpv6} onChange={v => set('enableIpv6', v)} label="Habilitar IPv6" /></div>
            {config.enableIpv6 && (
              <>
                <FieldGroup label="Endereço IPv6" error={fieldError('ipv6Address')}><Input value={config.ipv6Address} onChange={v => set('ipv6Address', v)} /></FieldGroup>
                <FieldGroup label="Gateway IPv6" error={fieldError('ipv6Gateway')}><Input value={config.ipv6Gateway} onChange={v => set('ipv6Gateway', v)} /></FieldGroup>
              </>
            )}
          </div>
        );
      case 2:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="Dummy Interface *" error={fieldError('dummyInterface')}><Input value={config.dummyInterface} onChange={v => set('dummyInterface', v)} /></FieldGroup>
              <FieldGroup label="VIP Anycast IPv4 *" error={fieldError('vipAnycastIpv4')}><Input value={config.vipAnycastIpv4} onChange={v => set('vipAnycastIpv4', v)} /></FieldGroup>
            </div>
            <FieldGroup label="IPs de Bind do Unbound (/32) *" error={fieldError('unboundBindIps')}>
              <ListInput items={config.unboundBindIps} onChange={v => set('unboundBindIps', v)} placeholder="100.126.255.101/32" />
            </FieldGroup>
            <FieldGroup label="IPs Públicos de Saída (/32) *" error={fieldError('publicExitIps')}>
              <ListInput items={config.publicExitIps} onChange={v => set('publicExitIps', v)} placeholder="45.232.215.16/32" />
            </FieldGroup>
          </div>
        );
      case 3:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FieldGroup label="Threads *" error={fieldError('threads')}><Input type="number" value={config.threads} onChange={v => set('threads', parseInt(v) || 1)} /></FieldGroup>
              <FieldGroup label="Msg Cache"><Input value={config.msgCacheSize} onChange={v => set('msgCacheSize', v)} /></FieldGroup>
              <FieldGroup label="RRset Cache"><Input value={config.rrsetCacheSize} onChange={v => set('rrsetCacheSize', v)} /></FieldGroup>
              <FieldGroup label="Key Cache"><Input value={config.keyCacheSize} onChange={v => set('keyCacheSize', v)} /></FieldGroup>
              <FieldGroup label="Min TTL" error={fieldError('minTtl')}><Input type="number" value={config.minTtl} onChange={v => set('minTtl', parseInt(v) || 0)} /></FieldGroup>
              <FieldGroup label="Max TTL" error={fieldError('maxTtl')}><Input type="number" value={config.maxTtl} onChange={v => set('maxTtl', parseInt(v) || 0)} /></FieldGroup>
            </div>
            <div className="flex gap-4">
              <Toggle checked={config.enableDetailedLogs} onChange={v => set('enableDetailedLogs', v)} label="Logs detalhados" />
              <Toggle checked={config.enableBlocklist} onChange={v => set('enableBlocklist', v)} label="Blocklist" />
            </div>
            <div className="noc-panel-header mt-4">Instâncias ({config.instances.length})</div>
            <div className="space-y-3">
              {config.instances.map((inst, i) => (
                <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 rounded bg-secondary border border-border">
                  <FieldGroup label="Nome" error={fieldError(`instances[${i}].name`)}><Input value={inst.name} onChange={v => updateInstance(i, 'name', v)} /></FieldGroup>
                  <FieldGroup label="Bind IP" error={fieldError(`instances[${i}].bindIp`)}><Input value={inst.bindIp} onChange={v => updateInstance(i, 'bindIp', v)} /></FieldGroup>
                  <FieldGroup label="Exit IP" error={fieldError(`instances[${i}].exitIp`)}><Input value={inst.exitIp} onChange={v => updateInstance(i, 'exitIp', v)} /></FieldGroup>
                  <FieldGroup label="Control Port" error={fieldError(`instances[${i}].controlPort`)}><Input type="number" value={inst.controlPort} onChange={v => updateInstance(i, 'controlPort', parseInt(v) || 0)} /></FieldGroup>
                  <div className="flex items-end">
                    <button onClick={() => set('instances', config.instances.filter((_, j) => j !== i))}
                      className="px-2 py-2 text-xs text-destructive hover:bg-destructive/10 rounded">Remover</button>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => set('instances', [...config.instances, { name: `unbound${String(config.instances.length + 1).padStart(2, '0')}`, bindIp: '', exitIp: '', controlPort: 8953 + config.instances.length }])}
              className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">+ Adicionar instância</button>
          </div>
        );
      case 4:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="VIP alvo *" error={fieldError('nftVipTarget')}><Input value={config.nftVipTarget} onChange={v => set('nftVipTarget', v)} /></FieldGroup>
              <FieldGroup label="Modo de Dispatch">
                <select value={config.dispatchMode} onChange={e => set('dispatchMode', e.target.value as WizardConfig['dispatchMode'])}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground">
                  <option value="round-robin">Round-Robin</option>
                  <option value="random">Random</option>
                  <option value="hash">Source Hash</option>
                </select>
              </FieldGroup>
            </div>
            <Toggle checked={config.stickySourceIp} onChange={v => set('stickySourceIp', v)} label="Sticky por source IP" />
            {config.stickySourceIp && (
              <FieldGroup label="Sticky Timeout (s)" error={fieldError('stickyTimeout')}><Input type="number" value={config.stickyTimeout} onChange={v => set('stickyTimeout', parseInt(v) || 0)} /></FieldGroup>
            )}
            <Toggle checked={config.enableDnsProtection} onChange={v => set('enableDnsProtection', v)} label="Proteção básica DNS (rate limiting)" />
            <FieldGroup label="DNAT Targets *" error={fieldError('nftDnatTargets')}>
              <ListInput items={config.nftDnatTargets} onChange={v => set('nftDnatTargets', v)} placeholder="100.126.255.101" />
            </FieldGroup>
          </div>
        );
      case 5:
        return (
          <div className="space-y-4">
            <Toggle checked={config.enableFrr} onChange={v => set('enableFrr', v)} label="Habilitar FRR/OSPF" />
            {config.enableFrr && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldGroup label="Router ID *" error={fieldError('routerId')}><Input value={config.routerId} onChange={v => set('routerId', v)} /></FieldGroup>
                  <FieldGroup label="Área OSPF *" error={fieldError('ospfArea')}><Input value={config.ospfArea} onChange={v => set('ospfArea', v)} /></FieldGroup>
                  <FieldGroup label="Custo OSPF" error={fieldError('ospfCost')}><Input type="number" value={config.ospfCost} onChange={v => set('ospfCost', parseInt(v) || 1)} /></FieldGroup>
                  <FieldGroup label="Network Type">
                    <select value={config.networkType} onChange={e => set('networkType', e.target.value as WizardConfig['networkType'])}
                      className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground">
                      <option value="point-to-point">Point-to-Point</option>
                      <option value="broadcast">Broadcast</option>
                    </select>
                  </FieldGroup>
                </div>
                <Toggle checked={config.redistributeConnected} onChange={v => set('redistributeConnected', v)} label="Redistribuir connected" />
                <FieldGroup label="Interfaces OSPF *" error={fieldError('ospfInterfaces')}>
                  <ListInput items={config.ospfInterfaces} onChange={v => set('ospfInterfaces', v)} placeholder="lo0" />
                </FieldGroup>
              </>
            )}
          </div>
        );
      case 6:
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FieldGroup label="Tipo de Autenticação">
                <select value={config.authType} onChange={e => set('authType', e.target.value as WizardConfig['authType'])}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground">
                  <option value="local">Local (user/password)</option>
                  <option value="pam">PAM Linux</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Usuário Admin *" error={fieldError('adminUser')}><Input value={config.adminUser} onChange={v => set('adminUser', v)} /></FieldGroup>
              <FieldGroup label="Senha Inicial"><Input value={config.adminPassword} onChange={v => set('adminPassword', v)} type="password" placeholder="Definida no primeiro acesso" /></FieldGroup>
              <FieldGroup label="Bind do Painel">
                <select value={config.panelBind} onChange={e => set('panelBind', e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground">
                  <option value="127.0.0.1">127.0.0.1 (local only)</option>
                  <option value="0.0.0.0">0.0.0.0 (all interfaces)</option>
                </select>
              </FieldGroup>
              <FieldGroup label="Porta *" error={fieldError('panelPort')}><Input type="number" value={config.panelPort} onChange={v => set('panelPort', parseInt(v) || 8443)} /></FieldGroup>
            </div>
            <FieldGroup label="AllowList de IPs" error={fieldError('allowedIps')}>
              <ListInput items={config.allowedIps} onChange={v => set('allowedIps', v)} placeholder="10.0.0.0/8" />
            </FieldGroup>
            {showValidation && validationErrors.filter(e => e.step === 6 && e.severity === 'warning').map((w, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-warning/10 border border-warning/30 text-warning text-xs">
                <AlertTriangle size={12} />{w.message}
              </div>
            ))}
          </div>
        );
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
            {/* Validation summary */}
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

            <div className="noc-panel">
              <div className="noc-panel-header">Resumo da Configuração</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
                {[
                  ['Hostname', config.hostname || '(não definido)'],
                  ['Organização', config.organization || '(não definido)'],
                  ['Interface', config.mainInterface],
                  ['IPv4', config.ipv4Address],
                  ['Gateway', config.ipv4Gateway],
                  ['IPv6', config.enableIpv6 ? 'Sim' : 'Não'],
                  ['VIP Anycast', config.vipAnycastIpv4],
                  ['Instâncias DNS', String(config.instances.length)],
                  ['Threads', String(config.threads)],
                  ['FRR/OSPF', config.enableFrr ? 'Sim' : 'Não'],
                  ['Router ID', config.routerId],
                  ['Dispatch', config.dispatchMode],
                  ['Proteção DNS', config.enableDnsProtection ? 'Sim' : 'Não'],
                  ['Porta Painel', String(config.panelPort)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between py-1 border-b border-border">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="noc-panel">
              <div className="noc-panel-header">Instâncias DNS</div>
              <div className="space-y-1 font-mono text-sm">
                {config.instances.map((inst, i) => (
                  <div key={i} className="flex gap-4 py-1 border-b border-border last:border-0 flex-wrap">
                    <span className="text-primary w-24">{inst.name}</span>
                    <span>bind: {inst.bindIp}</span>
                    <span>exit: {inst.exitIp}</span>
                    <span className="text-muted-foreground">ctrl: {inst.controlPort}</span>
                  </div>
                ))}
              </div>
            </div>

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
        <h1 className="text-xl font-semibold">Wizard de Instalação</h1>
        <p className="text-sm text-muted-foreground">Configure e implante o serviço DNS recursivo</p>
      </div>

      <div className="flex gap-1 overflow-x-auto pb-2">
        {STEPS.map((s, i) => {
          const hasErrors = showValidation && stepErrors(i).some(e => e.severity === 'error');
          return (
            <button key={i} onClick={() => setStep(i)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border whitespace-nowrap transition-colors ${
                i === step ? 'wizard-step-active' :
                i < step && !hasErrors ? 'wizard-step-done' :
                hasErrors ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'wizard-step-pending'
              }`}>
              {i < step && !hasErrors ? <Check size={12} /> : hasErrors ? <AlertCircle size={12} /> : <span className="font-mono">{i + 1}</span>}
              {s}
            </button>
          );
        })}
      </div>

      <div className="noc-panel min-h-[300px]">
        <div className="noc-panel-header">Etapa {step + 1} — {STEPS[step]}</div>
        {renderStep()}
      </div>

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
                {applyMutation.isPending ? 'Aplicando...' : 'Aplicar'}
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
