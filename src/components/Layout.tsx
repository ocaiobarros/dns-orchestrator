import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, Network, Globe, Shield, Router,
  FileText, Wrench, Settings, History, FolderOpen, Menu, X, Wand2, Users, LogOut,
  HeartPulse, BarChart3, Bell,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useNoc } from '@/lib/noc-context';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, adminOnly: false },
  { path: '/kiosk', label: 'NOC / Kiosk', icon: HeartPulse, adminOnly: false },
  { path: '/wizard', label: 'Wizard', icon: Wand2, adminOnly: true },
  { path: '/services', label: 'Serviços', icon: Server, adminOnly: true },
  { path: '/network', label: 'Rede', icon: Network, adminOnly: true },
  { path: '/dns', label: 'DNS', icon: Globe, adminOnly: false },
  { path: '/nat', label: 'NAT / Balanceamento', icon: Shield, adminOnly: true },
  { path: '/ospf', label: 'OSPF / FRR', icon: Router, adminOnly: true },
  { path: '/metrics', label: 'Métricas', icon: BarChart3, adminOnly: false },
  { path: '/events', label: 'Eventos', icon: Bell, adminOnly: false },
  { path: '/logs', label: 'Logs', icon: FileText, adminOnly: true },
  { path: '/troubleshoot', label: 'Troubleshooting', icon: Wrench, adminOnly: true },
  { path: '/files', label: 'Arquivos', icon: FolderOpen, adminOnly: true },
  { path: '/history', label: 'Histórico', icon: History, adminOnly: true },
  { path: '/settings', label: 'Configurações', icon: Settings, adminOnly: true },
  { path: '/users', label: 'Usuários', icon: Users, adminOnly: true },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();
  const { fullscreen } = useNoc();
  const isViewer = user?.role === 'viewer';

  // Filter nav items based on role
  const filteredNavItems = isViewer
    ? navItems.filter(item => !item.adminOnly)
    : navItems;

  // In fullscreen NOC mode on the dashboard, hide sidebar and header
  const isDashboard = location.pathname === '/';
  const nocMode = fullscreen && isDashboard;

  if (nocMode) {
    return (
      <div className="h-screen overflow-y-auto bg-background p-4 lg:p-6">
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/80 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-56 flex flex-col
        bg-sidebar border-r border-sidebar-border
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm font-mono">D</span>
          </div>
          <span className="font-semibold text-sidebar-accent-foreground tracking-tight">DNS Control</span>
          <button className="ml-auto lg:hidden text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {filteredNavItems.map(item => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors
                  ${active
                    ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }
                `}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-3 border-t border-sidebar-border space-y-2">
          {user && (
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs text-muted-foreground font-mono truncate">{user.username}</span>
                <span className={`text-[9px] font-mono font-bold uppercase px-1 py-0.5 rounded ${
                  user.role === 'viewer' ? 'bg-accent/20 text-accent' : 'bg-primary/20 text-primary'
                }`}>{user.role}</span>
              </div>
              <button
                onClick={logout}
                className="text-muted-foreground hover:text-destructive transition-colors"
                title="Sair"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground font-mono px-1">v2.0.0 · Carrier Edition</p>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 flex items-center gap-3 px-4 border-b border-border bg-card">
          <button className="lg:hidden text-foreground" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <h1 className="text-sm font-medium text-foreground">
            {navItems.find(n => n.path === location.pathname)?.label || 'DNS Control'}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <span className="status-dot-ok" />
            <span className="text-xs text-muted-foreground font-mono">Operacional</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
