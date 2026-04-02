import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Loader2 } from 'lucide-react';

// Routes that viewer users are allowed to access
const VIEWER_ALLOWED_ROUTES = ['/', '/kiosk', '/metrics', '/events', '/dns'];

// Routes that are admin-only
const ADMIN_ONLY_ROUTES = ['/wizard', '/settings', '/users', '/files', '/history', '/troubleshoot', '/services', '/network', '/nat', '/ospf'];

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground font-mono">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Force password change redirect
  if (user.mustChangePassword) {
    return <Navigate to="/force-change-password" replace />;
  }

  // Viewer role restrictions — redirect to kiosk if trying to access admin routes
  if (user.role === 'viewer') {
    const isAllowed = VIEWER_ALLOWED_ROUTES.some(r => location.pathname === r);
    if (!isAllowed && ADMIN_ONLY_ROUTES.some(r => location.pathname === r)) {
      return <Navigate to="/kiosk" replace />;
    }
  }

  return <>{children}</>;
}
