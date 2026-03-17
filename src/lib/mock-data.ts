// ============================================================
// DNS Control — Complete Mock Data
// Realistic data matching the API contracts
// ============================================================

import type {
  SystemInfo, ServiceStatus, NetworkInterface, Route,
  ReachabilityResult, DnsMetrics, DnsTopDomain, DnsInstanceStats,
  NftCounter, NftStickyEntry, OspfNeighbor, OspfRoute,
  LogEntry, DiagCommand, DiagResult, ApplyResult, ConfigProfile,
  WizardConfig,
} from './types';

// ---- System ----

export const mockSystemInfo: SystemInfo = {
  hostname: 'dns-rec-01.example.com',
  os: 'Debian 13 (Trixie)',
  kernel: '6.12.6-amd64',
  uptime: '5d 12h 33m',
  unboundVersion: '1.21.1',
  frrVersion: '10.2',
  nftablesVersion: '1.1.0',
  mainInterface: 'enp6s18',
  vipAnycast: '4.2.2.5/32',
  lastApply: '2026-03-10T14:30:00Z',
  configVersion: 'v3',
  cpuCount: 8,
  memoryTotalMb: 16384,
  memoryUsedMb: 4200,
};

// ---- Services ----

export const mockServices: ServiceStatus[] = [
  { name: 'unbound01', status: 'running', pid: 1234, memoryBytes: 134217728, cpuPercent: 2.3, restartCount: 0, uptime: '5d 12h 33m', lastLog: 'start of service (unbound 1.21.1)', unitFile: '/etc/systemd/system/unbound01.service' },
  { name: 'unbound02', status: 'running', pid: 1235, memoryBytes: 140509184, cpuPercent: 1.8, restartCount: 0, uptime: '5d 12h 33m', lastLog: 'start of service (unbound 1.21.1)', unitFile: '/etc/systemd/system/unbound02.service' },
  { name: 'unbound03', status: 'running', pid: 1236, memoryBytes: 126877696, cpuPercent: 2.1, restartCount: 1, uptime: '2d 8h 15m', lastLog: 'start of service (unbound 1.21.1)', unitFile: '/etc/systemd/system/unbound03.service' },
  { name: 'unbound04', status: 'running', pid: 1237, memoryBytes: 123731968, cpuPercent: 1.5, restartCount: 0, uptime: '5d 12h 33m', lastLog: 'start of service (unbound 1.21.1)', unitFile: '/etc/systemd/system/unbound04.service' },
  { name: 'frr', status: 'running', pid: 890, memoryBytes: 47185920, cpuPercent: 0.3, restartCount: 0, uptime: '5d 12h 34m', lastLog: 'ospfd[890]: Neighbor Full', unitFile: '/lib/systemd/system/frr.service' },
  { name: 'nftables', status: 'running', pid: null, memoryBytes: null, cpuPercent: null, restartCount: 0, uptime: '5d 12h 35m', lastLog: 'ruleset loaded', unitFile: '/lib/systemd/system/nftables.service' },
  { name: 'dns-control', status: 'running', pid: 2001, memoryBytes: 67108864, cpuPercent: 0.8, restartCount: 0, uptime: '5d 12h 30m', lastLog: 'API started on 0.0.0.0:8443', unitFile: '/etc/systemd/system/dns-control.service' },
];

// ---- Network ----

export const mockInterfaces: NetworkInterface[] = [
  {
    name: 'enp6s18', type: 'physical', state: 'UP', mtu: 1500,
    macAddress: '52:54:00:ab:cd:ef',
    ipv4Addresses: ['172.28.22.6/30'],
    ipv6Addresses: [],
    rxBytes: 89234567890, txBytes: 45123456789,
    rxPackets: 123456789, txPackets: 98765432,
  },
  {
    name: 'lo0', type: 'dummy', state: 'UP', mtu: 65536,
    macAddress: '00:00:00:00:00:00',
    ipv4Addresses: ['4.2.2.5/32', '100.126.255.101/32', '100.126.255.102/32', '100.126.255.103/32', '100.126.255.104/32', '45.232.215.16/32', '45.232.215.17/32', '45.232.215.18/32', '45.232.215.19/32'],
    ipv6Addresses: [],
    rxBytes: 0, txBytes: 0,
    rxPackets: 0, txPackets: 0,
  },
  {
    name: 'lo', type: 'loopback', state: 'UP', mtu: 65536,
    macAddress: '00:00:00:00:00:00',
    ipv4Addresses: ['127.0.0.1/8'],
    ipv6Addresses: ['::1/128'],
    rxBytes: 1234567, txBytes: 1234567,
    rxPackets: 12345, txPackets: 12345,
  },
];

export const mockRoutes: Route[] = [
  { destination: 'default', via: '172.28.22.5', device: 'enp6s18', protocol: 'static', scope: 'global', metric: 100 },
  { destination: '172.28.22.4/30', via: null, device: 'enp6s18', protocol: 'kernel', scope: 'link', metric: 0 },
  { destination: '4.2.2.5', via: null, device: 'lo0', protocol: 'kernel', scope: 'host', metric: 0 },
  { destination: '100.126.255.101', via: null, device: 'lo0', protocol: 'kernel', scope: 'host', metric: 0 },
  { destination: '100.126.255.102', via: null, device: 'lo0', protocol: 'kernel', scope: 'host', metric: 0 },
  { destination: '100.126.255.103', via: null, device: 'lo0', protocol: 'kernel', scope: 'host', metric: 0 },
  { destination: '100.126.255.104', via: null, device: 'lo0', protocol: 'kernel', scope: 'host', metric: 0 },
];

