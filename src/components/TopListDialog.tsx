import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export interface TopListItem {
  label: string;
  count: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  items: TopListItem[];
  itemLabel?: string; // e.g. "domínios", "clientes"
  source?: string;
  accent?: 'mint' | 'violet';
}

export default function TopListDialog({
  open, onOpenChange, title, items, itemLabel = 'itens', source, accent = 'mint',
}: Props) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return items;
    return items.filter((i) => i.label.toLowerCase().includes(term));
  }, [items, q]);

  const barColor =
    accent === 'violet'
      ? 'linear-gradient(90deg, hsl(270 75% 65%), hsl(290 80% 70%))'
      : 'linear-gradient(90deg, hsl(162 72% 51%), hsl(162 90% 60%))';
  const max = Math.max(1, ...items.map((i) => i.count));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,32rem)] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        <div className="px-5 py-3 border-b border-border">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar…"
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>

        <div className="max-h-[340px] overflow-y-auto px-5 py-3">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              {q ? `Nenhum resultado para "${q}"` : 'Sem dados'}
            </div>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((it, i) => {
                const pct = (it.count / max) * 100;
                return (
                  <div
                    key={`${it.label}-${i}`}
                    className="grid grid-cols-[28px_1fr_auto] gap-2 items-center text-[12px] font-mono py-0.5"
                  >
                    <span className="text-muted-foreground/60 tabular-nums text-right">{i + 1}.</span>
                    <div className="min-w-0">
                      <div className="text-foreground/90 truncate" title={it.label}>{it.label}</div>
                      <div className="h-1 mt-1 rounded-full overflow-hidden" style={{ background: 'hsl(220 42% 9%)' }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                      </div>
                    </div>
                    <span className="text-primary tabular-nums whitespace-nowrap">
                      {it.count.toLocaleString('de-DE')}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span>
            {filtered.length} de {items.length} {itemLabel}
          </span>
          {source && <span>Fonte: {source}</span>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
