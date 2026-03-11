import { useState } from 'react';

const logSources = ['apply', 'unbound', 'frr', 'nftables', 'system'];

const mockLogs: Record<string, string[]> = {
  apply: [
    '[2026-03-10 14:30:01] INFO  Starting configuration apply...',
    '[2026-03-10 14:30:02] OK    Packages verified: unbound frr nftables',
    '[2026-03-10 14:30:03] OK    Generated /etc/unbound/unbound01.conf',
    '[2026-03-10 14:30:03] OK    Generated /etc/unbound/unbound02.conf',
    '[2026-03-10 14:30:03] OK    Generated /etc/unbound/unbound03.conf',
    '[2026-03-10 14:30:04] OK    Generated /etc/unbound/unbound04.conf',
    '[2026-03-10 14:30:04] OK    Generated /etc/nftables.conf',
    '[2026-03-10 14:30:05] OK    Generated /etc/frr/frr.conf',
    '[2026-03-10 14:30:06] OK    Services restarted successfully',
    '[2026-03-10 14:30:08] OK    Validation passed — all instances responding',
    '[2026-03-10 14:30:08] INFO  Apply completed successfully',
  ],
  unbound: [
    '[2026-03-11 08:00:01] unbound[1234]: start of service (unbound 1.21.1)',
    '[2026-03-11 08:00:01] unbound[1234]: service started (4 threads)',
    '[2026-03-11 08:15:32] unbound[1234]: info: 127.0.0.1 google.com. A IN',
    '[2026-03-11 08:15:33] unbound[1234]: info: response for google.com. A IN NOERROR 1.2ms',
  ],
  frr: [
    '[2026-03-11 08:00:00] ospfd[890]: OSPFd starting: vty@2604',
    '[2026-03-11 08:00:01] ospfd[890]: Neighbor 172.28.22.1 state Full',
    '[2026-03-11 08:00:01] ospfd[890]: Neighbor 172.28.22.2 state Full',
  ],
  nftables: [
    '[2026-03-11 08:00:00] nftables: ruleset loaded successfully',
    '[2026-03-11 08:00:00] nftables: table ip nat — 2 chains, 4 rules',
  ],
  system: [
    '[2026-03-11 08:00:00] systemd: Started DNS Control Panel',
    '[2026-03-11 08:00:00] systemd: Started Unbound DNS resolver (instance 01)',
    '[2026-03-11 08:00:00] systemd: Started Unbound DNS resolver (instance 02)',
    '[2026-03-11 08:00:00] systemd: Started Unbound DNS resolver (instance 03)',
    '[2026-03-11 08:00:00] systemd: Started Unbound DNS resolver (instance 04)',
  ],
};

export default function LogsPage() {
  const [source, setSource] = useState('apply');
  const [search, setSearch] = useState('');

  const logs = (mockLogs[source] || []).filter(l => !search || l.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Logs</h1>
        <p className="text-sm text-muted-foreground">Logs do sistema e dos serviços</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {logSources.map(s => (
          <button
            key={s}
            onClick={() => setSource(s)}
            className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
              source === s
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Buscar nos logs..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 text-sm bg-secondary border border-border rounded font-mono text-foreground placeholder:text-muted-foreground"
      />

      <div className="terminal-output max-h-[500px]">
        {logs.length === 0 ? (
          <p className="text-muted-foreground">Nenhum log encontrado.</p>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`py-0.5 ${
              line.includes('ERROR') || line.includes('FAIL') ? 'text-destructive' :
              line.includes('OK') || line.includes('success') ? 'text-success' :
              line.includes('WARN') ? 'text-warning' : ''
            }`}>
              {line}
            </div>
          ))
        )}
      </div>

      <button className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground border border-border rounded hover:bg-secondary/80">
        Exportar Logs
      </button>
    </div>
  );
}
