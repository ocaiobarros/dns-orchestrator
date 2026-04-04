// ============================================================
// DNS Control — Production Validation Engine (Deterministic 2-Mode Wizard)
// Cross-field, architectural, and safety validations
// ============================================================

import type { WizardConfig, ValidationError, OperationMode, VipDeliverySubmode } from './types';

const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const IPV6_CIDR = /^[0-9a-fA-F:]+\/\d{1,3}$/;
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/;
const IFACE_NAME = /^[a-zA-Z][a-zA-Z0-9\-_\.]*$/;

// ═══ Known public DNS IPs — BLOCKED as Service VIPs ═══
const KNOWN_PUBLIC_DNS_IPV4 = [
  '8.8.8.8', '8.8.4.4',           // Google
  '1.1.1.1', '1.0.0.1',           // Cloudflare
  '9.9.9.9', '149.112.112.112',   // Quad9
  '208.67.222.222', '208.67.220.220', // OpenDNS
  '4.2.2.1', '4.2.2.2', '4.2.2.3', '4.2.2.4', '4.2.2.5', '4.2.2.6', // Level3
  '64.6.64.6', '64.6.65.6',       // Verisign
  '185.228.168.9', '185.228.169.9', // CleanBrowsing
];

function isValidIpv4(ip: string): boolean {
  if (!IPV4.test(ip)) return false;
  return ip.split('.').every(o => { const n = parseInt(o); return n >= 0 && n <= 255; });
}

function isValidIpv4Cidr(cidr: string): boolean {
  if (!IPV4_CIDR.test(cidr)) return false;
  const [ip, mask] = cidr.split('/');
  return isValidIpv4(ip) && parseInt(mask) >= 0 && parseInt(mask) <= 32;
}

function isValidIpv6(ip: string): boolean {
  return IPV6.test(ip) && ip.includes(':');
}

function isValidIpv6Cidr(cidr: string): boolean {
  if (!IPV6_CIDR.test(cidr)) return false;
  const [ip, mask] = cidr.split('/');
  return isValidIpv6(ip) && parseInt(mask) >= 0 && parseInt(mask) <= 128;
}

function extractIpFromCidr(cidr: string): string {
  return cidr.split('/')[0];
}

function findDuplicates(arr: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  arr.forEach(v => { if (seen.has(v)) dups.add(v); seen.add(v); });
  return [...dups];
}

// ═══ Step index resolver — maps step names to their current index ═══
function getStepNames(mode: OperationMode, submode: VipDeliverySubmode): string[] {
  if (mode === 'simple') {
    return ['Topologia do Host', 'Modo de Operação DNS', 'Frontend DNS', 'Instâncias Resolver', 'Segurança', 'Observabilidade', 'Revisão & Deploy'];
  }
  if (submode === 'interception-plus-own-vip') {
    return ['Topologia do Host', 'Modo de Operação DNS', 'Modelo de Entrega do VIP', 'Instâncias Resolver', 'VIPs de Serviço', 'VIP Interception', 'Egress Público', 'Mapeamento VIP→Instância', 'Segurança', 'Observabilidade', 'Revisão & Deploy'];
  }
  return ['Topologia do Host', 'Modo de Operação DNS', 'Modelo de Entrega do VIP', 'Instâncias Resolver', 'VIP Interception', 'Egress Público', 'Mapeamento VIP→Instância', 'Segurança', 'Observabilidade', 'Revisão & Deploy'];
}

function stepIndex(names: string[], name: string): number {
  const idx = names.indexOf(name);
  return idx >= 0 ? idx : 0;
}

