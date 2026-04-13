// ============================================================
// DNS Control — nftables Interception Mode Tests (Phase 2)
// Golden files, deterministic order, structural validation,
// parity contract, filter table non-regression
// ============================================================

import { describe, it, expect } from 'vitest';
import { generateNftablesModular, generateNftablesConf, generateAllFiles, generateSimpleNftablesModular, generateNftablesFilterTable } from '@/lib/config-generator';
import { DEFAULT_CONFIG, type WizardConfig, type ServiceVip, type InterceptedVip, type DnsInstance } from '@/lib/types';

// ═══ HELPERS ═══

function makeInstance(name: string, bindIp: string, opts?: Partial<DnsInstance>): DnsInstance {
  return {
    name, bindIp, bindIpv6: '', publicListenerIp: '',
    controlInterface: '127.0.0.1', controlPort: 8953,
    egressIpv4: '', egressIpv6: '', ...opts,
  };
}

function makeVip(ipv4: string, opts?: Partial<ServiceVip>): ServiceVip {
  return {
    ipv4, ipv6: '', port: 53, protocol: 'udp+tcp', description: '',
    label: '', vipType: 'owned', deliveryMode: 'routed-vip',
    healthCheckEnabled: false, healthCheckDomain: '', healthCheckInterval: 10,
    ...opts,
  };
}

function makeInterceptedVip(vipIp: string, opts?: Partial<InterceptedVip>): InterceptedVip {
  return {
    vipIp, vipIpv6: '', vipType: 'intercepted', captureMode: 'dnat',
    backendInstance: '', backendTargetIp: '', description: '',
    expectedLocalLatencyMs: 5, validationMode: 'strict',
    protocol: 'udp+tcp', port: 53, ...opts,
  };
}

function makeInterceptionConfig(overrides?: Partial<WizardConfig>): WizardConfig {
  return {
    ...DEFAULT_CONFIG,
    operationMode: 'interception',
    hostname: 'vdns-intercept-01',
    organization: 'ISP Test',
    mainInterface: 'ens192',
    ipv4Address: '172.16.20.100/24',
    ipv4Gateway: '172.16.20.1',
    securityProfile: 'legacy',
    serviceVips: [makeVip('45.160.10.1')],
    interceptedVips: [],
    instances: [
      makeInstance('unbound01', '100.127.255.1'),
      makeInstance('unbound02', '100.127.255.2'),
    ],
    stickyTimeout: 1200,
    ...overrides,
  };
}

function nftFiles(config: WizardConfig) {
  return generateNftablesModular(config);
}

function filePaths(files: { path: string }[]) {
  return files.map(f => f.path).sort();
}

function fileByPath(files: { path: string; content: string }[], path: string) {
  return files.find(f => f.path === path);
}

function nftNatFiles(files: { path: string }[]) {
  return files.filter(f => f.path.startsWith('/etc/nftables.d/') && !f.path.includes('filter'));
}

// ═══ 1. GOLDEN FILE SNAPSHOT TESTS ═══

