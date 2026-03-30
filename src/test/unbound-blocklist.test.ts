import { describe, it, expect } from 'vitest';
import { generateUnboundConf, generateAllConfigs } from '../lib/config-generator';
import type { WizardConfig } from '../lib/types';

function baseConfig(overrides: Partial<WizardConfig> = {}): WizardConfig {
  return {
    hostname: 'vdns-01',
    environmentId: 'prod',
    networkCidr: '100.127.255.0/24',
    gateway: '100.127.255.1',
    primaryInterface: 'ens18',
    enableIpv6: false,
    enableBlocklist: false,
    enableDetailedLogs: false,
    threads: 4,
    msgCacheSize: '512m',
    rrsetCacheSize: '32m',
    maxTtl: 7200,
    minTtl: 0,
    rootHintsPath: '/etc/unbound/named.cache',
    dnsIdentity: 'vdns-01',
    dnsVersion: '1.0',
    egressDeliveryMode: 'border-routed',
    routingMode: 'static',
    instances: [
      {
        name: 'unbound01',
        bindIp: '100.127.255.11',
        bindIpv6: '',
        egressIpv4: '203.0.113.1',
        egressIpv6: '',
        controlInterface: '127.0.0.1',
        controlPort: 8953,
        publicListenerIp: '',
      },
      {
        name: 'unbound02',
        bindIp: '100.127.255.12',
        bindIpv6: '',
        egressIpv4: '203.0.113.2',
        egressIpv6: '',
        controlInterface: '127.0.0.1',
        controlPort: 8954,
        publicListenerIp: '',
      },
    ],
    serviceVips: [{ ip: '4.2.2.5', label: 'primary' }],
    accessControlIpv4: [{ network: '0.0.0.0/0', action: 'allow' }],
    accessControlIpv6: [{ network: '::/0', action: 'allow' }],
    nftDistributionMode: 'nth',
    enableStickySource: false,
    stickyTimeoutMinutes: 20,
    ...overrides,
  } as WizardConfig;
}

describe('Unbound blocklist conditional includes', () => {
  describe('Scenario A — blocklist disabled', () => {
    it('unbound configs must NOT contain blocklist includes', () => {
      const config = baseConfig({ enableBlocklist: false });
      
      for (let i = 0; i < config.instances.length; i++) {
        const content = generateUnboundConf(config, i);
        expect(content).not.toContain('unbound-block-domains.conf');
        expect(content).not.toContain('anablock.conf');
      }
    });

    it('generateAllConfigs must NOT produce blocklist files', () => {
      const config = baseConfig({ enableBlocklist: false });
      const files = generateAllConfigs(config);
      const paths = files.map(f => f.path);
      
      expect(paths).not.toContain('/etc/unbound/unbound-block-domains.conf');
      expect(paths).not.toContain('/etc/unbound/anablock.conf');
    });
  });

  describe('Scenario B — blocklist enabled', () => {
    it('unbound configs MUST contain blocklist includes', () => {
      const config = baseConfig({ enableBlocklist: true });
      
      for (let i = 0; i < config.instances.length; i++) {
        const content = generateUnboundConf(config, i);
        expect(content).toContain('unbound-block-domains.conf');
        expect(content).toContain('anablock.conf');
      }
    });

    it('generateAllConfigs MUST produce both blocklist files', () => {
      const config = baseConfig({ enableBlocklist: true });
      const files = generateAllConfigs(config);
      const paths = files.map(f => f.path);
      
      expect(paths).toContain('/etc/unbound/unbound-block-domains.conf');
      expect(paths).toContain('/etc/unbound/anablock.conf');
    });
  });
});
