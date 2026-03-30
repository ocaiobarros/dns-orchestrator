// ============================================================
// DNS Control — Complete Type System
// ============================================================

// ---- Deployment Mode ----

export type DeploymentMode =
  | 'internal-recursive'
  | 'public-controlled'
  | 'pseudo-anycast-local'
  | 'anycast-frr-ospf'
  | 'anycast-frr-bgp'
  | 'vip-routed-border'
  | 'vip-local-dummy';

export type VipDeliveryMode = 'local-vip' | 'routed-vip' | 'firewall-delivered';

export type VipDistributionPolicy =
  | 'fixed-mapping'
  | 'round-robin'
  | 'sticky-source'
  | 'nth-balancing'
  | 'active-passive';

export type RoutingMode = 'static' | 'frr-ospf' | 'frr-bgp';

// ---- Service VIP ----

export type VipType = 'owned' | 'intercepted';

export interface ServiceVip {
  ipv4: string;
  ipv6: string;
  port: number;
  protocol: 'udp+tcp' | 'udp' | 'tcp';
  description: string;
  label: string;
  vipType: VipType;
  deliveryMode: VipDeliveryMode;
  healthCheckEnabled: boolean;
  healthCheckDomain: string;
  healthCheckInterval: number;
}

export type EgressMode = 'fixed-per-instance' | 'shared-pool' | 'randomized';

export type EgressDeliveryMode = 'host-owned' | 'border-routed';

// ---- VIP Interception / DNS Seizure ----

export type CaptureMode = 'dnat' | 'route' | 'bind';

export type VipInterceptionStatus =
  | 'INTERCEPTED_LOCAL'
  | 'INTERNET_ESCAPING'
  | 'NO_CAPTURE_RULE'
  | 'BACKEND_DOWN'
  | 'UNKNOWN';

export interface InterceptedVip {
  vipIp: string;
  vipIpv6: string;
  vipType: 'owned' | 'intercepted';
  captureMode: CaptureMode;
  backendInstance: string;
  backendTargetIp: string;
  description: string;
  expectedLocalLatencyMs: number;
  validationMode: 'strict' | 'relaxed';
  protocol: 'udp+tcp' | 'udp' | 'tcp';
  port: number;
}

// ---- DNS Instance (expanded) ----

export interface DnsInstance {
  name: string;
  bindIp: string;
  bindIpv6: string;
  publicListenerIp: string;
  controlInterface: string;
  controlPort: number;
  egressIpv4: string;
  egressIpv6: string;
}

// ---- Access Control ----

export interface AccessControlEntry {
  network: string;
  action: 'allow' | 'refuse' | 'deny' | 'allow_snoop';
  label: string;
}

// ---- Observability Config ----

export interface ObservabilityConfig {
  metricsPerVip: boolean;
  metricsPerInstance: boolean;
  metricsPerEgress: boolean;
  nftablesCounters: boolean;
  systemdStatus: boolean;
  healthChecks: boolean;
  latencyTracking: boolean;
  cacheHitTracking: boolean;
  recursionTimeTracking: boolean;
  operationalEvents: boolean;
}

// ---- Wizard Configuration ----

export interface WizardConfig {
  // Step 1 - Topologia do Host
  hostname: string;
  organization: string;
  project: string;
  description: string;
  timezone: string;
  mainInterface: string;
  ipv4Address: string;
  ipv4Cidr: string;
  ipv4Gateway: string;
  enableIpv6: boolean;
  ipv6Address: string;
  ipv6Gateway: string;
  vlanTag: string;
  behindFirewall: boolean;

  // Step 2 - Modelo de Publicação DNS
  deploymentMode: DeploymentMode;

  // Step 3 - VIPs de Serviço
  serviceVips: ServiceVip[];
  vipIpv6Enabled: boolean;

  // Step 3b - VIP Interception / DNS Seizure
  interceptedVips: InterceptedVip[];

  // Step 4 - Instâncias de Resolução (listeners + control)
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
  blocklistApiUrl: string;
  blocklistMode: 'always_nxdomain' | 'redirect_cname' | 'redirect_ip' | 'redirect_ip_dualstack';
  blocklistCnameTarget: string;
  blocklistRedirectIpv4: string;
  blocklistRedirectIpv6: string;
  blocklistSyncIntervalHours: number;
  blocklistAutoSync: boolean;
  blocklistValidateBeforeReload: boolean;
  blocklistAutoReload: boolean;
  dnsIdentity: string;
  dnsVersion: string;

  // Step 5 - Egress Público (outgoing-interface per instance)
  // (egress fields live on DnsInstance but are edited in step 5)
  egressFixedIdentity: boolean;
  egressMode: EgressMode;
  egressDeliveryMode: EgressDeliveryMode;
  egressSharedPool: string[];

  // Step 6 - Mapeamento VIP → Instância
  distributionPolicy: VipDistributionPolicy;
  stickyTimeout: number;
  vipMappings: { vipIndex: number; instanceIndex: number }[];