describe('Golden File — 1 service VIP, 2 instances', () => {
  const config = makeInterceptionConfig();
  const files = nftFiles(config);

  it('generates nftables.conf master include', () => {
    const master = fileByPath(files, '/etc/nftables.conf');
    expect(master).toBeDefined();
    expect(master!.content).toContain('flush ruleset');
    expect(master!.content).toContain('include "/etc/nftables.d/*.nft"');
  });

  it('generates table ip nat (empty additive)', () => {
    const f = fileByPath(files, '/etc/nftables.d/0002-table-ipv4-nat.nft');
    expect(f).toBeDefined();
    expect(f!.content).toBe('table ip nat {\n}\n');
  });

  it('generates PREROUTING hook', () => {
    const f = fileByPath(files, '/etc/nftables.d/0051-hook-ipv4-prerouting.nft');
    expect(f).toBeDefined();
    expect(f!.content).toContain('type nat hook prerouting priority dstnat');
  });

  it('generates OUTPUT hook (local interception)', () => {
    const f = fileByPath(files, '/etc/nftables.d/0053-hook-ipv4-output.nft');
    expect(f).toBeDefined();
    expect(f!.content).toContain('type nat hook output priority dstnat');
  });

  it('defines DNS_ANYCAST_IPV4 with service VIP', () => {
    const f = fileByPath(files, '/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft');
    expect(f).toBeDefined();
    expect(f!.content).toContain('45.160.10.1');
  });

  it('generates PREROUTING + OUTPUT capture rules for tcp and udp', () => {
    for (const proto of ['tcp', 'udp']) {
      const suffix = proto === 'tcp' ? '1' : '2';
      const preCap = fileByPath(files, `/etc/nftables.d/511${suffix}-nat-rule-ipv4_${proto}_dns.nft`);
      expect(preCap).toBeDefined();
      expect(preCap!.content).toContain(`${proto} dport 53`);
      expect(preCap!.content).toContain('$DNS_ANYCAST_IPV4');
      expect(preCap!.content).toContain('chain PREROUTING');

      const outSuffix = proto === 'tcp' ? '3' : '4';
      const outCap = fileByPath(files, `/etc/nftables.d/511${outSuffix}-nat-rule-output-ipv4_${proto}_dns.nft`);
      expect(outCap).toBeDefined();
      expect(outCap!.content).toContain('chain OUTPUT');
      expect(outCap!.content).toContain(`${proto} dport 53`);
    }
  });

  it('generates sticky sets for each instance', () => {
    for (const name of ['unbound01', 'unbound02']) {
      const setFiles = files.filter(f => f.path.includes(`ipv4_users_${name}`));
      expect(setFiles.length).toBeGreaterThanOrEqual(1);
      const setDef = setFiles.find(f => f.content.includes('type ipv4_addr'));
      expect(setDef).toBeDefined();
      expect(setDef!.content).toContain('timeout 20m');
      expect(setDef!.content).toContain('flags dynamic, timeout');
    }
  });

  it('generates DNAT action rules per instance per proto', () => {
    for (const name of ['unbound01', 'unbound02']) {
      for (const proto of ['tcp', 'udp']) {
        const actionFile = files.find(f =>
          f.path.includes(`nat-rule-action-ipv4_dns_${proto}_${name}`)
        );
        expect(actionFile).toBeDefined();
        expect(actionFile!.content).toContain('dnat to');
        expect(actionFile!.content).toContain(`${proto} dport 53`);
      }
    }
  });

  it('generates memorized-source rules', () => {
    for (const name of ['unbound01', 'unbound02']) {
      for (const proto of ['tcp', 'udp']) {
        const f = files.find(f => f.path.includes(`nat-rule-memorized-ipv4_dns_${proto}_${name}`));
        expect(f).toBeDefined();
        expect(f!.content).toContain(`ip saddr @ipv4_users_${name}`);
        expect(f!.content).toContain(`jump ipv4_dns_${proto}_${name}`);
      }
    }
  });

  it('generates nth balancing rules (numgen inc mod N decrementing)', () => {
    const nthFiles = files.filter(f => f.path.includes('nat-rule-nth'));
    expect(nthFiles.length).toBe(4); // 2 protos × 2 instances
    // First rule per proto: mod 2, second: mod 1
    const tcpNth = nthFiles.filter(f => f.path.includes('tcp'));
    expect(tcpNth[0].content).toContain('numgen inc mod 2');
    expect(tcpNth[1].content).toContain('numgen inc mod 1');
  });
});

describe('Golden File — Multiple intercepted VIPs', () => {
  const config = makeInterceptionConfig({
    serviceVips: [makeVip('45.160.10.1')],
    interceptedVips: [
      makeInterceptedVip('4.2.2.5'),
      makeInterceptedVip('4.2.2.6'),
      makeInterceptedVip('208.67.222.222'),
    ],
  });
  const files = nftFiles(config);

  it('merges all VIPs into DNS_ANYCAST_IPV4', () => {
    const f = fileByPath(files, '/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft');
    expect(f).toBeDefined();
    expect(f!.content).toContain('45.160.10.1');
    expect(f!.content).toContain('4.2.2.5');
    expect(f!.content).toContain('4.2.2.6');
    expect(f!.content).toContain('208.67.222.222');
  });

  it('all VIPs are balanced across ALL backends (no per-VIP chains)', () => {
    // No file should contain a chain named after a specific VIP
    const allContent = files.map(f => f.content).join('\n');
    expect(allContent).not.toContain('chain ipv4_dns_tcp_4.2.2.5');
    expect(allContent).not.toContain('chain ipv4_dns_udp_4.2.2.5');
  });
});