export const mockReachability: ReachabilityResult[] = [
  { target: '172.28.22.5', label: 'Gateway', reachable: true, latencyMs: 0.3, error: null },
  { target: '8.8.8.8', label: 'Google DNS', reachable: true, latencyMs: 12.4, error: null },
  { target: '1.1.1.1', label: 'Cloudflare', reachable: true, latencyMs: 8.7, error: null },
  { target: '4.2.2.5', label: 'VIP Anycast', reachable: true, latencyMs: 0.1, error: null },
  { target: '100.126.255.101', label: 'Unbound 01', reachable: true, latencyMs: 0.1, error: null },
  { target: '100.126.255.102', label: 'Unbound 02', reachable: true, latencyMs: 0.1, error: null },
  { target: '100.126.255.103', label: 'Unbound 03', reachable: true, latencyMs: 0.1, error: null },
  { target: '100.126.255.104', label: 'Unbound 04', reachable: true, latencyMs: 0.1, error: null },
];

// ---- DNS Metrics ----

export function generateDnsMetrics(hours: number = 24): DnsMetrics[] {
  const metrics: DnsMetrics[] = [];
  const instances = ['unbound01', 'unbound02', 'unbound03', 'unbound04'];
  const now = Date.now();

  for (let i = hours * 60; i >= 0; i -= 5) {
    const ts = new Date(now - i * 60 * 1000).toISOString();
    for (const inst of instances) {
      const hourOfDay = new Date(now - i * 60 * 1000).getHours();
      const trafficMultiplier = hourOfDay >= 8 && hourOfDay <= 22 ? 1.5 : 0.6;
      const base = (800 + Math.random() * 400) * trafficMultiplier;
      metrics.push({
        timestamp: ts,
        qps: Math.round(base + Math.sin(i / 30) * 200),
        cacheHits: Math.round(base * 0.85 + Math.random() * 50),
        cacheMisses: Math.round(base * 0.15 + Math.random() * 20),
        avgLatencyMs: +(1.2 + Math.random() * 3).toFixed(1),
        servfail: Math.round(Math.random() * 5),
        nxdomain: Math.round(Math.random() * 30),
        refused: Math.round(Math.random() * 2),
        noerror: Math.round(base * 0.95),
        instance: inst,
      });
    }
  }
  return metrics;
}

export const mockTopDomains: DnsTopDomain[] = [
  { domain: 'google.com', queryCount: 45231, queryType: 'A', lastSeen: '2026-03-11T08:15:00Z' },
  { domain: 'facebook.com', queryCount: 32109, queryType: 'A', lastSeen: '2026-03-11T08:14:55Z' },
  { domain: 'amazonaws.com', queryCount: 28456, queryType: 'A', lastSeen: '2026-03-11T08:15:01Z' },
  { domain: 'cloudflare.com', queryCount: 21345, queryType: 'A', lastSeen: '2026-03-11T08:14:59Z' },
  { domain: 'microsoft.com', queryCount: 19876, queryType: 'A', lastSeen: '2026-03-11T08:15:02Z' },
  { domain: 'apple.com', queryCount: 15432, queryType: 'A', lastSeen: '2026-03-11T08:14:58Z' },
  { domain: 'netflix.com', queryCount: 12345, queryType: 'A', lastSeen: '2026-03-11T08:14:50Z' },
  { domain: 'twitter.com', queryCount: 11234, queryType: 'AAAA', lastSeen: '2026-03-11T08:14:45Z' },
  { domain: 'instagram.com', queryCount: 10987, queryType: 'A', lastSeen: '2026-03-11T08:14:48Z' },
  { domain: 'youtube.com', queryCount: 9876, queryType: 'A', lastSeen: '2026-03-11T08:14:52Z' },
];

export const mockInstanceStats: DnsInstanceStats[] = [
  { instance: 'unbound01', totalQueries: 1284532, cacheHitRatio: 87.3, avgLatencyMs: 2.1, uptime: '5d 12h', threads: 4, currentConnections: 342 },
  { instance: 'unbound02', totalQueries: 1283891, cacheHitRatio: 86.8, avgLatencyMs: 2.3, uptime: '5d 12h', threads: 4, currentConnections: 338 },
  { instance: 'unbound03', totalQueries: 1285102, cacheHitRatio: 87.1, avgLatencyMs: 2.0, uptime: '2d 8h', threads: 4, currentConnections: 345 },
  { instance: 'unbound04', totalQueries: 1282761, cacheHitRatio: 86.5, avgLatencyMs: 2.4, uptime: '5d 12h', threads: 4, currentConnections: 331 },
];

// ---- NAT ----

