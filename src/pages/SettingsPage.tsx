import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { Settings2, Activity, Stethoscope, Download } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { safeDate } from '@/lib/types';

export default function SettingsPage() {
  const navigate = useNavigate();

  const { data: settingsData, isLoading, error, refetch } = useQuery({
    queryKey: ['settings', 'runtime'],
    queryFn: async () => {
      const res = await api.getSettings();
      if (!res.success) throw new Error(res.error || 'Falha ao carregar configurações');
      return res.data;
    },
  });

  const { data: systemInfo } = useQuery({
    queryKey: ['settings', 'system-info'],
    queryFn: async () => {
      const res = await api.getSystemInfo();
      return res.success ? res.data : null;
    },
  });

  const { data: schedulerStatus } = useQuery({
    queryKey: ['settings', 'scheduler-status'],
    queryFn: async () => {
      const res = await api.getSchedulerStatus();
      return res.success ? res.data : null;
    },
    refetchInterval: 15000,
  });

  const settingsEntries = useMemo(() => {
    if (!settingsData || typeof settingsData !== 'object' || Array.isArray(settingsData)) return [];
    return Object.entries(settingsData).sort(([a], [b]) => a.localeCompare(b));
  }, [settingsData]);

  const handleExportSettings = () => {
    const payload = JSON.stringify(settingsData ?? {}, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dns-control-runtime-settings.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Configurações exportadas');
  };

  if (isLoading) return <LoadingState />;
  if (error instanceof Error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  const jobs = Array.isArray(schedulerStatus?.jobs) ? schedulerStatus.jobs : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Estado operacional em tempo real</p>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header flex items-center gap-2">
          <Settings2 size={14} /> Runtime
        </div>
        <div className="space-y-2 text-sm">
          {[
            ['Modo', import.meta.env.MODE],
            ['API Base', import.meta.env.VITE_API_URL || 'não configurado'],
            ['Scheduler', schedulerStatus?.running ? 'ativo' : 'indisponível'],
            ['Jobs agendados', jobs.length.toString()],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={14} /> Configurações Persistidas
          </div>
          <Button size="sm" variant="outline" onClick={handleExportSettings}>
            <Download size={12} className="mr-1" /> Exportar JSON
          </Button>
        </div>

        {settingsEntries.length === 0 ? (
          <EmptyState title="Nenhuma configuração persistida" description="A tabela settings está vazia no backend." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Chave</th>
                  <th className="pb-2 font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {settingsEntries.map(([key, value]) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="py-2 text-primary break-all">{key}</td>
                    <td className="py-2 text-muted-foreground break-all">{value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Sistema</div>
        <div className="space-y-2 text-sm">
          {[
            ['Hostname', systemInfo?.hostname || '—'],
            ['Kernel', systemInfo?.kernel || '—'],
            ['OS', systemInfo?.os || '—'],
            ['Uptime', systemInfo?.uptime || '—'],
            ['Última aplicação', safeDate(systemInfo?.last_apply_at ?? systemInfo?.lastApply ?? null)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Operações</div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/troubleshoot')}>
          <Stethoscope size={12} className="mr-1" /> Abrir diagnóstico
        </Button>
      </div>
    </div>
  );
}