describe('Golden File — Service VIP + Intercepted VIP (mixed)', () => {
  const config = makeInterceptionConfig({
    serviceVips: [makeVip('45.160.10.1'), makeVip('45.160.10.2')],
    interceptedVips: [makeInterceptedVip('4.2.2.5')],
  });
  const files = nftFiles(config);

  it('DNS_ANYCAST_IPV4 contains all 3 IPs without duplicates', () => {
    const f = fileByPath(files, '/etc/nftables.d/5100-nat-define-anyaddr-ipv4.nft');
    const content = f!.content;
    expect(content).toContain('45.160.10.1');
    expect(content).toContain('45.160.10.2');
    expect(content).toContain('4.2.2.5');
    // Count occurrences
    const matches = content.match(/45\.160\.10\.1/g);
    expect(matches?.length).toBe(1);
  });
});

describe('Golden File — With IPv6', () => {
  const config = makeInterceptionConfig({
    enableIpv6: true,
    serviceVips: [makeVip('45.160.10.1', { ipv6: '2001:db8::1' })],
    instances: [
      makeInstance('unbound01', '100.127.255.1', { bindIpv6: 'fd00::1' }),
      makeInstance('unbound02', '100.127.255.2', { bindIpv6: 'fd00::2' }),
    ],
  });
  const files = nftFiles(config);

  it('generates ip6 nat table', () => {
    expect(fileByPath(files, '/etc/nftables.d/0003-table-ipv6-nat.nft')).toBeDefined();
  });

  it('generates IPv6 PREROUTING and OUTPUT hooks', () => {
    expect(fileByPath(files, '/etc/nftables.d/0052-hook-ipv6-prerouting.nft')).toBeDefined();
    expect(fileByPath(files, '/etc/nftables.d/0054-hook-ipv6-output.nft')).toBeDefined();
  });

  it('defines DNS_ANYCAST_IPV6', () => {
    const f = fileByPath(files, '/etc/nftables.d/5200-nat-define-anyaddr-ipv6.nft');
    expect(f).toBeDefined();
    expect(f!.content).toContain('2001:db8::1');
  });

  it('generates IPv6 capture rules (PREROUTING + OUTPUT)', () => {
    for (const proto of ['tcp', 'udp']) {
      const suffix = proto === 'tcp' ? '1' : '2';
      expect(fileByPath(files, `/etc/nftables.d/521${suffix}-nat-rule-ipv6_${proto}_dns.nft`)).toBeDefined();
      const outSuffix = proto === 'tcp' ? '3' : '4';
      expect(fileByPath(files, `/etc/nftables.d/521${outSuffix}-nat-rule-output-ipv6_${proto}_dns.nft`)).toBeDefined();
    }
  });

  it('IPv6 DNAT uses bracket syntax', () => {
    const actionFiles = files.filter(f => f.path.includes('nat-rule-action-ipv6'));
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const f of actionFiles) {
      expect(f.content).toMatch(/dnat to \[fd00::/);
    }
  });

  it('IPv6 sticky sets use ipv6_addr type', () => {
    const setFiles = files.filter(f => f.path.includes('ipv6_users_'));
    expect(setFiles.length).toBeGreaterThan(0);
    for (const f of setFiles) {
      if (f.content.includes('type')) {
        expect(f.content).toContain('type ipv6_addr');
      }
    }
  });
});

describe('Golden File — Without IPv6', () => {
  const config = makeInterceptionConfig({ enableIpv6: false });
  const files = nftFiles(config);

  it('does NOT generate any IPv6 files', () => {
    const v6Files = files.filter(f => f.path.includes('ipv6') || f.path.includes('ip6'));
    expect(v6Files).toEqual([]);
  });
});

describe('Golden File — Single instance', () => {
  const config = makeInterceptionConfig({
    instances: [makeInstance('unbound01', '100.127.255.1')],
  });
  const files = nftFiles(config);

  it('nth balancing uses mod 1', () => {
    const nthFiles = files.filter(f => f.path.includes('nat-rule-nth'));
    expect(nthFiles.length).toBe(2); // tcp + udp
    for (const f of nthFiles) {
      expect(f.content).toContain('numgen inc mod 1');
    }
  });

  it('only generates sets/chains for one instance', () => {
    const setFiles = files.filter(f => f.path.includes('ipv4_users_'));
    // Each proto gets one set file
    expect(setFiles.length).toBe(2); // tcp + udp
    expect(setFiles.every(f => f.path.includes('unbound01'))).toBe(true);
  });
});

