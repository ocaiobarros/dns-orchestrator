import { useState } from 'react';
import { Play } from 'lucide-react';

const commands = [
  { label: 'systemctl status unbound*', cmd: 'systemctl status unbound01 unbound02 unbound03 unbound04', category: 'services' },
  { label: 'ss -lunp | grep :53', cmd: 'ss -lunp | grep :53', category: 'network' },
  { label: 'ip addr show lo0', cmd: 'ip addr show lo0', category: 'network' },
  { label: 'ip route', cmd: 'ip route', category: 'network' },
  { label: 'unbound-control status', cmd: 'unbound-control -c /etc/unbound/unbound01.conf status', category: 'dns' },
  { label: 'dig @VIP google.com', cmd: 'dig @4.2.2.5 google.com +short', category: 'dns' },
  { label: 'dig @unbound01 google.com', cmd: 'dig @100.126.255.101 google.com +short', category: 'dns' },
  { label: 'dig @unbound02 google.com', cmd: 'dig @100.126.255.102 google.com +short', category: 'dns' },
  { label: 'nft list ruleset', cmd: 'nft list ruleset', category: 'nat' },
  { label: 'vtysh show running', cmd: 'vtysh -c "show running-config"', category: 'frr' },
  { label: 'vtysh show ip ospf neighbor', cmd: 'vtysh -c "show ip ospf neighbor"', category: 'frr' },
  { label: 'Health Check Completo', cmd: 'dns-wizard-diagnose --full', category: 'system' },
];

const mockOutputs: Record<string, string> = {
  'ss -lunp | grep :53': `udp   UNCONN  0  0  100.126.255.101:53  0.0.0.0:*  users:(("unbound",pid=1234,fd=5))
udp   UNCONN  0  0  100.126.255.102:53  0.0.0.0:*  users:(("unbound",pid=1235,fd=5))
udp   UNCONN  0  0  100.126.255.103:53  0.0.0.0:*  users:(("unbound",pid=1236,fd=5))
udp   UNCONN  0  0  100.126.255.104:53  0.0.0.0:*  users:(("unbound",pid=1237,fd=5))`,
  'dig @4.2.2.5 google.com +short': '142.250.79.46',
  'dig @100.126.255.101 google.com +short': '142.250.79.46',
  'dig @100.126.255.102 google.com +short': '142.250.79.46',
};

export default function TroubleshootPage() {
  const [results, setResults] = useState<Record<string, string>>({});

  const runCommand = (cmd: string) => {
    // In real deployment, this calls the backend API
    setResults(prev => ({
      ...prev,
      [cmd]: mockOutputs[cmd] || `$ ${cmd}\n[Resultado simulado — execução real requer backend ativo no Debian 13]`,
    }));
  };

  const runAll = () => {
    commands.forEach(c => runCommand(c.cmd));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Troubleshooting</h1>
          <p className="text-sm text-muted-foreground">Testes e diagnóstico em tempo real</p>
        </div>
        <button onClick={runAll} className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90">
          <Play size={14} /> Executar Todos
        </button>
      </div>

      <div className="space-y-3">
        {commands.map(c => (
          <div key={c.cmd} className="noc-panel">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{c.category}</span>
                <span className="text-sm font-medium">{c.label}</span>
              </div>
              <button
                onClick={() => runCommand(c.cmd)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80"
              >
                <Play size={12} /> Run
              </button>
            </div>
            <code className="text-xs text-muted-foreground font-mono">$ {c.cmd}</code>
            {results[c.cmd] && (
              <pre className="terminal-output mt-2">{results[c.cmd]}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
