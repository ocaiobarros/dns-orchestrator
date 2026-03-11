export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">Parâmetros da aplicação</p>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Autenticação</div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tipo</span>
            <span className="font-mono">Local (user/password)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Usuário admin</span>
            <span className="font-mono">admin</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bind</span>
            <span className="font-mono">0.0.0.0:8443</span>
          </div>
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Ações</div>
        <div className="flex flex-wrap gap-2">
          {[
            'Exportar Configuração', 'Importar Perfil', 'Clonar Instalação',
            'Gerar Relatório Técnico', 'Validar Ambiente', 'Executar Diagnóstico Completo'
          ].map(action => (
            <button key={action} className="px-3 py-1.5 text-xs bg-secondary text-secondary-foreground rounded border border-border hover:bg-secondary/80">
              {action}
            </button>
          ))}
        </div>
      </div>

      <div className="noc-panel">
        <div className="noc-panel-header">Aplicação Parcial</div>
        <div className="flex flex-wrap gap-2">
          {['Aplicar Somente DNS', 'Aplicar Somente Rede', 'Aplicar Somente FRR', 'Aplicar Somente nftables'].map(action => (
            <button key={action} className="px-3 py-1.5 text-xs bg-primary/15 text-primary rounded border border-primary/30 hover:bg-primary/25">
              {action}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
