/**
 * UpstreamSilencePage — Aba de Observabilidade.
 *
 * Hospeda o painel NocUpstreamSilence (v1, conntrack [UNREPLIED]). Não é
 * promovido ao dashboard principal por decisão de produto: só observar
 * agora; promover só depois de provar valor.
 */

import NocUpstreamSilence from '@/components/noc/NocUpstreamSilence';

export default function UpstreamSilencePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Upstream Silence — Autoritativos Mudos</h1>
        <p className="text-xs text-muted-foreground">
          Detecção em tempo (quase) real de IPs autoritativos na internet que NÃO respondem
          às queries de recursão do Unbound. Sinal kernel via{' '}
          <code className="font-mono">nf_conntrack [UNREPLIED]</code> em UDP :53. Opt-in,
          admin-only.
        </p>
      </div>
      <NocUpstreamSilence />
    </div>
  );
}
