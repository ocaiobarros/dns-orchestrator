import type { DiffLine } from '@/lib/types';

interface Props {
  path: string;
  oldContent: string;
  newContent: string;
}

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  let oldIdx = 0;
  let newIdx = 0;

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldIdx < oldLines.length ? oldLines[oldIdx] : undefined;
    const newLine = newIdx < newLines.length ? newLines[newIdx] : undefined;

    if (oldLine === newLine) {
      result.push({ type: 'context', content: oldLine || '', oldLineNumber: oldIdx + 1, newLineNumber: newIdx + 1 });
      oldIdx++;
      newIdx++;
    } else {
      if (oldLine !== undefined) {
        result.push({ type: 'remove', content: oldLine, oldLineNumber: oldIdx + 1, newLineNumber: null });
        oldIdx++;
      }
      if (newLine !== undefined) {
        result.push({ type: 'add', content: newLine, oldLineNumber: null, newLineNumber: newIdx + 1 });
        newIdx++;
      }
    }
  }

  return result;
}

export default function DiffViewer({ path, oldContent, newContent }: Props) {
  const lines = computeDiff(oldContent, newContent);
  const hasChanges = lines.some(l => l.type !== 'context');

  return (
    <div className="noc-panel">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm text-muted-foreground">{path}</span>
        {!hasChanges && <span className="text-xs text-muted-foreground">Sem alterações</span>}
      </div>
      <div className="overflow-auto max-h-[500px] font-mono text-xs border border-border rounded">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex ${
              line.type === 'add' ? 'bg-success/10' :
              line.type === 'remove' ? 'bg-destructive/10' : ''
            }`}
          >
            <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border shrink-0">
              {line.oldLineNumber || ''}
            </span>
            <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border shrink-0">
              {line.newLineNumber || ''}
            </span>
            <span className={`w-5 text-center shrink-0 ${
              line.type === 'add' ? 'text-success' :
              line.type === 'remove' ? 'text-destructive' : 'text-muted-foreground'
            }`}>
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
            <span className="flex-1 px-2 whitespace-pre">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
