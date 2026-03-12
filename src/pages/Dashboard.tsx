import { Activity, Clock, Globe, Server, HeartPulse, CheckCircle, XCircle, Zap, AlertTriangle, Bell, RefreshCw, Timer } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth } from '@/lib/hooks';
import { getInstanceQueries, getInstanceCacheHit, getInstanceLatency, safeDate } from '@/lib/types';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'N/A';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export default function Dashboard() {
  const { data: sysInfo, isLoading: sysLoading, error: sysError } = useSystemInfo();
  const { data: services, isLoading: svcLoading } = useServices();
  const { data: instanceStats } = useInstanceStats();
  const { data: health } = useInstanceHealth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [reconciling, setReconciling] = useState(false);

  const { data: v2Instances } = useQuery({
    queryKey: ['v2-instances'],
    queryFn: async () => { const r = await api.getV2Instances(); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 10000,
  });

  const { data: recentEvents } = useQuery({
    queryKey: ['events', 'recent'],
    queryFn: async () => { const r = await api.getEvents(undefined, 5); if (!r.success) throw new Error(r.error!); return r.data; },
    refetchInterval: 5000,
  });

  const reconcileMutation = useMutation({
    mutationFn: async () => {
      setReconciling(true);
      const r = await api.reconcileNow();
      if (!r.success) throw new Error(r.error!);
      return r.data;
    },
    onSettled: () => {
      setReconciling(false);
      qc.invalidateQueries({ queryKey: ['v2-instances'] });
      qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  if (sysLoading && svcLoading) return <LoadingState />;
  if (sysError && !sysInfo) return <ErrorState message={sysError.message} onRetry={() => qc.invalidateQueries({ queryKey: ['system', 'info'] })} />;

  const safeServices = Array.isArray(services) ? services.filter(Boolean) : [];
  const safeStats = Array.isArray(instanceStats) ? instanceStats.filter(Boolean) : [];
  const safeV2 = Array.isArray(v2Instances) ? v2Instances.filter(Boolean) : [];

  const allRunning = safeServices.every(s => s.status === 'running');

  // Prefer dashboard summary metrics (real unbound-control data) over instance stats aggregation
  const dnsMetricsAvailable = sysInfo?.dns_metrics_available ?? false;
  const dnsMetricsStatus = sysInfo?.dns_metrics_status ?? 'unknown';
  const dashTotalQueries = sysInfo?.total_queries ?? 0;
  const dashCacheHit = sysInfo?.cache_hit_ratio ?? 0;
  const dashLatency = sysInfo?.latency_ms ?? 0;

  // Fallback to instance stats if dashboard metrics not available
  const totalQps = dnsMetricsAvailable ? dashTotalQueries : safeStats.reduce((a, b) => a + getInstanceQueries(b), 0);
  const avgCacheHit = dnsMetricsAvailable ? dashCacheHit.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceCacheHit(b), 0) / safeStats.length).toFixed(1)
    : '0');
  const avgLatency = dnsMetricsAvailable ? dashLatency.toFixed(1) : (safeStats.length > 0
    ? (safeStats.reduce((a, b) => a + getInstanceLatency(b), 0) / safeStats.length).toFixed(1)
    : '0');

  const healthyCount = safeV2.length > 0
    ? safeV2.filter(i => i.current_status === 'healthy').length
    : (health?.healthy ?? 0);
  const totalInstances = safeV2.length > 0 ? safeV2.length : (health?.total ?? 0);
  const failedCount = safeV2.filter(i => i.current_status === 'failed' || i.current_status === 'withdrawn').length;
  const inRotation = safeV2.length > 0
    ? safeV2.filter(i => i.in_rotation).length
    : totalInstances;

  const eventItems = recentEvents?.items ?? (Array.isArray(recentEvents) ? recentEvents : []);
  const criticalEvents = eventItems.filter((e: any) => e.severity === 'critical').length;
  const statusLabel = failedCount > 0 ? 'Degradado' : 'Todas saudáveis';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">DNS Control v2.1 — Carrier Edition</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => reconcileMutation.mutate()}
            disabled={reconciling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={reconciling ? 'animate-spin' : ''} />
            Reconciliar Agora
          </button>
          <StatusBadge status={allRunning && failedCount === 0 ? 'running' : 'error'} />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <MetricCard label="Instâncias" value={`${healthyCount}/${totalInstances}`} sub={statusLabel} icon={<Globe size={16} />} />
        <MetricCard label="Em Rotação" value={`${inRotation}/${totalInstances}`} sub="DNAT ativo" icon={<Zap size={16} />} />
        <MetricCard label="Total Queries" value={dnsMetricsAvailable ? totalQps.toLocaleString() : '—'} sub={dnsMetricsAvailable ? 'Acumulado' : dnsMetricsStatus === 'privilege_limited' ? 'Sem privilégio' : 'Indisponível'} icon={<Activity size={16} />} />
        <MetricCard label="Cache Hit" value={dnsMetricsAvailable ? `${avgCacheHit}%` : '—'} sub={dnsMetricsAvailable ? 'Média geral' : dnsMetricsStatus === 'privilege_limited' ? 'Sem privilégio' : 'Indisponível'} icon={<Server size={16} />} />
        <MetricCard label="Latência" value={dnsMetricsAvailable ? `${avgLatency}ms` : '—'} sub={dnsMetricsAvailable ? 'Média DNS' : dnsMetricsStatus === 'privilege_limited' ? 'Sem privilégio' : 'Indisponível'} icon={<Timer size={16} />} />
        <MetricCard label="Uptime" value={sysInfo?.uptime ?? '—'} sub="Sistema" icon={<Clock size={16} />} />
      </div>

      {!dnsMetricsAvailable && dnsMetricsStatus === 'privilege_limited' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
          <AlertTriangle size={14} />
          <span>Métricas DNS limitadas por privilégio — ative o modelo de execução privilegiada para dados reais</span>
        </div>
      )}

      {/* Reconciliation result */}
      {reconcileMutation.data && (
        <div className="noc-panel border-l-2 border-l-primary">
          <div className="text-sm">
            <span className="font-medium">Reconciliação executada:</span>{' '}
            <span className="font-mono">{reconcileMutation.data.instances_checked ?? 0} verificadas</span>{' · '}
            <span className="font-mono text-destructive">{reconcileMutation.data.instances_failed ?? 0} falhas</span>{' · '}
            <span className="font-mono">{reconcileMutation.data.backends_removed ?? 0} removidas</span>{' · '}
            <span className="font-mono text-emerald-500">{reconcileMutation.data.backends_restored ?? 0} restauradas</span>
          </div>
        </div>
      )}

      {/* v2.1 Instance State Table with cooldown */}
      {safeV2.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header flex items-center gap-2">
            <HeartPulse size={14} />
            Estado Operacional das Instâncias
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3 font-medium">Instância</th>
                  <th className="py-2 pr-3 font-medium">Bind IP</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Rotação</th>
                  <th className="py-2 pr-3 font-medium text-right">Falhas</th>
                  <th className="py-2 pr-3 font-medium text-right">Sucessos</th>
                  <th className="py-2 pr-3 font-medium text-right">Cooldown</th>
                  <th className="py-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {safeV2.map(inst => (
                  <tr key={inst.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 font-mono">{inst.instance_name ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{inst.bind_ip ?? '—'}:{inst.bind_port ?? 53}</td>
                    <td className="py-2 pr-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded ${
                        inst.current_status === 'healthy' ? 'bg-emerald-500/10 text-emerald-500' :
                        inst.current_status === 'degraded' ? 'bg-yellow-500/10 text-yellow-500' :
                        'bg-destructive/10 text-destructive'
                      }`}>
                        {inst.current_status === 'healthy' ? <CheckCircle size={12} /> : inst.current_status === 'degraded' ? <AlertTriangle size={12} /> : <XCircle size={12} />}
                        {inst.current_status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className={`text-xs font-mono ${inst.in_rotation ? 'text-emerald-500' : 'text-destructive'}`}>
                        {inst.in_rotation ? 'SIM' : 'NÃO'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{inst.consecutive_failures ?? 0}</td>
                    <td className="py-2 pr-3 text-right font-mono">{inst.consecutive_successes ?? 0}</td>
                    <td className="py-2 pr-3 text-right">
                      {(inst.cooldown_remaining ?? 0) > 0 ? (
                        <span className="text-xs font-mono text-yellow-500">{inst.cooldown_remaining}s</span>
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground truncate max-w-[200px]">{inst.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Health Check Panel (dig-based) */}
      {health && Array.isArray(health.instances) && health.instances.length > 0 && (
        <div className="noc-panel">
          <div className="noc-panel-header flex items-center gap-2">
            <HeartPulse size={14} />
            Health Check — dig @instância
          </div>
          {health.vip && (
            <div className="flex items-center justify-between py-2 px-1 mb-2 rounded bg-secondary/30 border border-border">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-primary" />
                <span className="text-sm font-mono font-semibold">{health.vip.bind_ip}</span>
                <span className="text-xs text-muted-foreground">VIP Anycast</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground">{health.vip.latency_ms ?? 0}ms</span>
                {health.vip.healthy ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-500"><CheckCircle size={12} /> OK</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-destructive"><XCircle size={12} /> FAIL</span>
                )}
              </div>
            </div>
          )}
          <div className="space-y-1">
            {health.instances.map(inst => (
              <div key={inst.instance} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  {inst.healthy ? <CheckCircle size={14} className="text-emerald-500" /> : <XCircle size={14} className="text-destructive" />}
                  <span className="text-sm font-mono">{inst.instance}</span>
                  <span className="text-xs text-muted-foreground font-mono">{inst.bind_ip}:{inst.port}</span>
                </div>
                <div className="flex items-center gap-4">
                  {inst.healthy && inst.resolved_ip && <span className="text-xs text-muted-foreground font-mono">→ {inst.resolved_ip}</span>}
                  <span className={`text-xs font-mono ${(inst.latency_ms ?? 0) < 10 ? 'text-emerald-500' : (inst.latency_ms ?? 0) < 50 ? 'text-yellow-500' : 'text-destructive'}`}>
                    {inst.latency_ms ?? 0}ms
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Critical Events */}
        <div className="noc-panel">
          <div className="noc-panel-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell size={14} />
              Eventos Recentes
              {criticalEvents > 0 && (
                <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                  {criticalEvents} crítico{criticalEvents > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <button onClick={() => navigate('/events')} className="text-xs text-primary hover:underline">Ver todos</button>
          </div>
          <div className="space-y-1">
            {eventItems.length > 0 ? eventItems.slice(0, 5).map((ev: any) => (
              <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-border last:border-0">
                {ev.severity === 'critical' ? <XCircle size={12} className="text-destructive mt-0.5" /> :
                 ev.severity === 'warning' ? <AlertTriangle size={12} className="text-yellow-500 mt-0.5" /> :
                 <CheckCircle size={12} className="text-muted-foreground mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground truncate">{ev.message}</p>
                  <span className="text-xs text-muted-foreground">{safeDate(ev.created_at)}</span>
                </div>
              </div>
            )) : (
              <p className="text-xs text-muted-foreground py-2">Nenhum evento recente</p>
            )}
          </div>
        </div>

        {/* Services */}
        <div className="noc-panel">
          <div className="noc-panel-header">Serviços</div>
          <div className="space-y-2">
            {safeServices.map(svc => (
              <div key={svc.name} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-muted-foreground" />
                  <span className="text-sm font-mono">{svc.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">{formatBytes(svc.memoryBytes)}</span>
                  <StatusBadge status={svc.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Informações do Sistema</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 text-sm">
          {[
            ['Hostname', sysInfo?.hostname ?? '—'],
            ['OS', sysInfo?.os ?? '—'],
            ['Kernel', sysInfo?.kernel ?? '—'],
            ['Unbound', sysInfo?.unbound_version ?? sysInfo?.unboundVersion ?? '—'],
            ['FRR', sysInfo?.frr_version ?? sysInfo?.frrVersion ?? '—'],
            ['nftables', sysInfo?.nftables_version ?? sysInfo?.nftablesVersion ?? '—'],
            ['Interface', sysInfo?.primary_interface ?? sysInfo?.mainInterface ?? '—'],
            ['VIP Anycast', sysInfo?.vip_anycast ?? sysInfo?.vipAnycast ?? '—'],
            ['Config Version', sysInfo?.config_version ?? sysInfo?.configVersion ?? '—'],
            ['Última aplicação', safeDate(sysInfo?.last_apply_at ?? sysInfo?.lastApply)],
          ].map(([label, value]) => (
            <div key={label as string} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono text-foreground">{value || '—'}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Ações Rápidas</div>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Métricas DNS', action: () => navigate('/metrics') },
            { label: 'Eventos', action: () => navigate('/events') },
            { label: 'Executar Diagnóstico', action: () => navigate('/troubleshoot') },
            { label: 'Wizard de Instalação', action: () => navigate('/wizard') },
            { label: 'Ver Arquivos Gerados', action: () => navigate('/files') },
            { label: 'Ver Histórico', action: () => navigate('/history') },
            { label: 'Ver Logs', action: () => navigate('/logs') },
          ].map(btn => (
            <button key={btn.label} onClick={btn.action} className="px-3 py-1.5 text-xs font-medium rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-colors">
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
