// ============================================================
// DNS Control — API Client
// All backend communication goes through this module.
// In preview mode, returns mock data. In production, calls real endpoints.
// ============================================================

import type {
  ApiResponse, WizardConfig, SystemInfo, ServiceStatus,
  NetworkInterface, Route, ReachabilityResult, DnsMetrics,
  DnsTopDomain, DnsInstanceStats, NftCounter, NftStickyEntry,
  OspfNeighbor, OspfRoute, LogEntry, LogSource,
  ApplyRequest, ApplyResult, DiagCommand, DiagResult,
  ConfigProfile, ConfigDiff, GeneratedFile, PaginatedResponse,
  InstanceHealthReport, DeployState, RollbackResult, PostDeployCheck,
  V2Event, V2MetricEntry, V2Instance, V2Action, ReconcileSummary, SystemSelfTestResult,
} from './types';

export interface AuthUserRecord {
  id: string;
  username: string;
  role?: string;
  is_active?: boolean;
  isActive?: boolean;
  must_change_password?: boolean;
  mustChangePassword?: boolean;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  last_login_at?: string | null;
  lastLoginAt?: string | null;
}
import {
  mockSystemInfo, mockServices, mockInterfaces, mockRoutes,
  mockReachability, generateDnsMetrics, mockTopDomains,
  mockInstanceStats, mockNftCounters, mockStickyEntries,
  mockOspfNeighbors, mockOspfRoutes, mockLogs, mockDiagCommands,
  mockHistory, mockProfiles, mockDiagOutputs, mockInstanceHealth,
  mockV2Events, mockV2Metrics, mockV2Instances, mockV2Actions,
  mockVipDiagnostics,
} from './mock-data';

// ---- Configuration ----

// Production: mocks are enabled only in development when API URL is not configured.
const IS_PREVIEW = import.meta.env.MODE === 'development' && !import.meta.env.VITE_API_URL;
const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

function normalizeApiPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  if (normalized === '/api') return '/api';
  return normalized.startsWith('/api/') ? normalized : `/api${normalized}`;
}

function buildApiUrl(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  if (!API_BASE) return normalizedPath;

  const base = API_BASE.replace(/\/+$/, '');
  if (base.endsWith('/api')) {
    return `${base}${normalizedPath.replace(/^\/api/, '')}`;
  }
  return `${base}${normalizedPath}`;
}

function buildLegacyApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE) return normalizedPath;
  const baseWithoutApi = API_BASE.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${baseWithoutApi}${normalizedPath}`;
}

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  if (IS_PREVIEW) {
    return getMockResponse<T>(method, path, body);
  }

  const requestInit: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('dns-control-token') || ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  };

  let res = await fetch(buildApiUrl(path), requestInit);

  // Compatibility fallback for legacy backends exposing /deploy/* without /api prefix.
  if (!res.ok && res.status === 404) {
    const normalizedPath = normalizeApiPath(path);
    if (normalizedPath.startsWith('/api/deploy/')) {
      const legacyPath = normalizedPath.replace(/^\/api/, '');
      const legacyRes = await fetch(buildLegacyApiUrl(legacyPath), requestInit);
      if (legacyRes.ok || legacyRes.status !== 404) {
        res = legacyRes;
      }
    }
  }

  if (!res.ok) {
    const errorText = await res.text();
    return {
      success: false,
      data: null as unknown as T,
      error: `HTTP ${res.status}: ${errorText}`,
      timestamp: new Date().toISOString(),
    };
  }

  const data = await res.json();
  return {
    success: true,
    data: data as T,
    error: null,
    timestamp: new Date().toISOString(),
  };
}

// ---- Public API Methods ----
// Paths match backend routes in backend/app/main.py

export const api = {
  // Dashboard
  getSystemInfo: () => apiCall<SystemInfo>('GET', '/dashboard/summary'),
  getInstanceHealth: () => apiCall<InstanceHealthReport>('GET', '/healthcheck'),
  getInstanceRealStats: () => apiCall<DnsInstanceStats[]>('GET', '/dashboard/instance-stats'),
  getVipDiagnostics: () => apiCall<any>('GET', '/dashboard/vip-diagnostics'),

  // Services
  getServices: () => apiCall<ServiceStatus[]>('GET', '/services'),
  restartService: (name: string) => apiCall<{ success: boolean }>('POST', `/services/${name}/restart`),

  // Network
  getInterfaces: () => apiCall<NetworkInterface[]>('GET', '/network/interfaces'),
  getRoutes: () => apiCall<Route[]>('GET', '/network/routes'),
  checkReachability: () => apiCall<ReachabilityResult[]>('GET', '/network/reachability'),

  // DNS
  getDnsMetrics: (hours: number = 6, instance?: string) =>
    apiCall<DnsMetrics[]>('GET', `/dns/metrics?hours=${hours}${instance ? `&instance=${instance}` : ''}`),
  getTopDomains: (limit: number = 20) =>
    apiCall<DnsTopDomain[]>('GET', `/dns/top-domains?limit=${limit}`),
  getInstanceStats: () => apiCall<DnsInstanceStats[]>('GET', '/dns/instances'),

  // NAT / nftables
  getNftCounters: () => apiCall<NftCounter[]>('GET', '/nat/summary'),
  getStickyTable: () => apiCall<NftStickyEntry[]>('GET', '/nat/sticky'),
  getNftRuleset: () => apiCall<{ ruleset: string }>('GET', '/nat/ruleset'),

  // OSPF / FRR
  getOspfNeighbors: () => apiCall<OspfNeighbor[]>('GET', '/ospf/neighbors'),
  getOspfRoutes: () => apiCall<OspfRoute[]>('GET', '/ospf/routes'),
  getFrrRunningConfig: () => apiCall<{ config: string }>('GET', '/ospf/running-config'),

  // Logs
  getLogs: (source?: LogSource, search?: string, page: number = 1, pageSize: number = 100) =>
    apiCall<PaginatedResponse<LogEntry>>('GET',
      `/logs?page=${page}&page_size=${pageSize}${source ? `&source=${source}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  exportLogs: (source?: LogSource) =>
    apiCall<{ content: string; count: number }>('GET', `/logs/export${source ? `?source=${source}` : ''}`),

  // Troubleshooting
  getDiagCommands: () => apiCall<DiagCommand[]>('GET', '/troubleshooting/commands'),
  runDiagCommand: (commandId: string, args?: Record<string, string>) =>
    apiCall<DiagResult>('POST', '/troubleshooting/run', { command_id: commandId, args: args || {} }),
  runHealthCheck: () => apiCall<DiagResult[]>('GET', '/troubleshooting/health-check'),

  // Config Profiles
  getProfiles: () => apiCall<ConfigProfile[]>('GET', '/configs'),
  saveProfile: (profile: { name: string; description?: string; payload: Record<string, unknown> }) =>
    apiCall<ConfigProfile>('POST', '/configs', profile),
  getProfile: (id: string) => apiCall<ConfigProfile>('GET', `/configs/${id}`),
  updateProfile: (id: string, profile: { name: string; description?: string; payload: Record<string, unknown> }) =>
    apiCall<{ success: boolean }>('PATCH', `/configs/${id}`, profile),
  cloneProfile: (id: string) => apiCall<{ id: string; name: string }>('POST', `/configs/${id}/clone`),
  previewFiles: (id: string) => apiCall<GeneratedFile[]>('GET', `/configs/${id}/preview`),
  getConfigFiles: (id: string) => apiCall<GeneratedFile[]>('GET', `/configs/${id}/files`),
  getConfigDiff: (id: string, revA: string, revB: string) =>
    apiCall<ConfigDiff[]>('GET', `/configs/${id}/diff/${revA}/${revB}`),
  getConfigHistory: (id: string) => apiCall<unknown[]>('GET', `/configs/${id}/history`),
  deleteProfile: (id: string) => apiCall<void>('DELETE', `/configs/${id}`),

  // Config validation (standalone, without saved profile)
  getCurrentConfig: () => apiCall<WizardConfig>('GET', '/configs'),
  validateConfig: (config: WizardConfig) =>
    apiCall<{ valid: boolean; errors: Array<{ field: string; message: string }> }>('POST', '/configs', config),
  previewFilesFromConfig: (config: WizardConfig) =>
    apiCall<GeneratedFile[]>('POST', '/configs', config),

  // Apply / Deploy
  applyConfig: (request: ApplyRequest) =>
    apiCall<ApplyResult>('POST', `/deploy/apply`, {
      config: request.config,
      scope: request.scope || 'full',
      dry_run: request.dryRun,
      comment: request.comment,
    }),
  dryRunConfig: (request: ApplyRequest) =>
    apiCall<ApplyResult>('POST', '/deploy/dry-run', {
      config: request.config,
      scope: request.scope || 'full',
      dry_run: true,
      comment: request.comment,
    }),
  getApplyJobs: () => apiCall<ApplyResult[]>('GET', '/apply/jobs'),
  getApplyJob: (id: string) => apiCall<ApplyResult>('GET', `/apply/jobs/${id}`),

  // Deploy State
  getDeployState: () => apiCall<DeployState>('GET', '/deploy/state'),
  getDeployBackups: () =>
    apiCall<Array<{ backupId: string; timestamp: string; operator: string; fileCount: number; filePaths: string[] }>>('GET', '/deploy/backups'),
  rollback: (backupId: string, reason: string) =>
    apiCall<RollbackResult>('POST', '/deploy/rollback', { backup_id: backupId, reason }),

  // History
  getHistory: (page: number = 1) =>
    apiCall<PaginatedResponse<ApplyResult>>('GET', `/deploy/history?page=${page}`),
  getHistoryEntry: (id: string) =>
    apiCall<ApplyResult>('GET', `/deploy/history/${id}`),

  // Files
  getGeneratedFiles: () => apiCall<GeneratedFile[]>('GET', '/files/generated'),
  getFileContent: (path: string) => apiCall<{ path: string; content: string }>('GET', `/files/generated/${path}`),

  // Settings
  getSettings: () => apiCall<Record<string, string>>('GET', '/settings'),
  updateSettings: (settings: Record<string, string>) =>
    apiCall<{ success: boolean }>('PATCH', '/settings', { settings }),

  // System
  runSystemSelfTest: (credentials?: { username?: string; password?: string }) =>
    apiCall<SystemSelfTestResult>('POST', '/system/self-test', credentials || {}),

  // Reports
  generateReport: () => apiCall<{ downloadUrl: string; html: string }>('POST', '/dashboard/summary'),

  // Users (admin)
  getUsers: () => apiCall<AuthUserRecord[]>('GET', '/users'),
  createUser: (username: string, password: string, mustChangePassword: boolean = true, role: string = 'admin') =>
    apiCall<AuthUserRecord>('POST', '/users', { username, password, must_change_password: mustChangePassword, role }),
  toggleUser: (userId: string, active: boolean) =>
    apiCall<{ success: boolean }>('POST', `/users/${userId}/${active ? 'enable' : 'disable'}`),
  changeUserPassword: (userId: string, password: string) =>
    apiCall<{ success: boolean }>('POST', `/users/${userId}/change-password`, { password }),
  deleteUser: (userId: string) =>
    apiCall<void>('DELETE', `/users/${userId}`),

  // ---- v2: Events, Metrics, Actions, Instances ----
  getEvents: (severity?: string, limit: number = 100) =>
    apiCall<{ items: V2Event[]; total: number }>('GET', `/events${severity ? `?severity=${severity}` : ''}${severity ? '&' : '?'}limit=${limit}`),
  getV2Metrics: () =>
    apiCall<V2MetricEntry[]>('GET', '/metrics/dns'),
  getV2Instances: () =>
    apiCall<V2Instance[]>('GET', '/health/instances'),
  getV2Actions: () =>
    apiCall<V2Action[]>('GET', '/actions'),
  // Telemetry (collector service)
  getTelemetryLatest: () => apiCall<any>('GET', '/telemetry/latest'),
  getTelemetryStatus: () => apiCall<any>('GET', '/telemetry/status'),
  getTelemetryHistory: () => apiCall<any[]>('GET', '/telemetry/history'),

  // Kiosk (NOC TV)
  getKioskSummary: () => apiCall<any>('GET', '/kiosk/summary'),

  removeBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/actions/remove-backend/${instanceId}`),
  restoreBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/actions/restore-backend/${instanceId}`),
  reconcileNow: () =>
    apiCall<ReconcileSummary>('POST', '/actions/reconcile-now'),
  getSchedulerStatus: () =>
    apiCall<{ running: boolean; jobs: Array<{ id: string; name: string; next_run: string | null }> }>('GET', '/health'),
  importHostState: () =>
    apiCall<any>('GET', '/config/import-host'),

  // Import mode (read-only infrastructure adoption)
  getServiceMode: () =>
    apiCall<{ service_mode: string; import_timestamp?: string; imported_vips?: any[]; inventory_summary?: { instances: number; vips: number; dnat_rules: number; listeners: number } }>('GET', '/config/service-mode'),
  executeImport: () =>
    apiCall<any>('POST', '/config/import'),
  clearImport: () =>
    apiCall<{ success: boolean; mode: string }>('DELETE', '/config/import'),

  // Observed mode (runtime discovery)
  setServiceMode: (mode: string) =>
    apiCall<{ mode: string }>('POST', '/config/service-mode', { mode }),
  getRuntimeInventory: () =>
    apiCall<any>('GET', '/inventory/full'),
  syncRuntimeInstances: () =>
    apiCall<any>('POST', '/inventory/sync'),
  dryRunStaging: (config: any) =>
    apiCall<any>('POST', '/config/dry-run-staging', { config }),

  // DNS Error Metrics
  getDnsErrorSummary: (minutes: number = 60) =>
    apiCall<any>('GET', `/metrics/dns/errors/summary?minutes=${minutes}`),
  getDnsErrorsLive: (since: number = 60) =>
    apiCall<any>('GET', `/metrics/dns/errors/live?since=${since}`),
  getDnsErrorStats: () =>
    apiCall<any>('GET', '/metrics/dns/errors/stats'),
  getDnstapStatus: () =>
    apiCall<any>('GET', '/metrics/dns/errors/dnstap/status'),
  getDnstapEvents: (limit: number = 100) =>
    apiCall<any[]>('GET', `/metrics/dns/errors/dnstap/events?limit=${limit}`),
  getDnstapSummary: () =>
    apiCall<any>('GET', '/metrics/dns/errors/dnstap/summary'),
};

// ---- Mock Response Router ----

function getMockResponse<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  return new Promise(resolve => {
    const delay = 200 + Math.random() * 300;
    setTimeout(() => {
      const data = routeMock(method, normalizeMockPath(path), body);
      resolve({
        success: true,
        data: data as T,
        error: null,
        timestamp: new Date().toISOString(),
      });
    }, delay);
  });
}

function normalizeMockPath(path: string): string {
  const normalized = normalizeApiPath(path);
  return normalized.startsWith('/api/') ? normalized : `/api${normalized}`;
}

function routeMock(method: string, path: string, body?: unknown): unknown {
  // Dashboard
  if (path === '/api/dashboard/summary') return mockSystemInfo;
  if (path === '/api/healthcheck') return mockInstanceHealth();
  if (path === '/api/dashboard/instance-stats') return mockInstanceStats;
  if (path === '/api/dashboard/vip-diagnostics') return mockVipDiagnostics();

  // Services
  if (path === '/api/services' && method === 'GET') return mockServices;
  if (path.match(/\/api\/services\/.*\/restart/)) return { success: true };

  // Network
  if (path === '/api/network/interfaces') return mockInterfaces;
  if (path === '/api/network/routes') return mockRoutes;
  if (path === '/api/network/reachability') return mockReachability;

  // DNS
  if (path.startsWith('/api/dns/metrics')) return generateDnsMetrics(6);
  if (path.startsWith('/api/dns/top-domains')) return mockTopDomains;
  if (path === '/api/dns/instances') return mockInstanceStats;

  // NAT
  if (path === '/api/nat/summary') return mockNftCounters;
  if (path === '/api/nat/sticky') return mockStickyEntries;
  if (path === '/api/nat/ruleset') return { ruleset: 'table ip nat { ... }' };

  // OSPF
  if (path === '/api/ospf/neighbors') return mockOspfNeighbors;
  if (path === '/api/ospf/routes') return mockOspfRoutes;
  if (path === '/api/ospf/running-config') return { config: '! FRR running config...' };

  // Logs
  if (path.startsWith('/api/logs') && !path.includes('export')) {
    const source = new URL('http://x' + path).searchParams.get('source') as LogSource | null;
    const filtered = source ? mockLogs.filter(l => l.source === source) : mockLogs;
    return { items: filtered, total: filtered.length, page: 1, pageSize: 100, hasMore: false };
  }
  if (path.startsWith('/api/logs/export')) {
    return { content: mockLogs.map(l => `${l.timestamp} [${l.level}] ${l.message}`).join('\n'), count: mockLogs.length };
  }

  // Troubleshooting
  if (path === '/api/troubleshooting/commands') return mockDiagCommands;
  if (path === '/api/troubleshooting/run' && method === 'POST') {
    const b = body as { command_id: string } | undefined;
    const cmdId = b?.command_id || '';
    return mockDiagOutputs[cmdId] || { commandId: cmdId, exitCode: 0, stdout: 'OK', stderr: '', durationMs: 50, timestamp: new Date().toISOString() };
  }
  if (path === '/api/troubleshooting/health-check') return Object.values(mockDiagOutputs);

  // Config profiles
  if (path === '/api/configs' && method === 'GET') return mockProfiles;
  if (path === '/api/configs' && method === 'POST') {
    const { DEFAULT_CONFIG } = require('./types');
    return { valid: true, errors: [], id: `cfg-${Date.now()}`, name: 'New Config', payload: body || DEFAULT_CONFIG };
  }

  // Apply / Deploy
  if (path.startsWith('/api/deploy/')) {
    if (path === '/api/deploy/state') return mockDeployState();
    if (path === '/api/deploy/backups') return mockDeployBackups();
    if (path === '/api/deploy/rollback' && method === 'POST') return mockRollbackResult();
    if (path === '/api/deploy/apply' && method === 'POST') return mockApplyResult(body as any);
    if (path === '/api/deploy/dry-run' && method === 'POST') return mockApplyResult({ ...(body as any), dry_run: true });
    if (path.startsWith('/api/deploy/history')) {
      if (path === '/api/deploy/history') return { items: mockHistory, total: mockHistory.length, page: 1, pageSize: 20, hasMore: false };
      return mockHistory[0]; // detail view
    }
    return {};
  }
  if (path.startsWith('/api/apply/')) {
    if (path.includes('/jobs')) {
      if (path === '/api/apply/jobs') return mockHistory;
      return mockHistory[0];
    }
    return mockApplyResult(body as { dry_run?: boolean; scope?: string });
  }

  // History
  if (path.startsWith('/api/history')) {
    return { items: mockHistory, total: mockHistory.length, page: 1, pageSize: 20, hasMore: false };
  }

  // Files
  if (path === '/api/files/generated') return [];
  if (path.startsWith('/api/files/generated/')) return { path: '', content: '' };

  // Settings
  if (path === '/api/settings' && method === 'GET') return {};
  if (path === '/api/settings' && method === 'PATCH') return { success: true };

  // Users
  if (path === '/api/users' && method === 'GET') return mockUsers();
  if (path === '/api/users' && method === 'POST') {
    const b = body as { username: string };
    return { id: `usr-${Date.now()}`, username: b.username, isActive: true, mustChangePassword: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLoginAt: null };
  }
  if (path.match(/\/api\/users\/.*\/change-password/)) return { success: true };
  if (path.match(/\/api\/users\/.*\/(enable|disable)/)) return { success: true };
  if (path.match(/\/api\/users\//) && method === 'PATCH') return { success: true };
  if (path.match(/\/api\/users\//) && method === 'DELETE') return undefined;

  // v2: Events
  if (path.startsWith('/api/events')) return mockV2Events();

  // v2: Metrics
  if (path === '/api/metrics/dns') return mockV2Metrics();

  // v2: Health instances
  if (path === '/api/health/instances') return mockV2Instances();

  // v2: Actions
  if (path === '/api/actions' && method === 'GET') return mockV2Actions();
  if (path.match(/\/api\/actions\/(remove|restore)-backend/)) return { success: true };
  if (path === '/api/actions/reconcile-now' && method === 'POST') return { instances_checked: 4, instances_failed: 0, backends_removed: 0, backends_restored: 0 };

  // Service mode & inventory mocks
  if (path === '/api/config/service-mode' && method === 'GET') return { service_mode: 'managed' };
  if (path === '/api/config/service-mode' && method === 'POST') return { mode: (body as any)?.mode ?? 'managed' };
  if (path === '/api/inventory/full') return { collected_at: new Date().toISOString(), instances: [], vips: [], dnat_rules: [], sticky_sets: [], listeners: [], vip_backend_map: {}, instance_count: 0, vip_count: 0, dnat_rule_count: 0, listener_count: 0 };
  if (path === '/api/inventory/sync' && method === 'POST') return { discovered: 0, created: 0, updated: 0, unchanged: 0, instances: [] };

  // DNS Error mocks
  if (path.startsWith('/api/metrics/dns/errors/summary')) return { rcode_counts: { SERVFAIL: 12, NXDOMAIN: 45, REFUSED: 3 }, total_errors: 60, top_error_domains: [{ domain: 'malware.example.com', count: 15 }, { domain: 'blocked.ad.net', count: 12 }, { domain: 'nonexist.test', count: 8 }], top_error_clients: [{ ip: '192.168.1.50', count: 20 }, { ip: '10.0.0.33', count: 15 }], top_error_instances: [{ instance: 'unbound01', count: 30 }, { instance: 'unbound02', count: 30 }], error_timeline: [], source: 'mock', period_minutes: 60 };
  if (path.startsWith('/api/metrics/dns/errors/live')) return { errors: [], rcode_counts: { SERVFAIL: 2, NXDOMAIN: 8 }, total_errors: 10, top_error_domains: [], top_error_clients: [], source: 'mock' };
  if (path.startsWith('/api/metrics/dns/errors/stats')) return { rcode_counts: { SERVFAIL: 100, NXDOMAIN: 500, REFUSED: 20, NOERROR: 50000 }, total_errors: 620, total_queries: 50620, error_rate_pct: 1.22, source: 'unbound-control', fidelity: 'aggregate' };
  if (path.startsWith('/api/metrics/dns/errors/dnstap/status')) return { enabled: false, status: 'not_configured', fidelity: 'unavailable', message: 'dnstap collector not running' };
  if (path.startsWith('/api/metrics/dns/errors/dnstap/events')) return [];
  if (path.startsWith('/api/metrics/dns/errors/dnstap/summary')) return { status: 'not_configured', source: 'dnstap', fidelity: 'unavailable' };

  // Telemetry mock
  if (path === '/api/telemetry/latest') return mockTelemetryLatest();
  if (path === '/api/telemetry/status') return { collector_status: 'ok', last_update: new Date().toISOString(), file_age_seconds: 5, stale: false, mode: 'recursive_simple' };
  if (path === '/api/telemetry/history') return mockTelemetryHistoryData();

  // Import
  if (path === '/api/config/import' && method === 'POST') return { success: true, mode: 'imported', discovery: { instances: [], vip_mappings: [], dns_listeners: [] }, audit: [], errors: [] };
  if (path === '/api/config/import' && method === 'DELETE') return { success: true, mode: 'managed' };
  if (path === '/api/config/import-host') return { hostname: 'mock-host', instances: [], instanceCount: 0, network: { interfaces: [], listeners: [] } };

  // Kiosk
  if (path === '/api/kiosk/summary') return mockKioskSummary();

  // System
  if (path === '/api/system/self-test' && method === 'POST') {
    return {
      overall: 'ok',
      passed: 4,
      warned: 0,
      failed: 0,
      checks: [
        { name: 'systemd_active', status: 'pass', detail: 'dns-control-api.service ativo', duration_ms: 18 },
        { name: 'api_health', status: 'pass', detail: 'status=ok', duration_ms: 24 },
        { name: 'database_access', status: 'pass', detail: 'users=1', duration_ms: 7 },
        { name: 'login_functional', status: 'pass', detail: 'login OK para admin', duration_ms: 49 },
      ],
    };
  }

  return {};
}

function mockTelemetryLatest() {
  return {
    mode: 'recursive_simple',
    timestamp: new Date().toISOString(),
    epoch: Math.floor(Date.now() / 1000),
    frontend: { ip: '172.250.40.100', port: 53, healthy: true },
    resolver: {
      total_queries: 1284, cache_hits: 920, cache_misses: 364,
      cache_hit_ratio: 71.6, avg_latency_ms: 4.2, servfail: 2, nxdomain: 14,
      qps: 12.4, instances_live: 2, instances_total: 2, source: 'unbound-control',
    },
    traffic: { total_packets: 1284, total_bytes: 84521, qps: 12.4, available: true, source: 'nftables' },
    backends: [
      {
        name: 'unbound01', ip: '100.127.255.101', healthy: true,
        resolver: { total_queries: 612, cache_hits: 440, cache_misses: 172, cache_hit_ratio: 71.9, recursion_avg_ms: 3.8, servfail: 1, nxdomain: 7, noerror: 604, refused: 0, uptime_seconds: 86400, source: 'unbound-control' },
        traffic: { packets: 612, bytes: 40123, share: 47.6, source: 'nftables' },
      },
      {
        name: 'unbound02', ip: '100.127.255.102', healthy: true,
        resolver: { total_queries: 672, cache_hits: 480, cache_misses: 192, cache_hit_ratio: 71.4, recursion_avg_ms: 4.6, servfail: 1, nxdomain: 7, noerror: 664, refused: 0, uptime_seconds: 86400, source: 'unbound-control' },
        traffic: { packets: 672, bytes: 44398, share: 52.4, source: 'nftables' },
      },
    ],
    top_domains: [
      { domain: 'google.com', count: 120 }, { domain: 'youtube.com', count: 98 },
      { domain: 'cloudflare.com', count: 64 }, { domain: 'github.com', count: 42 },
      { domain: 'uol.com.br', count: 38 },
    ],
    top_clients: [
      { ip: '172.250.40.10', queries: 300 }, { ip: '172.250.40.11', queries: 210 },
      { ip: '172.250.40.12', queries: 150 },
    ],
    recent_queries: [
      { time: '13:40:01', client: '172.250.40.10', domain: 'uol.com.br', type: 'A' },
      { time: '13:40:02', client: '172.250.40.11', domain: 'google.com', type: 'A' },
      { time: '13:40:03', client: '172.250.40.10', domain: 'youtube.com', type: 'AAAA' },
    ],
    query_analytics: { log_source: 'journalctl', queries_parsed: 1284 },
    health: { collector: 'ok', last_update: new Date().toISOString(), collection_duration_ms: 280 },
  };
}

function mockDeployState(): DeployState & Record<string, unknown> {
  return {
    configVersion: 'v3',
    lastApplyAt: '2026-03-10T14:30:00Z',
    lastApplyOperator: 'admin',
    lastApplyStatus: 'success',
    pendingChanges: false,
    lastDeploymentId: 'apply-001',
    totalDeployments: 3,
    rollbackAvailable: true,
    // Live polling fields
    phase: 'idle',
    currentStep: null,
    completedSteps: 0,
    totalSteps: 0,
    lastMessage: '',
  };
}

function mockDeployBackups() {
  return [
    { backupId: 'bk-20260310_143000_apply-001', timestamp: '2026-03-10T14:30:00Z', operator: 'admin', fileCount: 11, filePaths: ['/etc/unbound/unbound01.conf', '/etc/nftables.conf'], deployId: 'apply-001' },
    { backupId: 'bk-20260308_091500_apply-002', timestamp: '2026-03-08T09:15:00Z', operator: 'admin', fileCount: 3, filePaths: ['/etc/network/interfaces'], deployId: 'apply-002' },
  ];
}

function mockRollbackResult(): RollbackResult {
  return {
    success: true,
    restoredFiles: ['/etc/unbound/unbound01.conf', '/etc/unbound/unbound02.conf', '/etc/nftables.conf'],
    restartedServices: ['unbound01', 'unbound02', 'nftables'],
    steps: [
      { order: 1, name: 'Restaurar arquivos', status: 'success', output: '3 arquivos restaurados', durationMs: 200, command: null },
      { order: 2, name: 'daemon-reload', status: 'success', output: 'OK', durationMs: 300, command: 'systemctl daemon-reload' },
      { order: 3, name: 'Reiniciar unbound01', status: 'success', output: 'OK', durationMs: 800, command: 'systemctl restart unbound01' },
      { order: 4, name: 'Reiniciar nftables', status: 'success', output: 'OK', durationMs: 200, command: 'nft -f /etc/nftables.conf' },
    ],
    duration: 1500,
  };
}




function mockUsers(): AuthUserRecord[] {
  return [
    { id: 'usr-001', username: 'admin', role: 'admin', isActive: true, mustChangePassword: false, createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-03-10T08:00:00Z', lastLoginAt: '2026-03-11T09:30:00Z' },
    { id: 'usr-002', username: 'operador', role: 'admin', isActive: true, mustChangePassword: false, createdAt: '2026-02-20T14:00:00Z', updatedAt: '2026-03-08T12:00:00Z', lastLoginAt: '2026-03-10T16:45:00Z' },
    { id: 'usr-003', username: 'viewer', role: 'viewer', isActive: true, mustChangePassword: false, createdAt: '2026-03-01T09:00:00Z', updatedAt: '2026-03-05T11:00:00Z', lastLoginAt: null },
    { id: 'usr-004', username: 'auditor', role: 'admin', isActive: false, mustChangePassword: true, createdAt: '2026-03-01T09:00:00Z', updatedAt: '2026-03-05T11:00:00Z', lastLoginAt: null },
  ];
}

function mockApplyResult(req?: { dry_run?: boolean; scope?: string; config?: WizardConfig }): ApplyResult {
  const cfg = req?.config;
  const instanceNames = cfg?.instances?.map(i => i.name) || ['unbound01', 'unbound02'];
  const vipIps = cfg?.serviceVips?.map(v => v.ipv4).filter(Boolean) || [];
  const now = new Date();
  type Step = ApplyResult['steps'][number];

  const baseSteps: Step[] = [
    { order: 1, name: 'Validar modelo', status: 'success' as const, output: 'Validação OK — 0 erros, 0 avisos', durationMs: 120, command: null, startedAt: now.toISOString(), finishedAt: now.toISOString() },
    { order: 2, name: 'Gerar artefatos', status: 'success' as const, output: `${cfg ? 10 + instanceNames.length * 2 : 11} arquivos gerados`, durationMs: 200, command: null },
    { order: 3, name: req?.dry_run ? 'Dry-run concluído' : 'Backup configuração atual', status: 'success' as const, output: req?.dry_run ? 'Nenhuma alteração aplicada' : `Snapshot salvo em /var/lib/dns-control/backups/${now.toISOString().slice(0,19).replace(/[:-]/g,'')}`, durationMs: req?.dry_run ? 0 : 340, command: null, rollbackHint: 'Restaurar backup anterior' },
  ];

  const applySteps: Step[] = req?.dry_run ? [] : [
    { order: 4, name: 'Gravar rede (/etc/network/*)', status: 'success' as const, output: '2 arquivos: interfaces, post-up.sh', durationMs: 80, command: null },
    { order: 5, name: `Gravar Unbound (${instanceNames.length} instâncias)`, status: 'success' as const, output: instanceNames.map(n => `${n}.conf`).join(', '), durationMs: 100, command: null },
    { order: 6, name: 'Gravar nftables (modular)', status: 'success' as const, output: 'DNAT + sticky sets + nth balancing', durationMs: 50, command: null },
    { order: 7, name: 'Gravar sysctl', status: 'success' as const, output: 'Tuning de rede, conntrack, kernel', durationMs: 30, command: null },
    { order: 8, name: 'daemon-reload', status: 'success' as const, output: 'OK', durationMs: 300, command: 'systemctl daemon-reload', startedAt: now.toISOString(), finishedAt: now.toISOString() },
    ...instanceNames.map((name, i) => ({
      order: 9 + i, name: `Reiniciar ${name}`, status: 'success' as const, output: `active (running) pid ${1234 + i}`, durationMs: 600 + Math.floor(Math.random() * 400),
      command: `systemctl restart ${name}`, startedAt: now.toISOString(), finishedAt: now.toISOString(), rollbackHint: `systemctl restart ${name} (restore config first)`,
    })),
    { order: 9 + instanceNames.length, name: 'Aplicar nftables', status: 'success' as const, output: 'Ruleset loaded', durationMs: 300, command: 'nft -f /etc/nftables.conf' },
    { order: 10 + instanceNames.length, name: 'Verificação pós-deploy', status: 'success' as const, output: `${2 + instanceNames.length + vipIps.length}/${2 + instanceNames.length + vipIps.length} checks OK`, durationMs: 1500, command: null },
  ];

  const healthChecks: PostDeployCheck[] = req?.dry_run ? [] : [
    ...instanceNames.map(name => ({
      name: `${name} systemd status`, target: name, status: 'pass' as const, detail: 'active (running)', durationMs: 50,
    })),
    ...instanceNames.map(name => ({
      name: `${name} DNS probe`, target: name, status: 'pass' as const, detail: 'google.com → 142.250.79.46', durationMs: 3 + Math.floor(Math.random() * 8),
    })),
    ...vipIps.map(ip => ({
      name: `VIP ${ip} reachability`, target: ip, status: 'pass' as const, detail: `dig @${ip} google.com → OK`, durationMs: 4 + Math.floor(Math.random() * 6),
    })),
    { name: 'nftables rules loaded', target: 'nftables', status: 'pass', detail: 'table ip nat { PREROUTING, chains OK }', durationMs: 30 },
    { name: 'Control interfaces reachable', target: 'unbound-control', status: 'pass', detail: `${instanceNames.length}/${instanceNames.length} responding`, durationMs: 100 },
  ];

  return {
    id: `apply-${Date.now()}`,
    timestamp: now.toISOString(),
    user: 'admin',
    status: req?.dry_run ? 'dry-run' : 'success',
    scope: (req?.scope as ApplyResult['scope']) || 'full',
    dryRun: req?.dry_run || false,
    comment: '',
    duration: baseSteps.concat(applySteps).reduce((sum, s) => sum + s.durationMs, 0),
    configSnapshot: (cfg || {}) as WizardConfig,
    configVersion: `v${Math.floor(Math.random() * 10) + 3}`,
    environment: 'production',
    changedFiles: [
      ...instanceNames.map(n => `/etc/unbound/${n}.conf`),
      '/etc/nftables.conf',
      '/etc/network/interfaces',
      '/etc/network/post-up.sh',
    ],
    healthResult: healthChecks,
    rollbackAvailable: !req?.dry_run,
    backupId: req?.dry_run ? null : `bk-${now.toISOString().slice(0,19).replace(/[:-]/g, '')}`,
    steps: ([...baseSteps, ...applySteps] as ApplyResult['steps']),
    filesGenerated: [],
  };
}

function mockTelemetryHistoryData() {
  const now = Date.now();
  return Array.from({ length: 30 }, (_, i) => {
    const t = new Date(now - (29 - i) * 10000);
    return {
      timestamp: t.toISOString(),
      epoch: Math.floor(t.getTime() / 1000),
      qps: Math.round(80 + Math.random() * 40),
      latency_ms: +(5 + Math.random() * 10).toFixed(2),
      cache_hit_ratio: +(85 + Math.random() * 10).toFixed(1),
      servfail: Math.floor(Math.random() * 5),
      nxdomain: Math.floor(Math.random() * 20),
      total_queries: 150000 + i * 1000,
      cache_hits: 130000 + i * 900,
      cache_misses: 20000 + i * 100,
      instances_live: 2,
      nft_qps: Math.round(70 + Math.random() * 30),
      nft_packets: 500000 + i * 5000,
    };
  });
}

function mockKioskSummary() {
  const tel = mockTelemetryLatest();
  return {
    timestamp: new Date().toISOString(),
    host: {
      hostname: 'dnscontrol',
      uptime_seconds: 345600,
      uptime_display: '4d 0h 0m',
      load_1m: 0.42,
      load_5m: 0.38,
      load_15m: 0.35,
      cpu_count: 8,
      cpu_percent: 5.3,
      ram_total_mb: 16384,
      ram_used_mb: 4200,
      ram_percent: 25.6,
      disk_total_gb: 100.0,
      disk_used_gb: 22.4,
      disk_percent: 22.4,
      services: {
        'dns-control-api': 'active',
        'nginx': 'active',
        'unbound01': 'active',
        'unbound02': 'active',
        'dns-control-collector.timer': 'active',
        'nftables': 'active',
      },
      timezone: 'BRT',
      primary_ip: '172.29.22.6',
    },
    operation_mode: 'Recursivo Simples',
    dns: {
      frontend: tel.frontend,
      resolver: tel.resolver,
      traffic: tel.traffic,
      backends: tel.backends,
      top_domains: tel.top_domains,
      top_clients: tel.top_clients,
      recent_queries: tel.recent_queries,
      health: tel.health,
    },
    history: mockTelemetryHistoryData(),
  };
}
