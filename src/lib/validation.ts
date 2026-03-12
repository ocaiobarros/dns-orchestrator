// ============================================================
// DNS Control — Validation Engine
// ============================================================

import type { WizardConfig, ValidationError } from './types';

const IPV4_CIDR = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
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

export function validateConfig(config: WizardConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const e = (field: string, step: number, message: string, severity: 'error' | 'warning' = 'error') =>
    errors.push({ field, step, message, severity });

  // Step 1 — Identification
  if (!config.hostname.trim()) e('hostname', 0, 'Hostname é obrigatório');
  else if (!HOSTNAME.test(config.hostname)) e('hostname', 0, 'Hostname contém caracteres inválidos');
  if (!config.organization.trim()) e('organization', 0, 'Organização é obrigatória');
  if (!config.mainInterface.trim()) e('mainInterface', 0, 'Interface principal é obrigatória');
  else if (!IFACE_NAME.test(config.mainInterface)) e('mainInterface', 0, 'Nome de interface inválido');
  if (!config.project.trim()) e('project', 0, 'Nome do projeto é obrigatório', 'warning');

  // Step 2 — Network
  if (!config.ipv4Address) e('ipv4Address', 1, 'Endereço IPv4 é obrigatório');
  else if (!isValidIpv4Cidr(config.ipv4Address)) e('ipv4Address', 1, 'Endereço IPv4/CIDR inválido');
  if (!config.ipv4Gateway) e('ipv4Gateway', 1, 'Gateway IPv4 é obrigatório');
  else if (!isValidIpv4(config.ipv4Gateway)) e('ipv4Gateway', 1, 'Gateway IPv4 inválido');
  if (!config.bootstrapDns) e('bootstrapDns', 1, 'DNS bootstrap é obrigatório');
  if (config.enableIpv6) {
    if (!config.ipv6Address) e('ipv6Address', 1, 'Endereço IPv6 é obrigatório quando IPv6 está habilitado');
    if (!config.ipv6Gateway) e('ipv6Gateway', 1, 'Gateway IPv6 é obrigatório quando IPv6 está habilitado');
  }

  // Step 3 — Loopback & VIP
  if (!config.dummyInterface) e('dummyInterface', 2, 'Nome da dummy interface é obrigatório');
  if (!config.vipAnycastIpv4) e('vipAnycastIpv4', 2, 'VIP anycast IPv4 é obrigatório');
  else if (!isValidIpv4Cidr(config.vipAnycastIpv4)) e('vipAnycastIpv4', 2, 'VIP anycast IPv4/CIDR inválido');
  if (config.unboundBindIps.length === 0) e('unboundBindIps', 2, 'Pelo menos um IP de bind é necessário');
  config.unboundBindIps.forEach((ip, i) => {
    if (!isValidIpv4Cidr(ip)) e(`unboundBindIps[${i}]`, 2, `IP de bind "${ip}" é inválido`);
  });
  if (config.publicExitIps.length === 0) e('publicExitIps', 2, 'Pelo menos um IP público de saída é necessário');
  config.publicExitIps.forEach((ip, i) => {
    if (!isValidIpv4Cidr(ip)) e(`publicExitIps[${i}]`, 2, `IP de saída "${ip}" é inválido`);
  });
  if (config.unboundBindIps.length !== config.publicExitIps.length) {
    e('publicExitIps', 2, 'Número de IPs de bind deve ser igual ao de IPs de saída', 'warning');
  }

  // Step 4 — DNS Instances
  if (config.instances.length === 0) e('instances', 3, 'Pelo menos uma instância DNS é necessária');
  const names = new Set<string>();
  const ports = new Set<number>();
  config.instances.forEach((inst, i) => {
    if (!inst.name.trim()) e(`instances[${i}].name`, 3, `Nome da instância ${i + 1} é obrigatório`);
    if (names.has(inst.name)) e(`instances[${i}].name`, 3, `Nome duplicado: "${inst.name}"`);
    names.add(inst.name);
    if (!inst.bindIp.trim()) e(`instances[${i}].bindIp`, 3, `Bind IP da instância "${inst.name}" é obrigatório`);
    if (!inst.egressIpv4.trim()) e(`instances[${i}].egressIpv4`, 3, `Egress IPv4 da instância "${inst.name}" é obrigatório`);
    if (ports.has(inst.controlPort)) e(`instances[${i}].controlPort`, 3, `Porta de controle duplicada: ${inst.controlPort}`);
    ports.add(inst.controlPort);
    if (inst.controlPort < 1024 || inst.controlPort > 65535) e(`instances[${i}].controlPort`, 3, `Porta inválida: ${inst.controlPort}`);
  });
  if (config.threads < 1 || config.threads > 64) e('threads', 3, 'Threads deve ser entre 1 e 64');
  if (config.minTtl < 0) e('minTtl', 3, 'Min TTL não pode ser negativo');
  if (config.maxTtl < config.minTtl) e('maxTtl', 3, 'Max TTL deve ser maior que Min TTL');

  // Step 5 — nftables
  if (!config.nftVipTarget) e('nftVipTarget', 4, 'VIP de entrada é obrigatório');
  if (config.nftDnatTargets.length === 0) e('nftDnatTargets', 4, 'Pelo menos um target DNAT é necessário');
  if (config.stickySourceIp && config.stickyTimeout < 1) e('stickyTimeout', 4, 'Sticky timeout deve ser > 0');

  // Step 6 — FRR/OSPF
  if (config.enableFrr) {
    if (!config.routerId) e('routerId', 5, 'Router ID é obrigatório');
    else if (!isValidIpv4(config.routerId)) e('routerId', 5, 'Router ID deve ser um IPv4 válido');
    if (!config.ospfArea) e('ospfArea', 5, 'Área OSPF é obrigatória');
    if (config.ospfInterfaces.length === 0) e('ospfInterfaces', 5, 'Pelo menos uma interface OSPF é necessária');
    if (config.ospfCost < 1 || config.ospfCost > 65535) e('ospfCost', 5, 'Custo OSPF deve ser entre 1 e 65535');
  }

  // Step 7 — Security
  if (!config.adminUser.trim()) e('adminUser', 6, 'Usuário admin é obrigatório');
  if (config.panelPort < 1 || config.panelPort > 65535) e('panelPort', 6, 'Porta do painel inválida');
  if (config.panelBind === '0.0.0.0' && config.allowedIps.length === 0) {
    e('allowedIps', 6, 'Recomendado definir allowlist ao expor em 0.0.0.0', 'warning');
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
