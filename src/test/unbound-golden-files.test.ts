// ============================================================
// DNS Control — Golden File Snapshot Tests
// Validates generated Unbound configs for real deployment scenarios
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateUnboundConf, computeSlabs, generateAllFiles } from '@/lib/config-generator';
import { DEFAULT_CONFIG, type WizardConfig } from '@/lib/types';
import { validateSimpleModeConfig } from '@/lib/config-validator';

function makeSimpleConfig(overrides?: Partial<WizardConfig>): WizardConfig {
  return {
    ...DEFAULT_CONFIG,
    operationMode: 'simple',
    securityProfile: 'isp-hardened',
    hostname: 'dns-prod-01.isp.net',
    organization: 'ISP Telecom',
    mainInterface: 'ens192',
    ipv4Address: '172.250.40.100/23',
    ipv4Gateway: '172.250.40.1',
    frontendDnsIp: '172.250.40.100',
    instances: [
      { name: 'unbound01', bindIp: '100.127.255.101', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
      { name: 'unbound02', bindIp: '100.127.255.102', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.12', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
    ],
    threads: 4,
    forwardAddrs: ['1.1.1.1', '1.0.0.1', '8.8.8.8', '9.9.9.9'],
    adForwardZones: [],
    ...overrides,
  };
}

// ═══ SCENARIO 1: Simple mode without AD ═══
describe('Golden File — Simple without AD', () => {
  const config = makeSimpleConfig();
  const content = generateUnboundConf(config, 0);

  it('snapshot matches expected structure', () => {
    expect(content).toContain('server:');
    expect(content).toContain('remote-control:');
    expect(content).toContain('forward-zone:');
    expect(content).toContain('name: "."');
    expect(content).toContain('forward-addr: 1.1.1.1');
    expect(content).toContain('forward-addr: 8.8.8.8');
    expect(content).not.toMatch(/^\s*root-hints:\s*"/m);
    expect(content).toContain('cache-min-ttl: 300');
    expect(content).toContain('serve-expired: yes');
    expect(content).toContain('prefetch: yes');
    expect(content).toContain('num-threads: 4');
    expect(content).toContain('msg-cache-slabs: 4');
  });

  it('passes all acceptance checks', () => {
    const checks = validateSimpleModeConfig(config);
    const failures = checks.filter(c => c.status === 'fail');
    expect(failures).toEqual([]);
  });
});

// ═══ SCENARIO 2: Simple with AD and 2 DCs ═══
describe('Golden File — Simple with AD (2 DCs)', () => {
  const config = makeSimpleConfig({
    adForwardZones: [{ domain: 'empresa.local', dnsServers: ['10.0.0.10', '10.0.0.11'] }],
  });
  const content = generateUnboundConf(config, 0);

  it('contains AD forward-zones, dual DCs and only the main private-domain', () => {
    expect(content).toContain('name: "empresa.local"');
    expect(content).toContain('name: "_msdcs.empresa.local"');
    expect(content).toContain('private-domain: "empresa.local"');
    expect(content).not.toContain('private-domain: "_msdcs.empresa.local"');
    expect(content).toContain('forward-addr: 10.0.0.10');
    expect(content).toContain('forward-addr: 10.0.0.11');
  });

  it('still has global forward-zone "."', () => {
    expect(content).toContain('name: "."');
  });

  it('passes all acceptance checks', () => {
    const checks = validateSimpleModeConfig(config);
    const failures = checks.filter(c => c.status === 'fail');
    expect(failures).toEqual([]);
  });
});

// ═══ SCENARIO 3: Simple with /23 CIDR ═══
describe('Golden File — Simple with /23 CIDR', () => {
  const config = makeSimpleConfig({ ipv4Address: '172.250.40.100/23' });
  const content = generateUnboundConf(config, 0);

  it('derives correct /23 ACL', () => {
    expect(content).toContain('access-control: 172.250.40.0/23 allow');
    expect(content).not.toContain('/24 allow');
  });

  it('passes ACL check', () => {
    const checks = validateSimpleModeConfig(config);
    const aclCheck = checks.find(c => c.id === 'acl-cidr');
    expect(aclCheck?.status).toBe('pass');
  });
});

// ═══ SCENARIO 4: Simple with 2 instances (parity) ═══
describe('Golden File — 2 instances parity', () => {
  const config = makeSimpleConfig();

  it('generates equivalent configs except listener/control/pid differences', () => {
    const c0 = generateUnboundConf(config, 0);
    const c1 = generateUnboundConf(config, 1);
    const normalize = (c: string) =>
      c.split('\n')
        .filter(l => !l.includes('interface:') && !l.includes('control-interface:') && !l.includes('control-port:') && !l.includes('pidfile:'))
        .join('\n');
    expect(normalize(c0)).toBe(normalize(c1));
  });

  it('passes parity check', () => {
    const checks = validateSimpleModeConfig(config);
    const parityCheck = checks.find(c => c.id === 'parity');
    expect(parityCheck?.status).toBe('pass');
  });
});

// ═══ SCENARIO 5: Simple with hardening disabled ═══
describe('Golden File — Hardening disabled', () => {
  const config = makeSimpleConfig({
    hardenDnssecStripped: false,
    useCapsForId: true,
  });
  const content = generateUnboundConf(config, 0);

  it('reflects hardening toggles', () => {
    expect(content).toContain('harden-dnssec-stripped: no');
    expect(content).toContain('use-caps-for-id: yes');
  });
});

// ═══ SCENARIO 6: Simple with custom upstreams ═══
describe('Golden File — Custom upstreams', () => {
  const config = makeSimpleConfig({
    forwardAddrs: ['9.9.9.9', '149.112.112.112'],
  });
  const content = generateUnboundConf(config, 0);

  it('uses only custom upstreams', () => {
    expect(content).toContain('forward-addr: 9.9.9.9');
    expect(content).toContain('forward-addr: 149.112.112.112');
    expect(content).not.toContain('forward-addr: 1.1.1.1');
    expect(content).not.toContain('forward-addr: 8.8.8.8');
  });

  it('passes acceptance checks', () => {
    const checks = validateSimpleModeConfig(config);
    const failures = checks.filter(c => c.status === 'fail');
    expect(failures).toEqual([]);
  });
});

// ═══ SCENARIO 7: Dynamic slabs across thread counts ═══
describe('Golden File — Dynamic slabs for various thread counts', () => {
  it.each([
    [1, 2], [2, 2], [3, 4], [4, 4], [5, 8], [8, 8], [9, 16], [16, 16],
  ])('threads=%i → slabs=%i', (threads, expectedSlabs) => {
    const config = makeSimpleConfig({ threads });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain(`msg-cache-slabs: ${expectedSlabs}`);
    expect(content).toContain(`rrset-cache-slabs: ${expectedSlabs}`);
    expect(content).toContain(`infra-cache-slabs: ${expectedSlabs}`);
    expect(content).toContain(`key-cache-slabs: ${expectedSlabs}`);
  });
});

// ═══ SCENARIO 8: No named.cache in simple mode files ═══
describe('Golden File — No named.cache artifact', () => {
  it('generateAllFiles omits named.cache in simple mode', () => {
    const config = makeSimpleConfig();
    const files = generateAllFiles(config);
    const namedCache = files.find(f => f.path.includes('named.cache'));
    expect(namedCache).toBeUndefined();
  });
});

// ═══ SCENARIO 9: Backward compat — old config without new fields ═══
describe('Golden File — Backward compatibility with old configs', () => {
  it('handles config without forwardAddrs gracefully (uses defaults)', () => {
    const oldConfig = { ...makeSimpleConfig() };
    // Simulate old config missing new fields
    delete (oldConfig as any).forwardAddrs;
    delete (oldConfig as any).adForwardZones;
    delete (oldConfig as any).cacheMinTtl;
    delete (oldConfig as any).numQueriesPerThread;

    const content = generateUnboundConf(oldConfig, 0);
    // Should use default forward addrs
    expect(content).toContain('forward-addr: 1.1.1.1');
    expect(content).toContain('cache-min-ttl: 300');
    expect(content).toContain('num-queries-per-thread: 3200');
  });
});
