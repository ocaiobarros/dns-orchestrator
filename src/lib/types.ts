export interface WizardConfig {
  // Step 1 - Environment
  hostname: string;
  organization: string;
  project: string;
  timezone: string;
  mainInterface: string;
  description: string;

  // Step 2 - Network
  ipv4Address: string;
  ipv4Gateway: string;
  bootstrapDns: string;
  enableIpv6: boolean;
  ipv6Address: string;
  ipv6Gateway: string;

  // Step 3 - Loopback & VIP
  dummyInterface: string;
  vipAnycastIpv4: string;
  vipAnycastIpv6: string;
  unboundBindIps: string[];
  publicExitIps: string[];
  ipv6BindIps: string[];
  ipv6ExitIps: string[];

  // Step 4 - DNS Instances
  instanceCount: number;
  instances: DnsInstance[];
  threads: number;
  msgCacheSize: string;
  rrsetCacheSize: string;
  keyCacheSize: string;
  minTtl: number;
  maxTtl: number;
  rootHintsPath: string;
  enableDetailedLogs: boolean;
  enableBlocklist: boolean;

  // Step 5 - nftables
  nftVipTarget: string;
  nftDnatTargets: string[];
  stickySourceIp: boolean;
  stickyTimeout: number;
  roundRobin: boolean;
  dispatchMode: string;
  enableDnsProtection: boolean;

  // Step 6 - FRR/OSPF
  enableFrr: boolean;
  routerId: string;
  ospfArea: string;
  ospfInterfaces: string[];
  redistributeConnected: boolean;
  ospfCost: number;
  networkType: string;
  optionalRoute: string;

  // Step 7 - Security
  authType: string;
  adminUser: string;
  adminPassword: string;
  panelBind: string;
  allowedIps: string[];
  panelPort: number;
}

export interface DnsInstance {
  name: string;
  bindIp: string;
  exitIp: string;
  controlPort: number;
}

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'unknown';
  pid?: number;
  memory?: string;
  cpu?: string;
  restartCount?: number;
  uptime?: string;
}

export interface ApplyHistory {
  id: string;
  timestamp: string;
  user: string;
  status: 'success' | 'failed' | 'partial';
  params: Partial<WizardConfig>;
  files: string[];
  logs: string[];
}

export interface DnsMetrics {
  timestamp: string;
  qps: number;
  cacheHits: number;
  cacheMisses: number;
  avgLatency: number;
  servfail: number;
  nxdomain: number;
  refused: number;
  instance: string;
}

export const DEFAULT_CONFIG: WizardConfig = {
  hostname: '',
  organization: '',
  project: '',
  timezone: 'America/Sao_Paulo',
  mainInterface: 'enp6s18',
  description: '',
  ipv4Address: '172.28.22.6/30',
  ipv4Gateway: '172.28.22.5',
  bootstrapDns: '8.8.8.8',
  enableIpv6: false,
  ipv6Address: '',
  ipv6Gateway: '',
  dummyInterface: 'lo0',
  vipAnycastIpv4: '4.2.2.5/32',
  vipAnycastIpv6: '',
  unboundBindIps: ['100.126.255.101/32', '100.126.255.102/32', '100.126.255.103/32', '100.126.255.104/32'],
  publicExitIps: ['45.232.215.16/32', '45.232.215.17/32', '45.232.215.18/32', '45.232.215.19/32'],
  ipv6BindIps: [],
  ipv6ExitIps: [],
  instanceCount: 4,
  instances: [
    { name: 'unbound01', bindIp: '100.126.255.101', exitIp: '45.232.215.16', controlPort: 8953 },
    { name: 'unbound02', bindIp: '100.126.255.102', exitIp: '45.232.215.17', controlPort: 8954 },
    { name: 'unbound03', bindIp: '100.126.255.103', exitIp: '45.232.215.18', controlPort: 8955 },
    { name: 'unbound04', bindIp: '100.126.255.104', exitIp: '45.232.215.19', controlPort: 8956 },
  ],
  threads: 4,
  msgCacheSize: '256m',
  rrsetCacheSize: '512m',
  keyCacheSize: '256m',
  minTtl: 60,
  maxTtl: 86400,
  rootHintsPath: '/usr/share/dns/root.hints',
  enableDetailedLogs: false,
  enableBlocklist: true,
  nftVipTarget: '4.2.2.5',
  nftDnatTargets: ['100.126.255.101', '100.126.255.102', '100.126.255.103', '100.126.255.104'],
  stickySourceIp: true,
  stickyTimeout: 300,
  roundRobin: true,
  dispatchMode: 'round-robin',
  enableDnsProtection: true,
  enableFrr: true,
  routerId: '172.28.22.6',
  ospfArea: '0.0.0.0',
  ospfInterfaces: ['lo0', 'enp6s18'],
  redistributeConnected: true,
  ospfCost: 10,
  networkType: 'point-to-point',
  optionalRoute: '',
  authType: 'local',
  adminUser: 'admin',
  adminPassword: '',
  panelBind: '0.0.0.0',
  allowedIps: [],
  panelPort: 8443,
};
