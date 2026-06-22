import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Server, Network, Globe, Shield, ShieldCheck, Router,
  FileText, Wrench, Settings, History, FolderOpen, Menu, X, Wand2, Users, LogOut,
  HeartPulse, BarChart3, Bell, Search, ChevronDown, PanelLeftClose, PanelLeftOpen,
  SlidersHorizontal, Radio,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useNoc } from '@/lib/noc-context';
import OpenResolverBanner from '@/components/OpenResolverBanner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  { path: '/policy', label: 'Política', icon: ShieldCheck, adminOnly: false },
  { path: '/logs', label: 'Logs', icon: FileText, adminOnly: true },
  { path: '/troubleshoot', label: 'Troubleshooting', icon: Wrench, adminOnly: true },
  { path: '/files', label: 'Arquivos', icon: FolderOpen, adminOnly: true },
  { path: '/history', label: 'Histórico', icon: History, adminOnly: true },
  { path: '/settings', label: 'Configurações', icon: Settings, adminOnly: true },
  { path: '/users', label: 'Usuários', icon: Users, adminOnly: true },
];

const SIDEBAR_COLLAPSED_KEY = 'dns-control:sidebar-collapsed';
const UI_DENSITY_KEY = 'dns-control:ui-density';
type UiDensity = 'compact' | 'standard' | 'comfortable';

const densityLabels: Record<UiDensity, string> = {
  compact: 'Compacta',
  standard: 'Padrão',
  comfortable: 'Confortável',
};

function readDensity(): UiDensity {
  if (typeof window === 'undefined') return 'standard';
  const value = localStorage.getItem(UI_DENSITY_KEY);
  return value === 'compact' || value === 'comfortable' ? value : 'standard';
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
  });
  const [density, setDensity] = useState<UiDensity>(() => readDensity());
  const { user, logout } = useAuth();
  const { fullscreen } = useNoc();
  const isViewer = user?.role === 'viewer';

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try { localStorage.setItem(UI_DENSITY_KEY, density); } catch {}
  }, [density]);

  const filteredNavItems = isViewer ? navItems.filter(item => !item.adminOnly) : navItems;

  const isDashboard = location.pathname === '/';
  const nocMode = fullscreen && isDashboard;

  if (nocMode) {
    return (
      <div className="h-screen overflow-y-auto bg-background p-4 lg:p-6">
        {children}
      </div>
    );
  }

  const sidebarStyle = {
    width: sidebarOpen ? 'min(var(--sidebar-width), 86vw)' : collapsed ? 'var(--sidebar-collapsed-width)' : 'var(--sidebar-width)',
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-background/80 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside style={sidebarStyle} className={`
        fixed lg:static inset-y-0 left-0 z-50 flex flex-col shrink-0
        bg-sidebar border-r border-sidebar-border
        transform transition-all duration-200 ease-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center gap-2 px-3 h-[var(--app-header-height)] border-b border-sidebar-border overflow-hidden shrink-0">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center flex-shrink-0">
            <span className="text-primary-foreground font-bold text-sm font-mono">D</span>
          </div>
          {(!collapsed || sidebarOpen) && (
            <span className="font-semibold text-sidebar-accent-foreground tracking-tight whitespace-nowrap">DNS Control</span>
          )}
          <button className="ml-auto lg:hidden text-sidebar-foreground" onClick={() => setSidebarOpen(false)}>
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 min-h-0 overflow-y-auto py-[var(--sidebar-nav-y)] px-2 space-y-0.5 overscroll-contain">
          {filteredNavItems.map(item => {
            const active = location.pathname === item.path;
            const showLabel = !collapsed || sidebarOpen;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setSidebarOpen(false)}
                title={collapsed && !sidebarOpen ? item.label : undefined}
                className={`
                  flex items-center gap-2.5 px-3 py-[var(--sidebar-link-y)] rounded-md text-sm transition-colors
                  ${collapsed && !sidebarOpen ? 'justify-center' : ''}
                  ${active
                    ? 'bg-sidebar-accent text-sidebar-primary font-medium'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }
                `}
              >
                <item.icon size={16} className="flex-shrink-0" />
                {showLabel && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-[var(--sidebar-footer-y)] border-t border-sidebar-border space-y-2 shrink-0">
          {user && (!collapsed || sidebarOpen) && (
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
          {user && collapsed && !sidebarOpen && (
            <button
              onClick={logout}
              className="w-full flex justify-center text-muted-foreground hover:text-destructive transition-colors"
              title="Sair"
            >
              <LogOut size={14} />
            </button>
          )}
          {(!collapsed || sidebarOpen) && (
            <p className="text-xs text-muted-foreground font-mono px-1">v2.0.0 · Carrier Edition</p>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-[var(--app-header-height)] flex items-center gap-3 px-[var(--app-main-padding)] border-b border-border bg-card/50 backdrop-blur shrink-0">
          {/* Mobile open */}
          <button className="lg:hidden text-foreground" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          {/* Desktop collapse toggle — visible on all pages */}
          <button
            className="hidden lg:flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:text-primary hover:bg-secondary transition-colors"
            onClick={() => setCollapsed(v => !v)}
            title={collapsed ? 'Expandir menu (Ctrl+B)' : 'Recolher menu (Ctrl+B)'}
            aria-label="Alternar menu lateral"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <h1 className="text-sm font-bold uppercase tracking-[0.16em] text-foreground/90">
            {navItems.find(n => n.path === location.pathname)?.label || 'Dashboard'}
          </h1>
          <div className="ml-auto flex items-center gap-3">
            <label className="noc-search hidden md:flex">
              <Search size={13} className="text-muted-foreground/60" />
              <input
                type="text"
                placeholder="Buscar (Ctrl+K)"
                className="bg-transparent outline-none flex-1 text-foreground placeholder:text-muted-foreground/50"
              />
            </label>
            <button
              onClick={() => navigate('/events')}
              className="relative p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
              title="Ver eventos"
            >
              <Bell size={16} />
              <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-accent text-accent-foreground text-[9px] font-bold flex items-center justify-center">2</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="inline-flex items-center gap-2 p-2 xl:px-3 rounded-md hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground border border-border/60"
                  title="Densidade da interface"
                  aria-label="Selecionar densidade da interface"
                >
                  <SlidersHorizontal size={16} />
                  <span className="hidden 2xl:inline text-[10px] font-mono font-bold uppercase tracking-[0.12em]">{densityLabels[density]}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[110] border-border bg-popover text-popover-foreground shadow-[0_0_28px_hsl(var(--background)/0.85)]">
                <DropdownMenuRadioGroup value={density} onValueChange={(value) => setDensity(value as UiDensity)}>
                  <DropdownMenuRadioItem value="compact" className="font-mono text-xs focus:bg-primary/15 focus:text-primary">Compacta</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="standard" className="font-mono text-xs focus:bg-primary/15 focus:text-primary">Padrão</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="comfortable" className="font-mono text-xs focus:bg-primary/15 focus:text-primary">Confortável</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="noc-status-chip" data-state="ok">
              <span className="w-1.5 h-1.5 rounded-full bg-primary"
                style={{ boxShadow: '0 0 6px hsl(var(--primary))' }} />
              <span>Operacional</span>
              <ChevronDown size={11} />
            </div>
          </div>
        </header>

        <OpenResolverBanner />

        <main className="flex-1 overflow-y-auto w-full max-w-none">
          <div className="noc-page" style={{ paddingBlock: 'var(--app-main-padding)' }}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

