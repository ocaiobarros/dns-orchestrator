// ============================================================
// DNS Control — Secure-by-default Security Profile
// Garante que novas configs nasçam restritas (sem open resolver)
// e que 'legacy' continue funcionando apenas por opt-in explícito.
// ============================================================

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '@/lib/types';
import { generateUnboundConf } from '@/lib/config-generator';
import { extractInterceptionDiagnostics } from '@/lib/config-validator';

describe('secure-by-default — securityProfile', () => {
  it('DEFAULT_CONFIG nasce em isp-hardened (sem open resolver)', () => {
    expect(DEFAULT_CONFIG.securityProfile).toBe('isp-hardened');
  });

  it('config default + CIDR do host NÃO emite access-control 0.0.0.0/0', () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      operationMode: 'simple' as const,
      hostname: 'secure-default.isp.net',
      ipv4Address: '203.0.113.10/24',
      mainInterface: 'eth0',
      instances: [
        { name: 'unbound01', bindIp: '100.127.255.101', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
      ],
    };
    const content = generateUnboundConf(cfg, 0);
    expect(content).not.toContain('access-control: 0.0.0.0/0 allow');
    expect(content).toContain('access-control: 203.0.113.0/24 allow');
    expect(content).toContain('access-control: 127.0.0.0/8 allow');
    expect(content).toContain('access-control: 100.64.0.0/10 allow');
  });

  it('modo aberto exige opt-in EXPLÍCITO em securityProfile=legacy', () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      operationMode: 'simple' as const,
      securityProfile: 'legacy' as const,
      hostname: 'legacy-optin.isp.net',
      ipv4Address: '203.0.113.10/24',
      mainInterface: 'eth0',
      instances: [
        { name: 'unbound01', bindIp: '100.127.255.101', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
      ],
    };
    const content = generateUnboundConf(cfg, 0);
    expect(content).toContain('access-control: 0.0.0.0/0 allow');
  });

  it('fallback de extractInterceptionDiagnostics não vaza para legacy', () => {
    const diag = extractInterceptionDiagnostics({
      ...DEFAULT_CONFIG,
      operationMode: 'interception',
      securityProfile: undefined as unknown as 'isp-hardened',
    });
    expect(diag.securityProfile).toBe('isp-hardened');
  });
});
