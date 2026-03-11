import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Server, Network, Globe, Shield, Router,
  FileText, Wrench, Settings, History, FolderOpen, Menu, X, Wand2, Users, LogOut
} from 'lucide-react';
import { useAuth } from '@/lib/auth';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/wizard', label: 'Wizard', icon: Wand2 },
  { path: '/services', label: 'Serviços', icon: Server },
  { path: '/network', label: 'Rede', icon: Network },
  { path: '/dns', label: 'DNS', icon: Globe },
  { path: '/nat', label: 'NAT / Balanceamento', icon: Shield },
  { path: '/ospf', label: 'OSPF / FRR', icon: Router },
  { path: '/logs', label: 'Logs', icon: FileText },
  { path: '/troubleshoot', label: 'Troubleshooting', icon: Wrench },
  { path: '/files', label: 'Arquivos', icon: FolderOpen },
  { path: '/history', label: 'Histórico', icon: History },
  { path: '/settings', label: 'Configurações', icon: Settings },
  { path: '/users', label: 'Usuários', icon: Users },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, logout } = useAuth();

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
          {navItems.map(item => {
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

        <div className="px-4 py-3 border-t border-sidebar-border">
          <p className="text-xs text-muted-foreground font-mono">v1.0.0 · Debian 13</p>
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
