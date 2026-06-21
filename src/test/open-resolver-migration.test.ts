// ============================================================
// DNS Control — Open Resolver Migration (FE)
// Garante que a migração guiada legacy → isp-hardened JAMAIS
// aplique sem cobertura de subscriber (evitar REFUSED em massa).
// ============================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/types';
import { planOpenResolverMigration, parseCidrList, isValidIpv4Cidr } from '@/lib/open-resolver-migration';
import { generateUnboundConf } from '@/lib/config-generator';

const legacyBase = () => ({
  ...DEFAULT_CONFIG,
  operationMode: 'simple' as const,
  securityProfile: 'legacy' as const,
  hostname: 'legacy.isp.net',
  ipv4Address: '',
  mainInterface: 'eth0',
  accessControlIpv4: [],
  instances: [
    { name: 'unbound01', bindIp: '100.127.255.101', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
  ],
});

describe('open-resolver-migration — validação de ranges', () => {
  it('CIDRs ausentes + sem host CIDR → bloqueia migração', () => {
    const plan = planOpenResolverMigration(legacyBase(), []);
    expect(plan.sufficient).toBe(false);
    expect(plan.reason).toMatch(/range|CIDR/i);
  });

  it('host CIDR presente → migração ok mesmo sem extras', () => {
    const cfg = { ...legacyBase(), ipv4Address: '203.0.113.10/24' };
    const plan = planOpenResolverMigration(cfg, []);
    expect(plan.sufficient).toBe(true);
    expect(plan.migrated.securityProfile).toBe('isp-hardened');
  });

  it('CIDRs do operador informados → migração ok', () => {
    const plan = planOpenResolverMigration(legacyBase(), ['198.51.100.0/24', '192.0.2.0/22']);
    expect(plan.sufficient).toBe(true);
    expect(plan.migrated.accessControlIpv4.map((e) => e.network)).toEqual(
      expect.arrayContaining(['198.51.100.0/24', '192.0.2.0/22']),
    );
  });

  it('CIDR inválido → bloqueia com mensagem específica', () => {
    const plan = planOpenResolverMigration(legacyBase(), ['invalido/99']);
    expect(plan.sufficient).toBe(false);
    expect(plan.reason).toMatch(/inv[aá]lido/i);
  });

  it('preview do generator NÃO contém 0.0.0.0/0 após migração', () => {
    const cfg = { ...legacyBase(), ipv4Address: '203.0.113.10/24' };
    const plan = planOpenResolverMigration(cfg, ['198.51.100.0/24']);
    expect(plan.sufficient).toBe(true);
    const content = generateUnboundConf(plan.migrated, 0);
    expect(content).not.toContain('access-control: 0.0.0.0/0 allow');
    expect(content).toContain('access-control: 203.0.113.0/24 allow');
    expect(content).toContain('access-control: 198.51.100.0/24 allow');
    expect(content).toContain('access-control: 100.64.0.0/10 allow');
  });

  it('migração NÃO muta o objeto de entrada', () => {
    const cfg = { ...legacyBase(), ipv4Address: '203.0.113.10/24' };
    const plan = planOpenResolverMigration(cfg, ['198.51.100.0/24']);
    expect(cfg.securityProfile).toBe('legacy');
    expect(plan.migrated).not.toBe(cfg);
  });
});

describe('open-resolver-migration — helpers', () => {
  it('parseCidrList aceita separadores diversos', () => {
    expect(parseCidrList('10.0.0.0/8, 192.0.2.0/24; 198.51.100.0/24\n203.0.113.0/24')).toEqual([
      '10.0.0.0/8',
      '192.0.2.0/24',
      '198.51.100.0/24',
      '203.0.113.0/24',
    ]);
  });

  it('isValidIpv4Cidr rejeita lixo e aceita formato canônico', () => {
    expect(isValidIpv4Cidr('10.0.0.0/8')).toBe(true);
    expect(isValidIpv4Cidr('10.0.0.0')).toBe(false);
    expect(isValidIpv4Cidr('300.0.0.0/8')).toBe(false);
    expect(isValidIpv4Cidr('10.0.0.0/33')).toBe(false);
  });
});
