// ============================================================
// DNS Control — Generator Decision Log
// Produces human-readable reasoning trace for config audit
// ============================================================

import type { WizardConfig } from './types';
import { computeSlabs } from './config-generator';

export interface GeneratorDecision {
  category: string;
  parameter: string;
  value: string;
  reasoning: string;
}

export function buildDecisionLog(config: WizardConfig): GeneratorDecision[] {
  const decisions: GeneratorDecision[] = [];
  const isSimple = config.operationMode === 'simple';

  // Mode
  decisions.push({
    category: 'Arquitetura',
    parameter: 'operationMode',
    value: isSimple ? 'Recursivo Simples' : 'Interceptação',
    reasoning: isSimple
      ? 'Forward-only com forward-zone "." — sem recursão iterativa, sem root-hints'
      : 'Interceptação via nftables DNAT — suporta VIPs e egress público',
  });

  // Threads & Slabs
  const threads = config.threads || 4;
  const slabs = computeSlabs(threads);
  decisions.push({
    category: 'Performance',
    parameter: 'num-threads / slabs',
    value: `${threads} threads → ${slabs} slabs`,
    reasoning: `Slabs derivados em potência de 2: ${threads <= 2 ? '≤2→2' : threads <= 4 ? '≤4→4' : threads <= 8 ? '≤8→8' : '>8→16'}. Evita contenção de lock entre threads.`,
  });

  // Cache
  const msgCache = config.msgCacheSize || '512m';
  const rrsetCache = config.rrsetCacheSize || '512m';
  decisions.push({
    category: 'Cache',
    parameter: 'msg-cache / rrset-cache',
    value: `${msgCache} / ${rrsetCache}`,
    reasoning: 'Cache massivo para ISP-grade: objetivo >95% cache hit. rrset ≥ msg para evitar eviction prematura.',
  });

  // Cache TTL
  const cacheMinTtl = config.cacheMinTtl ?? 300;
  decisions.push({
    category: 'Cache',
    parameter: 'cache-min-ttl',
    value: `${cacheMinTtl}s`,
    reasoning: cacheMinTtl >= 300
      ? 'TTL mínimo elevado (≥300s) — força retenção de registros populares, reduz lookups upstream'
      : `TTL mínimo baixo (${cacheMinTtl}s) — respeita TTLs curtos dos autoritativos, menor cache hit`,
  });

  // Serve expired
  const serveExpired = config.serveExpired !== false;
  decisions.push({
    category: 'Resiliência',
    parameter: 'serve-expired',
    value: serveExpired ? `yes (TTL: ${config.serveExpiredTtl ?? 86400}s)` : 'no',
    reasoning: serveExpired
      ? 'Entrega respostas expiradas enquanto revalida em background — protege contra falhas de upstream'
      : 'Desabilitado — respostas expiradas não serão servidas, maior risco de SERVFAIL em falha de upstream',
  });

  // Prefetch
  decisions.push({
    category: 'Performance',
    parameter: 'prefetch / prefetch-key',
    value: 'yes / yes',
    reasoning: 'Renovação proativa de entradas próximas da expiração — mantém cache "quente" sem pico de latência.',
  });

  // Queries per thread
  const qpt = config.numQueriesPerThread || 3200;
  decisions.push({
    category: 'Performance',
    parameter: 'num-queries-per-thread',
    value: String(qpt),
    reasoning: qpt >= 4096
      ? 'Valor alto (≥4096) — adequado para hosts com muita RAM e throughput elevado'
      : `Valor conservador (${qpt}) — equilibra consumo de memória e capacidade de resposta`,
  });

  // ACL
  if (config.ipv4Address) {
    const cidrMatch = config.ipv4Address.match(/\/(\d+)$/);
    decisions.push({
      category: 'Segurança',
      parameter: 'access-control',
      value: `Derivado de ${config.ipv4Address}`,
      reasoning: cidrMatch
        ? `Rede /${cidrMatch[1]} extraída automaticamente do CIDR da interface — não trunca para /24`
        : 'CIDR não detectado — usando loopback + CGN apenas',
    });
  }

  // Forward addrs
  const fwd = config.forwardAddrs?.length > 0 ? config.forwardAddrs : ['1.1.1.1', '1.0.0.1', '8.8.8.8', '9.9.9.9'];
  decisions.push({
    category: 'Resolução',
    parameter: 'forward-addr',
    value: fwd.join(', '),
    reasoning: config.forwardAddrs?.length > 0
      ? 'Upstreams customizados pelo operador'
      : 'Upstreams default: Cloudflare + Google (fallback quando nenhum upstream foi especificado)',
  });

  // Root hints
  if (isSimple) {
    decisions.push({
      category: 'Arquitetura',
      parameter: 'root-hints',
      value: 'REMOVIDO',
      reasoning: 'Modo simples usa forward-only — root-hints é incompatível e causaria bypass do forward-zone',
    });
  }

  // AD zones
  const adZones = config.adForwardZones?.filter(z => z.domain?.trim() && z.dnsServers.length > 0) || [];
  if (adZones.length > 0) {
    for (const ad of adZones) {
      decisions.push({
        category: 'Active Directory',
        parameter: `forward-zone: ${ad.domain}`,
        value: `${ad.dnsServers.join(', ')} (+_msdcs)`,
        reasoning: `Gera forward-zone para ${ad.domain} e _msdcs.${ad.domain}, com private-domain para ambos — garante resolução de SRV/LDAP para DC`,
      });
    }
  }

  // Hardening
  const hardenDnssec = config.hardenDnssecStripped !== false;
  const capsForId = config.useCapsForId === true;
  decisions.push({
    category: 'Segurança',
    parameter: 'hardening',
    value: `dnssec-stripped=${hardenDnssec ? 'yes' : 'no'}, caps-for-id=${capsForId ? 'yes' : 'no'}`,
    reasoning: [
      hardenDnssec ? 'DNSSEC stripping protection ativa' : 'DNSSEC stripping desabilitado (compatibilidade)',
      capsForId ? '0x20 randomization ativa (anti-spoofing)' : '0x20 desabilitado (compatibilidade com autoritativos antigos)',
    ].join('. '),
  });

  return decisions;
}
