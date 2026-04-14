// ============================================================
// DNS Control — Unbound Simple Mode Acceptance Tests
// Validates generated configs meet ISP-grade production requirements
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateUnboundConf, computeSlabs, generateAllFiles } from '@/lib/config-generator';
import { DEFAULT_CONFIG, type WizardConfig } from '@/lib/types';

function makeSimpleConfig(overrides?: Partial<WizardConfig>): WizardConfig {
  return {
    ...DEFAULT_CONFIG,
    operationMode: 'simple',
    securityProfile: 'isp-hardened',
    hostname: 'dns-test-01.example.com',
    organization: 'TestOrg',
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

describe('Unbound Simple Mode — Block Ordering', () => {
  it('renders blocks in order: server → remote-control → forward-zone', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);

    const serverIdx = content.indexOf('server:');
    const remoteIdx = content.indexOf('remote-control:');
    const forwardIdx = content.indexOf('forward-zone:');

    expect(serverIdx).toBeGreaterThanOrEqual(0);
    expect(remoteIdx).toBeGreaterThan(serverIdx);
    expect(forwardIdx).toBeGreaterThan(remoteIdx);
  });

  it('forward-zone is NOT nested inside remote-control or server block', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);

    // forward-zone: must start at column 0 (not indented under server/remote-control)
    const lines = content.split('\n');
    const forwardLines = lines.filter(l => l.startsWith('forward-zone:'));
    expect(forwardLines.length).toBeGreaterThanOrEqual(1);
    forwardLines.forEach(line => {
      expect(line).toBe('forward-zone:'); // not indented
    });
  });
});

describe('Unbound Simple Mode — Forward Zone', () => {
  it('always generates forward-zone "."', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('forward-zone:');
    expect(content).toContain('name: "."');
  });

  it('includes all configured forward addrs', () => {
    const config = makeSimpleConfig({ forwardAddrs: ['1.1.1.1', '8.8.8.8'] });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('forward-addr: 1.1.1.1');
    expect(content).toContain('forward-addr: 8.8.8.8');
  });

  it('does NOT include forward-first in simple mode', () => {
    const config = makeSimpleConfig({ forwardFirst: true });
    const content = generateUnboundConf(config, 0);
    expect(content).not.toContain('forward-first: yes');
  });
});

describe('Unbound Simple Mode — No Root Hints', () => {
  it('does NOT generate root-hints directive in simple mode', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);
    expect(content).not.toMatch(/^\s*root-hints:/m);
    expect(content).toContain('root-hints: REMOVED');
  });

  it('does NOT generate named.cache file in simple mode', () => {
    const config = makeSimpleConfig();
    const files = generateAllFiles(config);
    const namedCache = files.find(f => f.path.includes('named.cache'));
    expect(namedCache).toBeUndefined();
  });
});

describe('Unbound Simple Mode — AD Forward Zones', () => {
  it('generates forward-zone for AD domain and _msdcs when configured', () => {
    const config = makeSimpleConfig({
      adForwardZones: [{ domain: 'empresa.local', dnsServers: ['10.0.0.10', '10.0.0.11'] }],
    });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('name: "empresa.local"');
    expect(content).toContain('name: "_msdcs.empresa.local"');
    expect(content).toContain('forward-addr: 10.0.0.10');
    expect(content).toContain('forward-addr: 10.0.0.11');
  });

  it('generates only the main private-domain for AD domains', () => {
    const config = makeSimpleConfig({
      adForwardZones: [{ domain: 'corp.interno', dnsServers: ['10.1.1.1'] }],
    });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('private-domain: "corp.interno"');
    expect(content).not.toContain('private-domain: "_msdcs.corp.interno"');
  });

  it('does NOT generate AD forward-zone when domain has no DCs', () => {
    const config = makeSimpleConfig({
      adForwardZones: [{ domain: 'orphan.local', dnsServers: [] }],
    });
    const content = generateUnboundConf(config, 0);
    expect(content).not.toContain('name: "orphan.local"');
  });
});

describe('Unbound Simple Mode — ACL from CIDR', () => {
  it('derives access-control from host CIDR /23', () => {
    const config = makeSimpleConfig({ ipv4Address: '172.250.40.100/23' });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('access-control: 172.250.40.0/23 allow');
  });

  it('derives access-control from host CIDR /24', () => {
    const config = makeSimpleConfig({ ipv4Address: '10.0.1.50/24' });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('access-control: 10.0.1.0/24 allow');
  });

  it('isp-hardened does NOT emit 0.0.0.0/0 allow', () => {
    const config = makeSimpleConfig({ securityProfile: 'isp-hardened' });
    const content = generateUnboundConf(config, 0);
    expect(content).not.toContain('access-control: 0.0.0.0/0 allow');
  });

  it('legacy profile DOES emit 0.0.0.0/0 allow (open resolver)', () => {
    const config = makeSimpleConfig({ securityProfile: 'legacy' });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('access-control: 0.0.0.0/0 allow');
    expect(content).not.toContain('access-control: 127.0.0.0/8 allow');
  });
});

describe('Unbound Simple Mode — Dynamic Slabs', () => {
  it('uses slabs=2 for 1-2 threads', () => {
    expect(computeSlabs(1)).toBe(2);
    expect(computeSlabs(2)).toBe(2);
  });

  it('uses slabs=4 for 3-4 threads', () => {
    expect(computeSlabs(3)).toBe(4);
    expect(computeSlabs(4)).toBe(4);
  });

  it('uses slabs=8 for 5-8 threads', () => {
    expect(computeSlabs(5)).toBe(8);
    expect(computeSlabs(8)).toBe(8);
  });

  it('uses slabs=16 for 9+ threads', () => {
    expect(computeSlabs(9)).toBe(16);
    expect(computeSlabs(16)).toBe(16);
  });

  it('renders correct slabs in generated config', () => {
    const config = makeSimpleConfig({ threads: 8 });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('msg-cache-slabs: 8');
    expect(content).toContain('rrset-cache-slabs: 8');
  });
});

describe('Unbound Simple Mode — num-queries-per-thread', () => {
  it('uses default 3200 when not specified', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('num-queries-per-thread: 3200');
  });

  it('uses custom value when specified', () => {
    const config = makeSimpleConfig({ numQueriesPerThread: 4096 });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('num-queries-per-thread: 4096');
  });
});

describe('Unbound Simple Mode — Optional Hardening', () => {
  it('defaults hardenDnssecStripped=yes, useCapsForId=no', () => {
    const config = makeSimpleConfig();
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('harden-dnssec-stripped: yes');
    expect(content).toContain('use-caps-for-id: no');
  });

  it('can disable harden-dnssec-stripped', () => {
    const config = makeSimpleConfig({ hardenDnssecStripped: false });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('harden-dnssec-stripped: no');
  });

  it('can enable use-caps-for-id', () => {
    const config = makeSimpleConfig({ useCapsForId: true });
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('use-caps-for-id: yes');
  });
});

describe('Unbound Simple Mode — Config Equivalence Between Instances', () => {
  it('generates equivalent configs except for listener/control/pid', () => {
    const config = makeSimpleConfig();
    const content0 = generateUnboundConf(config, 0);
    const content1 = generateUnboundConf(config, 1);

    const normalize = (c: string) =>
      c.split('\n')
        .filter(l => !l.includes('interface:') && !l.includes('control-interface:') && !l.includes('control-port:') && !l.includes('pidfile:'))
        .join('\n');

    expect(normalize(content0)).toBe(normalize(content1));
  });
});