export const mockNftCounters: NftCounter[] = [
  { chain: 'prerouting', rule: 'dnat to 100.126.255.101', packets: 1284532, bytes: 98234123, backend: '100.126.255.101' },
  { chain: 'prerouting', rule: 'dnat to 100.126.255.102', packets: 1283891, bytes: 98112344, backend: '100.126.255.102' },
  { chain: 'prerouting', rule: 'dnat to 100.126.255.103', packets: 1285102, bytes: 98345211, backend: '100.126.255.103' },
  { chain: 'prerouting', rule: 'dnat to 100.126.255.104', packets: 1282761, bytes: 98023456, backend: '100.126.255.104' },
];

export const mockStickyEntries: NftStickyEntry[] = [
  { sourceIp: '10.0.1.15', backend: '100.126.255.101', expires: 245, packets: 42 },
  { sourceIp: '10.0.2.30', backend: '100.126.255.102', expires: 189, packets: 28 },
  { sourceIp: '10.0.3.8', backend: '100.126.255.103', expires: 301, packets: 55 },
  { sourceIp: '172.16.0.100', backend: '100.126.255.104', expires: 120, packets: 15 },
  { sourceIp: '192.168.1.50', backend: '100.126.255.101', expires: 280, packets: 33 },
];

// ---- OSPF ----

export const mockOspfNeighbors: OspfNeighbor[] = [
  { neighborId: '172.28.22.1', priority: 1, state: 'Full', deadTime: '00:00:35', address: '172.28.22.5', interfaceName: 'enp6s18', area: '0.0.0.0' },
  { neighborId: '172.28.22.2', priority: 1, state: 'Full', deadTime: '00:00:38', address: '172.28.22.9', interfaceName: 'enp6s18', area: '0.0.0.0' },
];

