import { Loader2, AlertCircle, Inbox } from 'lucide-react';

export function LoadingState({ message = 'Carregando...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Loader2 size={24} className="animate-spin mb-2" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <AlertCircle size={24} className="text-destructive mb-2" />
      <span className="text-sm text-destructive mb-3">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
      <Inbox size={24} className="mb-2" />
      <span className="text-sm font-medium">{title}</span>
      {description && <span className="text-xs mt-1">{description}</span>}
    </div>
  );
}
