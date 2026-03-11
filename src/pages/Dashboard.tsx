import { Activity, Clock, Globe, Server, HeartPulse, CheckCircle, XCircle, Zap } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import StatusBadge from '@/components/StatusBadge';
import { LoadingState, ErrorState } from '@/components/DataStates';
import { useSystemInfo, useServices, useInstanceStats, useInstanceHealth } from '@/lib/hooks';
import { useNavigate } from 'react-router-dom';

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'N/A';
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

  if (sysLoading || svcLoading) return <LoadingState />;
  if (sysError) return <ErrorState message={sysError.message} />;

  const allRunning = services?.every(s => s.status === 'running') ?? false;
  const totalQps = instanceStats?.reduce((a, b) => a + b.totalQueries, 0) ?? 0;
  const avgCacheHit = instanceStats && instanceStats.length > 0
    ? (instanceStats.reduce((a, b) => a + b.cacheHitRatio, 0) / instanceStats.length).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão geral do ambiente DNS</p>
        </div>
        <StatusBadge status={allRunning ? 'running' : 'error'} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Instâncias DNS" value={`${health?.healthy ?? instanceStats?.length ?? 0}/${health?.total ?? instanceStats?.length ?? 0}`} sub={health?.all_healthy ? 'Todas saudáveis' : health?.degraded ? 'Degradado' : 'Operacionais'} icon={<Globe size={16} />} />
        <MetricCard label="Total Queries" value={totalQps.toLocaleString()} sub="Acumulado" icon={<Activity size={16} />} />
        <MetricCard label="Cache Hit" value={`${avgCacheHit}%`} sub="Média geral" icon={<Server size={16} />} />
        <MetricCard label="Uptime" value={sysInfo?.uptime ?? '-'} sub="Desde último restart" icon={<Clock size={16} />} />
      </div>

      {/* Instance Health Check Panel */}
      {health && (
        <div className="noc-panel">
          <div className="noc-panel-header flex items-center gap-2">
            <HeartPulse size={14} />
            Health Check — dig @instância
          </div>

          {/* VIP status */}
          {health.vip && (
            <div className="flex items-center justify-between py-2 px-1 mb-2 rounded bg-secondary/30 border border-border">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-primary" />
                <span className="text-sm font-mono font-semibold">{health.vip.bind_ip}</span>
                <span className="text-xs text-muted-foreground">VIP Anycast</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground">{health.vip.latency_ms}ms</span>
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
                  {inst.healthy ? (
                    <CheckCircle size={14} className="text-emerald-500" />
                  ) : (
                    <XCircle size={14} className="text-destructive" />
                  )}
                  <span className="text-sm font-mono">{inst.instance}</span>
                  <span className="text-xs text-muted-foreground font-mono">{inst.bind_ip}:{inst.port}</span>
                </div>
                <div className="flex items-center gap-4">
                  {inst.healthy && (
                    <span className="text-xs text-muted-foreground font-mono">→ {inst.resolved_ip}</span>
                  )}
                  <span className={`text-xs font-mono ${inst.latency_ms < 10 ? 'text-emerald-500' : inst.latency_ms < 50 ? 'text-yellow-500' : 'text-destructive'}`}>
                    {inst.latency_ms}ms
                  </span>
                  {inst.error && (
                    <span className="text-xs text-destructive truncate max-w-[200px]">{inst.error}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-instance stats */}
        <div className="noc-panel">
          <div className="noc-panel-header">Estatísticas por Instância</div>
          <div className="space-y-2">
            {instanceStats?.map(inst => (
              <div key={inst.instance} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-muted-foreground" />
                  <span className="text-sm font-mono">{inst.instance}</span>
                </div>
                <div className="flex items-center gap-4 text-xs font-mono">
                  <span className="text-muted-foreground">{inst.totalQueries.toLocaleString()} q</span>
                  <span className="text-emerald-500">{inst.cacheHitRatio}% hit</span>
                  <span className="text-muted-foreground">{inst.avgLatencyMs}ms</span>
                  <span className="text-muted-foreground">{inst.uptime}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="noc-panel">
          <div className="noc-panel-header">Serviços</div>
          <div className="space-y-2">
            {services?.map(svc => (
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
          {sysInfo && [
            ['Hostname', sysInfo.hostname],
            ['OS', sysInfo.os],
            ['Kernel', sysInfo.kernel],
            ['Unbound', sysInfo.unboundVersion],
            ['FRR', sysInfo.frrVersion],
            ['nftables', sysInfo.nftablesVersion],
            ['Interface', sysInfo.mainInterface],
            ['VIP Anycast', sysInfo.vipAnycast],
            ['Config Version', sysInfo.configVersion],
            ['Última aplicação', sysInfo.lastApply ? new Date(sysInfo.lastApply).toLocaleString('pt-BR') : 'Nunca'],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono text-foreground">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Ações Rápidas</div>
        <div className="flex flex-wrap gap-2">
          {[
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
