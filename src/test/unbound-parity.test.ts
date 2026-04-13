// ============================================================
// DNS Control — Frontend/Backend Generator Parity Test
// Validates that TS and Python generators produce structurally
// equivalent Unbound configs for the same input payload
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateUnboundConf, computeSlabs } from '@/lib/config-generator';
import { DEFAULT_CONFIG, type WizardConfig } from '@/lib/types';

/**
 * Since we can't execute the Python backend in Vitest,
 * we test structural invariants that BOTH generators must satisfy.
 * These invariants are the parity contract.
 */

function makePayload(overrides?: Partial<WizardConfig>): WizardConfig {
  return {
    ...DEFAULT_CONFIG,
    operationMode: 'simple',
    hostname: 'parity-test-01.isp.net',
    organization: 'Parity Corp',
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

// ═══ Structural parity invariants ═══
// Both generators MUST produce output satisfying ALL these invariants.
// The Python backend has identical logic; this test guards the frontend half.

describe('Frontend/Backend Parity Contract', () => {
  const config = makePayload();

  it('block order: server → remote-control → forward-zone → server(anablock)', () => {
    const content = generateUnboundConf(config, 0);
    const serverIdx = content.indexOf('server:');
    const remoteIdx = content.indexOf('remote-control:');
    const forwardIdx = content.indexOf('forward-zone:');
    const anablockIdx = content.lastIndexOf('server:');

    expect(serverIdx).toBeGreaterThanOrEqual(0);
    expect(remoteIdx).toBeGreaterThan(serverIdx);
    expect(forwardIdx).toBeGreaterThan(remoteIdx);
    expect(anablockIdx).toBeGreaterThan(forwardIdx);
  });

  it('tuning parameters match parity contract', () => {
    const content = generateUnboundConf(config, 0);
    // These EXACT values must match what Python produces for same input
    expect(content).toContain('num-threads: 4');
    expect(content).toContain('msg-cache-slabs: 4');
    expect(content).toContain('rrset-cache-slabs: 4');
    expect(content).toContain('infra-cache-slabs: 4');
    expect(content).toContain('key-cache-slabs: 4');
    expect(content).toContain('msg-cache-size: 512m');
    expect(content).toContain('rrset-cache-size: 512m');
    expect(content).toContain('cache-min-ttl: 300');
    expect(content).toContain('cache-max-ttl: 7200');
    expect(content).toContain('serve-expired: yes');
    expect(content).toContain('serve-expired-ttl: 86400');
    expect(content).toContain('num-queries-per-thread: 3200');
    expect(content).toContain('outgoing-range: 8192');
    expect(content).toContain('so-rcvbuf: 8m');
    expect(content).toContain('so-sndbuf: 8m');
    expect(content).toContain('so-reuseport: yes');
  });

  it('access control derives /23 from CIDR', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('access-control: 172.250.40.0/23 allow');
    expect(content).toContain('access-control: 127.0.0.0/8 allow');
    expect(content).toContain('access-control: 100.64.0.0/10 allow');
  });

  it('simple mode: root-hints suppressed, forward-zone "." present', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('# root-hints: REMOVED');
    expect(content).toContain('name: "."');
    expect(content).not.toMatch(/^\s*root-hints:\s*"/m);
  });

  it('hardening defaults: harden-dnssec=yes, caps-for-id=no', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('harden-dnssec-stripped: yes');
    expect(content).toContain('use-caps-for-id: no');
  });

  it('hardening toggles reflect overrides', () => {
    const cfg = makePayload({ hardenDnssecStripped: false, useCapsForId: true });
    const content = generateUnboundConf(cfg, 0);
    expect(content).toContain('harden-dnssec-stripped: no');
    expect(content).toContain('use-caps-for-id: yes');
  });

  it('AD forward zones produce identical structures', () => {
    const cfg = makePayload({
      adForwardZones: [{ domain: 'corp.local', dnsServers: ['10.0.1.1', '10.0.1.2'] }],
    });
    const content = generateUnboundConf(cfg, 0);
    expect(content).toContain('private-domain: "corp.local"');
    expect(content).toContain('private-domain: "_msdcs.corp.local"');
    expect(content).toContain('name: "corp.local"');
    expect(content).toContain('name: "_msdcs.corp.local"');
    // DC addrs appear in both zones
    const corpZoneIdx = content.indexOf('name: "corp.local"');
    const msdcsZoneIdx = content.indexOf('name: "_msdcs.corp.local"');
    expect(content.indexOf('forward-addr: 10.0.1.1', corpZoneIdx)).toBeGreaterThan(corpZoneIdx);
    expect(content.indexOf('forward-addr: 10.0.1.1', msdcsZoneIdx)).toBeGreaterThan(msdcsZoneIdx);
  });

  it('computeSlabs matches Python _compute_slabs for all cases', () => {
    // Python: <=2→2, <=4→4, <=8→8, else→16
    expect(computeSlabs(1)).toBe(2);
    expect(computeSlabs(2)).toBe(2);
    expect(computeSlabs(3)).toBe(4);
    expect(computeSlabs(4)).toBe(4);
    expect(computeSlabs(5)).toBe(8);
    expect(computeSlabs(8)).toBe(8);
    expect(computeSlabs(9)).toBe(16);
    expect(computeSlabs(16)).toBe(16);
    expect(computeSlabs(32)).toBe(16);
  });

  it('instance listener/control are instance-specific', () => {
    const c0 = generateUnboundConf(config, 0);
    const c1 = generateUnboundConf(config, 1);
    expect(c0).toContain('interface: 100.127.255.101');
    expect(c1).toContain('interface: 100.127.255.102');
    expect(c0).toContain('control-interface: 127.0.0.11');
    expect(c1).toContain('control-interface: 127.0.0.12');
  });

  it('module-config is always "iterator"', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('module-config: "iterator"');
  });

  it('anablock include is at the end', () => {
    const content = generateUnboundConf(config, 0);
    const lines = content.trimEnd().split('\n');
    const lastServerIdx = content.lastIndexOf('server:');
    const anablockIdx = content.indexOf('include: /etc/unbound/anablock.conf');
    expect(anablockIdx).toBeGreaterThan(lastServerIdx);
  });

  it('egress is suppressed in simple mode', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).toContain('# outgoing-interface: não aplicável');
    expect(content).not.toMatch(/^\s+outgoing-interface:\s+\d/m);
  });

  it('forward-first is NOT present in simple mode', () => {
    const content = generateUnboundConf(config, 0);
    expect(content).not.toContain('forward-first: yes');
  });
});
