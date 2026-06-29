import { describe, it, expect } from 'vitest';
import { validateInterceptionModeConfig } from '@/lib/config-validator';
import type { WizardConfig } from '@/lib/types';

function baseInterceptionConfig(): WizardConfig {
  return {
    operationMode: 'interception',
    ipv4Address: '10.0.0.1/24',
    threads: 4,
    instances: [
      { name: 'dns01', bindIp: '100.127.0.1', port: 53 },
    ],
    serviceVips: [{ ipv4: '10.0.0.53' }],
    interceptedVips: [],
    stickyTimeout: 1200,
    securityProfile: 'isp-hardened',
    enableIpv6: false,
    egressDeliveryMode: 'host-owned',
    distributionPolicy: 'sticky-source',
    forwardAddrs: [],
    adForwardZones: [],
  };
}

describe('Block order check — interception mode (iterativo)', () => {
  it('PASSA quando NÃO há forward-zone (iterativo puro)', () => {
    const checks = validateInterceptionModeConfig(baseInterceptionConfig());
    const blockOrder = checks.find(c => c.id === 'unbound-block-order');
    expect(blockOrder?.status).toBe('pass');
    expect(blockOrder?.detail).toContain('iterativo, sem forward-zone');
  });
});
