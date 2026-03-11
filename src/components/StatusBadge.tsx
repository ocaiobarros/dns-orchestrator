interface StatusBadgeProps {
  status: 'running' | 'stopped' | 'error' | 'unknown' | 'success' | 'failed' | 'partial';
}

const styles: Record<string, string> = {
  running: 'bg-success/15 text-success border-success/30',
  success: 'bg-success/15 text-success border-success/30',
  stopped: 'bg-muted text-muted-foreground border-border',
  error: 'bg-destructive/15 text-destructive border-destructive/30',
  failed: 'bg-destructive/15 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
  partial: 'bg-warning/15 text-warning border-warning/30',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono border ${styles[status] || styles.unknown}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'running' || status === 'success' ? 'bg-success' :
        status === 'error' || status === 'failed' ? 'bg-destructive' :
        status === 'partial' ? 'bg-warning' : 'bg-muted-foreground'
      }`} />
      {status}
    </span>
  );
}
