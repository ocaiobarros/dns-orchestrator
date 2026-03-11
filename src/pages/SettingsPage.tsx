import { useNavigate } from 'react-router-dom';
import { Download, Upload, Copy, FileCheck, Stethoscope, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { generateAllFiles } from '@/lib/config-generator';
import { DEFAULT_CONFIG } from '@/lib/types';

export default function SettingsPage() {
  const navigate = useNavigate();

  const handleExportConfig = () => {
    const blob = new Blob([JSON.stringify(DEFAULT_CONFIG, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dns-control-profile.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Perfil exportado');
  };

  const handleExportReport = () => {
    const files = generateAllFiles(DEFAULT_CONFIG);
    const report = `# DNS Control — Relatório Técnico
Gerado em: ${new Date().toISOString()}

## Configuração Atual
${JSON.stringify(DEFAULT_CONFIG, null, 2)}

## Arquivos Gerados (${files.length})
${files.map(f => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join('\n\n')}
`;
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dns-control-report.md';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Relatório gerado');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Administração e gestão de perfis</p>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Autenticação</div>
        <div className="space-y-3 text-sm">
          {[
            ['Tipo', 'Local (user/password)'],
            ['Usuário admin', 'admin'],
            ['Bind', '0.0.0.0:8443'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Gestão de Perfis</div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExportConfig} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <Download size={12} /> Exportar Configuração
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <Upload size={12} /> Importar Perfil
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <Copy size={12} /> Clonar Instalação
          </button>
          <button onClick={handleExportReport} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <BookOpen size={12} /> Gerar Relatório Técnico
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <FileCheck size={12} /> Validar Ambiente
          </button>
          <button onClick={() => navigate('/troubleshoot')} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
            <Stethoscope size={12} /> Diagnóstico Completo
          </button>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Aplicação Parcial</div>
        <p className="text-xs text-muted-foreground mb-3">Aplique apenas partes específicas da configuração sem reiniciar tudo.</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Aplicar Somente DNS', scope: 'dns' },
            { label: 'Aplicar Somente Rede', scope: 'network' },
            { label: 'Aplicar Somente FRR', scope: 'frr' },
            { label: 'Aplicar Somente nftables', scope: 'nftables' },
          ].map(item => (
            <button key={item.scope} className="px-3 py-1.5 text-xs bg-primary/15 text-primary rounded border border-primary/30 hover:bg-primary/25 transition-colors">
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Informações da Aplicação</div>
        <div className="space-y-2 text-sm">
          {[
            ['Nome', 'DNS Control'],
            ['Versão', '1.0.0'],
            ['Target OS', 'Debian 13 (Trixie)'],
            ['Backend', 'Python 3.12 + FastAPI'],
            ['Database', 'SQLite'],
            ['Config Dir', '/var/lib/dns-control/'],
            ['Log Dir', '/var/log/dns-control/'],
            ['Install Dir', '/opt/dns-control/'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between py-1 border-b border-border last:border-0">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-mono">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
