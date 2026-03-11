import { Server, Globe, Router, Shield, Activity, Clock } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import StatusBadge from '@/components/StatusBadge';
import { mockServices } from '@/lib/mock-data';

export default function Dashboard() {
  const allRunning = mockServices.every(s => s.status === 'running');

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
        <MetricCard label="Instâncias DNS" value="4/4" sub="Todas operacionais" icon={<Globe size={16} />} />
        <MetricCard label="QPS Total" value="4,231" sub="Média últimos 5min" icon={<Activity size={16} />} />
        <MetricCard label="Cache Hit" value="87.2%" sub="Últimas 24h" icon={<Server size={16} />} />
        <MetricCard label="Uptime" value="5d 12h" sub="Desde último restart" icon={<Clock size={16} />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Services */}
        <div className="noc-panel">
          <div className="noc-panel-header">Serviços</div>
          <div className="space-y-2">
            {mockServices.map(svc => (
              <div key={svc.name} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                <div className="flex items-center gap-2">
                  <Server size={14} className="text-muted-foreground" />
                  <span className="text-sm font-mono">{svc.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">{svc.memory}</span>
                  <StatusBadge status={svc.status} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* System Info */}
        <div className="noc-panel">
          <div className="noc-panel-header">Informações do Sistema</div>
          <div className="space-y-2 text-sm">
            {[
              ['Hostname', 'dns-rec-01.example.com'],
              ['OS', 'Debian 13 (Trixie)'],
              ['Unbound', '1.21.1'],
              ['FRR', '10.2'],
              ['nftables', '1.1.0'],
              ['Interface', 'enp6s18'],
              ['VIP Anycast', '4.2.2.5/32'],
              ['Última aplicação', '2026-03-10 14:30 UTC'],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-1 border-b border-border last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-foreground">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="noc-panel">
        <div className="noc-panel-header">Ações Rápidas</div>
        <div className="flex flex-wrap gap-2">
          {['Executar Diagnóstico', 'Reaplicar Config', 'Exportar Configuração', 'Gerar Relatório'].map(action => (
            <button key={action} className="px-3 py-1.5 text-xs font-medium rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-colors">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
