import { useAuth } from '@/lib/auth';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function SessionTimeoutModal() {
  const { showSessionWarning, sessionSecondsLeft, dismissSessionWarning, logout } = useAuth();

  const minutes = Math.floor(sessionSecondsLeft / 60);
  const seconds = sessionSecondsLeft % 60;
  const timeDisplay = minutes > 0
    ? `${minutes}m ${seconds.toString().padStart(2, '0')}s`
    : `${seconds}s`;

  return (
    <Dialog open={showSessionWarning} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Sessão expirando
          </DialogTitle>
          <DialogDescription>
            Sua sessão irá expirar em breve. Deseja continuar?
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center py-6">
          <div className="text-center">
            <p className="text-4xl font-mono font-bold text-warning">{timeDisplay}</p>
            <p className="text-sm text-muted-foreground mt-2">até o logout automático</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={logout}>
            Encerrar sessão
          </Button>
          <Button onClick={dismissSessionWarning}>
            Continuar conectado
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
