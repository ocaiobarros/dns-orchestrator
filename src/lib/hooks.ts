// ============================================================
// DNS Control — React Query Hooks
// Typed hooks for all API endpoints with loading/error states
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { WizardConfig, ApplyRequest, LogSource } from './types';

// ---- Query Keys ----
export const queryKeys = {
  systemInfo: ['system', 'info'] as const,
  services: ['system', 'services'] as const,
  interfaces: ['network', 'interfaces'] as const,
  routes: ['network', 'routes'] as const,
  reachability: ['network', 'reachability'] as const,
  dnsMetrics: (hours: number, instance?: string) => ['dns', 'metrics', hours, instance] as const,
  topDomains: (limit: number) => ['dns', 'topDomains', limit] as const,
  instanceStats: ['dns', 'instances'] as const,
  nftCounters: ['nat', 'counters'] as const,
  stickyTable: ['nat', 'sticky'] as const,
  nftRuleset: ['nat', 'ruleset'] as const,
  ospfNeighbors: ['ospf', 'neighbors'] as const,
  ospfRoutes: ['ospf', 'routes'] as const,
  frrConfig: ['ospf', 'config'] as const,
  logs: (source?: LogSource, search?: string, page?: number) => ['logs', source, search, page] as const,
  diagCommands: ['diag', 'commands'] as const,
  history: (page: number) => ['history', page] as const,
  profiles: ['profiles'] as const,
  currentConfig: ['config', 'current'] as const,
};

// ---- System ----
export function useSystemInfo() {
  return useQuery({
    queryKey: queryKeys.systemInfo,
    queryFn: async () => { const r = await api.getSystemInfo(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
  });
}

export function useServices() {
  return useQuery({
    queryKey: queryKeys.services,
    queryFn: async () => { const r = await api.getServices(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 10000,
  });
}

export function useRestartService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => { const r = await api.restartService(name); if (!r.success) throw new Error(r.error!); return r.data; },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.services }),
  });
}

// ---- Network ----
export function useInterfaces() {
  return useQuery({
    queryKey: queryKeys.interfaces,
    queryFn: async () => { const r = await api.getInterfaces(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
  });
}

export function useRoutes() {
  return useQuery({
    queryKey: queryKeys.routes,
    queryFn: async () => { const r = await api.getRoutes(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

export function useReachability() {
  return useMutation({
    mutationFn: async () => { const r = await api.checkReachability(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- DNS ----
export function useDnsMetrics(hours: number = 6, instance?: string) {
  return useQuery({
    queryKey: queryKeys.dnsMetrics(hours, instance),
    queryFn: async () => { const r = await api.getDnsMetrics(hours, instance); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 60000,
  });
}

export function useTopDomains(limit: number = 20) {
  return useQuery({
    queryKey: queryKeys.topDomains(limit),
    queryFn: async () => { const r = await api.getTopDomains(limit); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 60000,
  });
}

export function useInstanceStats() {
  return useQuery({
    queryKey: queryKeys.instanceStats,
    queryFn: async () => { const r = await api.getInstanceStats(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 15000,
  });
}

// ---- NAT ----
export function useNftCounters() {
  return useQuery({
    queryKey: queryKeys.nftCounters,
    queryFn: async () => { const r = await api.getNftCounters(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 15000,
  });
}

export function useStickyTable() {
  return useQuery({
    queryKey: queryKeys.stickyTable,
    queryFn: async () => { const r = await api.getStickyTable(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 10000,
  });
}

// ---- OSPF ----
export function useOspfNeighbors() {
  return useQuery({
    queryKey: queryKeys.ospfNeighbors,
    queryFn: async () => { const r = await api.getOspfNeighbors(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 30000,
  });
}

export function useOspfRoutes() {
  return useQuery({
    queryKey: queryKeys.ospfRoutes,
    queryFn: async () => { const r = await api.getOspfRoutes(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- Logs ----
export function useLogs(source?: LogSource, search?: string, page: number = 1) {
  return useQuery({
    queryKey: queryKeys.logs(source, search, page),
    queryFn: async () => { const r = await api.getLogs(source, search, page); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- Diagnostics ----
export function useDiagCommands() {
  return useQuery({
    queryKey: queryKeys.diagCommands,
    queryFn: async () => { const r = await api.getDiagCommands(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

export function useRunDiagCommand() {
  return useMutation({
    mutationFn: async (commandId: string) => { const r = await api.runDiagCommand(commandId); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

export function useHealthCheck() {
  return useMutation({
    mutationFn: async () => { const r = await api.runHealthCheck(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- Config / Apply ----
export function useCurrentConfig() {
  return useQuery({
    queryKey: queryKeys.currentConfig,
    queryFn: async () => { const r = await api.getCurrentConfig(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

export function useApplyConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: ApplyRequest) => { const r = await api.applyConfig(request); if (!r.success) throw new Error(r.error!); return r.data; },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.services });
      qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function usePreviewFiles() {
  return useMutation({
    mutationFn: async (config: WizardConfig) => { const r = await api.previewFilesFromConfig(config); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- History ----
export function useHistory(page: number = 1) {
  return useQuery({
    queryKey: queryKeys.history(page),
    queryFn: async () => { const r = await api.getHistory(page); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}

// ---- Profiles ----
export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.profiles,
    queryFn: async () => { const r = await api.getProfiles(); if (!r.success) throw new Error(r.error!); return r.data; },
  });
}
