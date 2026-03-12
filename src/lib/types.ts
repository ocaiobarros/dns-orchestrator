// ============================================================
// DNS Control — Complete Type System
// ============================================================

// ---- Wizard Configuration ----

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
  dispatchMode: 'round-robin' | 'random' | 'hash';
  enableDnsProtection: boolean;

  // Step 6 - FRR/OSPF
  enableFrr: boolean;
  routerId: string;
  ospfArea: string;
  ospfInterfaces: string[];
  redistributeConnected: boolean;
  ospfCost: number;
  networkType: 'point-to-point' | 'broadcast';
  optionalRoute: string;

  // Step 7 - Security
  authType: 'local' | 'pam';
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

// ---- Service Status ----

export type ServiceState = 'running' | 'stopped' | 'error' | 'unknown' | 'starting' | 'reloading';

export interface ServiceStatus {
  name: string;
  status: ServiceState;
  pid: number | null;
  memoryBytes: number | null;
  cpuPercent: number | null;
  restartCount: number;
  uptime: string;
  lastLog: string;
  unitFile: string;
}

// ---- System Info ----

export interface SystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  unboundVersion: string;
  frrVersion: string;
  nftablesVersion: string;
  mainInterface: string;
  vipAnycast: string;
  lastApply: string | null;
  configVersion: string;
  cpuCount: number;
  memoryTotalMb: number;
  memoryUsedMb: number;
}

// ---- Network ----
// Real API returns flat objects; mock returns rich objects.
// We normalize to a common shape in the hooks/pages.

export interface NetworkInterface {
  name: string;
  // Real API fields (flat)
  status?: string;
  ipv4?: string;
  ipv6?: string;
  mac?: string;
  // Mock/rich fields
  type?: 'physical' | 'dummy' | 'loopback' | 'vlan' | 'bridge';
  state?: 'UP' | 'DOWN' | 'UNKNOWN';
  mtu?: number;
  macAddress?: string;
  ipv4Addresses?: string[];
  ipv6Addresses?: string[];
  rxBytes?: number;
  txBytes?: number;
  rxPackets?: number;
  txPackets?: number;
}

export interface Route {
  destination: string;
  via: string | null;
  device: string;
  protocol: string;
  scope: string;
  metric: number;
}

export interface ReachabilityResult {
  target: string;
  label: string;
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
}

// ---- DNS Metrics ----

export interface DnsMetrics {
  timestamp: string;
  qps: number;
  cacheHits: number;
  cacheMisses: number;
  avgLatencyMs: number;
  servfail: number;
  nxdomain: number;
  refused: number;
  noerror: number;
  instance: string;
}

export interface DnsTopDomain {
  domain: string;
  queryCount: number;
  queryType: string;
  lastSeen: string;
}

// Real API shape from /api/dns/instances
export interface DnsInstanceStats {
  // Real API fields (snake_case)
  name?: string;
  instance?: string;
  bind_ip?: string;
  port?: number;
  status?: string;
  queries_total?: number;
  cache_entries?: number;
  // Mock/rich fields (camelCase)
  totalQueries?: number;
  cacheHitRatio?: number;
  avgLatencyMs?: number;
  uptime?: string;
  threads?: number;
  currentConnections?: number;
}

// ---- Instance Health Check ----

export interface InstanceHealthResult {
  instance: string;
  bind_ip: string;
  port: number;
  healthy: boolean;
  resolved_ip: string;
  latency_ms: number;
  probe_domain: string;
  error: string | null;
  timestamp: number;
}

export interface InstanceHealthReport {
  healthy: number;
  total: number;
  all_healthy: boolean;
  degraded: boolean;
  down: boolean;
  instances: InstanceHealthResult[];
  vip?: InstanceHealthResult;
  timestamp: number;
}

// ---- NAT / nftables ----

export interface NftCounter {
  chain: string;
  rule: string;
  packets: number;
  bytes: number;
  backend: string;
}

export interface NftStickyEntry {
  sourceIp: string;
  backend: string;
  expires: number;
  packets: number;
}

// ---- OSPF / FRR ----

export interface OspfNeighbor {
  neighborId: string;
  priority: number;
  state: string;
  deadTime: string;
  address: string;
  interfaceName: string;
  area: string;
}

export interface OspfRoute {
  prefix: string;
  nextHop: string;
  device: string;
  cost: number;
  area: string;
  type: string;
}

// ---- Logs ----

export type LogSource = 'apply' | 'unbound' | 'frr' | 'nftables' | 'system';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug' | 'ok';

export interface LogEntry {
  id: string;
  timestamp: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  service: string | null;
}

// ---- Apply / History ----

export type ApplyStatus = 'success' | 'failed' | 'partial' | 'running' | 'dry-run';
export type ApplyScope = 'full' | 'dns' | 'network' | 'frr' | 'nftables';

