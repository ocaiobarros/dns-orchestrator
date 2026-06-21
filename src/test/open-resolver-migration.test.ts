// ============================================================
// DNS Control — Open Resolver Migration (FE)
// Garante que a migração guiada legacy → isp-hardened JAMAIS
// aplique sem cobertura real de redes (evita REFUSED em massa)
// e cobre IPv4 + IPv6 + detecção de aberturas globais.
// ============================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/types';
import {
  planOpenResolverMigration,
  parseCidrList,
  parseCidr,
  cidrCovers,
  isValidIpv4Cidr,
  isValidIpv6Cidr,
  detectOpenAccessControl,
} from '@/lib/open-resolver-migration';
import { generateUnboundConf } from '@/lib/config-generator';

const legacyBase = () => ({
  ...DEFAULT_CONFIG,
  operationMode: 'simple' as const,
  securityProfile: 'legacy' as const,
  hostname: 'legacy.isp.net',
  ipv4Address: '',
  mainInterface: 'eth0',
  accessControlIpv4: [],
  accessControlIpv6: [],
  enableIpv6: false,
  instances: [
    { name: 'unbound01', bindIp: '100.127.255.101', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
  ],
});

describe('open-resolver-migration — estados de cobertura (IPv4)', () => {
  it('T1: sem fonte alguma → unverifiable (não verified)', () => {
    const plan = planOpenResolverMigration(legacyBase(), []);
    expect(plan.state).toBe('unverifiable');
    expect(plan.sufficient).toBe(false);
    expect(plan.requiresAdminConfirmation).toBe(true);
  });

  it('T1b: unverifiable + admin confirma → sufficient=true e sem requiresAdminConfirmation', () => {
    const plan = planOpenResolverMigration(legacyBase(), [], { unverifiableConfirmed: true });
    expect(plan.state).toBe('unverifiable');
    expect(plan.sufficient).toBe(true);
    expect(plan.requiresAdminConfirmation).toBe(false);
  });

  it('T2: CIDR inválido → invalid (bloqueado)', () => {
    const plan = planOpenResolverMigration(legacyBase(), ['invalido/99', '300.0.0.0/8']);
    expect(plan.state).toBe('invalid');
    expect(plan.sufficient).toBe(false);
    expect(plan.invalidCidrs.length).toBeGreaterThan(0);
  });

  it('T3: cobertura parcial das redes conhecidas → incomplete (bloqueado)', () => {
    // Caller injeta uma rede de assinante conhecida via runtime/settings
    // que não está coberta nem pelo host CIDR nem pelas ACLs prévias.
    const cfg = {
      ...legacyBase(),
      ipv4Address: '203.0.113.10/24',
      accessControlIpv4: [{ network: '192.0.2.0/24', action: 'allow' as const, label: '' }],
    };
    const plan = planOpenResolverMigration(cfg, [], {
      additionalKnownNetworks: [
        { origin: 'runtime-inventory-ipv4', cidr: '198.51.100.0/24', label: 'subscriber' },
      ],
    });
    expect(plan.state).toBe('incomplete');
    expect(plan.sufficient).toBe(false);
    expect(plan.uncovered.length).toBe(1);
    expect(plan.uncovered[0].cidr).toBe('198.51.100.0/24');
  });

  it('T4: todas as redes conhecidas cobertas → verified', () => {
    const cfg = {
      ...legacyBase(),
      ipv4Address: '203.0.113.10/24',
      accessControlIpv4: [{ network: '192.0.2.0/24', action: 'allow' as const, label: '' }],
    };
    const plan = planOpenResolverMigration(cfg, ['198.51.100.0/24']);
    expect(plan.state).toBe('verified');
    expect(plan.sufficient).toBe(true);
    expect(plan.uncovered).toEqual([]);
    expect(plan.knownNetworks.every((k) => k.covered)).toBe(true);
  });

  it('T5: cobertura por super-rede IPv4 válida → verified', () => {
    const cfg = {
      ...legacyBase(),
      ipv4Address: '',
      accessControlIpv4: [{ network: '198.51.100.0/24', action: 'allow' as const, label: '' }],
    };
    // 10.0.0.0/8 cobre 10.1.2.0/24
    const cfg2 = {
      ...cfg,
      accessControlIpv4: [{ network: '10.1.2.0/24', action: 'allow' as const, label: 'sub' }],
    };
    const plan = planOpenResolverMigration(cfg2, ['10.0.0.0/8']);
    expect(plan.state).toBe('verified');
    const known = plan.knownNetworks.find((k) => k.cidr === '10.1.2.0/24');
    expect(known?.coveredBy).toBe('10.0.0.0/8');
  });
});

describe('open-resolver-migration — IPv6 (adendo §2)', () => {
  it('T11: rede IPv6 de assinante conhecida não coberta → incomplete e bloqueado', () => {
    const cfg = {
      ...legacyBase(),
      enableIpv6: true,
      ipv4Address: '203.0.113.10/24',
      ipv6Address: '2001:db8:1::1/64',
      // Operador só listou uma rede v6 não relacionada à subscriber range
      accessControlIpv6: [
        { network: '2001:db8:9999::/48', action: 'allow' as const, label: 'unrelated' },
      ],
    };
    // Runtime/settings injeta uma rede IPv6 real de assinante que NÃO está
    // coberta nem pelo host nem pela ACL prévia.
    const plan = planOpenResolverMigration(cfg, [], {
      additionalKnownNetworks: [
        { origin: 'runtime-inventory-ipv6', cidr: '2001:db8:5555::/48', label: 'assinante' },
      ],
    });
    expect(plan.state).toBe('incomplete');
    expect(plan.sufficient).toBe(false);
    const v6Uncovered = plan.uncovered.find((u) => u.family === 6 && u.cidr === '2001:db8:5555::/48');
    expect(v6Uncovered).toBeDefined();
  });

  it('T12: rede IPv6 coberta por super-rede IPv6 válida → verified', () => {
    const cfg = {
      ...legacyBase(),
      enableIpv6: true,
      ipv4Address: '203.0.113.10/24',
      ipv6Address: '2001:db8:abcd:1::1/64',
    };
    // Caller declara rede de assinante /64; extras IPv6 incluem o /48 que
    // a contém — cobertura por super-rede válida.
    const plan = planOpenResolverMigration(
      cfg,
      ['2001:db8:abcd::/48'],
      {
        additionalKnownNetworks: [
          { origin: 'runtime-inventory-ipv6', cidr: '2001:db8:abcd:9::/64', label: 'sub' },
        ],
      },
    );
    expect(plan.state).toBe('verified');
    const known = plan.knownNetworks.find((k) => k.cidr === '2001:db8:abcd:9::/64');
    expect(known?.covered).toBe(true);
    expect(known?.coveredBy).toBe('2001:db8:abcd::/48');
  });

  it('Rejeita CIDR IPv6 malformado', () => {
    expect(isValidIpv6Cidr('2001:db8::/48')).toBe(true);
    expect(isValidIpv6Cidr('2001:db8::/129')).toBe(false);
    expect(isValidIpv6Cidr('2001::db8::/48')).toBe(false);
    expect(isValidIpv6Cidr('not-an-addr/48')).toBe(false);
  });
});

describe('open-resolver-migration — detecção de abertura no preview', () => {
  it('T7: preview contendo 0.0.0.0/0 allow → ipv4Open=true', () => {
    const conf = `
      server:
        access-control: 127.0.0.0/8 allow
        access-control: 0.0.0.0/0 allow
        access-control: ::1/128 allow
    `;
    expect(detectOpenAccessControl(conf)).toEqual({ ipv4Open: true, ipv6Open: false });
  });

  it('T8: preview contendo ::/0 allow → ipv6Open=true', () => {
    const conf = `
      server:
        access-control: 198.51.100.0/24 allow
        access-control:    ::/0   allow
    `;
    expect(detectOpenAccessControl(conf)).toEqual({ ipv4Open: false, ipv6Open: true });
  });

  it('detecção ignora linhas comentadas e espaçamento variado', () => {
    const conf = `
      # access-control: 0.0.0.0/0 allow    <- comentado, não conta
        access-control: 10.0.0.0/8     allow_snoop
    `;
    expect(detectOpenAccessControl(conf)).toEqual({ ipv4Open: false, ipv6Open: false });
  });

  it('preview gerado após migração não contém 0.0.0.0/0 nem ::/0', () => {
    const cfg = {
      ...legacyBase(),
      enableIpv6: true,
      ipv4Address: '203.0.113.10/24',
      ipv6Address: '2001:db8:abcd:1::1/64',
      accessControlIpv6: [{ network: '2001:db8:abcd::/48', action: 'allow' as const, label: '' }],
    };
    const plan = planOpenResolverMigration(cfg, ['198.51.100.0/24']);
    expect(plan.state).toBe('verified');
    const content = generateUnboundConf(plan.migrated, 0);
    const open = detectOpenAccessControl(content);
    expect(open.ipv4Open).toBe(false);
    expect(open.ipv6Open).toBe(false);
  });
});

describe('open-resolver-migration — utilitários e contrato', () => {
  it('migração NÃO muta o objeto de entrada', () => {
    const cfg = { ...legacyBase(), ipv4Address: '203.0.113.10/24' };
    const plan = planOpenResolverMigration(cfg, ['198.51.100.0/24']);
    expect(cfg.securityProfile).toBe('legacy');
    expect(plan.migrated).not.toBe(cfg);
    expect(plan.migrated.securityProfile).toBe('isp-hardened');
  });

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

  it('cidrCovers respeita família e relação de prefixo', () => {
    const sup = parseCidr('10.0.0.0/8')!;
    const sub = parseCidr('10.1.2.0/24')!;
    const other = parseCidr('192.0.2.0/24')!;
    const v6 = parseCidr('2001:db8::/32')!;
    expect(cidrCovers(sup, sub)).toBe(true);
    expect(cidrCovers(sub, sup)).toBe(false);
    expect(cidrCovers(sup, other)).toBe(false);
    expect(cidrCovers(sup, v6)).toBe(false);
  });

  it('contrato MigrationPlan expõe state/uncovered/knownNetworks/effectiveAcls v4 e v6', () => {
    const cfg = {
      ...legacyBase(),
      enableIpv6: true,
      ipv4Address: '203.0.113.10/24',
      ipv6Address: '2001:db8:1::1/64',
      accessControlIpv6: [{ network: '2001:db8:1::/64', action: 'allow' as const, label: '' }],
    };
    const plan = planOpenResolverMigration(cfg, []);
    expect(plan.state).toBeDefined();
    expect(Array.isArray(plan.knownNetworks)).toBe(true);
    expect(Array.isArray(plan.uncovered)).toBe(true);
    expect(Array.isArray(plan.effectiveAclsIpv4)).toBe(true);
    expect(Array.isArray(plan.effectiveAclsIpv6)).toBe(true);
    expect(plan.effectiveAclsIpv6.length).toBeGreaterThan(0);
  });
});