  // Step 7 - Roteamento
  routingMode: RoutingMode;
  routerId: string;
  ospfArea: string;
  ospfInterfaces: string[];
  redistributeConnected: boolean;
  ospfCost: number;
  networkType: 'point-to-point' | 'broadcast';

  // Step 8 - Segurança
  accessControlIpv4: AccessControlEntry[];
  accessControlIpv6: AccessControlEntry[];
  openResolverConfirmed: boolean;
  enableDnsProtection: boolean;
  enableAntiAmplification: boolean;
  recursionAllowed: boolean;
  authType: 'local' | 'pam';
  adminUser: string;
  adminPassword: string;
  panelBind: string;
  panelPort: number;
  allowedIps: string[];

  // Step 9 - Observabilidade
  observability: ObservabilityConfig;

  // Bootstrap DNS
  bootstrapDns: string;
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
  unboundVersion?: string;
  unbound_version?: string;
  frrVersion?: string;
  frr_version?: string;
  nftablesVersion?: string;
  nftables_version?: string;
  mainInterface?: string;
  primary_interface?: string;
  vipAnycast?: string;
  vip_anycast?: string;
  lastApply?: string | null;
  last_apply_at?: string | null;
  configVersion?: string;
  config_version?: string;
  cpuCount?: number;
  memoryTotalMb?: number;
  memoryUsedMb?: number;
  // Dashboard summary fields
  total_queries?: number;
  cache_hit_ratio?: number;
  active_services?: number;
  total_services?: number;
  ospf_neighbors_up?: number;
  ospf_neighbors_total?: number;
  nat_active_connections?: number;
  unbound_instances?: number;
  alerts?: any[];
  // DNS metrics from privileged unbound-control
  dns_metrics_available?: boolean;
  dns_metrics_status?: string;
  latency_ms?: number;
  // Availability metadata
  vip_anycast_available?: boolean;
  vip_anycast_status?: string;
  config_version_available?: boolean;
  config_version_status?: string;
  last_apply_available?: boolean;
  last_apply_status?: string;
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

export type ApplyStatus = 'success' | 'failed' | 'partial' | 'running' | 'dry-run' | 'rolled-back';
export type ApplyScope = 'full' | 'dns' | 'network' | 'frr' | 'nftables';

export interface ApplyRequest {
  config: WizardConfig;
  scope: ApplyScope;
  dryRun: boolean;
  comment: string;
}

export interface ApplyStep {
  order: number;
  name: string;
  status: 'success' | 'failed' | 'skipped' | 'running' | 'pending';
  output: string;
  durationMs: number;
  command: string | null;
  startedAt?: string;
  finishedAt?: string;
  rollbackHint?: string;
  stderr?: string;
}

export interface GeneratedFile {
  path: string;
  content: string;
  permissions: string;
  owner: string;
  backupPath: string | null;
  changed: boolean;
  diffStatus?: 'new' | 'changed' | 'unchanged';
  previousContent?: string;
}

export interface PostDeployCheck {
  name: string;
  target: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  durationMs: number;
}

export interface DeploymentRecord {
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
  configVersion: string;
  environment: string;
  changedFiles: string[];
  healthResult: PostDeployCheck[];
  rollbackAvailable: boolean;
  backupId: string | null;
}

export interface DeployValidationError {
  category: string;
  command: string | null;
  file: string | null;
  stderr: string;
  remediation?: string;
}

export interface DeployValidationResultItem {
  status: 'pass' | 'fail';
  file: string | null;
  command: string | null;
  stderr?: string;
  remediation?: string;
  details?: string;
}

export interface DeployValidationResults {
  unbound: DeployValidationResultItem[];
  nftables: DeployValidationResultItem[];
  network: DeployValidationResultItem[];
  ipCollision: DeployValidationResultItem[];
}

export interface ApplyResult extends DeploymentRecord {
  success?: boolean;
  validationErrors?: DeployValidationError[];
  validationResults?: DeployValidationResults;
}

export interface RollbackRequest {
  deploymentId: string;
  reason: string;
}

export interface RollbackResult {
  success: boolean;
  restoredFiles: string[];
  restartedServices: string[];
  steps: ApplyStep[];
  duration: number;
}

// ---- Deploy State (for dashboard) ----

export interface DeployState {
  configVersion: string;
  lastApplyAt: string | null;
  lastApplyOperator: string | null;
  lastApplyStatus: ApplyStatus | null;
  pendingChanges: boolean;
  lastDeploymentId: string | null;
  totalDeployments: number;
  rollbackAvailable: boolean;
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
  // Step 1 - Topologia do Host (vazio — operador preenche)
  hostname: '',
  organization: '',
  project: '',
  description: '',
  timezone: 'America/Sao_Paulo',
  mainInterface: '',
  ipv4Address: '',
  ipv4Cidr: '',
  ipv4Gateway: '',
  enableIpv6: false,
  ipv6Address: '',
  ipv6Gateway: '',
  vlanTag: '',
  behindFirewall: true,

  // Step 2 - Modelo de Publicação
  deploymentMode: 'vip-routed-border',

