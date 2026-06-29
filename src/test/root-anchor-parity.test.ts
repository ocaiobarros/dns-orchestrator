// Frozen root trust anchor (DNSSEC KSK) — bootstrap offline, parity FE↔BE.
import { describe, it, expect } from 'vitest';
import { ROOT_TRUST_ANCHOR_KEY, ROOT_TRUST_ANCHOR_VERSION } from '@/lib/root-anchor';
import { generateAllFiles } from '@/lib/config-generator';
import { DEFAULT_CONFIG, type WizardConfig } from '@/lib/types';

const DS_KSK_2017 =
  '.       IN DS   20326 8 2 E06D44B80B8F1D39A95C0B0D7C65D08458E880409BBC683457104237C7F8EC8D';
const DS_KSK_2024 =
  '.       IN DS   38696 8 2 683D2D0ACB8C9B712A1948B27F741219298D0A450D612C483AF444A4C0FB2B16';

function makeCfg(mode: 'simple' | 'interception'): WizardConfig {
  return {
    ...DEFAULT_CONFIG,
    operationMode: mode,
    hostname: 'anchor-test-01.isp.net',
    ipv4Address: '172.250.40.100/23',
    instances: [
      {
        name: 'unbound01',
        bindIp: '100.127.255.101',
        bindIpv6: '',
        publicListenerIp: '',
        controlInterface: '127.0.0.11',
        controlPort: 8953,
        egressIpv4: '',
        egressIpv6: '',
      },
    ],
  };
}

describe('Root Trust Anchor — frozen snapshot', () => {
  it('mirror contains both IANA root KSK DS records', () => {
    expect(ROOT_TRUST_ANCHOR_KEY).toContain(DS_KSK_2017);
    expect(ROOT_TRUST_ANCHOR_KEY).toContain(DS_KSK_2024);
  });

  it('mirror exposes a versioned snapshot label', () => {
    expect(ROOT_TRUST_ANCHOR_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ROOT_TRUST_ANCHOR_KEY).toContain(ROOT_TRUST_ANCHOR_VERSION);
  });

  it('mirror carries the determinism guardrails (no runtime download)', () => {
    expect(ROOT_TRUST_ANCHOR_KEY).toContain('SNAPSHOT DETERMINÍSTICO');
    expect(ROOT_TRUST_ANCHOR_KEY).toContain('PROIBIDO download em runtime');
  });
});

describe('Root Trust Anchor — generator wiring', () => {
  it('interception materializes /var/lib/unbound/root.key from the frozen seed', () => {
    const files = generateAllFiles(makeCfg('interception'));
    const rootKey = files.find((f) => f.path === '/var/lib/unbound/root.key');
    expect(rootKey).toBeDefined();
    expect(rootKey!.content).toBe(ROOT_TRUST_ANCHOR_KEY);
    expect(rootKey!.content).toContain(DS_KSK_2017);
    expect(rootKey!.content).toContain(DS_KSK_2024);
  });

  it('simple mode does NOT emit the root.key (no local validator)', () => {
    const files = generateAllFiles(makeCfg('simple'));
    const rootKey = files.find((f) => f.path === '/var/lib/unbound/root.key');
    expect(rootKey).toBeUndefined();
  });
});
