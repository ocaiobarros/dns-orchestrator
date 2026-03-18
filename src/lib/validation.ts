// ============================================================
// DNS Control — Production Validation Engine (10-Step Wizard)
// Cross-field, architectural, and safety validations
// ============================================================

import type { WizardConfig, ValidationError } from './types';

const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;
const IPV6_CIDR = /^[0-9a-fA-F:]+\/\d{1,3}$/;
const HOSTNAME = /^[a-zA-Z0-9]([a-zA-Z0-9\-\.]*[a-zA-Z0-9])?$/;
const IFACE_NAME = /^[a-zA-Z][a-zA-Z0-9\-_\.]*$/;

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

/** Find duplicates in an array of strings, returns the duplicated values */
function findDuplicates(arr: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  arr.filter(Boolean).forEach(v => {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  });
  return [...dupes];
}

export function validateConfig(config: WizardConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const e = (field: string, step: number, message: string, severity: 'error' | 'warning' = 'error') =>
    errors.push({ field, step, message, severity });

  // ═══ Step 0 — Topologia do Host ═══
  if (!config.hostname.trim()) e('hostname', 0, 'Hostname é obrigatório');
  else if (!HOSTNAME.test(config.hostname)) e('hostname', 0, 'Hostname contém caracteres inválidos');
  if (!config.organization.trim()) e('organization', 0, 'Organização é obrigatória');
  if (!config.mainInterface.trim()) e('mainInterface', 0, 'Interface principal é obrigatória');
  else if (!IFACE_NAME.test(config.mainInterface)) e('mainInterface', 0, 'Nome de interface inválido');
  if (!config.ipv4Address) e('ipv4Address', 0, 'Endereço IPv4 é obrigatório');
  else if (!isValidIpv4Cidr(config.ipv4Address)) e('ipv4Address', 0, 'Endereço IPv4/CIDR inválido (formato: x.x.x.x/y)');
  if (!config.ipv4Gateway) e('ipv4Gateway', 0, 'Gateway IPv4 é obrigatório');
  else if (!isValidIpv4(config.ipv4Gateway)) e('ipv4Gateway', 0, 'Gateway IPv4 inválido');
  if (config.enableIpv6) {
    if (!config.ipv6Address) e('ipv6Address', 0, 'Endereço IPv6 é obrigatório quando IPv6 está habilitado');
    else if (!isValidIpv6Cidr(config.ipv6Address) && !isValidIpv6(config.ipv6Address)) e('ipv6Address', 0, 'Endereço IPv6 inválido');
    if (!config.ipv6Gateway) e('ipv6Gateway', 0, 'Gateway IPv6 é obrigatório quando IPv6 está habilitado');
    else if (!isValidIpv6(config.ipv6Gateway)) e('ipv6Gateway', 0, 'Gateway IPv6 inválido');
  }

  // ═══ Step 1 — Modelo de Publicação (structural validation) ═══
  const needsVipDnat = ['pseudo-anycast-local', 'vip-routed-border', 'vip-local-dummy', 'anycast-frr-ospf'].includes(config.deploymentMode);
  const needsFrr = ['anycast-frr-ospf', 'anycast-frr-bgp'].includes(config.deploymentMode);

  if (needsFrr && config.routingMode === 'static') {
    e('routingMode', 1, `Modo "${config.deploymentMode}" requer roteamento dinâmico (FRR), mas roteamento está como estático`, 'warning');
  }

  // ═══ Step 2 — VIPs de Serviço ═══
  if (config.serviceVips.length === 0) e('serviceVips', 2, 'Pelo menos um VIP de serviço é necessário');
  
  const vipIpv4s = config.serviceVips.map(v => v.ipv4).filter(Boolean);
  const dupVips = findDuplicates(vipIpv4s);
  if (dupVips.length > 0) e('serviceVips', 2, `VIPs IPv4 duplicados: ${dupVips.join(', ')}`);

  config.serviceVips.forEach((vip, i) => {
    if (!vip.ipv4.trim()) e(`serviceVips[${i}].ipv4`, 2, `IPv4 do VIP ${i + 1} é obrigatório`);
    else if (!isValidIpv4(vip.ipv4)) e(`serviceVips[${i}].ipv4`, 2, `IPv4 do VIP ${i + 1} é inválido`);

    if (config.vipIpv6Enabled && vip.ipv6 && !isValidIpv6(vip.ipv6)) {
      e(`serviceVips[${i}].ipv6`, 2, `IPv6 do VIP ${i + 1} é inválido`);
    }

    // VIP cannot equal a listener IP
    config.instances.forEach((inst, j) => {
      if (vip.ipv4 && inst.bindIp && vip.ipv4 === inst.bindIp) {
        e(`serviceVips[${i}].ipv4`, 2, `VIP ${vip.ipv4} conflita com listener da instância "${inst.name}" — VIP e listener devem ser IPs distintos`);
      }
    });

    // VIP cannot equal the host private IP
    if (vip.ipv4 && config.ipv4Address && vip.ipv4 === extractIpFromCidr(config.ipv4Address)) {
      e(`serviceVips[${i}].ipv4`, 2, `VIP ${vip.ipv4} conflita com o IP privado do host`);
    }

    // DNAT mode requires nftables targets
    if (needsVipDnat && !vip.deliveryMode) {
      e(`serviceVips[${i}].deliveryMode`, 2, `Modo de entrega é obrigatório para modo ${config.deploymentMode}`);
    }
  });

  // ═══ Step 3 — Instâncias de Resolução ═══
  if (config.instances.length === 0) e('instances', 3, 'Pelo menos uma instância resolver é necessária');
  
  const instNames = config.instances.map(i => i.name).filter(Boolean);
  const dupNames = findDuplicates(instNames);
  if (dupNames.length > 0) e('instances', 3, `Nomes de instância duplicados: ${dupNames.join(', ')}`);

  const listenerIps = config.instances.map(i => i.bindIp).filter(Boolean);
  const dupListeners = findDuplicates(listenerIps);
  if (dupListeners.length > 0) e('instances', 3, `Listener IPs duplicados: ${dupListeners.join(', ')}`);

  const controlIps = config.instances.map(i => `${i.controlInterface}:${i.controlPort}`).filter(i => i !== ':');
  const dupControls = findDuplicates(controlIps);
  if (dupControls.length > 0) e('instances', 3, `Control interfaces duplicadas: ${dupControls.join(', ')}`);

  config.instances.forEach((inst, i) => {
    if (!inst.name.trim()) e(`instances[${i}].name`, 3, `Nome da instância ${i + 1} é obrigatório`);
    if (!inst.bindIp.trim()) e(`instances[${i}].bindIp`, 3, `Listener IPv4 da instância "${inst.name}" é obrigatório`);
    else if (!isValidIpv4(inst.bindIp)) e(`instances[${i}].bindIp`, 3, `Listener IPv4 da instância "${inst.name}" é inválido`);

    if (!inst.controlInterface.trim()) e(`instances[${i}].controlInterface`, 3, `Control interface da instância "${inst.name}" é obrigatória`);
    else if (!isValidIpv4(inst.controlInterface)) e(`instances[${i}].controlInterface`, 3, `Control interface da instância "${inst.name}" é inválida`);

    if (inst.controlPort < 1024 || inst.controlPort > 65535) e(`instances[${i}].controlPort`, 3, `Porta de controle inválida: ${inst.controlPort} (1024-65535)`);

    // Listener cannot equal host private IP
    if (inst.bindIp && config.ipv4Address && inst.bindIp === extractIpFromCidr(config.ipv4Address)) {
      e(`instances[${i}].bindIp`, 3, `Listener ${inst.bindIp} conflita com IP privado do host`);
    }

    // IPv6 validation
    if (config.enableIpv6 && inst.bindIpv6 && !isValidIpv6(inst.bindIpv6)) {
      e(`instances[${i}].bindIpv6`, 3, `Listener IPv6 da instância "${inst.name}" é inválido`);
    }
  });

  if (config.threads < 1 || config.threads > 64) e('threads', 3, 'Threads deve ser entre 1 e 64');
  if (config.maxTtl < config.minTtl) e('maxTtl', 3, 'Max TTL deve ser maior que Min TTL');

  // ═══ Step 4 — VIP Interception / DNS Seizure ═══
  if (config.interceptedVips && config.interceptedVips.length > 0) {
    const ivipIps = config.interceptedVips.map(v => v.vipIp).filter(Boolean);
    const dupIvips = findDuplicates(ivipIps);
    if (dupIvips.length > 0) e('interceptedVips', 4, `VIPs interceptados duplicados: ${dupIvips.join(', ')}`);

    config.interceptedVips.forEach((vip, i) => {
      if (!vip.vipIp.trim()) e(`interceptedVips[${i}].vipIp`, 4, `VIP IP ${i + 1} é obrigatório`);
      else if (!isValidIpv4(vip.vipIp)) e(`interceptedVips[${i}].vipIp`, 4, `VIP IP ${i + 1} inválido`);
      if (!vip.backendInstance.trim()) e(`interceptedVips[${i}].backendInstance`, 4, `Backend instance do VIP ${vip.vipIp || i + 1} é obrigatório`);
      if (!vip.backendTargetIp.trim()) e(`interceptedVips[${i}].backendTargetIp`, 4, `Backend target IP do VIP ${vip.vipIp || i + 1} é obrigatório`);
      else if (!isValidIpv4(vip.backendTargetIp)) e(`interceptedVips[${i}].backendTargetIp`, 4, `Backend target IP inválido`);
    });
  }

  // ═══ Step 5 — Egress Público ═══
  const isBorderRouted = config.egressDeliveryMode === 'border-routed';
  const egressIps = config.instances.map(i => i.egressIpv4).filter(Boolean);
  const dupEgress = findDuplicates(egressIps);
  if (dupEgress.length > 0 && config.egressFixedIdentity) {
    e('egressIpv4', 5, `IPs de egress duplicados com identidade fixa ativa: ${dupEgress.join(', ')}`);
  }

  config.instances.forEach((inst, i) => {
    if (!inst.egressIpv4.trim()) e(`instances[${i}].egressIpv4`, 5, `Egress IPv4 da instância "${inst.name}" é obrigatório`);
    else if (!isValidIpv4(inst.egressIpv4)) e(`instances[${i}].egressIpv4`, 5, `Egress IPv4 da instância "${inst.name}" é inválido`);

    // Egress cannot equal listener
    if (inst.egressIpv4 && inst.bindIp && inst.egressIpv4 === inst.bindIp) {
      e(`instances[${i}].egressIpv4`, 5, `Egress ${inst.egressIpv4} da instância "${inst.name}" é igual ao listener — devem ser IPs distintos`);
    }

    // Egress cannot equal VIP
    config.serviceVips.forEach(vip => {
      if (inst.egressIpv4 && vip.ipv4 && inst.egressIpv4 === vip.ipv4) {
        e(`instances[${i}].egressIpv4`, 5, `Egress ${inst.egressIpv4} conflita com VIP ${vip.ipv4}`);
      }
    });

    // Egress vs host private IP — only warn in host-owned mode (border-routed is expected to differ)
    if (!isBorderRouted && inst.egressIpv4 && config.ipv4Address && inst.egressIpv4 === extractIpFromCidr(config.ipv4Address)) {
      e(`instances[${i}].egressIpv4`, 5, `Egress ${inst.egressIpv4} conflita com IP privado do host`);
    }

    // IPv6 egress
    if (config.enableIpv6 && inst.egressIpv6 && !isValidIpv6(inst.egressIpv6)) {
      e(`instances[${i}].egressIpv6`, 5, `Egress IPv6 da instância "${inst.name}" é inválido`);
    }
  });

  // Border-routed INFO: egress IP not on host is expected
  if (isBorderRouted && egressIps.length > 0) {
    e('egressDeliveryMode', 5, 'Modo border-routed: IP público de egress não estará presente nas interfaces do host — esperado neste modo. Roteamento estático na borda é obrigatório.', 'warning');
  }

  // Listener IPs MUST be materialized locally — always required
  config.instances.forEach((inst, i) => {
    if (inst.bindIp && !inst.bindIp.startsWith('127.')) {
      e(`instances[${i}].bindIp`, 3, `Listener ${inst.bindIp} (${inst.name}) será configurado no loopback do host — obrigatório para binding e health checks diretos.`, 'warning');
    }
  });

  // ═══ Step 6 — Mapeamento VIP → Instância ═══
  if (config.distributionPolicy === 'fixed-mapping') {
    if (config.vipMappings.length === 0 && config.serviceVips.length > 0 && config.instances.length > 0) {
      e('vipMappings', 6, 'Mapeamento fixo requer pelo menos uma associação VIP→instância', 'warning');
    }
    // Check for orphaned VIPs
    const mappedVips = new Set(config.vipMappings.map(m => m.vipIndex));
    config.serviceVips.forEach((_, i) => {
      if (!mappedVips.has(i)) {
        e(`vipMappings`, 6, `VIP ${config.serviceVips[i]?.ipv4 || i + 1} não tem instância associada no mapeamento fixo`, 'warning');
      }
    });
  }

  if (config.distributionPolicy === 'active-passive' && config.instances.length < 2) {
    e('distributionPolicy', 6, 'Ativo/passivo requer pelo menos 2 instâncias');
  }

  // ═══ Step 7 — Roteamento ═══
  if (config.routingMode === 'frr-ospf') {
    if (!config.routerId) e('routerId', 7, 'Router ID é obrigatório');
    else if (!isValidIpv4(config.routerId)) e('routerId', 7, 'Router ID deve ser um IPv4 válido');
    if (!config.ospfArea) e('ospfArea', 7, 'Área OSPF é obrigatória');
    if (config.ospfInterfaces.length === 0) e('ospfInterfaces', 7, 'Pelo menos uma interface OSPF é necessária');
    if (config.ospfCost < 1 || config.ospfCost > 65535) e('ospfCost', 7, 'Custo OSPF deve ser entre 1 e 65535');
  }
  if (config.routingMode === 'frr-bgp') {
    e('routingMode', 7, 'BGP ainda não é suportado', 'warning');
  }

  // ═══ Step 8 — Segurança ═══
  if (config.accessControlIpv4.length === 0) e('accessControlIpv4', 8, 'Pelo menos uma ACL IPv4 é necessária');
  
  config.accessControlIpv4.forEach((acl, i) => {
    if (!acl.network.trim()) e(`accessControlIpv4[${i}].network`, 8, `Rede da ACL ${i + 1} é obrigatória`);
    else if (!isValidIpv4Cidr(acl.network) && acl.network !== '0.0.0.0/0') {
      e(`accessControlIpv4[${i}].network`, 8, `Rede "${acl.network}" não é um CIDR válido`);
    }
  });

  const hasOpenResolver = config.accessControlIpv4.some(a => a.network === '0.0.0.0/0' && a.action === 'allow');
  if (hasOpenResolver && !config.openResolverConfirmed) {
    e('openResolverConfirmed', 8, 'Open resolver requer confirmação explícita');
  }
  if (hasOpenResolver) {
    e('openResolver', 8, 'Configurado como open resolver — risco de amplificação DNS', 'warning');
  }

  // Wide ACL warning
  const wideAcls = config.accessControlIpv4.filter(a => {
    if (a.action !== 'allow') return false;
    const cidr = a.network.split('/')[1];
    return cidr && parseInt(cidr) < 8;
  });
  if (wideAcls.length > 0 && !hasOpenResolver) {
    e('accessControlIpv4', 8, `ACLs muito amplas detectadas (${wideAcls.map(a => a.network).join(', ')}) — verifique se é intencional`, 'warning');
  }

  if (!config.adminUser.trim()) e('adminUser', 8, 'Usuário admin é obrigatório');
  if (config.panelPort < 1 || config.panelPort > 65535) e('panelPort', 8, 'Porta do painel inválida');

  if (config.panelBind === '0.0.0.0' && config.allowedIps.length === 0) {
    e('panelBind', 8, 'Painel exposto em 0.0.0.0 sem restrição de IPs — risco de segurança', 'warning');
  }

  // ═══ Step 9 — Observabilidade (always valid) ═══

  // ═══ Cross-layer architectural validations ═══
  
  // All IPs across layers must be unique
  const allIps: { ip: string; layer: string }[] = [];
  if (config.ipv4Address) allIps.push({ ip: extractIpFromCidr(config.ipv4Address), layer: 'Host privado' });
  config.serviceVips.forEach(v => { if (v.ipv4) allIps.push({ ip: v.ipv4, layer: 'VIP de serviço' }); });
  config.instances.forEach(inst => {
    if (inst.bindIp) allIps.push({ ip: inst.bindIp, layer: `Listener ${inst.name}` });
    if (inst.publicListenerIp) allIps.push({ ip: inst.publicListenerIp, layer: `Public Listener ${inst.name}` });
    if (inst.egressIpv4) allIps.push({ ip: inst.egressIpv4, layer: `Egress ${inst.name}` });
    if (inst.controlInterface) allIps.push({ ip: inst.controlInterface, layer: `Control ${inst.name}` });
  });

  // Check for cross-layer IP collisions (excluding control interfaces which may legitimately use 127.x)
  const nonLoopbackIps = allIps.filter(i => !i.ip.startsWith('127.'));
  const ipMap = new Map<string, string[]>();
  nonLoopbackIps.forEach(({ ip, layer }) => {
    if (!ipMap.has(ip)) ipMap.set(ip, []);
    ipMap.get(ip)!.push(layer);
  });
  ipMap.forEach((layers, ip) => {
    if (layers.length > 1) {
      e('architecture', 10, `IP ${ip} usado em múltiplas camadas: ${layers.join(', ')} — cada camada deve ter IPs exclusivos`, 'warning');
    }
  });

  // Instance count vs VIP count warnings
  if (config.distributionPolicy === 'fixed-mapping' && config.serviceVips.length > config.instances.length) {
    e('architecture', 10, `Mais VIPs (${config.serviceVips.length}) do que instâncias (${config.instances.length}) em modo mapeamento fixo — alguns VIPs ficarão sem resolver`, 'warning');
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

/** Summary of validation state for display */
export function getValidationSummary(errors: ValidationError[]) {
  return {
    totalErrors: errors.filter(e => e.severity === 'error').length,
    totalWarnings: errors.filter(e => e.severity === 'warning').length,
    errorsByStep: Array.from({ length: 10 }, (_, i) => ({
      step: i,
      errors: errors.filter(e => e.step === i && e.severity === 'error').length,
      warnings: errors.filter(e => e.step === i && e.severity === 'warning').length,
    })),
    isValid: !errors.some(e => e.severity === 'error'),
    hasArchitecturalWarnings: errors.some(e => e.field === 'architecture'),
  };
}
