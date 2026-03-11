import type { ServiceStatus, DnsMetrics, ApplyHistory } from './types';

export const mockServices: ServiceStatus[] = [
  { name: 'unbound01', status: 'running', pid: 1234, memory: '128MB', cpu: '2.3%', restartCount: 0, uptime: '5d 12h 33m' },
  { name: 'unbound02', status: 'running', pid: 1235, memory: '134MB', cpu: '1.8%', restartCount: 0, uptime: '5d 12h 33m' },
  { name: 'unbound03', status: 'running', pid: 1236, memory: '121MB', cpu: '2.1%', restartCount: 1, uptime: '2d 8h 15m' },
  { name: 'unbound04', status: 'running', pid: 1237, memory: '118MB', cpu: '1.5%', restartCount: 0, uptime: '5d 12h 33m' },
  { name: 'frr', status: 'running', pid: 890, memory: '45MB', cpu: '0.3%', restartCount: 0, uptime: '5d 12h 34m' },
  { name: 'nftables', status: 'running', pid: 0, memory: 'N/A', cpu: 'N/A', restartCount: 0, uptime: '5d 12h 35m' },
  { name: 'dns-control', status: 'running', pid: 2001, memory: '64MB', cpu: '0.8%', restartCount: 0, uptime: '5d 12h 30m' },
];

export function generateDnsMetrics(hours: number = 24): DnsMetrics[] {
  const metrics: DnsMetrics[] = [];
  const instances = ['unbound01', 'unbound02', 'unbound03', 'unbound04'];
  const now = Date.now();

  for (let i = hours * 60; i >= 0; i -= 5) {
    const ts = new Date(now - i * 60 * 1000).toISOString();
    for (const inst of instances) {
      const base = 800 + Math.random() * 400;
      metrics.push({
        timestamp: ts,
        qps: Math.round(base + Math.sin(i / 30) * 200),
        cacheHits: Math.round(base * 0.85 + Math.random() * 50),
        cacheMisses: Math.round(base * 0.15 + Math.random() * 20),
        avgLatency: +(1.2 + Math.random() * 3).toFixed(1),
        servfail: Math.round(Math.random() * 5),
        nxdomain: Math.round(Math.random() * 30),
        refused: Math.round(Math.random() * 2),
        instance: inst,
      });
    }
  }
  return metrics;
}

export const mockHistory: ApplyHistory[] = [
  {
    id: 'apply-001',
    timestamp: '2026-03-10T14:30:00Z',
    user: 'admin',
    status: 'success',
    params: {},
    files: ['/etc/unbound/unbound01.conf', '/etc/unbound/unbound02.conf', '/etc/nftables.conf', '/etc/frr/frr.conf'],
    logs: ['[OK] Packages verified', '[OK] Config generated', '[OK] Services restarted', '[OK] Validation passed'],
  },
  {
    id: 'apply-002',
    timestamp: '2026-03-08T09:15:00Z',
    user: 'admin',
    status: 'success',
    params: {},
    files: ['/etc/network/interfaces', '/etc/network/post-up.sh'],
    logs: ['[OK] Network config applied', '[OK] Interfaces reloaded'],
  },
];

export const mockOspfNeighbors = [
  { neighborId: '172.28.22.1', state: 'Full', deadTime: '00:00:35', address: '172.28.22.5', interface: 'enp6s18' },
  { neighborId: '172.28.22.2', state: 'Full', deadTime: '00:00:38', address: '172.28.22.9', interface: 'enp6s18' },
];

export const mockNftCounters = [
  { chain: 'dnat_dns', rule: 'dnat to 100.126.255.101', packets: 1284532, bytes: 98234123 },
  { chain: 'dnat_dns', rule: 'dnat to 100.126.255.102', packets: 1283891, bytes: 98112344 },
  { chain: 'dnat_dns', rule: 'dnat to 100.126.255.103', packets: 1285102, bytes: 98345211 },
  { chain: 'dnat_dns', rule: 'dnat to 100.126.255.104', packets: 1282761, bytes: 98023456 },
];

export const mockTopDomains = [
  { domain: 'google.com', queries: 45231 },
  { domain: 'facebook.com', queries: 32109 },
  { domain: 'amazonaws.com', queries: 28456 },
  { domain: 'cloudflare.com', queries: 21345 },
  { domain: 'microsoft.com', queries: 19876 },
  { domain: 'apple.com', queries: 15432 },
  { domain: 'netflix.com', queries: 12345 },
  { domain: 'twitter.com', queries: 11234 },
  { domain: 'instagram.com', queries: 10987 },
  { domain: 'youtube.com', queries: 9876 },
];
