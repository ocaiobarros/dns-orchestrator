import type { ReactNode } from 'react';

interface Props {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function PanelV3({ title, icon, action, children, className = '' }: Props) {
  return (
    <div className={`noc-panel-v3 ${className}`}>
      <div className="noc-panel-v3-header">
        {icon && <span className="noc-panel-v3-icon flex-shrink-0">{icon}</span>}
        <span className="noc-panel-v3-title">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="noc-panel-v3-body">{children}</div>
    </div>
  );
}
