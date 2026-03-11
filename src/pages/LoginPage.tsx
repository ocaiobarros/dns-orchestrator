import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const { user, login, loading: sessionLoading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (sessionLoading) return null;
  if (user && !user.mustChangePassword) return <Navigate to="/" replace />;
  if (user && user.mustChangePassword) return <Navigate to="/force-change-password" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username, password);
    if (!result.success) {
      setError(result.error || 'Falha na autenticação');
    } else if (result.mustChangePassword) {
      navigate('/force-change-password', { replace: true });
    }
    setLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xl font-mono">D</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground tracking-tight">DNS Control</h1>
            <p className="text-sm text-muted-foreground mt-1">Painel de gerenciamento</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="noc-panel space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border mb-2">
            <Lock size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Autenticação</span>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle size={14} className="text-destructive shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="username">Usuário</Label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              autoFocus
              disabled={loading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !username || !password}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Autenticando...
              </>
            ) : (
              'Entrar'
            )}
          </Button>

          {!import.meta.env.VITE_API_URL && (
            <p className="text-xs text-center text-muted-foreground font-mono pt-2">
              Preview: admin/admin (troca de senha) · outro/qualquer (acesso direto)
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