export interface ApplyRequest {
  config: WizardConfig;
  scope: ApplyScope;
  dryRun: boolean;
  comment: string;
}

export interface ApplyResult {
  id: string;
  timestamp: string;
  user: string;
  status: ApplyStatus;
  scope: ApplyScope;
  dryRun: boolean;
  comment: string;
  steps: ApplyStep[];
  filesGenerated: GeneratedFile[];
  duration: number;
  configSnapshot: WizardConfig;
}

export interface ApplyStep {
  order: number;
  name: string;
  status: 'success' | 'failed' | 'skipped' | 'running' | 'pending';
  output: string;
  durationMs: number;
  command: string | null;
}

export interface GeneratedFile {
  path: string;
  content: string;
  permissions: string;
  owner: string;
  backupPath: string | null;
  changed: boolean;
}

// ---- Troubleshoot Commands ----

export interface DiagCommand {
  id: string;
  label: string;
  command: string;
  category: 'services' | 'network' | 'dns' | 'nat' | 'frr' | 'system';
  dangerous: boolean;
}

export interface DiagResult {
  commandId: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timestamp: string;
}

// ---- Config Profile ----

export interface ConfigProfile {
  id: string;
  name: string;
  description: string;
  config: WizardConfig;
  createdAt: string;
  updatedAt: string;
}

// ---- Config Diff ----

export interface ConfigDiff {
  path: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

// ---- Validation ----

export interface ValidationError {
  field: string;
  step: number;
  message: string;
  severity: 'error' | 'warning';
}

// ---- API Response Wrapper ----

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ---- Defaults ----

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

// ---- v2: Operational Types ----

export interface V2Event {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'critical';
  instance_id: string | null;
  message: string;
  details_json: string | null;
  created_at: string;
}

export interface V2MetricEntry {
  instance_id: string;
  instance_name: string;
  metric_name: string;
  metric_value: number;
  collected_at: string;
}

export interface V2Instance {
  id: string;
  instance_name: string;
  bind_ip: string;
  bind_port: number;
  outgoing_ip: string | null;
  control_port: number;
  current_status: 'healthy' | 'degraded' | 'failed' | 'withdrawn' | 'unknown';
  in_rotation: boolean;
  consecutive_failures: number;
  consecutive_successes: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_transition_at: string | null;
  reason: string | null;
  // v2.1 cooldown
  cooldown_remaining: number;
  last_reconciliation_at: string | null;
}

export interface V2Action {
  id: string;
  action_type: string;
  target_type: string;
  target_id: string | null;
  status: string;
  exit_code: number | null;
  trigger_source: string;
  stdout_log: string;
  stderr_log: string;
  created_at: string;
  finished_at: string | null;
}

export interface ReconcileSummary {
  instances_checked: number;
  instances_failed: number;
  backends_removed: number;
  backends_restored: number;
}

// ---- Helpers for normalizing real API data ----

/** Safely get instance display name from DnsInstanceStats (handles both real API and mock) */
export function getInstanceName(inst: DnsInstanceStats): string {
  return inst.instance || inst.name || 'unknown';
}

/** Safely get total queries from DnsInstanceStats */
export function getInstanceQueries(inst: DnsInstanceStats): number {
  return inst.totalQueries ?? inst.queries_total ?? 0;
}

/** Safely get cache hit ratio */
export function getInstanceCacheHit(inst: DnsInstanceStats): number {
  return inst.cacheHitRatio ?? 0;
}

/** Safely get avg latency */
export function getInstanceLatency(inst: DnsInstanceStats): number {
  return inst.avgLatencyMs ?? 0;
}

/** Get interface display state (handles both real 'status' and mock 'state') */
export function getIfaceState(iface: NetworkInterface): string {
  return iface.state || iface.status || 'UNKNOWN';
}

/** Get interface IPv4 addresses as array */
export function getIfaceIpv4(iface: NetworkInterface): string[] {
  if (iface.ipv4Addresses && iface.ipv4Addresses.length > 0) return iface.ipv4Addresses;
  if (iface.ipv4) return [iface.ipv4];
  return [];
}

/** Get interface IPv6 addresses as array */
export function getIfaceIpv6(iface: NetworkInterface): string[] {
  if (iface.ipv6Addresses && iface.ipv6Addresses.length > 0) return iface.ipv6Addresses;
  if (iface.ipv6) return [iface.ipv6];
  return [];
}

/** Get MAC address */
export function getIfaceMac(iface: NetworkInterface): string {
  return iface.macAddress || iface.mac || '';
}

/** Safe date formatting */
export function safeDate(dateStr: string | null | undefined, locale = 'pt-BR'): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(locale);
  } catch {
    return '—';
  }
}
