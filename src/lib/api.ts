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
} from './types';

export interface AuthUserRecord {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}
import {
  mockSystemInfo, mockServices, mockInterfaces, mockRoutes,
  mockReachability, generateDnsMetrics, mockTopDomains,
  mockInstanceStats, mockNftCounters, mockStickyEntries,
  mockOspfNeighbors, mockOspfRoutes, mockLogs, mockDiagCommands,
  mockHistory, mockProfiles, mockDiagOutputs,
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
    // Return mock data in preview mode
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

  return res.json();
}

// ---- Public API Methods ----

export const api = {
  // System
  getSystemInfo: () => apiCall<SystemInfo>('GET', '/api/v1/system/info'),
  getServices: () => apiCall<ServiceStatus[]>('GET', '/api/v1/system/services'),
  restartService: (name: string) => apiCall<{ success: boolean }>('POST', `/api/v1/system/services/${name}/restart`),

  // Network
  getInterfaces: () => apiCall<NetworkInterface[]>('GET', '/api/v1/network/interfaces'),
  getRoutes: () => apiCall<Route[]>('GET', '/api/v1/network/routes'),
  checkReachability: () => apiCall<ReachabilityResult[]>('POST', '/api/v1/network/reachability'),

  // DNS
  getDnsMetrics: (hours: number = 6, instance?: string) =>
    apiCall<DnsMetrics[]>('GET', `/api/v1/dns/metrics?hours=${hours}${instance ? `&instance=${instance}` : ''}`),
  getTopDomains: (limit: number = 20) =>
    apiCall<DnsTopDomain[]>('GET', `/api/v1/dns/top-domains?limit=${limit}`),
  getInstanceStats: () => apiCall<DnsInstanceStats[]>('GET', '/api/v1/dns/instances'),

  // NAT / nftables
  getNftCounters: () => apiCall<NftCounter[]>('GET', '/api/v1/nat/counters'),
  getStickyTable: () => apiCall<NftStickyEntry[]>('GET', '/api/v1/nat/sticky'),
  getNftRuleset: () => apiCall<{ ruleset: string }>('GET', '/api/v1/nat/ruleset'),

  // OSPF / FRR
  getOspfNeighbors: () => apiCall<OspfNeighbor[]>('GET', '/api/v1/ospf/neighbors'),
  getOspfRoutes: () => apiCall<OspfRoute[]>('GET', '/api/v1/ospf/routes'),
  getFrrRunningConfig: () => apiCall<{ config: string }>('GET', '/api/v1/ospf/running-config'),

  // Logs
  getLogs: (source?: LogSource, search?: string, page: number = 1, pageSize: number = 100) =>
    apiCall<PaginatedResponse<LogEntry>>('GET',
      `/api/v1/logs?page=${page}&pageSize=${pageSize}${source ? `&source=${source}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`),
  exportLogs: (source?: LogSource) =>
    apiCall<{ downloadUrl: string }>('POST', `/api/v1/logs/export${source ? `?source=${source}` : ''}`),

  // Troubleshooting
  getDiagCommands: () => apiCall<DiagCommand[]>('GET', '/api/v1/diag/commands'),
  runDiagCommand: (commandId: string) => apiCall<DiagResult>('POST', `/api/v1/diag/run/${commandId}`),
  runHealthCheck: () => apiCall<DiagResult[]>('POST', '/api/v1/diag/health-check'),

  // Config / Apply
  getCurrentConfig: () => apiCall<WizardConfig>('GET', '/api/v1/config/current'),
  validateConfig: (config: WizardConfig) =>
    apiCall<{ valid: boolean; errors: Array<{ field: string; message: string }> }>('POST', '/api/v1/config/validate', config),
  previewFiles: (config: WizardConfig) =>
    apiCall<GeneratedFile[]>('POST', '/api/v1/config/preview', config),
  applyConfig: (request: ApplyRequest) =>
    apiCall<ApplyResult>('POST', '/api/v1/config/apply', request),

  // History
  getHistory: (page: number = 1) =>
    apiCall<PaginatedResponse<ApplyResult>>('GET', `/api/v1/history?page=${page}`),
  getHistoryEntry: (id: string) =>
    apiCall<ApplyResult>('GET', `/api/v1/history/${id}`),
  getConfigDiff: (id1: string, id2: string) =>
    apiCall<ConfigDiff[]>('GET', `/api/v1/history/diff?from=${id1}&to=${id2}`),
  reapply: (id: string) =>
    apiCall<ApplyResult>('POST', `/api/v1/history/${id}/reapply`),

  // Profiles
  getProfiles: () => apiCall<ConfigProfile[]>('GET', '/api/v1/profiles'),
  saveProfile: (profile: Omit<ConfigProfile, 'id' | 'createdAt' | 'updatedAt'>) =>
    apiCall<ConfigProfile>('POST', '/api/v1/profiles', profile),
  importProfile: (data: string) =>
    apiCall<ConfigProfile>('POST', '/api/v1/profiles/import', { data }),
  exportProfile: (id: string) =>
    apiCall<{ json: string }>('GET', `/api/v1/profiles/${id}/export`),
  deleteProfile: (id: string) =>
    apiCall<void>('DELETE', `/api/v1/profiles/${id}`),

  // Reports
  generateReport: () => apiCall<{ downloadUrl: string; html: string }>('POST', '/api/v1/reports/generate'),

  // Auth / Users
  getUsers: () => apiCall<AuthUserRecord[]>('GET', '/api/v1/auth/users'),
  createUser: (username: string, password: string) =>
    apiCall<AuthUserRecord>('POST', '/api/v1/auth/users', { username, password }),
  toggleUser: (userId: string, active: boolean) =>
    apiCall<{ success: boolean }>('PATCH', `/api/v1/auth/users/${userId}`, { is_active: active }),
  changeUserPassword: (userId: string, password: string) =>
    apiCall<{ success: boolean }>('PATCH', `/api/v1/auth/users/${userId}/password`, { password }),
  deleteUser: (userId: string) =>
    apiCall<void>('DELETE', `/api/v1/auth/users/${userId}`),
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
  // System
  if (path === '/api/v1/system/info') return mockSystemInfo;
  if (path === '/api/v1/system/services') return mockServices;
  if (path.match(/\/api\/v1\/system\/services\/.*\/restart/)) return { success: true };

  // Network
  if (path === '/api/v1/network/interfaces') return mockInterfaces;
  if (path === '/api/v1/network/routes') return mockRoutes;
  if (path === '/api/v1/network/reachability') return mockReachability;

  // DNS
  if (path.startsWith('/api/v1/dns/metrics')) return generateDnsMetrics(6);
  if (path.startsWith('/api/v1/dns/top-domains')) return mockTopDomains;
  if (path === '/api/v1/dns/instances') return mockInstanceStats;

  // NAT
  if (path === '/api/v1/nat/counters') return mockNftCounters;
  if (path === '/api/v1/nat/sticky') return mockStickyEntries;
  if (path === '/api/v1/nat/ruleset') return { ruleset: 'table ip nat { ... }' };

  // OSPF
  if (path === '/api/v1/ospf/neighbors') return mockOspfNeighbors;
  if (path === '/api/v1/ospf/routes') return mockOspfRoutes;
  if (path === '/api/v1/ospf/running-config') return { config: '! FRR running config...' };

  // Logs
  if (path.startsWith('/api/v1/logs') && !path.includes('export')) {
    const source = new URL('http://x' + path).searchParams.get('source') as LogSource | null;
    const filtered = source ? mockLogs.filter(l => l.source === source) : mockLogs;
    return { items: filtered, total: filtered.length, page: 1, pageSize: 100, hasMore: false };
  }

  // Diag
  if (path === '/api/v1/diag/commands') return mockDiagCommands;
  if (path.startsWith('/api/v1/diag/run/')) {
    const cmdId = path.split('/').pop()!;
    return mockDiagOutputs[cmdId] || { commandId: cmdId, exitCode: 0, stdout: 'OK', stderr: '', durationMs: 50, timestamp: new Date().toISOString() };
  }
  if (path === '/api/v1/diag/health-check') return Object.values(mockDiagOutputs);

  // Config
  if (path === '/api/v1/config/current') {
    const { DEFAULT_CONFIG } = require('./types');
    return DEFAULT_CONFIG;
  }
  if (path === '/api/v1/config/validate') return { valid: true, errors: [] };
  if (path === '/api/v1/config/preview') {
    const { generateAllFiles } = require('./config-generator');
    return generateAllFiles(body as WizardConfig).map((f: { path: string; content: string }) => ({
      ...f, permissions: '0644', owner: 'root:root', backupPath: null, changed: true
    }));
  }
  if (path === '/api/v1/config/apply') {
    return mockApplyResult(body as { dryRun?: boolean; scope?: string });
  }

  // History
  if (path.startsWith('/api/v1/history') && !path.includes('diff') && !path.includes('reapply')) {
    if (path === '/api/v1/history' || path.includes('?')) {
      return { items: mockHistory, total: mockHistory.length, page: 1, pageSize: 20, hasMore: false };
    }
    return mockHistory[0];
  }

  // Profiles
  if (path === '/api/v1/profiles') return mockProfiles;

  // Reports
  if (path === '/api/v1/reports/generate') return { downloadUrl: '#', html: '<h1>DNS Control Report</h1>' };

  // Auth / Users
  if (path === '/api/v1/auth/users' && method === 'GET') {
    return mockUsers();
  }
  if (path === '/api/v1/auth/users' && method === 'POST') {
    const b = body as { username: string };
    return { id: `usr-${Date.now()}`, username: b.username, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastLoginAt: null };
  }
  if (path.match(/\/api\/v1\/auth\/users\/.*\/password/)) return { success: true };
  if (path.match(/\/api\/v1\/auth\/users\//) && method === 'PATCH') return { success: true };
  if (path.match(/\/api\/v1\/auth\/users\//) && method === 'DELETE') return undefined;

  return {};
}

function mockUsers(): AuthUserRecord[] {
  return [
    { id: 'usr-001', username: 'admin', isActive: true, createdAt: '2026-01-15T10:00:00Z', updatedAt: '2026-03-10T08:00:00Z', lastLoginAt: '2026-03-11T09:30:00Z' },
    { id: 'usr-002', username: 'operador', isActive: true, createdAt: '2026-02-20T14:00:00Z', updatedAt: '2026-03-08T12:00:00Z', lastLoginAt: '2026-03-10T16:45:00Z' },
    { id: 'usr-003', username: 'auditor', isActive: false, createdAt: '2026-03-01T09:00:00Z', updatedAt: '2026-03-05T11:00:00Z', lastLoginAt: null },
  ];
}

function mockApplyResult(req?: { dryRun?: boolean; scope?: string }): ApplyResult {
  return {
    id: `apply-${Date.now()}`,
    timestamp: new Date().toISOString(),
    user: 'admin',
    status: req?.dryRun ? 'dry-run' : 'success',
    scope: (req?.scope as ApplyResult['scope']) || 'full',
    dryRun: req?.dryRun || false,
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
