import type { ServiceState, ApplyStatus } from '@/lib/types';

type BadgeStatus = ServiceState | ApplyStatus | 'success';

const styles: Record<string, string> = {
  running: 'bg-success/15 text-success border-success/30',
  success: 'bg-success/15 text-success border-success/30',
  starting: 'bg-accent/15 text-accent border-accent/30',
  reloading: 'bg-accent/15 text-accent border-accent/30',
  stopped: 'bg-muted text-muted-foreground border-border',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
  partial: 'bg-warning/15 text-warning border-warning/30',
  'dry-run': 'bg-accent/15 text-accent border-accent/30',
};

const dotColors: Record<string, string> = {
  running: 'bg-success',
  success: 'bg-success',
  starting: 'bg-accent',
  reloading: 'bg-accent',
  error: 'bg-destructive',
  failed: 'bg-destructive',
  partial: 'bg-warning',
  'dry-run': 'bg-accent',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${styles[status] || styles.unknown}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColors[status] || 'bg-muted-foreground'}`} />
      {status}
    </span>
  );
}