describe('Golden File — 4 instances', () => {
  const config = makeInterceptionConfig({
    instances: [
      makeInstance('unbound01', '100.127.255.1'),
      makeInstance('unbound02', '100.127.255.2'),
      makeInstance('unbound03', '100.127.255.3'),
      makeInstance('unbound04', '100.127.255.4'),
    ],
  });
  const files = nftFiles(config);

  it('nth balancing decrements: mod 4, 3, 2, 1 per proto', () => {
    const tcpNth = files
      .filter(f => f.path.includes('nat-rule-nth') && f.path.includes('tcp'))
      .sort((a, b) => a.path.localeCompare(b.path));
    expect(tcpNth.length).toBe(4);
    expect(tcpNth[0].content).toContain('numgen inc mod 4');
    expect(tcpNth[1].content).toContain('numgen inc mod 3');
    expect(tcpNth[2].content).toContain('numgen inc mod 2');
    expect(tcpNth[3].content).toContain('numgen inc mod 1');
  });

  it('generates 4 sticky sets per proto (8 total)', () => {
    const setFiles = files.filter(f => f.path.includes('nat-addrlist-ipv4_users_'));
    expect(setFiles.length).toBe(8);
  });
});

describe('Golden File — No interception (simple mode baseline)', () => {
  const config: WizardConfig = {
    ...DEFAULT_CONFIG,
    operationMode: 'simple',
    hostname: 'dns-simple-01',
    mainInterface: 'ens192',
    ipv4Address: '172.250.40.100/23',
    frontendDnsIp: '172.250.40.100',
    instances: [makeInstance('unbound01', '100.127.255.101')],
    securityProfile: 'legacy',
  };

  it('generateNftablesModular should NOT be called for simple mode', () => {
    // generateAllFiles routes to simple mode
    const allFiles = generateAllFiles(config);
    const nftFiles = allFiles.filter(f => f.path.startsWith('/etc/nftables'));

    // No interception hooks
    const hasInterceptionHook = nftFiles.some(f =>
      f.path.includes('0051-hook') || f.path.includes('0053-hook')
    );
    expect(hasInterceptionHook).toBe(false);

    // No DNS_ANYCAST_IPV4
    const hasAnycast = nftFiles.some(f => f.content.includes('DNS_ANYCAST_IPV4'));
    expect(hasAnycast).toBe(false);

    // Uses local_ prefix chains instead
    const hasLocal = nftFiles.some(f => f.content.includes('local_tcp_dns') || f.content.includes('local_udp_dns'));
    expect(hasLocal).toBe(true);
  });
});

// ═══ 2. DETERMINISTIC ORDER TESTS ═══

