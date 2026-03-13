import type { ApplyStep } from '@/lib/types';
import { Check, X, Loader2, SkipForward, Clock } from 'lucide-react';

interface Props {
  steps: ApplyStep[];
  showCommands?: boolean;
}

const statusIcons = {
  success: <Check size={14} className="text-success" />,
  failed: <X size={14} className="text-destructive" />,
  running: <Loader2 size={14} className="text-accent animate-spin" />,
  skipped: <SkipForward size={14} className="text-muted-foreground" />,
  pending: <Clock size={14} className="text-muted-foreground" />,
};

export default function ApplyStepsViewer({ steps, showCommands = true }: Props) {
  if (!steps || steps.length === 0) {
    return <p className="text-xs text-muted-foreground italic">Nenhum passo registrado</p>;
  }
  return (
    <div className="space-y-1">
      {steps.map((step, idx) => (
        <div key={step.order} className={`flex items-start gap-3 p-2 rounded text-sm ${
          step.status === 'failed' ? 'bg-destructive/5' : ''
        }`}>
          <div className="mt-0.5 shrink-0">{statusIcons[step.status]}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{step.name}</span>
              <span className="text-xs text-muted-foreground font-mono shrink-0">{step.durationMs}ms</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{step.output}</p>
            {showCommands && step.command && (
              <code className="text-xs text-muted-foreground font-mono block mt-1 opacity-60">$ {step.command}</code>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
