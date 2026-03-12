import { useNavigate } from 'react-router-dom';
import { BarChart3, Bell, Stethoscope, Wand2, FileCode, History, ScrollText } from 'lucide-react';

export default function NocQuickActions() {
  const navigate = useNavigate();

  const actions = [
    { label: 'DNS Metrics', path: '/metrics', icon: <BarChart3 size={12} /> },
    { label: 'Events', path: '/events', icon: <Bell size={12} /> },
    { label: 'Diagnostics', path: '/troubleshoot', icon: <Stethoscope size={12} /> },
    { label: 'Wizard', path: '/wizard', icon: <Wand2 size={12} /> },
    { label: 'Gen Files', path: '/files', icon: <FileCode size={12} /> },
    { label: 'History', path: '/history', icon: <History size={12} /> },
    { label: 'Logs', path: '/logs', icon: <ScrollText size={12} /> },
  ];

  return (
    <div className="noc-card animate-slide-in-up">
      <div className="noc-card-body">
        <div className="noc-section-title mb-3">
          COMMAND CONSOLE
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {actions.map(a => (
            <button
              key={a.label}
              onClick={() => navigate(a.path)}
              className="noc-action-btn flex items-center gap-2"
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