export function validateConfig(config: WizardConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const steps = getStepNames(config.operationMode, config.vipDeliverySubmode);
  const s = (name: string) => stepIndex(steps, name);
  const e = (field: string, step: number, message: string, severity: 'error' | 'warning' = 'error') =>
    errors.push({ field, step, message, severity });

  const isInterception = config.operationMode === 'interception';
  const hasOwnVip = config.vipDeliverySubmode === 'interception-plus-own-vip';

  // ═══ Topologia do Host ═══
  const topStep = s('Topologia do Host');
  if (!config.hostname.trim()) e('hostname', topStep, 'Hostname é obrigatório');
  else if (!HOSTNAME.test(config.hostname)) e('hostname', topStep, 'Hostname contém caracteres inválidos');
  if (!config.organization.trim()) e('organization', topStep, 'Organização é obrigatória');
  if (!config.mainInterface.trim()) e('mainInterface', topStep, 'Interface principal é obrigatória');
  else if (!IFACE_NAME.test(config.mainInterface)) e('mainInterface', topStep, 'Nome de interface inválido');
  if (!config.ipv4Address) e('ipv4Address', topStep, 'Endereço IPv4 é obrigatório');
  else if (!isValidIpv4Cidr(config.ipv4Address)) e('ipv4Address', topStep, 'Endereço IPv4/CIDR inválido (formato: x.x.x.x/y)');
  if (!config.ipv4Gateway) e('ipv4Gateway', topStep, 'Gateway IPv4 é obrigatório');
  else if (!isValidIpv4(config.ipv4Gateway)) e('ipv4Gateway', topStep, 'Gateway IPv4 inválido');
  if (config.enableIpv6) {
    if (!config.ipv6Address) e('ipv6Address', topStep, 'Endereço IPv6 é obrigatório quando IPv6 está habilitado');
    else if (!isValidIpv6Cidr(config.ipv6Address) && !isValidIpv6(config.ipv6Address)) e('ipv6Address', topStep, 'Endereço IPv6 inválido');
    if (!config.ipv6Gateway) e('ipv6Gateway', topStep, 'Gateway IPv6 é obrigatório quando IPv6 está habilitado');
    else if (!isValidIpv6(config.ipv6Gateway)) e('ipv6Gateway', topStep, 'Gateway IPv6 inválido');
  }

  // ═══ Frontend DNS (simple mode only) ═══
  if (!isInterception) {
    const frontendStep = s('Frontend DNS');
    if (!config.frontendDnsIp.trim()) e('frontendDnsIp', frontendStep, 'Frontend DNS IP é obrigatório no modo simples');
    else if (!isValidIpv4(config.frontendDnsIp)) e('frontendDnsIp', frontendStep, 'Frontend DNS IP inválido');
    else {
      // Frontend IP must not collide with backend bind IPs
      config.instances.forEach((inst) => {
        if (config.frontendDnsIp === inst.bindIp) {
          e('frontendDnsIp', frontendStep, `Frontend DNS IP ${config.frontendDnsIp} conflita com listener da instância "${inst.name}" — o frontend não pode ser o mesmo IP do backend`);
        }
      });
    }
  }

  // ═══ Instâncias Resolver ═══
  const instStep = s('Instâncias Resolver');
  if (config.instances.length === 0) e('instances', instStep, 'Pelo menos uma instância resolver é necessária');
  
  const instNames = config.instances.map(i => i.name).filter(Boolean);
  const dupNames = findDuplicates(instNames);
  if (dupNames.length > 0) e('instances', instStep, `Nomes de instância duplicados: ${dupNames.join(', ')}`);

  const listenerIps = config.instances.map(i => i.bindIp).filter(Boolean);
  const dupListeners = findDuplicates(listenerIps);
  if (dupListeners.length > 0) e('instances', instStep, `Listener IPs duplicados: ${dupListeners.join(', ')}`);

  const controlIps = config.instances.map(i => `${i.controlInterface}:${i.controlPort}`).filter(i => i !== ':');
  const dupControls = findDuplicates(controlIps);
  if (dupControls.length > 0) e('instances', instStep, `Control interfaces duplicadas: ${dupControls.join(', ')}`);

  config.instances.forEach((inst, i) => {
    if (!inst.name.trim()) e(`instances[${i}].name`, instStep, `Nome da instância ${i + 1} é obrigatório`);
    if (!inst.bindIp.trim()) e(`instances[${i}].bindIp`, instStep, `Listener privado da instância "${inst.name}" é obrigatório`);
    else if (!isValidIpv4(inst.bindIp)) e(`instances[${i}].bindIp`, instStep, `Listener privado da instância "${inst.name}" é inválido`);

    if (!inst.controlInterface.trim()) e(`instances[${i}].controlInterface`, instStep, `Control interface da instância "${inst.name}" é obrigatória`);
    else if (!isValidIpv4(inst.controlInterface)) e(`instances[${i}].controlInterface`, instStep, `Control interface da instância "${inst.name}" é inválida`);

    if (inst.controlPort < 1024 || inst.controlPort > 65535) e(`instances[${i}].controlPort`, instStep, `Porta de controle inválida: ${inst.controlPort} (1024-65535)`);

    if (inst.bindIp && config.ipv4Address && inst.bindIp === extractIpFromCidr(config.ipv4Address)) {
      e(`instances[${i}].bindIp`, instStep, `Listener ${inst.bindIp} conflita com IP privado do host`);
    }

    if (config.enableIpv6 && inst.bindIpv6 && !isValidIpv6(inst.bindIpv6)) {
      e(`instances[${i}].bindIpv6`, instStep, `Listener IPv6 da instância "${inst.name}" é inválido`);
    }

    if (isInterception && inst.publicListenerIp && inst.publicListenerIp.trim()) {
      e(`instances[${i}].publicListenerIp`, instStep, `No modo Interceptação, a instância "${inst.name}" não deve ter listener público — o IP público é tratado como VIP interceptado via nftables`);
    }
  });

  if (config.threads < 1 || config.threads > 64) e('threads', instStep, 'Threads deve ser entre 1 e 64');
  if (config.maxTtl < config.minTtl) e('maxTtl', instStep, 'Max TTL deve ser maior que Min TTL');

  // ═══ Interception-only steps ═══
  if (isInterception) {
    // ═══ VIPs de Serviço (only when submode = interception-plus-own-vip) ═══
    if (hasOwnVip) {
      const vipStep = s('VIPs de Serviço');
      if (config.serviceVips.length === 0) e('serviceVips', vipStep, 'Pelo menos um VIP de serviço próprio é necessário neste submodo');
      
      const vipIpv4s = config.serviceVips.map(v => v.ipv4).filter(Boolean);
      const dupVips = findDuplicates(vipIpv4s);
      if (dupVips.length > 0) e('serviceVips', vipStep, `VIPs IPv4 duplicados: ${dupVips.join(', ')}`);

      config.serviceVips.forEach((vip, i) => {
        if (!vip.ipv4.trim()) e(`serviceVips[${i}].ipv4`, vipStep, `IPv4 do VIP ${i + 1} é obrigatório`);
        else if (!isValidIpv4(vip.ipv4)) e(`serviceVips[${i}].ipv4`, vipStep, `IPv4 do VIP ${i + 1} é inválido`);

        if (vip.ipv4 && KNOWN_PUBLIC_DNS_IPV4.includes(vip.ipv4)) {
          e(`serviceVips[${i}].ipv4`, vipStep, `O IP ${vip.ipv4} pertence a resolvedor público conhecido e não pode ser usado como VIP próprio. Use a etapa "VIP Interception" para interceptar este IP.`);
        }

        // VIP cannot be an intercepted VIP
        if (vip.ipv4 && config.interceptedVips?.some(iv => iv.vipIp === vip.ipv4)) {
          e(`serviceVips[${i}].ipv4`, vipStep, `O IP ${vip.ipv4} já está cadastrado como VIP interceptado — VIP próprio e interceptado devem ser distintos`);
        }

        if (config.vipIpv6Enabled && vip.ipv6 && !isValidIpv6(vip.ipv6)) {
          e(`serviceVips[${i}].ipv6`, vipStep, `IPv6 do VIP ${i + 1} é inválido`);
        }

        config.instances.forEach((inst) => {
          if (vip.ipv4 && inst.bindIp && vip.ipv4 === inst.bindIp) {
            e(`serviceVips[${i}].ipv4`, vipStep, `VIP ${vip.ipv4} conflita com listener da instância "${inst.name}"`);
          }
        });

        if (vip.ipv4 && config.ipv4Address && vip.ipv4 === extractIpFromCidr(config.ipv4Address)) {
          e(`serviceVips[${i}].ipv4`, vipStep, `VIP ${vip.ipv4} conflita com o IP privado do host`);
        }
      });
    }

    // ═══ VIP Interception ═══
    const intStep = s('VIP Interception');
    if (config.interceptedVips && config.interceptedVips.length > 0) {
      const ivipIps = config.interceptedVips.map(v => v.vipIp).filter(Boolean);
      const dupIvips = findDuplicates(ivipIps);
      if (dupIvips.length > 0) e('interceptedVips', intStep, `VIPs interceptados duplicados: ${dupIvips.join(', ')}`);

      config.interceptedVips.forEach((vip, i) => {
        if (!vip.vipIp.trim()) e(`interceptedVips[${i}].vipIp`, intStep, `VIP IP ${i + 1} é obrigatório`);
        else if (!isValidIpv4(vip.vipIp)) e(`interceptedVips[${i}].vipIp`, intStep, `VIP IP ${i + 1} inválido`);

        // IPv6 validation for intercepted VIPs
        if (config.enableIpv6 && vip.vipIpv6 && !isValidIpv6(vip.vipIpv6)) {
          e(`interceptedVips[${i}].vipIpv6`, intStep, `VIP IPv6 ${i + 1} inválido`);
        }

        // VIP IPv4 must not collide with listener or egress IPs
        if (vip.vipIp) {
          config.instances.forEach((inst) => {
            if (inst.bindIp && vip.vipIp === inst.bindIp) {
              e(`interceptedVips[${i}].vipIp`, intStep, `VIP ${vip.vipIp} conflita com listener da instância "${inst.name}"`);
            }
            if (inst.egressIpv4 && vip.vipIp === inst.egressIpv4) {
              e(`interceptedVips[${i}].vipIp`, intStep, `VIP ${vip.vipIp} conflita com egress da instância "${inst.name}"`);
            }
          });
          if (config.ipv4Address && vip.vipIp === extractIpFromCidr(config.ipv4Address)) {
            e(`interceptedVips[${i}].vipIp`, intStep, `VIP ${vip.vipIp} conflita com IP principal do host`);
          }
        }
      });
    }

    // ═══ Egress Público ═══
    const egrStep = s('Egress Público');
    const isBorderRouted = config.egressDeliveryMode === 'border-routed';
    const egressIps = config.instances.map(i => i.egressIpv4).filter(Boolean);
    const dupEgress = findDuplicates(egressIps);
    if (dupEgress.length > 0 && config.egressFixedIdentity) {
      e('egressIpv4', egrStep, `IPs de egress duplicados com identidade fixa ativa: ${dupEgress.join(', ')}`);
    }

    // ═══ Count validations: egress must match instances ═══
    const instanceCount = config.instances.length;
    const egressCount = config.instances.filter(i => i.egressIpv4.trim()).length;
    if (egressCount > 0 && egressCount < instanceCount) {
      e('egressIpv4', egrStep, `Apenas ${egressCount} de ${instanceCount} instâncias possuem egress IPv4 — todas devem ter`);
    }
    if (config.enableIpv6) {
      const egressV6Count = config.instances.filter(i => i.egressIpv6?.trim()).length;
      if (egressV6Count > 0 && egressV6Count < instanceCount) {
        e('egressIpv6', egrStep, `Apenas ${egressV6Count} de ${instanceCount} instâncias possuem egress IPv6 — todas devem ter quando IPv6 está habilitado`);
      }
    }

    config.instances.forEach((inst, i) => {
      if (!inst.egressIpv4.trim()) e(`instances[${i}].egressIpv4`, egrStep, `Egress IPv4 da instância "${inst.name}" é obrigatório`);
      else if (!isValidIpv4(inst.egressIpv4)) e(`instances[${i}].egressIpv4`, egrStep, `Egress IPv4 da instância "${inst.name}" é inválido`);

      if (inst.egressIpv4 && inst.bindIp && inst.egressIpv4 === inst.bindIp) {
        e(`instances[${i}].egressIpv4`, egrStep, `Egress ${inst.egressIpv4} da instância "${inst.name}" é igual ao listener — devem ser IPs distintos`);
      }

      config.interceptedVips?.forEach(vip => {
        if (inst.egressIpv4 && vip.vipIp && inst.egressIpv4 === vip.vipIp) {
          e(`instances[${i}].egressIpv4`, egrStep, `Egress ${inst.egressIpv4} conflita com VIP interceptado ${vip.vipIp}`);
        }
      });

      if (!isBorderRouted && inst.egressIpv4 && config.ipv4Address && inst.egressIpv4 === extractIpFromCidr(config.ipv4Address)) {
        e(`instances[${i}].egressIpv4`, egrStep, `Egress ${inst.egressIpv4} conflita com IP privado do host`);
      }

      if (config.enableIpv6 && inst.egressIpv6 && !isValidIpv6(inst.egressIpv6)) {
        e(`instances[${i}].egressIpv6`, egrStep, `Egress IPv6 da instância "${inst.name}" é inválido`);
      }
    });

    if (isBorderRouted && egressIps.length > 0) {
      e('egressDeliveryMode', egrStep, 'Modo border-routed: IP público de egress não estará presente nas interfaces do host — esperado neste modo. Roteamento estático na borda é obrigatório.', 'warning');
    }

    // ═══ Mapeamento VIP → Instância ═══
    const mapStep = s('Mapeamento VIP→Instância');
    if (config.distributionPolicy === 'active-passive' && config.instances.length < 2) {
      e('distributionPolicy', mapStep, 'Ativo/passivo requer pelo menos 2 instâncias');
    }
  }

  // ═══ Segurança ═══
  const secStep = s('Segurança');
  if (config.accessControlIpv4.length === 0) e('accessControlIpv4', secStep, 'Pelo menos uma ACL IPv4 é necessária');
  
  config.accessControlIpv4.forEach((acl, i) => {
    if (!acl.network.trim()) e(`accessControlIpv4[${i}].network`, secStep, `Rede da ACL ${i + 1} é obrigatória`);
    else if (!isValidIpv4Cidr(acl.network) && acl.network !== '0.0.0.0/0') {
      e(`accessControlIpv4[${i}].network`, secStep, `Rede "${acl.network}" não é um CIDR válido`);
    }
  });

  const hasOpenResolver = config.accessControlIpv4.some(a => a.network === '0.0.0.0/0' && a.action === 'allow');
  if (hasOpenResolver && !config.openResolverConfirmed) {
    e('openResolverConfirmed', secStep, 'Open resolver requer confirmação explícita');
  }
  if (hasOpenResolver) {
    e('openResolver', secStep, 'Configurado como open resolver — risco de amplificação DNS', 'warning');
  }

  const wideAcls = config.accessControlIpv4.filter(a => {
    if (a.action !== 'allow') return false;
    const cidr = a.network.split('/')[1];
    return cidr && parseInt(cidr) < 8;
  });
  if (wideAcls.length > 0 && !hasOpenResolver) {
    e('accessControlIpv4', secStep, `ACLs muito amplas detectadas (${wideAcls.map(a => a.network).join(', ')}) — verifique se é intencional`, 'warning');
  }

  if (!config.adminUser.trim()) e('adminUser', secStep, 'Usuário admin é obrigatório');
  if (config.panelPort < 1 || config.panelPort > 65535) e('panelPort', secStep, 'Porta do painel inválida');

  if (config.panelBind === '0.0.0.0' && config.allowedIps.length === 0) {
    e('panelBind', secStep, 'Painel exposto em 0.0.0.0 sem restrição de IPs — risco de segurança', 'warning');
  }

  // ═══ Cross-layer architectural validations ═══
  if (isInterception) {
    const reviewStep = s('Revisão & Deploy');
    const allIps: { ip: string; layer: string }[] = [];
    if (config.ipv4Address) allIps.push({ ip: extractIpFromCidr(config.ipv4Address), layer: 'Host privado' });
    config.interceptedVips?.forEach(v => { if (v.vipIp) allIps.push({ ip: v.vipIp, layer: 'VIP interceptado' }); });
    if (hasOwnVip) {
      config.serviceVips.forEach(v => { if (v.ipv4) allIps.push({ ip: v.ipv4, layer: 'VIP próprio' }); });
    }
    config.instances.forEach(inst => {
      if (inst.bindIp) allIps.push({ ip: inst.bindIp, layer: `Listener ${inst.name}` });
      if (inst.egressIpv4) allIps.push({ ip: inst.egressIpv4, layer: `Egress ${inst.name}` });
      if (inst.controlInterface) allIps.push({ ip: inst.controlInterface, layer: `Control ${inst.name}` });
    });

    const nonLoopbackIps = allIps.filter(i => !i.ip.startsWith('127.'));
    const ipMap = new Map<string, string[]>();
    nonLoopbackIps.forEach(({ ip, layer }) => {
      if (!ipMap.has(ip)) ipMap.set(ip, []);
      ipMap.get(ip)!.push(layer);
    });
    ipMap.forEach((layers, ip) => {
      if (layers.length > 1) {
        e('architecture', reviewStep, `IP ${ip} usado em múltiplas camadas: ${layers.join(', ')} — cada camada deve ter IPs exclusivos`, 'warning');
      }
    });
  }

  return errors;
}

export function getStepErrors(errors: ValidationError[], step: number): ValidationError[] {
  return errors.filter(e => e.step === step);
}

export function hasStepErrors(errors: ValidationError[], step: number): boolean {
  return errors.some(e => e.step === step && e.severity === 'error');
}

export function isConfigValid(errors: ValidationError[]): boolean {
  return !errors.some(e => e.severity === 'error');
}

export function getValidationSummary(errors: ValidationError[]) {
  const maxStep = Math.max(0, ...errors.map(e => e.step)) + 1;
  return {
    totalErrors: errors.filter(e => e.severity === 'error').length,
    totalWarnings: errors.filter(e => e.severity === 'warning').length,
    errorsByStep: Array.from({ length: Math.max(maxStep, 12) }, (_, i) => ({
      step: i,
      errors: errors.filter(e => e.step === i && e.severity === 'error').length,
      warnings: errors.filter(e => e.step === i && e.severity === 'warning').length,
    })),
    isValid: !errors.some(e => e.severity === 'error'),
    hasArchitecturalWarnings: errors.some(e => e.field === 'architecture'),
  };
}
