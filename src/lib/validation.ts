// ============================================================
// DNS Control — Validation Engine (10-Step Wizard)
// ============================================================

import type { WizardConfig, ValidationError } from './types';

const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
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

export function validateConfig(config: WizardConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const e = (field: string, step: number, message: string, severity: 'error' | 'warning' = 'error') =>
    errors.push({ field, step, message, severity });

  // Step 0 — Topologia do Host
  if (!config.hostname.trim()) e('hostname', 0, 'Hostname é obrigatório');
  else if (!HOSTNAME.test(config.hostname)) e('hostname', 0, 'Hostname contém caracteres inválidos');
  if (!config.organization.trim()) e('organization', 0, 'Organização é obrigatória');
  if (!config.mainInterface.trim()) e('mainInterface', 0, 'Interface principal é obrigatória');
  else if (!IFACE_NAME.test(config.mainInterface)) e('mainInterface', 0, 'Nome de interface inválido');
  if (!config.ipv4Address) e('ipv4Address', 0, 'Endereço IPv4 é obrigatório');
  else if (!isValidIpv4Cidr(config.ipv4Address)) e('ipv4Address', 0, 'Endereço IPv4/CIDR inválido');
  if (!config.ipv4Gateway) e('ipv4Gateway', 0, 'Gateway IPv4 é obrigatório');
  else if (!isValidIpv4(config.ipv4Gateway)) e('ipv4Gateway', 0, 'Gateway IPv4 inválido');
  if (config.enableIpv6) {
    if (!config.ipv6Address) e('ipv6Address', 0, 'Endereço IPv6 é obrigatório quando IPv6 está habilitado');
    if (!config.ipv6Gateway) e('ipv6Gateway', 0, 'Gateway IPv6 é obrigatório quando IPv6 está habilitado');
  }

  // Step 1 — Modelo de Publicação (always valid)

  // Step 2 — VIPs de Serviço
  if (config.serviceVips.length === 0) e('serviceVips', 2, 'Pelo menos um VIP de serviço é necessário');
  config.serviceVips.forEach((vip, i) => {
    if (!vip.ipv4.trim()) e(`serviceVips[${i}].ipv4`, 2, `IPv4 do VIP ${i + 1} é obrigatório`);
    else if (!isValidIpv4(vip.ipv4)) e(`serviceVips[${i}].ipv4`, 2, `IPv4 do VIP ${i + 1} é inválido`);
  });

  // Step 3 — Instâncias de Resolução
  if (config.instances.length === 0) e('instances', 3, 'Pelo menos uma instância resolver é necessária');
  const names = new Set<string>();
  config.instances.forEach((inst, i) => {
    if (!inst.name.trim()) e(`instances[${i}].name`, 3, `Nome da instância ${i + 1} é obrigatório`);
    if (names.has(inst.name)) e(`instances[${i}].name`, 3, `Nome duplicado: "${inst.name}"`);
    names.add(inst.name);
    if (!inst.bindIp.trim()) e(`instances[${i}].bindIp`, 3, `Listener IPv4 da instância "${inst.name}" é obrigatório`);
    if (inst.controlPort < 1024 || inst.controlPort > 65535) e(`instances[${i}].controlPort`, 3, `Porta inválida: ${inst.controlPort}`);
  });
  if (config.threads < 1 || config.threads > 64) e('threads', 3, 'Threads deve ser entre 1 e 64');
  if (config.maxTtl < config.minTtl) e('maxTtl', 3, 'Max TTL deve ser maior que Min TTL');

  // Step 4 — Egress Público
  config.instances.forEach((inst, i) => {
    if (!inst.egressIpv4.trim()) e(`instances[${i}].egressIpv4`, 4, `Egress IPv4 da instância "${inst.name}" é obrigatório`);
  });

  // Step 5 — Mapeamento VIP → Instância (always valid)

  // Step 6 — Roteamento
  if (config.routingMode === 'frr-ospf') {
    if (!config.routerId) e('routerId', 6, 'Router ID é obrigatório');
    else if (!isValidIpv4(config.routerId)) e('routerId', 6, 'Router ID deve ser um IPv4 válido');
    if (!config.ospfArea) e('ospfArea', 6, 'Área OSPF é obrigatória');
    if (config.ospfInterfaces.length === 0) e('ospfInterfaces', 6, 'Pelo menos uma interface OSPF é necessária');
    if (config.ospfCost < 1 || config.ospfCost > 65535) e('ospfCost', 6, 'Custo OSPF deve ser entre 1 e 65535');
  }

  // Step 7 — Segurança
  if (config.accessControlIpv4.length === 0) e('accessControlIpv4', 7, 'Pelo menos uma ACL IPv4 é necessária');
  const hasOpenResolver = config.accessControlIpv4.some(a => a.network === '0.0.0.0/0' && a.action === 'allow');
  if (hasOpenResolver && !config.openResolverConfirmed) {
    e('openResolverConfirmed', 7, 'Open resolver requer confirmação explícita');
  }
  if (hasOpenResolver) {
    e('openResolver', 7, 'Configurado como open resolver — risco de amplificação DNS', 'warning');
  }
  if (!config.adminUser.trim()) e('adminUser', 7, 'Usuário admin é obrigatório');
  if (config.panelPort < 1 || config.panelPort > 65535) e('panelPort', 7, 'Porta do painel inválida');

  // Step 8 — Observabilidade (always valid)

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
