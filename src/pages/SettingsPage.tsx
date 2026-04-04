import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { LoadingState, ErrorState, EmptyState } from '@/components/DataStates';
import { Settings2, Activity, Stethoscope, Download, Import, ShieldAlert, ShieldCheck, Trash2, Loader2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { safeDate } from '@/lib/types';

export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [importLoading, setImportLoading] = useState(false);
  const [clearLoading, setClearLoading] = useState(false);
  const [observeLoading, setObserveLoading] = useState(false);

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

  const { data: serviceModeData, refetch: refetchMode } = useQuery({
    queryKey: ['service-mode'],
    queryFn: async () => {
      const res = await api.getServiceMode();
      return res.success ? res.data : { service_mode: 'managed' };
    },
    refetchInterval: 30000,
  });

  const serviceMode = serviceModeData?.service_mode ?? 'managed';
  const isImported = serviceMode === 'imported';
  const isObserved = serviceMode === 'observed';
  const isReadonly = isImported || isObserved;

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

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const res = await api.executeImport();
      if (res.success) {
        const data = res.data;
        const vips = data.discovery?.vip_mappings?.length ?? 0;
        const instances = data.discovery?.instances?.length ?? 0;
        toast.success(`Import concluído: ${instances} instâncias, ${vips} VIPs descobertos`);
        queryClient.invalidateQueries({ queryKey: ['service-mode'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        refetchMode();
      } else {
        toast.error(`Falha no import: ${res.error}`);
      }
    } catch (e) {
      toast.error('Erro ao executar import');
    } finally {
      setImportLoading(false);
    }
  };

  const handleClearImport = async () => {
    setClearLoading(true);
    try {
      const res = await api.clearImport();
      if (res.success) {
        toast.success('Import removido — modo managed restaurado');
        queryClient.invalidateQueries({ queryKey: ['service-mode'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        refetchMode();
      } else {
        toast.error(`Falha ao limpar import: ${res.error}`);
      }
    } catch (e) {
      toast.error('Erro ao limpar import');
    } finally {
      setClearLoading(false);
    }
  };

  const handleEnableObserved = async () => {
    setObserveLoading(true);
    try {
      const res = await api.setServiceMode('observed');
      if (res.success) {
        toast.success('Modo Observação ativado — descoberta automática habilitada');
        queryClient.invalidateQueries({ queryKey: ['service-mode'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        queryClient.invalidateQueries({ queryKey: ['v2-instances'] });
        refetchMode();
      } else {
        toast.error(`Falha ao ativar observação: ${res.error}`);
      }
    } catch (e) {
      toast.error('Erro ao ativar modo observação');
    } finally {
      setObserveLoading(false);
    }
  };

  const handleDisableObserved = async () => {
    setObserveLoading(true);
    try {
      const res = await api.setServiceMode('managed');
      if (res.success) {
        toast.success('Modo gerenciado restaurado');
        queryClient.invalidateQueries({ queryKey: ['service-mode'] });
        queryClient.invalidateQueries({ queryKey: ['settings'] });
        refetchMode();
      } else {
        toast.error(`Falha ao restaurar modo: ${res.error}`);
      }
    } catch (e) {
      toast.error('Erro ao restaurar modo gerenciado');
    } finally {
      setObserveLoading(false);
    }
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

      {/* Service Mode Banner */}
      <div className={`noc-panel border-2 ${isImported ? 'border-yellow-500/50' : 'border-border'}`}>
        <div className="noc-panel-header flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isImported ? <ShieldAlert size={14} className="text-yellow-500" /> : <ShieldCheck size={14} className="text-emerald-500" />}
            Modo de Operação
          </div>
          <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold uppercase ${
            isImported
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-emerald-500/20 text-emerald-400'
          }`}>
            {serviceMode}
          </span>
        </div>

        {isImported ? (
          <div className="space-y-3">
            <div className="text-sm text-yellow-400/90">
              <strong>Modo IMPORT ativo</strong> — O sistema está em observação passiva (somente leitura).
              Deploy, apply e rollback estão <strong>bloqueados</strong>. Nenhuma alteração será feita no host.
            </div>
            {serviceModeData?.import_timestamp && (
              <div className="text-xs text-muted-foreground">
                Importado em: <span className="font-mono">{safeDate(serviceModeData.import_timestamp)}</span>
              </div>
            )}
            {serviceModeData?.imported_vips && serviceModeData.imported_vips.length > 0 && (
              <div className="text-xs text-muted-foreground">
                VIPs importados: {serviceModeData.imported_vips.map((v: any) => v.vip_ip).join(', ')}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleClearImport}
                disabled={clearLoading}
              >
                {clearLoading ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Trash2 size={12} className="mr-1" />}
                Desativar Import
              </Button>
            </div>
            <div className="text-xs text-muted-foreground/70 border-t border-border pt-2">
              Ao desativar, o comportamento DNS permanece idêntico — somente o modelo interno é limpo.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <strong>Modo Gerenciado</strong> — Deploy e apply estão habilitados.
            </div>
            <div className="text-sm text-muted-foreground">
              Para monitorar um servidor já configurado manualmente sem risco de alteração, use o <strong>Import</strong>.
              Ele lê a topologia ativa (nftables, unbound, rotas) e importa para o banco interno em modo somente leitura.
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleImport}
              disabled={importLoading}
            >
              {importLoading ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Import size={12} className="mr-1" />}
              Importar Infraestrutura (Read-Only)
            </Button>
            <div className="text-xs text-muted-foreground/70 border-t border-border pt-2">
              <strong>Garantias:</strong> nenhum arquivo é escrito, nenhum serviço é reiniciado, nenhum sysctl é aplicado.
              Apenas leitura via nft, ip, ss, unbound-control.
            </div>
          </div>
        )}
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header flex items-center gap-2">
          <Settings2 size={14} /> Runtime
        </div>
        <div className="space-y-2 text-sm">
          {[
            ['Modo', import.meta.env.MODE],
            ['API Base', import.meta.env.VITE_API_URL || 'não configurado'],
            ['Service Mode', serviceMode],
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
