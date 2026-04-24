import { describe, it, expect } from 'vitest';
import { generateUnboundConf, generateAllFiles } from '../lib/config-generator';
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
    it('unbound configs always include placeholder includes (empty files) for hot-reload compatibility', () => {
      const config = baseConfig({ enableBlocklist: false });
      
      // Placeholder includes are ALWAYS present — they reference empty files
      // This allows enabling blocklist via sync without restarting unbound
      for (let i = 0; i < config.instances.length; i++) {
        const content = generateUnboundConf(config, i);
        expect(content).toContain('unbound-block-domains.conf');
        expect(content).toContain('anablock.conf');
      }
    });

    it('generateAllFiles must NOT produce blocklist sync infra, but anablock.conf placeholder is ALWAYS guaranteed', () => {
      const config = baseConfig({ enableBlocklist: false });
      const files = generateAllFiles(config);
      const paths = files.map(f => f.path);

      // Sync infra is conditional on enableBlocklist
      expect(paths).not.toContain('/etc/unbound/unbound-block-domains.conf');
      expect(paths).not.toContain('/opt/dns-control/scripts/anablock-sync.sh');
      expect(paths).not.toContain('/etc/systemd/system/anablock-sync.service');
      expect(paths).not.toContain('/etc/systemd/system/anablock-sync.timer');

      // anablock.conf is ALWAYS materialized (safe placeholder when disabled)
      // because unboundXX.conf includes it — missing file would break Unbound startup.
      expect(paths).toContain('/etc/unbound/anablock.conf');
      const anablock = files.find(f => f.path === '/etc/unbound/anablock.conf')!;
      expect(anablock.content).toContain('placeholder seguro');
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

    it('generateAllFiles MUST produce blocklist files + sync infrastructure', () => {
      const config = baseConfig({ enableBlocklist: true, blocklistAutoSync: true } as any);
      const files = generateAllFiles(config);
      const paths = files.map(f => f.path);
      
      expect(paths).toContain('/etc/unbound/unbound-block-domains.conf');
      expect(paths).toContain('/etc/unbound/anablock.conf');
      expect(paths).toContain('/opt/dns-control/scripts/anablock-sync.sh');
      expect(paths).toContain('/etc/systemd/system/anablock-sync.service');
      expect(paths).toContain('/etc/systemd/system/anablock-sync.timer');
    });

    it('sync script URL must match blocklist mode', () => {
      const config = baseConfig({
        enableBlocklist: true,
        blocklistMode: 'redirect_cname',
        blocklistCnameTarget: 'anatel.gov.br',
        blocklistApiUrl: 'https://api.anablock.net.br',
      } as any);
      const files = generateAllFiles(config);
      const syncScript = files.find(f => f.path.includes('anablock-sync.sh'));
      expect(syncScript?.content).toContain('&cname=anatel.gov.br');
    });

    it('redirect_ip_dualstack must include both ipv4 and ipv6', () => {
      const config = baseConfig({
        enableBlocklist: true,
        blocklistMode: 'redirect_ip_dualstack',
        blocklistRedirectIpv4: '10.255.128.2',
        blocklistRedirectIpv6: '2001:db8::1',
        blocklistApiUrl: 'https://api.anablock.net.br',
      } as any);
      const files = generateAllFiles(config);
      const syncScript = files.find(f => f.path.includes('anablock-sync.sh'));
      expect(syncScript?.content).toContain('&ipv4=10.255.128.2');
      expect(syncScript?.content).toContain('&ipv6=2001:db8::1');
    });

    it('timer must NOT be generated when autoSync is false', () => {
      const config = baseConfig({ enableBlocklist: true, blocklistAutoSync: false } as any);
      const files = generateAllFiles(config);
      const paths = files.map(f => f.path);
      
      expect(paths).toContain('/etc/systemd/system/anablock-sync.service');
      expect(paths).not.toContain('/etc/systemd/system/anablock-sync.timer');
    });
  });
});