  // Step 3 - VIPs de Serviço
  serviceVips: [] as ServiceVip[],
  vipIpv6Enabled: false,

  // Step 3b - VIP Interception
  interceptedVips: [] as InterceptedVip[],

  // Step 4 - Instâncias de Resolução
  instanceCount: 2,
  instances: [
    { name: 'unbound01', bindIp: '', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.11', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
    { name: 'unbound02', bindIp: '', bindIpv6: '', publicListenerIp: '', controlInterface: '127.0.0.12', controlPort: 8953, egressIpv4: '', egressIpv6: '' },
  ],
  threads: 4,
  msgCacheSize: '512m',
  rrsetCacheSize: '32m',
  keyCacheSize: '256m',
  minTtl: 60,
  maxTtl: 7200,
  rootHintsPath: '/etc/unbound/named.cache',
  enableDetailedLogs: false,
  enableBlocklist: false,
  blocklistApiUrl: 'https://api.anablock.net.br',
  blocklistMode: 'always_nxdomain' as const,
  blocklistCnameTarget: '',
  blocklistRedirectIpv4: '',
  blocklistRedirectIpv6: '',
  blocklistSyncIntervalHours: 6,
  blocklistAutoSync: true,
  blocklistValidateBeforeReload: true,
  blocklistAutoReload: true,
  dnsIdentity: '',
  dnsVersion: '1.0',

  // Step 5 - Egress Público
  egressFixedIdentity: true,
  egressMode: 'fixed-per-instance' as EgressMode,
  egressDeliveryMode: 'border-routed' as EgressDeliveryMode,
  egressSharedPool: [],

  // Step 6 - Mapeamento VIP → Instância
  distributionPolicy: 'sticky-source',
  stickyTimeout: 1200,
  vipMappings: [],

  // Step 7 - Roteamento
  routingMode: 'static',
  routerId: '',
  ospfArea: '0.0.0.0',
  ospfInterfaces: [],
  redistributeConnected: true,
  ospfCost: 10,
  networkType: 'point-to-point',

  // Step 8 - Segurança
  accessControlIpv4: [
    { network: '127.0.0.0/8', action: 'allow', label: 'Loopback' },
  ],
  accessControlIpv6: [],
  openResolverConfirmed: false,
  enableDnsProtection: true,
  enableAntiAmplification: true,
  recursionAllowed: true,
  authType: 'local',
  adminUser: 'admin',
  adminPassword: '',
  panelBind: '127.0.0.1',
  panelPort: 8443,
  allowedIps: [],

  // Step 9 - Observabilidade
  observability: {
    metricsPerVip: true,
    metricsPerInstance: true,
    metricsPerEgress: true,
    nftablesCounters: true,
    systemdStatus: true,
    healthChecks: true,
    latencyTracking: true,
    cacheHitTracking: true,
    recursionTimeTracking: true,
    operationalEvents: true,
  },

  // Bootstrap DNS
  bootstrapDns: '8.8.8.8',
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

function toSafeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Safely get instance display name from DnsInstanceStats (handles both real API and mock) */
export function getInstanceName(inst: DnsInstanceStats): string {
  return inst.instance || inst.name || 'unknown';
}

/** Safely get total queries from DnsInstanceStats */
export function getInstanceQueries(inst: DnsInstanceStats): number {
  return toSafeNumber(inst.totalQueries ?? inst.queries_total, 0);
}

/** Safely get cache hit ratio */
export function getInstanceCacheHit(inst: DnsInstanceStats): number {
  return toSafeNumber(inst.cacheHitRatio, 0);
}

/** Safely get avg latency */
export function getInstanceLatency(inst: DnsInstanceStats): number {
  return toSafeNumber(inst.avgLatencyMs, 0);
}

/** Get interface display state (handles both real 'status' and mock 'state') */
export function getIfaceState(iface: NetworkInterface): string {
  return iface.state || iface.status || 'UNKNOWN';
}

/** Get interface IPv4 addresses as array */
export function getIfaceIpv4(iface: NetworkInterface): string[] {
  if (Array.isArray(iface.ipv4Addresses) && iface.ipv4Addresses.length > 0) return iface.ipv4Addresses.filter(Boolean);
  if (iface.ipv4) return [iface.ipv4];
  return [];
}

/** Get interface IPv6 addresses as array */
export function getIfaceIpv6(iface: NetworkInterface): string[] {
  if (Array.isArray(iface.ipv6Addresses) && iface.ipv6Addresses.length > 0) return iface.ipv6Addresses.filter(Boolean);
  if (iface.ipv6) return [iface.ipv6];
  return [];
}

/** Get MAC address */
export function getIfaceMac(iface: NetworkInterface): string {
  return iface.macAddress || iface.mac || '';
}

/** Safe date formatting — uses browser's local timezone automatically */
export function safeDate(dateStr: string | null | undefined, locale = 'pt-BR'): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(String(dateStr));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(locale);
  } catch {
    return '—';
  }
}

/** Safe date formatting — short time only, browser local timezone */
export function safeDateShort(dateStr: string | null | undefined, locale = 'pt-BR'): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(String(dateStr));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}
