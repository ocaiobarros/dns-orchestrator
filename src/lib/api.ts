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
  V2Event, V2MetricEntry, V2Instance, V2Action, ReconcileSummary,
} from './types';

export interface AuthUserRecord {
  id: string;
  username: string;
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
} from './mock-data';

// ---- Configuration ----

// Production: mocks are enabled only in development when API URL is not configured.
const IS_PREVIEW = import.meta.env.MODE === 'development' && !import.meta.env.VITE_API_URL;
const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

function normalizeApiPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function buildApiUrl(path: string): string {
  const normalizedPath = normalizeApiPath(path);
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  if (IS_PREVIEW) {
    return getMockResponse<T>(method, path, body);
  }

  const res = await fetch(buildApiUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${localStorage.getItem('dns-control-token') || ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

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
    apiCall<ApplyResult>('POST', '/deploy/apply', {
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
    apiCall<PaginatedResponse<ApplyResult>>('GET', `/history?page=${page}`),
  getHistoryEntry: (id: string) =>
    apiCall<ApplyResult>('GET', `/apply/jobs/${id}`),

  // Files
  getGeneratedFiles: () => apiCall<GeneratedFile[]>('GET', '/files/generated'),
  getFileContent: (path: string) => apiCall<{ path: string; content: string }>('GET', `/files/generated/${path}`),

  // Settings
  getSettings: () => apiCall<Record<string, string>>('GET', '/settings'),
  updateSettings: (settings: Record<string, string>) =>
    apiCall<{ success: boolean }>('PATCH', '/settings', { settings }),

  // Reports
  generateReport: () => apiCall<{ downloadUrl: string; html: string }>('POST', '/dashboard/summary'),

  // Users (admin)
  getUsers: () => apiCall<AuthUserRecord[]>('GET', '/users'),
  createUser: (username: string, password: string, mustChangePassword: boolean = true) =>
    apiCall<AuthUserRecord>('POST', '/users', { username, password, must_change_password: mustChangePassword }),
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
  removeBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/actions/remove-backend/${instanceId}`),
  restoreBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/actions/restore-backend/${instanceId}`),
  reconcileNow: () =>
    apiCall<ReconcileSummary>('POST', '/actions/reconcile-now'),
  getSchedulerStatus: () =>
    apiCall<{ running: boolean; jobs: Array<{ id: string; name: string; next_run: string | null }> }>('GET', '/health'),
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

  // Apply
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

  return {};
}

function mockUsers(): AuthUserRecord[] {
  return [
    { id: 'usr-001', username: 'admin', isActive: true, mustChangePassword: false, createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-03-10T08:00:00Z', lastLoginAt: '2026-03-11T09:30:00Z' },
    { id: 'usr-002', username: 'operador', isActive: true, mustChangePassword: false, createdAt: '2026-02-20T14:00:00Z', updatedAt: '2026-03-08T12:00:00Z', lastLoginAt: '2026-03-10T16:45:00Z' },
    { id: 'usr-003', username: 'auditor', isActive: false, mustChangePassword: true, createdAt: '2026-03-01T09:00:00Z', updatedAt: '2026-03-05T11:00:00Z', lastLoginAt: null },
  ];
}

function mockApplyResult(req?: { dry_run?: boolean; scope?: string }): ApplyResult {
  return {
    id: `apply-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: 'admin',
    status: req?.dry_run ? 'dry-run' : 'success',
    scope: (req?.scope as ApplyResult['scope']) || 'full',
    dryRun: req?.dry_run || false,
    comment: '',
    duration: 8500,
    configSnapshot: {} as WizardConfig,
    configVersion: 'v3',
    environment: 'production',
    changedFiles: ['/etc/unbound/unbound01.conf', '/etc/nftables.conf'],
    healthResult: [
      { name: 'unbound01 systemd status', target: 'unbound01', status: 'pass', detail: 'active', durationMs: 50 },
      { name: 'nftables rules loaded', target: 'nftables', status: 'pass', detail: 'table ip nat', durationMs: 30 },
    ],
    rollbackAvailable: !req?.dry_run,
    backupId: req?.dry_run ? null : `bk-${Date.now()}`,
    steps: [
      { order: 1, name: 'Validar modelo', status: 'success', output: 'Validação OK', durationMs: 120, command: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() },
      { order: 2, name: 'Gerar artefatos', status: 'success', output: '11 arquivos gerados', durationMs: 200, command: null },
      { order: 3, name: req?.dry_run ? 'Dry-run concluído' : 'Backup configuração', status: 'success', output: req?.dry_run ? 'Nenhuma alteração' : 'Backup salvo', durationMs: req?.dry_run ? 0 : 340, command: null },
      ...(!req?.dry_run ? [
        { order: 4, name: 'Gravar rede', status: 'success' as const, output: '3 arquivos de rede', durationMs: 80, command: null },
        { order: 5, name: 'Gravar Unbound', status: 'success' as const, output: '4 arquivos', durationMs: 100, command: null },
        { order: 6, name: 'Gravar nftables', status: 'success' as const, output: '12 arquivos', durationMs: 50, command: null },
        { order: 7, name: 'daemon-reload', status: 'success' as const, output: 'OK', durationMs: 300, command: 'systemctl daemon-reload' },
        { order: 8, name: 'Reiniciar unbound01', status: 'success' as const, output: 'OK', durationMs: 800, command: 'systemctl restart unbound01' },
        { order: 9, name: 'Aplicar nftables', status: 'success' as const, output: 'Ruleset loaded', durationMs: 300, command: 'nft -f /etc/nftables.conf' },
        { order: 10, name: 'Verificação pós-deploy', status: 'success' as const, output: '6/6 checks OK', durationMs: 1500, command: null },
      ] : []),
    ],
    filesGenerated: [],
  };
}
