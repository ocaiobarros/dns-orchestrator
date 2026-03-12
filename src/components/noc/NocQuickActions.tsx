import { useNavigate } from 'react-router-dom';

export default function NocQuickActions() {
  const navigate = useNavigate();

  const actions = [
    { label: 'Métricas DNS', path: '/metrics' },
    { label: 'Eventos', path: '/events' },
    { label: 'Diagnóstico', path: '/troubleshoot' },
    { label: 'Wizard', path: '/wizard' },
    { label: 'Arquivos', path: '/files' },
    { label: 'Histórico', path: '/history' },
    { label: 'Logs', path: '/logs' },
  ];

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-section-title mb-3">Ações Rápidas</div>
      <div className="flex flex-wrap gap-2">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={() => navigate(a.path)}
            className="px-3 py-1.5 text-[11px] font-medium rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 border border-border transition-all hover:border-primary/30 hover:shadow-[0_0_8px_hsl(var(--primary)/0.1)]"
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