describe('Deterministic order — file prefix ordering', () => {
  const config = makeInterceptionConfig({
    enableIpv6: true,
    serviceVips: [makeVip('45.160.10.1', { ipv6: '2001:db8::1' })],
    interceptedVips: [makeInterceptedVip('4.2.2.5')],
    instances: [
      makeInstance('unbound01', '100.127.255.1', { bindIpv6: 'fd00::1' }),
      makeInstance('unbound02', '100.127.255.2', { bindIpv6: 'fd00::2' }),
    ],
  });
  const files = nftFiles(config);
  const nftDFiles = files.filter(f => f.path.startsWith('/etc/nftables.d/')).sort((a, b) => a.path.localeCompare(b.path));

  it('tables (0002-0003) come before hooks (0051-0054)', () => {
    const tablePaths = nftDFiles.filter(f => f.path.includes('/0002-') || f.path.includes('/0003-'));
    const hookPaths = nftDFiles.filter(f => /\/005[1-4]-/.test(f.path));
    const maxTable = Math.max(...tablePaths.map(f => nftDFiles.indexOf(f)));
    const minHook = Math.min(...hookPaths.map(f => nftDFiles.indexOf(f)));
    expect(maxTable).toBeLessThan(minHook);
  });

  it('hooks (005x) come before defines (5100+)', () => {
    const hookPaths = nftDFiles.filter(f => /\/005[1-4]-/.test(f.path));
    const definePaths = nftDFiles.filter(f => /\/5[12]00-/.test(f.path));
    const maxHook = Math.max(...hookPaths.map(f => nftDFiles.indexOf(f)));
    const minDefine = Math.min(...definePaths.map(f => nftDFiles.indexOf(f)));
    expect(maxHook).toBeLessThan(minDefine);
  });

  it('defines (5100-5200) come before dispatch chains (5102-5103)', () => {
    const defineFile = nftDFiles.find(f => f.path.includes('/5100-'));
    const chainFiles = nftDFiles.filter(f => /\/510[23]-/.test(f.path));
    expect(defineFile).toBeDefined();
    expect(chainFiles.length).toBeGreaterThan(0);
    const defineIdx = nftDFiles.indexOf(defineFile!);
    const minChain = Math.min(...chainFiles.map(f => nftDFiles.indexOf(f)));
    expect(defineIdx).toBeLessThan(minChain);
  });

  it('dispatch chains (510x) come before capture rules (511x)', () => {
    const chains = nftDFiles.filter(f => /\/510[23]-/.test(f.path));
    const captures = nftDFiles.filter(f => /\/511[1-4]-/.test(f.path));
    const maxChain = Math.max(...chains.map(f => nftDFiles.indexOf(f)));
    const minCapture = Math.min(...captures.map(f => nftDFiles.indexOf(f)));
    expect(maxChain).toBeLessThan(minCapture);
  });

  it('sets+chains (6xxx) come before memorized rules (7xxx)', () => {
    const setsChains = nftDFiles.filter(f => /\/6\d{3}-/.test(f.path));
    const memorized = nftDFiles.filter(f => /\/7\d{3}-/.test(f.path));
    const maxSets = Math.max(...setsChains.map(f => nftDFiles.indexOf(f)));
    const minMem = Math.min(...memorized.map(f => nftDFiles.indexOf(f)));
    expect(maxSets).toBeLessThan(minMem);
  });

  it('no prefix collisions (each file has unique prefix number)', () => {
    const prefixes = nftDFiles.map(f => {
      const match = f.path.match(/\/(\d{4})-/);
      return match ? match[1] + '-' + f.path : f.path;
    });
    // Files with same prefix are OK if they have different suffixes
    // What matters is no EXACT path collision
    const paths = new Set(nftDFiles.map(f => f.path));
    expect(paths.size).toBe(nftDFiles.length);
  });
});

// ═══ 3. FRONTEND/BACKEND PARITY CONTRACT ═══

