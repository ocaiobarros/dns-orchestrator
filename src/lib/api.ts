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
  InstanceHealthReport,
  V2Event, V2MetricEntry, V2Instance, V2Action,
} from './types';

export interface AuthUserRecord {
  id: string;
  username: string;
  isActive: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
import {
  mockSystemInfo, mockServices, mockInterfaces, mockRoutes,
  mockReachability, generateDnsMetrics, mockTopDomains,
  mockInstanceStats, mockNftCounters, mockStickyEntries,
  mockOspfNeighbors, mockOspfRoutes, mockLogs, mockDiagCommands,
  mockHistory, mockProfiles, mockDiagOutputs, mockInstanceHealth,
} from './mock-data';

// ---- Configuration ----

const IS_PREVIEW = !import.meta.env.VITE_API_URL;
const API_BASE = import.meta.env.VITE_API_URL || '';

async function apiCall<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse<T>> {
  if (IS_PREVIEW) {
    return getMockResponse<T>(method, path, body);
  }

  const res = await fetch(`${API_BASE}${path}`, {
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
  getSystemInfo: () => apiCall<SystemInfo>('GET', '/api/dashboard/summary'),
  getInstanceHealth: () => apiCall<InstanceHealthReport>('GET', '/api/healthcheck'),
  getInstanceRealStats: () => apiCall<DnsInstanceStats[]>('GET', '/api/dashboard/instance-stats'),

  // Services
  getServices: () => apiCall<ServiceStatus[]>('GET', '/api/services'),
  restartService: (name: string) => apiCall<{ success: boolean }>('POST', `/api/services/${name}/restart`),

  // Network
  getInterfaces: () => apiCall<NetworkInterface[]>('GET', '/api/network/interfaces'),
  getRoutes: () => apiCall<Route[]>('GET', '/api/network/routes'),
  checkReachability: () => apiCall<ReachabilityResult[]>('GET', '/api/network/reachability'),

  // DNS
  getDnsMetrics: (hours: number = 6, instance?: string) =>
    apiCall<DnsMetrics[]>('GET', `/api/dns/metrics?hours=${hours}${instance ? `&instance=${instance}` : ''}`),
  getTopDomains: (limit: number = 20) =>
    apiCall<DnsTopDomain[]>('GET', `/api/dns/top-domains?limit=${limit}`),
  getInstanceStats: () => apiCall<DnsInstanceStats[]>('GET', '/api/dns/instances'),

  // NAT / nftables
  getNftCounters: () => apiCall<NftCounter[]>('GET', '/api/nat/summary'),
  getStickyTable: () => apiCall<NftStickyEntry[]>('GET', '/api/nat/sticky'),
  getNftRuleset: () => apiCall<{ ruleset: string }>('GET', '/api/nat/ruleset'),

  // OSPF / FRR
  getOspfNeighbors: () => apiCall<OspfNeighbor[]>('GET', '/api/ospf/neighbors'),
  getOspfRoutes: () => apiCall<OspfRoute[]>('GET', '/api/ospf/routes'),
  getFrrRunningConfig: () => apiCall<{ config: string }>('GET', '/api/ospf/running-config'),

  // Logs
  getLogs: (source?: LogSource, search?: string, page: number = 1, pageSize: number = 100) =>
    apiCall<PaginatedResponse<LogEntry>>('GET',
      `/api/logs?page=${page}&page_size=${pageSize}${source ? `&source=${source}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  exportLogs: (source?: LogSource) =>
    apiCall<{ content: string; count: number }>('GET', `/api/logs/export${source ? `?source=${source}` : ''}`),

  // Troubleshooting
  getDiagCommands: () => apiCall<DiagCommand[]>('GET', '/api/troubleshooting/commands'),
  runDiagCommand: (commandId: string, args?: Record<string, string>) =>
    apiCall<DiagResult>('POST', '/api/troubleshooting/run', { command_id: commandId, args: args || {} }),
  runHealthCheck: () => apiCall<DiagResult[]>('GET', '/api/troubleshooting/health-check'),

  // Config Profiles
  getProfiles: () => apiCall<ConfigProfile[]>('GET', '/api/configs'),
  saveProfile: (profile: { name: string; description?: string; payload: Record<string, unknown> }) =>
    apiCall<ConfigProfile>('POST', '/api/configs', profile),
  getProfile: (id: string) => apiCall<ConfigProfile>('GET', `/api/configs/${id}`),
  updateProfile: (id: string, profile: { name: string; description?: string; payload: Record<string, unknown> }) =>
    apiCall<{ success: boolean }>('PATCH', `/api/configs/${id}`, profile),
  cloneProfile: (id: string) => apiCall<{ id: string; name: string }>('POST', `/api/configs/${id}/clone`),
  previewFiles: (id: string) => apiCall<GeneratedFile[]>('GET', `/api/configs/${id}/preview`),
  getConfigFiles: (id: string) => apiCall<GeneratedFile[]>('GET', `/api/configs/${id}/files`),
  getConfigDiff: (id: string, revA: string, revB: string) =>
    apiCall<ConfigDiff[]>('GET', `/api/configs/${id}/diff/${revA}/${revB}`),
  getConfigHistory: (id: string) => apiCall<unknown[]>('GET', `/api/configs/${id}/history`),
  deleteProfile: (id: string) => apiCall<void>('DELETE', `/api/configs/${id}`),

  // Config validation (standalone, without saved profile)
  getCurrentConfig: () => apiCall<WizardConfig>('GET', '/api/configs'),
  validateConfig: (config: WizardConfig) =>
    apiCall<{ valid: boolean; errors: Array<{ field: string; message: string }> }>('POST', '/api/configs', config),
  previewFilesFromConfig: (config: WizardConfig) =>
    apiCall<GeneratedFile[]>('POST', '/api/configs', config),

  // Apply
  applyConfig: (request: ApplyRequest) =>
    apiCall<ApplyResult>('POST', `/api/apply/${request.scope || 'full'}`, request),
  dryRunConfig: (request: ApplyRequest) =>
    apiCall<ApplyResult>('POST', '/api/apply/dry-run', request),
  getApplyJobs: () => apiCall<ApplyResult[]>('GET', '/api/apply/jobs'),
  getApplyJob: (id: string) => apiCall<ApplyResult>('GET', `/api/apply/jobs/${id}`),

  // History
  getHistory: (page: number = 1) =>
    apiCall<PaginatedResponse<ApplyResult>>('GET', `/api/history?page=${page}`),
  getHistoryEntry: (id: string) =>
    apiCall<ApplyResult>('GET', `/api/apply/jobs/${id}`),

  // Files
  getGeneratedFiles: () => apiCall<GeneratedFile[]>('GET', '/api/files/generated'),
  getFileContent: (path: string) => apiCall<{ path: string; content: string }>('GET', `/api/files/generated/${path}`),

  // Settings
  getSettings: () => apiCall<Record<string, string>>('GET', '/api/settings'),
  updateSettings: (settings: Record<string, string>) =>
    apiCall<{ success: boolean }>('PATCH', '/api/settings', { settings }),

  // Reports
  generateReport: () => apiCall<{ downloadUrl: string; html: string }>('POST', '/api/dashboard/summary'),

  // Users (admin)
  getUsers: () => apiCall<AuthUserRecord[]>('GET', '/api/users'),
  createUser: (username: string, password: string, mustChangePassword: boolean = true) =>
    apiCall<AuthUserRecord>('POST', '/api/users', { username, password, must_change_password: mustChangePassword }),
  toggleUser: (userId: string, active: boolean) =>
    apiCall<{ success: boolean }>('POST', `/api/users/${userId}/${active ? 'enable' : 'disable'}`),
  changeUserPassword: (userId: string, password: string) =>
    apiCall<{ success: boolean }>('POST', `/api/users/${userId}/change-password`, { password }),
  deleteUser: (userId: string) =>
    apiCall<void>('DELETE', `/api/users/${userId}`),

  // ---- v2: Events, Metrics, Actions, Instances ----
  getEvents: (severity?: string, limit: number = 100) =>
    apiCall<{ items: V2Event[]; total: number }>('GET', `/api/events${severity ? `?severity=${severity}` : ''}${severity ? '&' : '?'}limit=${limit}`),
  getV2Metrics: () =>
    apiCall<V2MetricEntry[]>('GET', '/api/metrics/dns'),
  getV2Instances: () =>
    apiCall<V2Instance[]>('GET', '/api/health/instances'),
  getV2Actions: () =>
    apiCall<V2Action[]>('GET', '/api/actions'),
  removeBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/api/actions/remove-backend/${instanceId}`),
  restoreBackend: (instanceId: string) =>
    apiCall<{ success: boolean }>('POST', `/api/actions/restore-backend/${instanceId}`),
  getSchedulerStatus: () =>
    apiCall<{ running: boolean; jobs: Array<{ id: string; name: string; next_run: string | null }> }>('GET', '/api/health'),
};

// ---- Mock Response Router ----

function getMockResponse<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  return new Promise(resolve => {
    const delay = 200 + Math.random() * 300;
    setTimeout(() => {
      const data = routeMock(method, path, body);
      resolve({
        success: true,
        data: data as T,
        error: null,
        timestamp: new Date().toISOString(),
      });
    }, delay);
  });
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
    steps: [
      { order: 1, name: 'Validar parâmetros', status: 'success', output: 'Todos os parâmetros válidos', durationMs: 120, command: null },
      { order: 2, name: 'Verificar pacotes', status: 'success', output: 'unbound frr nftables — instalados', durationMs: 1200, command: 'dpkg -l unbound frr nftables' },
      { order: 3, name: 'Backup configuração atual', status: 'success', output: 'Backup salvo em /var/lib/dns-control/backups/', durationMs: 340, command: null },
      { order: 4, name: 'Gerar arquivos', status: 'success', output: '11 arquivos gerados', durationMs: 200, command: null },
      { order: 5, name: 'Gravar arquivos em disco', status: 'success', output: 'Arquivos gravados com sucesso', durationMs: 150, command: null },
      { order: 6, name: 'Configurar rede', status: 'success', output: 'Interfaces e IPs configurados', durationMs: 800, command: '/etc/network/post-up.sh' },
      { order: 7, name: 'Aplicar nftables', status: 'success', output: 'Ruleset carregado', durationMs: 300, command: 'nft -f /etc/nftables.conf' },
      { order: 8, name: 'Reiniciar Unbound', status: 'success', output: '4 instâncias reiniciadas', durationMs: 2500, command: 'systemctl restart unbound01 unbound02 unbound03 unbound04' },
      { order: 9, name: 'Reiniciar FRR', status: 'success', output: 'FRR reiniciado', durationMs: 1200, command: 'systemctl restart frr' },
      { order: 10, name: 'Validar DNS', status: 'success', output: 'VIP 4.2.2.5 respondendo queries', durationMs: 1500, command: 'dig @4.2.2.5 google.com +short' },
      { order: 11, name: 'Validar OSPF', status: 'success', output: '2 vizinhos em estado Full', durationMs: 500, command: 'vtysh -c "show ip ospf neighbor"' },
    ],
    filesGenerated: [],
  };
}
