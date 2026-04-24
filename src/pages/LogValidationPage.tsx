import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertTriangle, FileText, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const parserBadge = (p: string) => {
  if (p === 'journalctl') return <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400 border border-blue-500/30"><Database size={10} /> journalctl</span>;
  if (p === 'logfile') return <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/30"><FileText size={10} /> logfile</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground"><AlertTriangle size={10} /> nenhum</span>;
};

export default function LogValidationPage() {
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['log-validation'],
    queryFn: async () => {
      const res = await api.getLogValidation();
      return res.success ? res.data : null;
    },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Validação de Logs DNS</h1>
          <p className="text-xs text-muted-foreground">
            Mostra qual logfile cada instância usa e qual parser está alimentando o dashboard.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          <Loader2 size={14} className="mr-2 animate-spin" /> Carregando…
        </div>
      ) : !data ? (
        <Card><CardContent className="py-8 text-center text-xs text-muted-foreground">Indisponível.</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">Modo de Telemetria</CardTitle></CardHeader>
              <CardContent>
                <div className={`text-lg font-bold font-mono ${data.telemetry_mode === 'log' ? 'text-emerald-400' : 'text-yellow-400'}`}>
                  {data.telemetry_mode}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">Parser Ativo</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-col gap-1">
                  {parserBadge(data.active_parser)}
                  <span className="text-[10px] font-mono text-muted-foreground break-all">{data.active_path || '—'}</span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">Queries no Último Ciclo</CardTitle></CardHeader>
              <CardContent>
                <div className="text-lg font-bold font-mono text-primary">{data.queries_parsed_last_cycle}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1"><CardTitle className="text-[11px] uppercase tracking-wider text-muted-foreground">Disponibilidade</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-1">
                    {data.domains_available ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-destructive" />}
                    Top Domains
                  </div>
                  <div className="flex items-center gap-1">
                    {data.clients_available ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-destructive" />}
                    Top Clients
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Configuração por Instância</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="pb-2 pr-3">Instância</th>
                      <th className="pb-2 pr-3">log-queries</th>
                      <th className="pb-2 pr-3">use-syslog</th>
                      <th className="pb-2 pr-3">logfile</th>
                      <th className="pb-2 pr-3">Parser esperado</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {data.instances.map((inst) => (
                      <tr key={inst.instance} className="border-b border-border/40 last:border-0">
                        <td className="py-1.5 pr-3 font-semibold text-primary">{inst.instance}</td>
                        <td className="py-1.5 pr-3">
                          {inst.log_queries ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-destructive" />}
                        </td>
                        <td className="py-1.5 pr-3">
                          {inst.use_syslog ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-muted-foreground" />}
                        </td>
                        <td className="py-1.5 pr-3 text-muted-foreground break-all">{inst.logfile || '—'}</td>
                        <td className="py-1.5 pr-3">{parserBadge(inst.expected_parser)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {!data.domains_available && (
            <Card className="border-yellow-500/40 bg-yellow-500/5">
              <CardContent className="py-3 text-xs text-yellow-300">
                <strong>Modo Logless detectado.</strong> Top Domains e Top Clients ficarão vazios.
                Para habilitar telemetria de queries, configure no Unbound: <code className="font-mono">log-queries: yes</code> e <code className="font-mono">use-syslog: yes</code> (ou defina <code className="font-mono">logfile:</code> com caminho válido), e reinicie a instância.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