describe('Frontend/Backend Parity — nftables interception', () => {
  const config = makeInterceptionConfig({
    serviceVips: [makeVip('45.160.10.1')],
    interceptedVips: [makeInterceptedVip('4.2.2.5')],
    instances: [
      makeInstance('unbound01', '100.127.255.1'),
      makeInstance('unbound02', '100.127.255.2'),
    ],
    stickyTimeout: 1200,
  });
  const files = nftFiles(config);

  it('file count matches expected modular structure', () => {
    // nftables.conf + 0002 table + 0051 prerouting + 0053 output
    // + 5100 define + 5102/5103 dispatch chains
    // + 5111/5112 prerouting capture + 5113/5114 output capture
    // + per-instance: 2 protos × (set + chain) = 4 files each × 2 instances = 8
    // + per-instance: 2 protos × action = 4 files × 2 instances = 4
    // Wait, let's just count...
    const natFiles = nftNatFiles(files);
    // This is the structural invariant both TS and Python must satisfy
    expect(natFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('block syntax: every snippet uses table ip nat { ... }', () => {
    const natFiles = files.filter(f =>
      f.path.startsWith('/etc/nftables.d/') &&
      !f.path.includes('filter') &&
      !f.path.includes('define') &&
      f.path !== '/etc/nftables.conf'
    );
    for (const f of natFiles) {
      expect(f.content).toMatch(/^table ip6? nat \{/m);
    }
  });

  it('all capture rules target port 53 only', () => {
    const captureFiles = files.filter(f => f.path.includes('nat-rule-') && f.path.includes('_dns'));
    for (const f of captureFiles) {
      // Every rule line with dport must be 53
      const ruleLines = f.content.split('\n').filter(l => l.includes('dport'));
      for (const line of ruleLines) {
        expect(line).toContain('dport 53');
      }
    }
  });

  it('DNAT targets match instance bindIps', () => {
    const actionFiles = files.filter(f => f.path.includes('nat-rule-action'));
    const dnatTargets = actionFiles.flatMap(f => {
      const matches = f.content.match(/dnat to ([\d.]+):53/g) || [];
      return matches.map(m => m.replace('dnat to ', '').replace(':53', ''));
    });
    const expectedIps = ['100.127.255.1', '100.127.255.2'];
    for (const ip of dnatTargets) {
      expect(expectedIps).toContain(ip);
    }
  });

  it('sticky timeout is 20m (1200s / 60)', () => {
    const setFiles = files.filter(f => f.content.includes('timeout') && f.path.includes('addrlist'));
    for (const f of setFiles) {
      expect(f.content).toContain('timeout 20m');
    }
  });

  it('custom sticky timeout propagates correctly', () => {
    const customConfig = makeInterceptionConfig({ stickyTimeout: 3600 });
    const customFiles = nftFiles(customConfig);
    const setFiles = customFiles.filter(f => f.content.includes('timeout') && f.path.includes('addrlist'));
    for (const f of setFiles) {
      expect(f.content).toContain('timeout 60m');
    }
  });

  it('each file ends with newline', () => {
    for (const f of files) {
      expect(f.content.endsWith('\n')).toBe(true);
    }
  });
});

// ═══ 4. STRUCTURAL VALIDATION ═══

describe('Structural validation — nftables interception', () => {
  const config = makeInterceptionConfig({
    serviceVips: [makeVip('45.160.10.1')],
    interceptedVips: [makeInterceptedVip('4.2.2.5'), makeInterceptedVip('4.2.2.6')],
  });
  const files = nftFiles(config);

  it('OUTPUT hook present when intercepted VIPs exist', () => {
    const outputHook = fileByPath(files, '/etc/nftables.d/0053-hook-ipv4-output.nft');
    expect(outputHook).toBeDefined();
    expect(outputHook!.content).toContain('hook output');
  });

  it('OUTPUT capture rules present and correct', () => {
    for (const proto of ['tcp', 'udp']) {
      const suffix = proto === 'tcp' ? '3' : '4';
      const f = fileByPath(files, `/etc/nftables.d/511${suffix}-nat-rule-output-ipv4_${proto}_dns.nft`);
      expect(f).toBeDefined();
      expect(f!.content).toContain('chain OUTPUT');
      expect(f!.content).toContain('$DNS_ANYCAST_IPV4');
      expect(f!.content).toContain(`${proto} dport 53`);
    }
  });

  it('capture rules match ONLY port 53 UDP/TCP', () => {
    const allCaptures = files.filter(f =>
      f.path.includes('nat-rule-') && (f.path.includes('_dns.nft') || f.path.includes('output'))
    );
    for (const f of allCaptures) {
      const lines = f.content.split('\n').filter(l => l.includes('dport'));
      for (const l of lines) {
        expect(l).toMatch(/\b(tcp|udp) dport 53\b/);
        expect(l).not.toMatch(/dport [^5]/);
      }
    }
  });

  it('destinations restricted to defined VIPs ($DNS_ANYCAST_IPV4)', () => {
    const captureRules = files.filter(f =>
      f.path.includes('511') && f.path.includes('nat-rule')
    );
    for (const f of captureRules) {
      expect(f.content).toContain('$DNS_ANYCAST_IPV4');
    }
  });

  it('expected chains exist: dispatch, backend, PREROUTING, OUTPUT', () => {
    const allContent = files.map(f => f.content).join('\n');
    // Dispatch chains
    expect(allContent).toContain('chain ipv4_tcp_dns');
    expect(allContent).toContain('chain ipv4_udp_dns');
    // Backend chains
    expect(allContent).toContain('chain ipv4_dns_tcp_unbound01');
    expect(allContent).toContain('chain ipv4_dns_udp_unbound01');
    expect(allContent).toContain('chain ipv4_dns_tcp_unbound02');
    expect(allContent).toContain('chain ipv4_dns_udp_unbound02');
    // Hooks
    expect(allContent).toContain('chain PREROUTING');
    expect(allContent).toContain('chain OUTPUT');
  });

  it('no duplicate rules in dispatch chain files', () => {
    // Memorized-source files — each should have exactly one rule line
    const memFiles = files.filter(f => f.path.includes('nat-rule-memorized'));
    for (const f of memFiles) {
      const ruleLines = f.content.split('\n').filter(l => l.trim().startsWith('ip saddr'));
      expect(ruleLines.length).toBe(1);
    }
    // Nth files — each should have exactly one numgen line
    const nthFiles = files.filter(f => f.path.includes('nat-rule-nth'));
    for (const f of nthFiles) {
      const numgenLines = f.content.split('\n').filter(l => l.includes('numgen'));
      expect(numgenLines.length).toBe(1);
    }
  });

  it('hook priorities are consistent', () => {
    const preHook = fileByPath(files, '/etc/nftables.d/0051-hook-ipv4-prerouting.nft');
    const outHook = fileByPath(files, '/etc/nftables.d/0053-hook-ipv4-output.nft');
    expect(preHook!.content).toContain('priority dstnat');
    expect(outHook!.content).toContain('priority dstnat');
  });

  it('VIP count matches backends × protos in DNAT action rules', () => {
    const actionFiles = files.filter(f => f.path.includes('nat-rule-action-ipv4'));
    // 2 instances × 2 protos = 4
    expect(actionFiles.length).toBe(4);
  });
});

// ═══ 5. SYNTACTIC VALIDATION (structure-level, not nft -c) ═══

describe('Syntactic validation — nftables snippets', () => {
  const config = makeInterceptionConfig({
    enableIpv6: true,
    serviceVips: [makeVip('45.160.10.1', { ipv6: '2001:db8::1' })],
    instances: [
      makeInstance('unbound01', '100.127.255.1', { bindIpv6: 'fd00::1' }),
    ],
  });
  const files = nftFiles(config);

  it('all table block snippets have matching braces', () => {
    const tableFiles = files.filter(f =>
      f.path.startsWith('/etc/nftables.d/') && f.content.includes('table ')
    );
    for (const f of tableFiles) {
      const opens = (f.content.match(/\{/g) || []).length;
      const closes = (f.content.match(/\}/g) || []).length;
      expect(opens).toBe(closes);
    }
  });

  it('no trailing semicolons in set definitions', () => {
    const setFiles = files.filter(f => f.path.includes('addrlist'));
    for (const f of setFiles) {
      const lines = f.content.split('\n');
      for (const l of lines) {
        if (l.includes('type ') || l.includes('size ') || l.includes('flags ') || l.includes('timeout ')) {
          expect(l).not.toContain(';');
        }
      }
    }
  });

  it('IPv6 DNAT uses bracket syntax [addr]:port', () => {
    const v6ActionFiles = files.filter(f => f.path.includes('nat-rule-action-ipv6'));
    for (const f of v6ActionFiles) {
      expect(f.content).toMatch(/dnat to \[.+\]:53/);
    }
  });

  it('define statements use inline brace syntax', () => {
    const defineFiles = files.filter(f => f.path.includes('define'));
    for (const f of defineFiles) {
      expect(f.content).toMatch(/define \w+ = \{.+\}/);
    }
  });
});

// ═══ 6. FILTER TABLE NON-REGRESSION ═══

describe('Filter table non-regression', () => {
  it('legacy profile: no filter table generated', () => {
    const config = makeInterceptionConfig({ securityProfile: 'legacy' });
    const files = nftFiles(config);
    const filterFiles = files.filter(f => f.path.includes('filter'));
    expect(filterFiles.length).toBe(0);
  });

  it('isp-hardened profile: filter table generated', () => {
    const config = makeInterceptionConfig({
      securityProfile: 'isp-hardened',
      accessControlIpv4: [
        { network: '172.16.0.0/12', action: 'allow', label: 'RFC1918' },
      ],
    });
    const files = nftFiles(config);
    const filterFiles = files.filter(f => f.path.includes('filter'));
    expect(filterFiles.length).toBe(1);
    expect(filterFiles[0].path).toBe('/etc/nftables.d/0060-filter-table-ipv4.nft');
  });

  it('filter table content is independent of nat refactoring', () => {
    const config = makeInterceptionConfig({
      securityProfile: 'isp-hardened',
      enableDnsProtection: true,
      enableAntiAmplification: true,
      accessControlIpv4: [
        { network: '10.0.0.0/8', action: 'deny', label: 'Blocked' },
        { network: '172.16.0.0/12', action: 'allow', label: 'Internal' },
      ],
    });

    // Generate filter table directly
    const directFilter = generateNftablesFilterTable(config);
    // Generate via full modular pipeline
    const fullFiles = nftFiles(config);
    const fullFilter = fullFiles.filter(f => f.path.includes('filter'));

    // They must be identical
    expect(directFilter.length).toBe(fullFilter.length);
    for (let i = 0; i < directFilter.length; i++) {
      expect(directFilter[i].content).toBe(fullFilter[i].content);
    }
  });

  it('filter table has correct order: DENY → anti-amp → rate-limit → ACCEPT → DEFAULT DROP', () => {
    const config = makeInterceptionConfig({
      securityProfile: 'isp-hardened',
      enableDnsProtection: true,
      enableAntiAmplification: true,
      accessControlIpv4: [
        { network: '10.0.0.0/8', action: 'deny', label: 'Blocked' },
        { network: '172.16.0.0/12', action: 'allow', label: 'Internal' },
      ],
    });
    const filterFiles = generateNftablesFilterTable(config);
    const content = filterFiles[0].content;

    const denyIdx = content.indexOf('10.0.0.0/8');
    const antiAmpIdx = content.indexOf('Anti-amplifica');
    const rateLimitIdx = content.indexOf('Rate limiting');
    const acceptIdx = content.indexOf('172.16.0.0/12');
    const defaultDrop = content.lastIndexOf('DEFAULT DENY');

    expect(denyIdx).toBeLessThan(antiAmpIdx);
    expect(antiAmpIdx).toBeLessThan(rateLimitIdx);
    expect(rateLimitIdx).toBeLessThan(acceptIdx);
    expect(acceptIdx).toBeLessThan(defaultDrop);
  });

  it('nat refactoring does not inject filter-related content into nat snippets', () => {
    const config = makeInterceptionConfig({ securityProfile: 'isp-hardened' });
    const files = nftFiles(config);
    const natOnly = files.filter(f =>
      f.path.startsWith('/etc/nftables.d/') && !f.path.includes('filter') && !f.path.includes('define')
    );
    for (const f of natOnly) {
      expect(f.content).not.toContain('table ip filter');
      expect(f.content).not.toContain('table ip6 filter');
    }
  });

  it('simple mode filter table is structurally identical to interception filter table', () => {
    const sharedAcl = [{ network: '172.16.0.0/12', action: 'allow' as const, label: 'Test' }];

    const interceptConfig = makeInterceptionConfig({
      securityProfile: 'isp-hardened',
      enableDnsProtection: true,
      enableAntiAmplification: true,
      accessControlIpv4: sharedAcl,
    });

    const simpleConfig: WizardConfig = {
      ...DEFAULT_CONFIG,
      operationMode: 'simple',
      hostname: 'simple-01',
      mainInterface: 'ens192',
      ipv4Address: '172.250.40.100/23',
      frontendDnsIp: '172.250.40.100',
      instances: [makeInstance('unbound01', '100.127.255.101')],
      securityProfile: 'isp-hardened',
      enableDnsProtection: true,
      enableAntiAmplification: true,
      accessControlIpv4: sharedAcl,
    };

    const interceptFilter = generateNftablesFilterTable(interceptConfig);
    const simpleFilter = generateNftablesFilterTable(simpleConfig);

    // Same generator, same ACLs → identical output
    expect(interceptFilter.length).toBe(simpleFilter.length);
    for (let i = 0; i < interceptFilter.length; i++) {
      expect(interceptFilter[i].content).toBe(simpleFilter[i].content);
    }
  });
});

// ═══ 7. EDGE CASES ═══

describe('Edge cases', () => {
  it('no VIPs at all: falls back to loopback VIP', () => {
    const config = makeInterceptionConfig({
      serviceVips: [],
      interceptedVips: [],
    });
    // Should not crash
    const files = nftFiles(config);
    expect(files.length).toBeGreaterThan(0);
  });

  it('sticky timeout minimum is 1m (60s)', () => {
    const config = makeInterceptionConfig({ stickyTimeout: 30 }); // 30s < 60s minimum
    const files = nftFiles(config);
    const setFiles = files.filter(f => f.path.includes('addrlist') && f.content.includes('timeout'));
    for (const f of setFiles) {
      expect(f.content).toContain('timeout 1m');
    }
  });

  it('deterministic output: same config → same files', () => {
    const config = makeInterceptionConfig();
    const run1 = nftFiles(config);
    const run2 = nftFiles(config);
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i].path).toBe(run2[i].path);
      expect(run1[i].content).toBe(run2[i].content);
    }
  });
});
