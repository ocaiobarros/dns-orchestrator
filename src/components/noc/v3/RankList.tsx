interface Item { label: string; value: string | number; barPct?: number; barColor?: 'mint' | 'violet'; }

export default function RankList({ items, onSeeAll }: { items: Item[]; onSeeAll?: () => void }) {
  const max = Math.max(1, ...items.map((i) => (typeof i.value === 'number' ? i.value : 0)));
  return (
    <div className="space-y-1.5">
      {items.length === 0 && <div className="text-muted-foreground text-[11px] py-4 text-center">Sem dados</div>}
      {items.slice(0, 5).map((it, i) => {
        const num = typeof it.value === 'number' ? it.value : 0;
        const pct = it.barPct ?? (num / max) * 100;
        const color = it.barColor === 'violet' ? 'hsl(var(--accent))' : 'hsl(var(--primary))';
        return (
          <div key={i} className="grid grid-cols-[16px_1fr_auto] gap-2 items-center text-[11px] font-mono py-1">
            <span className="text-muted-foreground/60">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-foreground/90 truncate">{it.label}</div>
              <div className="h-1 mt-1 rounded-full bg-noc-depth-3/50 overflow-hidden" style={{ background: 'hsl(var(--noc-depth-3))' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
              </div>
            </div>
            <span className="text-foreground/85 tabular-nums">
              {typeof it.value === 'number' ? it.value.toLocaleString() : it.value}
            </span>
          </div>
        );
      })}
      {onSeeAll && (
        <button onClick={onSeeAll} className="mt-2 text-[10px] font-mono text-muted-foreground/70 hover:text-primary transition-colors px-2 py-1.5 rounded border border-border/40 w-full">
          Ver todos
        </button>
      )}
    </div>
  );
}
