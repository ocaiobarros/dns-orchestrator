import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function ObservedQueriesPage() {
  const [instance, setInstance] = useState<string>('');
  const [qtype, setQtype] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['recent-queries', instance, qtype],
    queryFn: async () => {
      const res = await api.getRecentQueries({ instance: instance || undefined, qtype: qtype || undefined, limit: 500 });
      return res.success ? res.data : null;
    },
    refetchInterval: 15000,
  });

  const items = data?.items ?? [];
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const s = search.toLowerCase();
    return items.filter(
      (q) => q.domain.toLowerCase().includes(s) || q.client.toLowerCase().includes(s),
    );
  }, [items, search]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Últimas Queries DNS</h1>
          <p className="text-xs text-muted-foreground">
            Buffer do collector — modo: <span className="font-mono text-primary">{data?.telemetry_mode ?? '—'}</span>{' '}
            · fonte: <span className="font-mono text-primary">{data?.log_source ?? '—'}</span>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
          Atualizar
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Instância</label>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
            >
              <option value="">Todas</option>
              {(data?.available_instances ?? []).map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Tipo (qtype)</label>
            <select
              className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
              value={qtype}
              onChange={(e) => setQtype(e.target.value)}
            >
              <option value="">Todos</option>
              {(data?.available_types ?? []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Buscar (domínio/cliente)</label>
            <div className="relative mt-1">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ex: google.com ou 192.168.1.10"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Queries ({filtered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              <Loader2 size={14} className="mr-2 animate-spin" /> Carregando…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              Nenhuma query encontrada. Verifique se o collector está coletando logs (modo logless?).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th className="pb-2 pr-3">Hora</th>
                    <th className="pb-2 pr-3">Cliente</th>
                    <th className="pb-2 pr-3">Domínio</th>
                    <th className="pb-2 pr-3">Tipo</th>
                    {filtered.some((q) => q.instance) && <th className="pb-2 pr-3">Instância</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((q, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0 hover:bg-muted/30">
                      <td className="py-1.5 pr-3 text-muted-foreground">{q.time}</td>
                      <td className="py-1.5 pr-3 text-primary">{q.client}</td>
                      <td className="py-1.5 pr-3 break-all">{q.domain}</td>
                      <td className="py-1.5 pr-3">
                        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px]">{q.type}</span>
                      </td>
                      {filtered.some((qq) => qq.instance) && (
                        <td className="py-1.5 pr-3 text-muted-foreground">{q.instance ?? '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