export const mockOspfRoutes: OspfRoute[] = [
  { prefix: '4.2.2.5/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '100.126.255.101/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '100.126.255.102/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '100.126.255.103/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '100.126.255.104/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '45.232.215.16/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '45.232.215.17/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '45.232.215.18/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
  { prefix: '45.232.215.19/32', nextHop: '0.0.0.0', device: 'lo0', cost: 0, area: '0.0.0.0', type: 'connected' },
];

// ---- Logs ----

export const mockLogs: LogEntry[] = [
  { id: 'l001', timestamp: '2026-03-11T08:15:32Z', source: 'unbound', level: 'info', message: 'query: 127.0.0.1 google.com. A IN', service: 'unbound01' },
  { id: 'l002', timestamp: '2026-03-11T08:15:33Z', source: 'unbound', level: 'info', message: 'response for google.com. A IN NOERROR 1.2ms', service: 'unbound01' },
  { id: 'l003', timestamp: '2026-03-11T08:14:00Z', source: 'frr', level: 'info', message: 'ospfd[890]: Neighbor 172.28.22.1 state Full', service: 'frr' },
  { id: 'l004', timestamp: '2026-03-11T08:00:00Z', source: 'nftables', level: 'ok', message: 'ruleset loaded successfully', service: 'nftables' },
  { id: 'l005', timestamp: '2026-03-10T14:30:01Z', source: 'apply', level: 'info', message: 'Starting configuration apply...', service: 'dns-control' },
  { id: 'l006', timestamp: '2026-03-10T14:30:02Z', source: 'apply', level: 'ok', message: 'Packages verified: unbound frr nftables', service: 'dns-control' },
  { id: 'l007', timestamp: '2026-03-10T14:30:03Z', source: 'apply', level: 'ok', message: 'Generated /etc/unbound/unbound01.conf', service: 'dns-control' },
  { id: 'l008', timestamp: '2026-03-10T14:30:03Z', source: 'apply', level: 'ok', message: 'Generated /etc/unbound/unbound02.conf', service: 'dns-control' },
  { id: 'l009', timestamp: '2026-03-10T14:30:04Z', source: 'apply', level: 'ok', message: 'Generated /etc/nftables.conf', service: 'dns-control' },
  { id: 'l010', timestamp: '2026-03-10T14:30:05Z', source: 'apply', level: 'ok', message: 'Generated /etc/frr/frr.conf', service: 'dns-control' },
  { id: 'l011', timestamp: '2026-03-10T14:30:06Z', source: 'apply', level: 'ok', message: 'Services restarted successfully', service: 'dns-control' },
  { id: 'l012', timestamp: '2026-03-10T14:30:08Z', source: 'apply', level: 'ok', message: 'Validation passed — all instances responding', service: 'dns-control' },
  { id: 'l013', timestamp: '2026-03-10T14:30:08Z', source: 'apply', level: 'info', message: 'Apply completed successfully', service: 'dns-control' },
  { id: 'l014', timestamp: '2026-03-10T14:00:00Z', source: 'system', level: 'info', message: 'Started DNS Control Panel', service: 'dns-control' },
  { id: 'l015', timestamp: '2026-03-10T14:00:01Z', source: 'system', level: 'info', message: 'Started Unbound DNS resolver (instance 01)', service: 'unbound01' },
  { id: 'l016', timestamp: '2026-03-10T14:00:01Z', source: 'system', level: 'info', message: 'Started Unbound DNS resolver (instance 02)', service: 'unbound02' },
  { id: 'l017', timestamp: '2026-03-10T14:00:02Z', source: 'system', level: 'info', message: 'Started Unbound DNS resolver (instance 03)', service: 'unbound03' },
  { id: 'l018', timestamp: '2026-03-10T14:00:02Z', source: 'system', level: 'info', message: 'Started Unbound DNS resolver (instance 04)', service: 'unbound04' },
];

// ---- Diagnostics ----

export const mockDiagCommands: DiagCommand[] = [
  { id: 'svc-status', label: 'systemctl status unbound*', command: 'systemctl status unbound01 unbound02 unbound03 unbound04', category: 'services', dangerous: false },
  { id: 'ss-dns', label: 'ss -lunp | grep :53', command: 'ss -lunp | grep :53', category: 'network', dangerous: false },
  { id: 'ip-addr-lo0', label: 'ip addr show lo0', command: 'ip addr show lo0', category: 'network', dangerous: false },
  { id: 'ip-route', label: 'ip route', command: 'ip route', category: 'network', dangerous: false },
  { id: 'ub-status', label: 'unbound-control status', command: 'unbound-control -c /etc/unbound/unbound01.conf status', category: 'dns', dangerous: false },
  { id: 'dig-vip', label: 'dig @VIP google.com', command: 'dig @4.2.2.5 google.com +short', category: 'dns', dangerous: false },
  { id: 'dig-ub01', label: 'dig @unbound01', command: 'dig @100.126.255.101 google.com +short', category: 'dns', dangerous: false },
  { id: 'dig-ub02', label: 'dig @unbound02', command: 'dig @100.126.255.102 google.com +short', category: 'dns', dangerous: false },
  { id: 'dig-ub03', label: 'dig @unbound03', command: 'dig @100.126.255.103 google.com +short', category: 'dns', dangerous: false },
  { id: 'dig-ub04', label: 'dig @unbound04', command: 'dig @100.126.255.104 google.com +short', category: 'dns', dangerous: false },
  { id: 'nft-list', label: 'nft list ruleset', command: 'nft list ruleset', category: 'nat', dangerous: false },
  { id: 'nft-counters', label: 'nft list counters', command: 'nft list counters', category: 'nat', dangerous: false },
  { id: 'vtysh-run', label: 'vtysh show running', command: 'vtysh -c "show running-config"', category: 'frr', dangerous: false },
  { id: 'vtysh-ospf', label: 'show ip ospf neighbor', command: 'vtysh -c "show ip ospf neighbor"', category: 'frr', dangerous: false },
  { id: 'vtysh-route', label: 'show ip route ospf', command: 'vtysh -c "show ip route ospf"', category: 'frr', dangerous: false },
  { id: 'health-full', label: 'Health Check Completo', command: '/usr/local/sbin/dns-control-diagnose --full', category: 'system', dangerous: false },
];

export const mockDiagOutputs: Record<string, DiagResult> = {
  'ss-dns': {
    commandId: 'ss-dns', exitCode: 0, durationMs: 45, timestamp: new Date().toISOString(), stderr: '',
    stdout: `udp  UNCONN  0  0  100.126.255.101:53  0.0.0.0:*  users:(("unbound",pid=1234,fd=5))
udp  UNCONN  0  0  100.126.255.102:53  0.0.0.0:*  users:(("unbound",pid=1235,fd=5))
udp  UNCONN  0  0  100.126.255.103:53  0.0.0.0:*  users:(("unbound",pid=1236,fd=5))
udp  UNCONN  0  0  100.126.255.104:53  0.0.0.0:*  users:(("unbound",pid=1237,fd=5))
tcp  LISTEN  0  256  100.126.255.101:53  0.0.0.0:*  users:(("unbound",pid=1234,fd=6))
tcp  LISTEN  0  256  100.126.255.102:53  0.0.0.0:*  users:(("unbound",pid=1235,fd=6))
tcp  LISTEN  0  256  100.126.255.103:53  0.0.0.0:*  users:(("unbound",pid=1236,fd=6))
tcp  LISTEN  0  256  100.126.255.104:53  0.0.0.0:*  users:(("unbound",pid=1237,fd=6))`,
  },
  'dig-vip': {
    commandId: 'dig-vip', exitCode: 0, durationMs: 12, timestamp: new Date().toISOString(), stderr: '',
    stdout: '142.250.79.46',
  },
  'dig-ub01': {
    commandId: 'dig-ub01', exitCode: 0, durationMs: 8, timestamp: new Date().toISOString(), stderr: '',
    stdout: '142.250.79.46',
  },
  'dig-ub02': {
    commandId: 'dig-ub02', exitCode: 0, durationMs: 9, timestamp: new Date().toISOString(), stderr: '',
    stdout: '142.250.79.46',
  },
  'dig-ub03': {
    commandId: 'dig-ub03', exitCode: 0, durationMs: 7, timestamp: new Date().toISOString(), stderr: '',
    stdout: '142.250.79.46',
  },
  'dig-ub04': {
    commandId: 'dig-ub04', exitCode: 0, durationMs: 11, timestamp: new Date().toISOString(), stderr: '',
    stdout: '142.250.79.46',
  },
  'ip-route': {
    commandId: 'ip-route', exitCode: 0, durationMs: 15, timestamp: new Date().toISOString(), stderr: '',
    stdout: `default via 172.28.22.5 dev enp6s18 proto static metric 100
172.28.22.4/30 dev enp6s18 proto kernel scope link src 172.28.22.6
4.2.2.5 dev lo0 proto kernel scope host src 4.2.2.5
100.126.255.101 dev lo0 proto kernel scope host
100.126.255.102 dev lo0 proto kernel scope host
100.126.255.103 dev lo0 proto kernel scope host
100.126.255.104 dev lo0 proto kernel scope host
45.232.215.16 dev lo0 proto kernel scope host
45.232.215.17 dev lo0 proto kernel scope host
45.232.215.18 dev lo0 proto kernel scope host
45.232.215.19 dev lo0 proto kernel scope host`,
  },
  'ub-status': {
    commandId: 'ub-status', exitCode: 0, durationMs: 30, timestamp: new Date().toISOString(), stderr: '',
    stdout: `version: 1.21.1
verbosity: 1
threads: 4
modules: 3 [ validator iterator respip ]
uptime: 468798 seconds
options: reuseport control
unbound (pid 1234) is running...`,
  },
  'ip-addr-lo0': {
    commandId: 'ip-addr-lo0', exitCode: 0, durationMs: 10, timestamp: new Date().toISOString(), stderr: '',
    stdout: `3: lo0: <BROADCAST,NOARP,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000
    link/ether 00:00:00:00:00:00 brd ff:ff:ff:ff:ff:ff
    inet 4.2.2.5/32 scope global lo0
    inet 100.126.255.101/32 scope global lo0
    inet 100.126.255.102/32 scope global lo0
    inet 100.126.255.103/32 scope global lo0
    inet 100.126.255.104/32 scope global lo0
    inet 45.232.215.16/32 scope global lo0
    inet 45.232.215.17/32 scope global lo0
    inet 45.232.215.18/32 scope global lo0
    inet 45.232.215.19/32 scope global lo0`,
  },
  'vtysh-ospf': {
    commandId: 'vtysh-ospf', exitCode: 0, durationMs: 50, timestamp: new Date().toISOString(), stderr: '',
    stdout: `Neighbor ID     Pri State           Dead Time Address         Interface
172.28.22.1       1 Full/DR         00:00:35  172.28.22.5     enp6s18:172.28.22.6
172.28.22.2       1 Full/Backup     00:00:38  172.28.22.9     enp6s18:172.28.22.6`,
  },
  'health-full': {
    commandId: 'health-full', exitCode: 0, durationMs: 3200, timestamp: new Date().toISOString(), stderr: '',
    stdout: `=== DNS Control Health Check ===
[OK] System: Debian 13 (Trixie), kernel 6.12.6
[OK] Uptime: 5 days, 12 hours
[OK] CPU: 8 cores, load avg 0.45
[OK] Memory: 4200/16384 MB (25.6%)
[OK] Interface enp6s18: UP, 172.28.22.6/30
[OK] Interface lo0: UP, 9 addresses configured
[OK] Gateway 172.28.22.5: reachable (0.3ms)
[OK] VIP 4.2.2.5: configured on lo0
[OK] unbound01 (pid 1234): running, 128MB, port 53 listening
[OK] unbound02 (pid 1235): running, 134MB, port 53 listening
[OK] unbound03 (pid 1236): running, 121MB, port 53 listening
[OK] unbound04 (pid 1237): running, 118MB, port 53 listening
[OK] dig @4.2.2.5 google.com: NOERROR (12ms)
[OK] dig @100.126.255.101 google.com: NOERROR (8ms)
[OK] dig @100.126.255.102 google.com: NOERROR (9ms)
[OK] dig @100.126.255.103 google.com: NOERROR (7ms)
[OK] dig @100.126.255.104 google.com: NOERROR (11ms)
[OK] nftables: ruleset loaded, 4 DNAT rules active
[OK] FRR/OSPF: running, 2 neighbors Full
[OK] OSPF redistribution: 9 connected routes announced

Result: ALL CHECKS PASSED (16/16)`,
  },
  'svc-status': {
    commandId: 'svc-status', exitCode: 0, durationMs: 80, timestamp: new Date().toISOString(), stderr: '',
    stdout: `● unbound01.service - Unbound DNS resolver (unbound01)
     Loaded: loaded (/etc/systemd/system/unbound01.service; enabled)
     Active: active (running) since Tue 2026-03-05 19:57:00 UTC; 5 days ago
   Main PID: 1234 (unbound)
     Memory: 128.0M
        CPU: 2h 15min
● unbound02.service - Unbound DNS resolver (unbound02)
     Loaded: loaded (/etc/systemd/system/unbound02.service; enabled)
     Active: active (running) since Tue 2026-03-05 19:57:00 UTC; 5 days ago
   Main PID: 1235 (unbound)
     Memory: 134.0M
        CPU: 1h 48min
● unbound03.service - Unbound DNS resolver (unbound03)
     Loaded: loaded (/etc/systemd/system/unbound03.service; enabled)
     Active: active (running) since Sun 2026-03-09 00:05:00 UTC; 2 days ago
   Main PID: 1236 (unbound)
     Memory: 121.0M
        CPU: 52min
● unbound04.service - Unbound DNS resolver (unbound04)
     Loaded: loaded (/etc/systemd/system/unbound04.service; enabled)
     Active: active (running) since Tue 2026-03-05 19:57:00 UTC; 5 days ago
   Main PID: 1237 (unbound)
     Memory: 118.0M
        CPU: 1h 30min`,
  },
};

// ---- Deployment mock extras ----
const _deployBase = {
  configVersion: 'v3',
  environment: 'production',
  changedFiles: ['/etc/unbound/unbound01.conf', '/etc/unbound/unbound02.conf', '/etc/nftables.conf'],
  healthResult: [
    { name: 'unbound01 systemd status', target: 'unbound01', status: 'pass' as const, detail: 'active', durationMs: 50 },
    { name: 'unbound02 systemd status', target: 'unbound02', status: 'pass' as const, detail: 'active', durationMs: 45 },
    { name: 'nftables rules loaded', target: 'nftables', status: 'pass' as const, detail: 'table ip nat', durationMs: 30 },
  ],
  rollbackAvailable: true,
  backupId: 'bk-20260310_143000',
};

// ---- History ----

export const mockHistory: ApplyResult[] = [
  {
    id: 'apply-001',
    timestamp: '2026-03-10T14:30:00Z',
    user: 'admin',
    status: 'success',
    scope: 'full',
    dryRun: false,
    comment: 'Initial deployment',
    duration: 8500,
    configSnapshot: {} as WizardConfig,
    steps: [
      { order: 1, name: 'Validar parâmetros', status: 'success', output: 'OK', durationMs: 120, command: null },
      { order: 2, name: 'Gerar artefatos', status: 'success', output: '11 arquivos', durationMs: 200, command: null },
      { order: 3, name: 'Backup configuração', status: 'success', output: 'Backup salvo', durationMs: 150, command: null },
      { order: 4, name: 'Gravar rede', status: 'success', output: '3 arquivos', durationMs: 80, command: null },
      { order: 5, name: 'Gravar Unbound', status: 'success', output: '4 arquivos', durationMs: 100, command: null },
      { order: 6, name: 'Gravar nftables', status: 'success', output: '12 arquivos', durationMs: 50, command: null },
      { order: 7, name: 'Gravar sysctl/systemd', status: 'success', output: '8 arquivos', durationMs: 40, command: null },
      { order: 8, name: 'daemon-reload', status: 'success', output: 'OK', durationMs: 300, command: 'systemctl daemon-reload' },
      { order: 9, name: 'Reiniciar unbound01', status: 'success', output: 'OK', durationMs: 800, command: 'systemctl restart unbound01' },
      { order: 10, name: 'Reiniciar unbound02', status: 'success', output: 'OK', durationMs: 800, command: 'systemctl restart unbound02' },
      { order: 11, name: 'Aplicar nftables', status: 'success', output: 'Ruleset loaded', durationMs: 300, command: 'nft -f /etc/nftables.conf' },
      { order: 12, name: 'Verificação pós-deploy', status: 'success', output: '6/6 checks OK', durationMs: 1500, command: null },
    ],
    filesGenerated: [],
    ..._deployBase,
  },
  {
    id: 'apply-002',
    timestamp: '2026-03-08T09:15:00Z',
    user: 'admin',
    status: 'success',
    scope: 'network',
    dryRun: false,
    comment: 'Network reconfiguration',
    duration: 2200,
    configSnapshot: {} as WizardConfig,
    steps: [
      { order: 1, name: 'Gerar config rede', status: 'success', output: 'OK', durationMs: 100, command: null },
      { order: 2, name: 'Aplicar rede', status: 'success', output: 'OK', durationMs: 800, command: '/etc/network/post-up.sh' },
      { order: 3, name: 'Verificação pós-deploy', status: 'success', output: '3/3 checks OK', durationMs: 500, command: null },
    ],
    filesGenerated: [],
    ..._deployBase,
    configVersion: 'v2',
  },
  {
    id: 'apply-003',
    timestamp: '2026-03-05T19:50:00Z',
    user: 'admin',
    status: 'success',
    scope: 'full',
    dryRun: true,
    comment: 'Dry-run before initial deployment',
    duration: 1200,
    configSnapshot: {} as WizardConfig,
    steps: [
      { order: 1, name: 'Validar parâmetros', status: 'success', output: 'OK', durationMs: 120, command: null },
      { order: 2, name: 'Gerar artefatos', status: 'success', output: '11 arquivos', durationMs: 800, command: null },
      { order: 3, name: 'Dry-run concluído', status: 'success', output: 'Nenhuma alteração', durationMs: 200, command: null },
    ],
    filesGenerated: [],
    ..._deployBase,
    configVersion: 'v1',
    rollbackAvailable: false,
    backupId: null,
  },
];

// ---- Profiles ----

export const mockProfiles: ConfigProfile[] = [
  {
    id: 'profile-001',
    name: 'Produção DNS-REC-01',
    description: 'Configuração de produção do servidor DNS recursivo principal',
    config: {} as WizardConfig,
    createdAt: '2026-03-05T19:00:00Z',
    updatedAt: '2026-03-10T14:30:00Z',
  },
];

// ---- Instance Health Check ----

import type { InstanceHealthReport } from './types';

export function mockInstanceHealth(): InstanceHealthReport {
  return {
    healthy: 4,
    total: 4,
    all_healthy: true,
    degraded: false,
    down: false,
    instances: [
      { instance: 'unbound01', bind_ip: '100.126.255.101', port: 53, healthy: true, resolved_ip: '142.250.79.46', latency_ms: 3 + Math.round(Math.random() * 5), probe_domain: 'google.com', error: null, timestamp: Date.now() / 1000 },
      { instance: 'unbound02', bind_ip: '100.126.255.102', port: 53, healthy: true, resolved_ip: '142.250.79.46', latency_ms: 4 + Math.round(Math.random() * 5), probe_domain: 'google.com', error: null, timestamp: Date.now() / 1000 },
      { instance: 'unbound03', bind_ip: '100.126.255.103', port: 53, healthy: true, resolved_ip: '142.250.79.46', latency_ms: 2 + Math.round(Math.random() * 4), probe_domain: 'google.com', error: null, timestamp: Date.now() / 1000 },
      { instance: 'unbound04', bind_ip: '100.126.255.104', port: 53, healthy: true, resolved_ip: '142.250.79.46', latency_ms: 5 + Math.round(Math.random() * 6), probe_domain: 'google.com', error: null, timestamp: Date.now() / 1000 },
    ],
    vip: { instance: 'VIP-Anycast', bind_ip: '4.2.2.5', port: 53, healthy: true, resolved_ip: '142.250.79.46', latency_ms: 2 + Math.round(Math.random() * 3), probe_domain: 'google.com', error: null, timestamp: Date.now() / 1000 },
    timestamp: Date.now() / 1000,
  };
}

// ---- v2 Mock Data ----

import type { V2Event, V2MetricEntry, V2Instance, V2Action } from './types';

export function mockV2Events(): { items: V2Event[]; total: number } {
  const events: V2Event[] = [
    { id: 'ev-001', event_type: 'instance_recovered', severity: 'info', instance_id: 'inst-03', message: 'unbound03 recovered after 3 successful checks', details_json: null, created_at: '2026-03-11T08:10:00Z' },
    { id: 'ev-002', event_type: 'backend_removed_from_dnat', severity: 'critical', instance_id: 'inst-03', message: 'Backend unbound03 (100.126.255.103) removed from DNAT rotation', details_json: null, created_at: '2026-03-11T07:55:00Z' },
    { id: 'ev-003', event_type: 'instance_failed', severity: 'critical', instance_id: 'inst-03', message: 'unbound03 FAILED after 3 consecutive failures', details_json: null, created_at: '2026-03-11T07:54:30Z' },
    { id: 'ev-004', event_type: 'instance_degraded', severity: 'warning', instance_id: 'inst-03', message: 'unbound03 is degraded', details_json: null, created_at: '2026-03-11T07:54:00Z' },
    { id: 'ev-005', event_type: 'backend_restored_to_dnat', severity: 'info', instance_id: 'inst-03', message: 'Backend unbound03 (100.126.255.103) restored to DNAT rotation', details_json: null, created_at: '2026-03-11T08:10:30Z' },
    { id: 'ev-006', event_type: 'health_check_timeout', severity: 'warning', instance_id: 'inst-02', message: 'Health check for unbound02 timed out (dig)', details_json: null, created_at: '2026-03-11T06:30:00Z' },
    { id: 'ev-007', event_type: 'instance_recovered', severity: 'info', instance_id: 'inst-02', message: 'unbound02 recovered after 3 successful checks', details_json: null, created_at: '2026-03-11T06:31:00Z' },
  ];
  return { items: events, total: events.length };
}

export function mockV2Metrics(): V2MetricEntry[] {
  const now = new Date().toISOString();
  return [
    { instance_id: 'inst-01', instance_name: 'unbound01', metric_name: 'dns_queries_total', metric_value: 1284532, collected_at: now },
    { instance_id: 'inst-01', instance_name: 'unbound01', metric_name: 'dns_cache_hit_ratio', metric_value: 0.873, collected_at: now },
    { instance_id: 'inst-01', instance_name: 'unbound01', metric_name: 'dns_latency_ms', metric_value: 2.1, collected_at: now },
    { instance_id: 'inst-01', instance_name: 'unbound01', metric_name: 'dns_servfail_total', metric_value: 12, collected_at: now },
    { instance_id: 'inst-01', instance_name: 'unbound01', metric_name: 'dns_nxdomain_total', metric_value: 3421, collected_at: now },
    { instance_id: 'inst-02', instance_name: 'unbound02', metric_name: 'dns_queries_total', metric_value: 1283891, collected_at: now },
    { instance_id: 'inst-02', instance_name: 'unbound02', metric_name: 'dns_cache_hit_ratio', metric_value: 0.868, collected_at: now },
    { instance_id: 'inst-02', instance_name: 'unbound02', metric_name: 'dns_latency_ms', metric_value: 2.3, collected_at: now },
    { instance_id: 'inst-02', instance_name: 'unbound02', metric_name: 'dns_servfail_total', metric_value: 8, collected_at: now },
    { instance_id: 'inst-02', instance_name: 'unbound02', metric_name: 'dns_nxdomain_total', metric_value: 3190, collected_at: now },
    { instance_id: 'inst-03', instance_name: 'unbound03', metric_name: 'dns_queries_total', metric_value: 1285102, collected_at: now },
    { instance_id: 'inst-03', instance_name: 'unbound03', metric_name: 'dns_cache_hit_ratio', metric_value: 0.871, collected_at: now },
    { instance_id: 'inst-03', instance_name: 'unbound03', metric_name: 'dns_latency_ms', metric_value: 2.0, collected_at: now },
    { instance_id: 'inst-03', instance_name: 'unbound03', metric_name: 'dns_servfail_total', metric_value: 5, collected_at: now },
    { instance_id: 'inst-03', instance_name: 'unbound03', metric_name: 'dns_nxdomain_total', metric_value: 3502, collected_at: now },
    { instance_id: 'inst-04', instance_name: 'unbound04', metric_name: 'dns_queries_total', metric_value: 1282761, collected_at: now },
    { instance_id: 'inst-04', instance_name: 'unbound04', metric_name: 'dns_cache_hit_ratio', metric_value: 0.865, collected_at: now },
    { instance_id: 'inst-04', instance_name: 'unbound04', metric_name: 'dns_latency_ms', metric_value: 2.4, collected_at: now },
    { instance_id: 'inst-04', instance_name: 'unbound04', metric_name: 'dns_servfail_total', metric_value: 15, collected_at: now },
    { instance_id: 'inst-04', instance_name: 'unbound04', metric_name: 'dns_nxdomain_total', metric_value: 3280, collected_at: now },
  ];
}

export function mockV2Instances(): V2Instance[] {
  return [
    { id: 'inst-01', instance_name: 'unbound01', bind_ip: '100.126.255.101', bind_port: 53, outgoing_ip: '45.232.215.16', control_port: 8953, current_status: 'healthy', in_rotation: true, consecutive_failures: 0, consecutive_successes: 142, last_success_at: new Date().toISOString(), last_failure_at: null, last_transition_at: '2026-03-10T14:30:00Z', reason: null, cooldown_remaining: 0, last_reconciliation_at: null },
    { id: 'inst-02', instance_name: 'unbound02', bind_ip: '100.126.255.102', bind_port: 53, outgoing_ip: '45.232.215.17', control_port: 8954, current_status: 'healthy', in_rotation: true, consecutive_failures: 0, consecutive_successes: 140, last_success_at: new Date().toISOString(), last_failure_at: '2026-03-11T06:30:00Z', last_transition_at: '2026-03-11T06:31:00Z', reason: 'Recovery: passed consecutive health checks', cooldown_remaining: 0, last_reconciliation_at: '2026-03-11T06:31:00Z' },
    { id: 'inst-03', instance_name: 'unbound03', bind_ip: '100.126.255.103', bind_port: 53, outgoing_ip: '45.232.215.18', control_port: 8955, current_status: 'healthy', in_rotation: true, consecutive_failures: 0, consecutive_successes: 85, last_success_at: new Date().toISOString(), last_failure_at: '2026-03-11T07:54:30Z', last_transition_at: '2026-03-11T08:10:00Z', reason: 'Recovery: passed consecutive health checks', cooldown_remaining: 0, last_reconciliation_at: '2026-03-11T08:10:30Z' },
    { id: 'inst-04', instance_name: 'unbound04', bind_ip: '100.126.255.104', bind_port: 53, outgoing_ip: '45.232.215.19', control_port: 8956, current_status: 'healthy', in_rotation: true, consecutive_failures: 0, consecutive_successes: 142, last_success_at: new Date().toISOString(), last_failure_at: null, last_transition_at: '2026-03-10T14:30:00Z', reason: null, cooldown_remaining: 0, last_reconciliation_at: null },
  ];
}

export function mockV2Actions(): V2Action[] {
  return [
    { id: 'act-001', action_type: 'remove_backend', target_type: 'instance', target_id: 'inst-03', status: 'success', exit_code: 0, trigger_source: 'health_engine', stdout_log: '', stderr_log: '', created_at: '2026-03-11T07:55:00Z', finished_at: '2026-03-11T07:55:01Z' },
    { id: 'act-002', action_type: 'restore_backend', target_type: 'instance', target_id: 'inst-03', status: 'success', exit_code: 0, trigger_source: 'health_engine', stdout_log: '', stderr_log: '', created_at: '2026-03-11T08:10:30Z', finished_at: '2026-03-11T08:10:31Z' },
  ];
}

export function mockExternalDnsProbes() {
  return {
    external_reachability: [
      { resolver: '4.2.2.5', label: 'Lumen/Level3 Resolver A', provider: 'Lumen', reachable: true, latency_ms: 42.3, resolved_ip: '142.250.219.14', error: null, purpose: 'External DNS connectivity probe' },
      { resolver: '4.2.2.6', label: 'Lumen/Level3 Resolver B', provider: 'Lumen', reachable: true, latency_ms: 38.7, resolved_ip: '142.250.219.14', error: null, purpose: 'External DNS connectivity probe' },
    ],
    hijack_detection: {
      detected: false,
      threshold_ms: 10,
      suspicious_probes: [],
      message: '✓ Nenhuma interceptação DNS detectada. Latências dentro do esperado para resolvers externos.',
    },
    root_recursion: {
      trace: { status: 'ok', latency_ms: 320.5, reached_root: true, output_lines: 47, error: null },
      root_query: { status: 'ok', target: 'a.root-servers.net', latency_ms: 85.2, answer: 'a.root-servers.net.\nb.root-servers.net.\nc.root-servers.net.', error: null },
    },
    summary: {
      external_dns_reachable: true,
      hijack_suspected: false,
      root_recursion_ok: true,
      trace_ok: true,
    },
  };
}
