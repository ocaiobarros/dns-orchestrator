import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Bell, Stethoscope, Wand2, FileCode, History, ScrollText, Terminal } from 'lucide-react';

export default function NocQuickActions() {
  const navigate = useNavigate();

  const actions = [
    { label: 'DNS Metrics', path: '/metrics', icon: <BarChart3 size={13} /> },
    { label: 'Events', path: '/events', icon: <Bell size={13} /> },
    { label: 'Diagnostics', path: '/troubleshoot', icon: <Stethoscope size={13} /> },
    { label: 'Wizard', path: '/wizard', icon: <Wand2 size={13} /> },
    { label: 'Gen Files', path: '/files', icon: <FileCode size={13} /> },
    { label: 'History', path: '/history', icon: <History size={13} /> },
    { label: 'Logs', path: '/logs', icon: <ScrollText size={13} /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="noc-glass"
    >
      <div className="noc-glass-body">
        <div className="noc-section-title">
          <Terminal size={12} className="text-muted-foreground/60" />
          COMMAND CONSOLE
        </div>
        <div className="noc-section-divider" />

        <div className="flex flex-wrap gap-2">
          {actions.map((a, i) => (
            <motion.button
              key={a.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.15 + i * 0.03 }}
              onClick={() => navigate(a.path)}
              className="noc-action-chip"
            >
              {a.icon}
              {a.label}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
