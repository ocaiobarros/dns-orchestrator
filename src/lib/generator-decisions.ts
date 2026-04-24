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
  const isInterception = config.operationMode === 'interception';

  // Mode
  decisions.push({
    category: 'Arquitetura',
    parameter: 'operationMode',
    value: isSimple ? 'Recursivo Simples' : 'Interceptação',
    reasoning: isSimple
      ? 'Forward-only com forward-zone "." — sem recursão iterativa, sem root-hints'
      : 'Interceptação via nftables DNAT — suporta VIPs e egress público',
  });

  // ═══ INTERCEPTION-SPECIFIC DECISIONS ═══
  if (isInterception) {
    // VIP topology
    const serviceVips = config.serviceVips?.filter(v => v.ipv4) || [];
    const interceptedVips = config.interceptedVips?.filter(v => v.vipIp) || [];
    const totalVips = serviceVips.length + interceptedVips.length;

    decisions.push({
      category: 'Topologia',
      parameter: 'VIPs',
      value: `${serviceVips.length} próprios + ${interceptedVips.length} interceptados = ${totalVips} total`,
      reasoning: totalVips > 0
        ? `Todos os VIPs são mesclados em DNS_ANYCAST_IPV4 e balanceados para todos os backends via sticky+nth`
        : 'Nenhum VIP configurado — nftables DNAT não terá alvos de captura',
    });

    // Intercepted VIPs detail
    if (interceptedVips.length > 0) {
      const ips = interceptedVips.map(v => v.vipIp).join(', ');
      decisions.push({
        category: 'DNS Seizure',
        parameter: 'interceptedVips',
        value: ips,
        reasoning: `IPs públicos interceptados (${interceptedVips.length}) são capturados via PREROUTING+OUTPUT DNAT — tráfego local e externo para esses IPs é redirecionado para resolvers internos`,
      });
    }

    // Egress mode
    const egressMode = config.egressDeliveryMode || 'host-owned';
    decisions.push({
      category: 'Egress',
      parameter: 'egressDeliveryMode',
      value: egressMode,
      reasoning: egressMode === 'border-routed'
        ? 'Egress via borda — outgoing-interface suprimido no Unbound, SNAT delegado ao dispositivo de borda'
        : 'Egress host-owned — IPs de egress configurados em loopback /32, Unbound usa outgoing-interface diretamente',
    });

    // Distribution policy
    decisions.push({
      category: 'Balanceamento',
      parameter: 'distributionPolicy',
      value: config.distributionPolicy || 'round-robin',
      reasoning: 'numgen inc mod N decrementing com sticky source — clientes memorizados preservam afinidade, novos são distribuídos uniformemente',
    });

    // Sticky timeout
    const stickyMin = Math.max(1, Math.floor((config.stickyTimeout || 1200) / 60));
    decisions.push({
      category: 'Balanceamento',
      parameter: 'stickyTimeout',
      value: `${stickyMin}m`,
      reasoning: stickyMin >= 20
        ? `Timeout de afinidade ${stickyMin}m — adequado para clientes ISP com sessões longas`
        : `Timeout curto (${stickyMin}m) — redistribuição mais frequente entre backends`,
    });

    // OUTPUT hook
    decisions.push({
      category: 'nftables',
      parameter: 'OUTPUT hook',
      value: 'HABILITADO',
      reasoning: 'Chain OUTPUT captura consultas DNS geradas localmente no host para VIPs interceptados — garante comportamento consistente em diagnóstico local (dig @VIP)',
    });

    // Security profile
    decisions.push({
      category: 'Segurança',
      parameter: 'securityProfile',
      value: config.securityProfile || 'legacy',
      reasoning: config.securityProfile === 'isp-hardened'
        ? 'Perfil ISP-hardened — ACL enforced no nftables INPUT antes do DNAT, com rate limiting e anti-amplificação'
        : 'Perfil legacy — sem filter table, reproduz comportamento Part1/Part2 de referência',
    });

    // IPv6
    decisions.push({
      category: 'Rede',
      parameter: 'enableIpv6',
      value: config.enableIpv6 ? 'SIM' : 'NÃO',
      reasoning: config.enableIpv6
        ? 'Dual-stack ativo — tabelas ip6 nat geradas com dispatch, sets e DNAT IPv6 paralelos'
        : 'IPv4-only — tabelas IPv6 suprimidas, sem overhead de regras dual-stack',
    });

    // FRR / OSPF — parte OFICIAL do layout homologado (não provisório)
    const ospfActive = config.enableOspf || config.routingMode === 'frr-ospf';
    decisions.push({
      category: 'Roteamento',
      parameter: 'FRR (layout homologado oficial)',
      value: ospfActive ? `OSPF ativo (router-id ${config.routerId || '—'}, área ${config.ospfArea})` : 'OSPF desativado (ospfd=no, frr.conf esqueleto)',
      reasoning: ospfActive
        ? `/etc/frr/frr.conf e /etc/frr/daemons gerados com router OSPF ativo. ${config.redistributeConnected ? 'Redistribuição connected ligada (anuncia VIPs e loopbacks).' : 'Redistribuição connected desligada — apenas redes declaradas serão anunciadas.'}`
        : 'FRR é parte oficial do layout homologado do modo Interceptação. /etc/frr/frr.conf e /etc/frr/daemons são SEMPRE materializados (mesmo com OSPF off) — comportamento estrutural, não provisório. ospfd=no e frr.conf como esqueleto comentado garantem paridade exata com o servidor de produção e permitem ativar OSPF depois sem regenerar o restante.',
    });

    // named.cache — snapshot determinístico versionado
    decisions.push({
      category: 'Determinismo',
      parameter: '/etc/unbound/named.cache',
      value: 'snapshot IANA versionado (2024-01-22)',
      reasoning: 'Materializado a partir de snapshot congelado no repositório (src/lib/root-hints.ts ↔ backend/app/generators/data/named.cache). PROIBIDO download em runtime durante deploy: garante reprodutibilidade 100% offline. Atualizar root servers exige PR explícito alterando os dois arquivos espelhados (paridade FE/BE obrigatória).',
    });
  }

  // ═══ COMMON DECISIONS (both modes) ═══

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
  } else {
    decisions.push({
      category: 'Arquitetura',
      parameter: 'root-hints',
      value: config.rootHintsPath || '/usr/share/dns/root.hints',
      reasoning: 'Modo interceptação usa forward-first — root-hints necessário para fallback iterativo quando upstreams falham',
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

  // Instances (interception-specific topology info)
  if (isInterception && config.instances?.length > 0) {
    const listeners = config.instances.map(i => `${i.name}@${i.bindIp}`).join(', ');
    decisions.push({
      category: 'Topologia',
      parameter: 'Instâncias',
      value: `${config.instances.length} backends: ${listeners}`,
      reasoning: `Cada instância recebe chain própria com set sticky (ipv4_users_*) e DNAT dedicado — isolamento total por backend`,
    });
  }

  return decisions;
}
