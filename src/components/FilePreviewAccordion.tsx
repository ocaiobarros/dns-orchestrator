// ============================================================
// DNS Control — File Preview Accordion
// Expandable per-file viewer for generated config artifacts
// ============================================================

import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Copy, Check, AlertTriangle } from 'lucide-react';

interface GeneratedFileEntry {
  path: string;
  content: string;
}

interface FilePreviewAccordionProps {
  files: GeneratedFileEntry[];
  maxPreviewLines?: number;
}

function getFileCategory(path: string): { label: string; color: string } {
  if (path.includes('/unbound/')) return { label: 'Unbound', color: 'text-accent' };
  if (path.includes('/nftables')) return { label: 'nftables', color: 'text-primary' };
  if (path.includes('/sysctl')) return { label: 'Sysctl', color: 'text-muted-foreground' };
  if (path.includes('/network/') || path.includes('interfaces')) return { label: 'Network', color: 'text-warning' };
  if (path.includes('/frr/')) return { label: 'FRR', color: 'text-success' };
  if (path.includes('systemd') || path.endsWith('.service')) return { label: 'Systemd', color: 'text-primary' };
  return { label: 'Config', color: 'text-muted-foreground' };
}

function getServicesAffected(path: string): string[] {
  if (path.includes('/unbound/') && path.endsWith('.conf')) {
    const match = path.match(/unbound(\d+)\.conf/);
    return match ? [`unbound${match[1]}`] : ['unbound'];
  }
  if (path.includes('/nftables')) return ['nftables'];
  if (path.includes('/frr/')) return ['frr'];
  if (path.includes('/network/') || path.includes('post-up')) return ['networking'];
  if (path.endsWith('.service')) {
    const name = path.split('/').pop()?.replace('.service', '');
    return name ? [name] : [];
  }
  return [];
}

function FileEntry({ file, maxLines }: { file: GeneratedFileEntry; maxLines: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cat = getFileCategory(file.path);
  const services = getServicesAffected(file.path);
  const lines = file.content.split('\n');
  const truncated = lines.length > maxLines;

  const copyContent = () => {
    navigator.clipboard.writeText(file.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-border rounded overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-secondary hover:bg-secondary/80 transition-colors"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <FileText size={12} className={cat.color} />
        <span className="text-xs font-mono flex-1 truncate">{file.path}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded bg-background border border-border ${cat.color}`}>{cat.label}</span>
        <span className="text-[10px] text-muted-foreground">{lines.length}L</span>
      </button>
      {open && (
        <div className="relative">
          <div className="absolute top-1 right-1 flex gap-1 z-10">
            {services.length > 0 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-warning/10 border border-warning/20 text-warning flex items-center gap-1">
                <AlertTriangle size={8} /> restart: {services.join(', ')}
              </span>
            )}
            <button onClick={copyContent}
              className="p-1 rounded bg-secondary border border-border hover:bg-secondary/80 text-muted-foreground">
              {copied ? <Check size={10} className="text-success" /> : <Copy size={10} />}
            </button>
          </div>
          <pre className="terminal-output text-[11px] leading-relaxed p-3 overflow-x-auto max-h-[400px] overflow-y-auto">
            {(truncated && !open ? lines.slice(0, maxLines) : lines).map((line, i) => {
              let color = '';
              if (line.trimStart().startsWith('#') || line.trimStart().startsWith('!') || line.trimStart().startsWith('//')) color = 'text-muted-foreground/60';
              else if (line.includes('interface:') || line.includes('outgoing-interface:')) color = 'text-accent';
              else if (line.includes('access-control:')) color = 'text-warning';
              else if (line.includes('dnat to') || line.includes('counter')) color = 'text-primary';
              return <div key={i} className={color}><span className="select-none text-muted-foreground/30 mr-3 inline-block w-5 text-right">{i + 1}</span>{line || '\u00A0'}</div>;
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function FilePreviewAccordion({ files, maxPreviewLines = 200 }: FilePreviewAccordionProps) {
  const [expandAll, setExpandAll] = useState(false);

  // Group files by category
  const categories = new Map<string, GeneratedFileEntry[]>();
  files.forEach(f => {
    const cat = getFileCategory(f.path).label;
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(f);
  });

  const allServices = new Set<string>();
  files.forEach(f => getServicesAffected(f.path).forEach(s => allServices.add(s)));

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-medium">{files.length} arquivos</span>
          {[...categories.entries()].map(([cat, catFiles]) => (
            <span key={cat} className="text-muted-foreground">{cat}: {catFiles.length}</span>
          ))}
        </div>
        <button onClick={() => setExpandAll(!expandAll)}
          className="text-[10px] text-accent hover:underline">
          {expandAll ? 'Recolher todos' : 'Expandir todos'}
        </button>
      </div>

      {/* Services warning */}
      {allServices.size > 0 && (
        <div className="flex items-center gap-2 p-2 rounded bg-warning/5 border border-warning/20 text-xs text-warning">
          <AlertTriangle size={12} />
          <span>Serviços que serão reiniciados: <strong>{[...allServices].join(', ')}</strong></span>
        </div>
      )}

      {/* File list */}
      <div className="space-y-1">
        {files.map(f => (
          <FileEntry key={f.path} file={f} maxLines={maxPreviewLines} />
        ))}
      </div>
    </div>
  );
}
