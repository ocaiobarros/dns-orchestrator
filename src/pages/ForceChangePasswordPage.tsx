import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, KeyRound, AlertCircle, Check } from 'lucide-react';

export default function ForceChangePasswordPage() {
  const { user, loading, forceChangePassword } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  const passwordValid = newPassword.length >= 6;
  const passwordsMatch = newPassword === confirmPassword;
  const canSubmit = passwordValid && passwordsMatch && confirmPassword.length > 0;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);

    const result = await forceChangePassword(newPassword);
    if (!result.success) {
      setError(result.error || 'Erro ao alterar senha');
    }
    setSubmitting(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-warning flex items-center justify-center">
            <KeyRound className="text-warning-foreground" size={24} />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Troca de Senha Obrigatória</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Defina uma nova senha para continuar usando o sistema.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="noc-panel space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border mb-2">
            <KeyRound size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Nova senha
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle size={14} className="text-destructive shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              disabled={submitting}
            />
            {newPassword.length > 0 && !passwordValid && (
              <p className="text-xs text-destructive">Mínimo 6 caracteres</p>
            )}
            {passwordValid && (
              <p className="text-xs text-success flex items-center gap-1">
                <Check size={12} /> Comprimento adequado
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              disabled={submitting}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-destructive">Senhas não conferem</p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={!canSubmit || submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Alterando...
              </>
            ) : (
              'Alterar senha e continuar'
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
