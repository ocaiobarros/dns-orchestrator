import { useState, useMemo } from 'react';
import { generateAllFiles } from '@/lib/config-generator';
import { DEFAULT_CONFIG } from '@/lib/types';
import { Download, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

export default function FilesPage() {
  const files = useMemo(() => generateAllFiles(DEFAULT_CONFIG), []);
  const [selected, setSelected] = useState(files[0]?.path ?? '');
  const [copied, setCopied] = useState(false);

  const file = files.find(f => f.path === selected);

  const handleCopy = () => {
    if (file) {
      navigator.clipboard.writeText(file.content);
      setCopied(true);
      toast.success('Copiado para o clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleExportAll = () => {
    const blob = new Blob(
      files.map(f => `# === ${f.path} ===\n${f.content}\n\n`),
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dns-control-config.txt';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Configuração exportada');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Arquivos Gerados</h1>
          <p className="text-sm text-muted-foreground">{files.length} arquivos de configuração</p>
        </div>
        <button onClick={handleExportAll} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
          <Download size={12} /> Exportar Todos
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {files.map(f => (
          <button
            key={f.path}
            onClick={() => setSelected(f.path)}
            className={`px-3 py-1.5 text-xs font-mono rounded border transition-colors ${
              selected === f.path
                ? 'bg-primary/15 text-primary border-primary/30'
                : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
            }`}
          >
            {f.path.split('/').pop()}
          </button>
        ))}
      </div>

      {file && (
        <div className="noc-panel">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-sm text-muted-foreground">{file.path}</span>
            <div className="flex gap-2">
              <button onClick={handleCopy} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
          <pre className="terminal-output max-h-[600px]">{file.content}</pre>
          <div className="mt-2 text-xs text-muted-foreground">
            {file.content.split('\n').length} linhas · {new Blob([file.content]).size} bytes
          </div>
        </div>
      )}
    </div>
  );
}
