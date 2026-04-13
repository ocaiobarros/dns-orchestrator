// ============================================================
// DNS Control — Config Structural Validator
// Validates generated config artifacts before deploy
// Covers both Simple and Interception modes
// ============================================================

import type { WizardConfig } from './types';
import { generateUnboundConf, computeSlabs, generateNftablesModular } from './config-generator';

export interface ConfigCheckItem {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  detail: string;
}

export interface ConfigDiagnostics {
  threads: number;
  slabs: number;
  msgCacheSize: string;
  rrsetCacheSize: string;
  cacheMinTtl: number;
  serveExpired: boolean;
  serveExpiredTtl: number;
  numQueriesPerThread: number;
  cidrApplied: string;
  upstreams: string[];
  adForwardZones: { domain: string; dcs: string[] }[];
  hardenDnssecStripped: boolean;
  useCapsForId: boolean;
}

export interface InterceptionDiagnostics extends ConfigDiagnostics {
  serviceVipCount: number;
  interceptedVipCount: number;
  totalVipCount: number;
  allVipIpv4s: string[];
  backendCount: number;
  backends: string[];
  stickyTimeoutMin: number;
  egressDeliveryMode: string;
  securityProfile: string;
  enableIpv6: boolean;
  hasOutputHook: boolean;
  nftFilesCount: number;
  distributionPolicy: string;
}

/**
 * Run acceptance checklist against a generated Unbound config for simple mode.
 */
export function validateSimpleModeConfig(config: WizardConfig): ConfigCheckItem[] {
  const checks: ConfigCheckItem[] = [];
  const isSimple = config.operationMode === 'simple';

  if (!isSimple) {
    checks.push({ id: 'mode', label: 'Modo de operação', status: 'skip', detail: 'Não é modo simples' });
    return checks;
  }

  // Generate config for first instance to validate
  const content = config.instances.length > 0 ? generateUnboundConf(config, 0) : '';

  // 1. Forward global present
  const hasForwardZone = content.includes('forward-zone:') && content.includes('name: "."');
  checks.push({
    id: 'forward-global',
    label: 'Forward global (forward-zone ".")',
    status: hasForwardZone ? 'pass' : 'fail',
    detail: hasForwardZone ? 'forward-zone "." presente' : 'AUSENTE — modo simples exige forward global',
  });

  // 2. Root hints absent
  const hasRootHints = /^\s*root-hints:\s*[^R]/m.test(content); // matches real path, not "REMOVED"
  checks.push({
    id: 'no-root-hints',
    label: 'Root-hints ausente',
    status: !hasRootHints ? 'pass' : 'fail',
    detail: !hasRootHints ? 'Nenhum root-hints ativo' : 'root-hints detectado — proibido no modo simples',
  });

  // 3. ACL derived from CIDR
  const cidrMatch = config.ipv4Address?.match(/\/(\d+)$/);
  const cidr = cidrMatch ? cidrMatch[1] : null;
  const hasCorrectAcl = cidr ? content.includes(`/${cidr} allow`) : false;
  checks.push({
    id: 'acl-cidr',
    label: `ACL derivada do CIDR (/${cidr || '?'})`,
    status: hasCorrectAcl ? 'pass' : cidr ? 'fail' : 'warn',
    detail: hasCorrectAcl ? `access-control com /${cidr} detectado` : 'ACL não corresponde ao CIDR da interface',
  });

  // 4. AD forward zones when domain exists
  const adZones = config.adForwardZones?.filter(z => z.domain?.trim() && z.dnsServers.length > 0) || [];
  if (adZones.length > 0) {
    for (const ad of adZones) {
      const hasDomain = content.includes(`name: "${ad.domain}"`);
      const hasMsdcs = content.includes(`name: "_msdcs.${ad.domain}"`);
      const hasPrivate = content.includes(`private-domain: "${ad.domain}"`);
      checks.push({
        id: `ad-${ad.domain}`,
        label: `AD forward-zone: ${ad.domain}`,
        status: hasDomain && hasMsdcs && hasPrivate ? 'pass' : 'fail',
        detail: [
          hasDomain ? '✓ domínio' : '✗ domínio',
          hasMsdcs ? '✓ _msdcs' : '✗ _msdcs',
          hasPrivate ? '✓ private-domain' : '✗ private-domain',
        ].join(' · '),
      });
    }
  } else {
    checks.push({ id: 'ad-none', label: 'AD forward-zones', status: 'skip', detail: 'Nenhum domínio AD configurado' });
  }

  // 5. Upstreams valid
  const forwardAddrs = config.forwardAddrs || [];
  const hasUpstreams = forwardAddrs.length > 0;
  checks.push({
    id: 'upstreams',
    label: 'Upstreams válidos',
    status: hasUpstreams ? 'pass' : 'fail',
    detail: hasUpstreams ? `${forwardAddrs.length} upstream(s): ${forwardAddrs.join(', ')}` : 'Lista de upstreams vazia',
  });

  // 6. Cache/tuning applied
  const hasCacheMin = content.includes('cache-min-ttl:');
  const hasPrefetch = content.includes('prefetch: yes');
  const hasServeExpired = content.includes('serve-expired: yes') || content.includes('serve-expired: no');
  checks.push({
    id: 'tuning',
    label: 'Parâmetros de cache/tuning',
    status: hasCacheMin && hasPrefetch && hasServeExpired ? 'pass' : 'warn',
    detail: [
      hasCacheMin ? '✓ cache-min-ttl' : '✗ cache-min-ttl',
      hasPrefetch ? '✓ prefetch' : '✗ prefetch',
      hasServeExpired ? '✓ serve-expired' : '✗ serve-expired',
    ].join(' · '),
  });

  // 7. Block ordering: server → remote-control → forward-zone
  const serverIdx = content.indexOf('server:');
  const remoteIdx = content.indexOf('remote-control:');
  const forwardIdx = content.indexOf('forward-zone:');
  const orderOk = serverIdx >= 0 && remoteIdx > serverIdx && forwardIdx > remoteIdx;
  checks.push({
    id: 'block-order',
    label: 'Ordem dos blocos (server → remote-control → forward-zone)',
    status: orderOk ? 'pass' : 'fail',
    detail: orderOk ? 'Blocos na ordem correta' : 'Ordem dos blocos incorreta',
  });

  // 8. Slabs match threads
  const threads = config.threads || 4;
  const expectedSlabs = computeSlabs(threads);
  const slabsOk = content.includes(`msg-cache-slabs: ${expectedSlabs}`);
  checks.push({
    id: 'slabs',
    label: `Slabs derivados (${threads} threads → ${expectedSlabs} slabs)`,
    status: slabsOk ? 'pass' : 'fail',
    detail: slabsOk ? `slabs=${expectedSlabs} correto` : `slabs esperado: ${expectedSlabs}`,
  });

  // 9. Instance parity (if 2+ instances)
  if (config.instances.length >= 2) {
    const c0 = generateUnboundConf(config, 0);
    const c1 = generateUnboundConf(config, 1);
    const normalize = (c: string) =>
      c.split('\n')
        .filter(l => !l.includes('interface:') && !l.includes('control-interface:') && !l.includes('control-port:') && !l.includes('pidfile:'))
        .join('\n');
    const parityOk = normalize(c0) === normalize(c1);
    checks.push({
      id: 'parity',
      label: 'Paridade entre instâncias',
      status: parityOk ? 'pass' : 'fail',
      detail: parityOk ? 'Configs equivalentes (exceto listener/control)' : 'Divergência detectada entre instâncias',
    });
  }

  return checks;
}

/**
 * Run acceptance checklist for interception mode — covers Unbound + nftables.
 */
export function validateInterceptionModeConfig(config: WizardConfig): ConfigCheckItem[] {
  const checks: ConfigCheckItem[] = [];

  if (config.operationMode !== 'interception') {
    checks.push({ id: 'mode', label: 'Modo de operação', status: 'skip', detail: 'Não é modo interceptação' });
    return checks;
  }

  // Generate nftables files for structural validation
  const nftFiles = generateNftablesModular(config);
  const nftDFiles = nftFiles.filter(f => f.path.startsWith('/etc/nftables.d/'));
  const allContent = nftFiles.map(f => f.content).join('\n');

  // ═══ 1. VIP configuration ═══
  const serviceVips = config.serviceVips?.filter(v => v.ipv4) || [];
  const interceptedVips = config.interceptedVips?.filter(v => v.vipIp) || [];
  const totalVips = serviceVips.length + interceptedVips.length;

  checks.push({
    id: 'vip-count',
    label: 'VIPs configurados',
    status: totalVips > 0 ? 'pass' : 'fail',
    detail: totalVips > 0
      ? `${serviceVips.length} próprios + ${interceptedVips.length} interceptados = ${totalVips}`
      : 'Nenhum VIP configurado — nftables não terá alvos de captura',
  });

  // ═══ 2. DNS_ANYCAST_IPV4 define ═══
  const defineFile = nftFiles.find(f => f.path.includes('5100-nat-define'));
  checks.push({
    id: 'anycast-define',
    label: 'DNS_ANYCAST_IPV4 definido',
    status: defineFile ? 'pass' : totalVips === 0 ? 'warn' : 'fail',
    detail: defineFile
      ? `define com ${(defineFile.content.match(/\d+\.\d+\.\d+\.\d+/g) || []).length} IP(s)`
      : 'Arquivo de definição ausente',
  });

  // ═══ 3. PREROUTING hook ═══
  const preHook = nftFiles.find(f => f.path.includes('0051-hook-ipv4-prerouting'));
  checks.push({
    id: 'hook-prerouting',
    label: 'PREROUTING hook (dstnat)',
    status: preHook ? 'pass' : 'fail',
    detail: preHook ? 'hook prerouting priority dstnat presente' : 'PREROUTING hook AUSENTE',
  });

  // ═══ 4. OUTPUT hook (local interception) ═══
  const outHook = nftFiles.find(f => f.path.includes('0053-hook-ipv4-output'));
  checks.push({
    id: 'hook-output',
    label: 'OUTPUT hook (interceptação local)',
    status: outHook ? 'pass' : 'fail',
    detail: outHook ? 'hook output priority dstnat presente — dig @VIP funciona localmente' : 'OUTPUT hook AUSENTE — consultas locais não serão interceptadas',
  });

  // ═══ 5. PREROUTING capture rules ═══
  const preCaptureUdp = nftFiles.find(f => f.path.includes('5112-nat-rule-ipv4_udp_dns'));
  const preCaptureTcp = nftFiles.find(f => f.path.includes('5111-nat-rule-ipv4_tcp_dns'));
  checks.push({
    id: 'capture-prerouting',
    label: 'Capture rules PREROUTING (TCP + UDP)',
    status: preCaptureUdp && preCaptureTcp ? 'pass' : 'fail',
    detail: [
      preCaptureTcp ? '✓ TCP' : '✗ TCP',
      preCaptureUdp ? '✓ UDP' : '✗ UDP',
    ].join(' · '),
  });

  // ═══ 6. OUTPUT capture rules ═══
  const outCaptureUdp = nftFiles.find(f => f.path.includes('5114-nat-rule-output-ipv4_udp'));
  const outCaptureTcp = nftFiles.find(f => f.path.includes('5113-nat-rule-output-ipv4_tcp'));
  checks.push({
    id: 'capture-output',
    label: 'Capture rules OUTPUT (TCP + UDP)',
    status: outCaptureUdp && outCaptureTcp ? 'pass' : 'fail',
    detail: [
      outCaptureTcp ? '✓ TCP' : '✗ TCP',
      outCaptureUdp ? '✓ UDP' : '✗ UDP',
    ].join(' · '),
  });

  // ═══ 7. Port 53 restriction ═══
  const captureFiles = nftFiles.filter(f => f.path.includes('nat-rule-') && (f.path.includes('_dns') || f.path.includes('output')));
  let port53Only = true;
  for (const f of captureFiles) {
    const dportLines = f.content.split('\n').filter(l => l.includes('dport'));
    for (const line of dportLines) {
      if (!line.includes('dport 53')) port53Only = false;
    }
  }
  checks.push({
    id: 'port-53-only',
    label: 'Captura restrita a porta 53',
    status: port53Only ? 'pass' : 'fail',
    detail: port53Only ? 'Todas as regras usam dport 53 exclusivamente' : 'Regra com porta != 53 detectada',
  });

  // ═══ 8. Destination restricted to VIPs ═══
  const captureRuleFiles = nftFiles.filter(f => /511[1-4]/.test(f.path));
  const allUseVipVar = captureRuleFiles.every(f => f.content.includes('$DNS_ANYCAST_IPV4'));
  checks.push({
    id: 'vip-destination',
    label: 'Destino restrito a $DNS_ANYCAST_IPV4',
    status: allUseVipVar ? 'pass' : captureRuleFiles.length === 0 ? 'warn' : 'fail',
    detail: allUseVipVar ? 'Todas as capture rules referenciam $DNS_ANYCAST_IPV4' : 'Regra com destino fora do define detectada',
  });

  // ═══ 9. Backend chains exist ═══
  const expectedChains = config.instances.flatMap(i => [
    `ipv4_dns_tcp_${i.name}`,
    `ipv4_dns_udp_${i.name}`,
  ]);
  const missingChains = expectedChains.filter(c => !allContent.includes(`chain ${c}`));
  checks.push({
    id: 'backend-chains',
    label: `Backend chains (${expectedChains.length} esperadas)`,
    status: missingChains.length === 0 ? 'pass' : 'fail',
    detail: missingChains.length === 0
      ? `Todas as ${expectedChains.length} chains presentes`
      : `Ausentes: ${missingChains.join(', ')}`,
  });

  // ═══ 10. DNAT targets match instance bindIps ═══
  const actionFiles = nftFiles.filter(f => f.path.includes('nat-rule-action-ipv4'));
  const dnatIps = actionFiles.flatMap(f => {
    const m = f.content.match(/dnat to ([\d.]+):53/g) || [];
    return m.map(x => x.replace('dnat to ', '').replace(':53', ''));
  });
  const expectedIps = config.instances.map(i => i.bindIp).filter(Boolean);
  const missingIps = expectedIps.filter(ip => !dnatIps.includes(ip));
  const extraIps = dnatIps.filter(ip => !expectedIps.includes(ip));
  checks.push({
    id: 'dnat-targets',
    label: 'DNAT targets = bindIPs das instâncias',
    status: missingIps.length === 0 && extraIps.length === 0 ? 'pass' : 'fail',
    detail: missingIps.length === 0 && extraIps.length === 0
      ? `${dnatIps.length} regras de DNAT para ${expectedIps.length} backends`
      : `Ausentes: ${missingIps.join(', ') || '—'} · Extra: ${extraIps.join(', ') || '—'}`,
  });

  // ═══ 11. No duplicate rules per file ═══
  const memFiles = nftFiles.filter(f => f.path.includes('nat-rule-memorized'));
  let dupFound = false;
  for (const f of memFiles) {
    const ruleLines = f.content.split('\n').filter(l => l.trim().startsWith('ip saddr'));
    if (ruleLines.length > 1) dupFound = true;
  }
  checks.push({
    id: 'no-duplicates',
    label: 'Sem duplicidade de rules por arquivo',
    status: !dupFound ? 'pass' : 'fail',
    detail: !dupFound ? 'Cada arquivo contém exatamente 1 regra' : 'Arquivo com regras duplicadas detectado',
  });

  // ═══ 12. Priority consistency ═══
  const preContent = preHook?.content || '';
  const outContent = outHook?.content || '';
  const prePriority = preContent.includes('priority dstnat');
  const outPriority = outContent.includes('priority dstnat');
  checks.push({
    id: 'priority-consistency',
    label: 'Prioridades consistentes (dstnat)',
    status: prePriority && outPriority ? 'pass' : 'fail',
    detail: prePriority && outPriority ? 'PREROUTING e OUTPUT usam priority dstnat' : 'Prioridade inconsistente entre hooks',
  });

  // ═══ 13. Deterministic file ordering ═══
  const sortedPaths = [...nftDFiles].sort((a, b) => a.path.localeCompare(b.path));
  const prefixes = sortedPaths.map(f => {
    const m = f.path.match(/\/(\d+)-/);
    return m ? parseInt(m[1]) : 0;
  });
  const isOrdered = prefixes.every((p, i) => i === 0 || p >= prefixes[i - 1]);
  checks.push({
    id: 'file-ordering',
    label: 'Ordenação léxica determinística',
    status: isOrdered ? 'pass' : 'fail',
    detail: isOrdered ? `${nftDFiles.length} snippets em ordem lexicográfica correta` : 'Ordem de prefixos violada',
  });

  // ═══ 14. Block syntax (table ip nat { ... }) ═══
  const nonDefineNatFiles = nftDFiles.filter(f => !f.path.includes('define') && !f.path.includes('filter'));
  let blockSyntaxOk = true;
  for (const f of nonDefineNatFiles) {
    if (!f.content.match(/^table ip6? nat \{/m)) blockSyntaxOk = false;
  }
  checks.push({
    id: 'block-syntax',
    label: 'Block syntax Debian 13 (table ip nat { })',
    status: blockSyntaxOk ? 'pass' : 'fail',
    detail: blockSyntaxOk ? 'Todos os snippets usam block syntax' : 'Snippet sem block syntax detectado',
  });

  // ═══ 15. Brace matching ═══
  let bracesOk = true;
  for (const f of nftDFiles.filter(f => f.content.includes('table '))) {
    const opens = (f.content.match(/\{/g) || []).length;
    const closes = (f.content.match(/\}/g) || []).length;
    if (opens !== closes) bracesOk = false;
  }
  checks.push({
    id: 'brace-match',
    label: 'Chaves balanceadas em todos os snippets',
    status: bracesOk ? 'pass' : 'fail',
    detail: bracesOk ? 'Todas as chaves balanceadas' : 'Snippet com chaves desbalanceadas',
  });

  // ═══ 16. Newline termination ═══
  const allEndNewline = nftFiles.every(f => f.content.endsWith('\n'));
  checks.push({
    id: 'newline-termination',
    label: 'Todos os arquivos terminam com newline',
    status: allEndNewline ? 'pass' : 'warn',
    detail: allEndNewline ? 'Correto' : 'Arquivo sem newline final',
  });

  // ═══ 17. Sticky sets per instance ═══
  const stickySetFiles = nftFiles.filter(f => f.path.includes('nat-addrlist-ipv4_users_'));
  const stickyTimeoutMin = Math.max(1, Math.floor((config.stickyTimeout || 1200) / 60));
  const setsMatchTimeout = stickySetFiles.every(f => f.content.includes(`timeout ${stickyTimeoutMin}m`));
  checks.push({
    id: 'sticky-timeout',
    label: `Sticky timeout (${stickyTimeoutMin}m)`,
    status: setsMatchTimeout ? 'pass' : 'fail',
    detail: setsMatchTimeout ? `${stickySetFiles.length} sets com timeout ${stickyTimeoutMin}m` : 'Set com timeout incorreto',
  });

  // ═══ 18. Filter table isolation (legacy = absent) ═══
  const filterFiles = nftFiles.filter(f => f.path.includes('filter'));
  if (config.securityProfile === 'legacy') {
    checks.push({
      id: 'filter-isolation',
      label: 'Filter table ausente (perfil legacy)',
      status: filterFiles.length === 0 ? 'pass' : 'fail',
      detail: filterFiles.length === 0 ? 'Nenhuma filter table — reproduz runtime Part1/Part2' : 'Filter table indevida em perfil legacy',
    });
  } else {
    checks.push({
      id: 'filter-present',
      label: 'Filter table presente (perfil hardened)',
      status: filterFiles.length > 0 ? 'pass' : 'fail',
      detail: filterFiles.length > 0 ? `${filterFiles.length} filter table(s)` : 'Filter table ausente em perfil hardened',
    });
  }

  // ═══ 19. Unbound config: tuning / block order (same checks as simple) ═══
  if (config.instances.length > 0) {
    const content = generateUnboundConf(config, 0);
    const serverIdx = content.indexOf('server:');
    const remoteIdx = content.indexOf('remote-control:');
    const forwardIdx = content.indexOf('forward-zone:');
    const orderOk = serverIdx >= 0 && remoteIdx > serverIdx && forwardIdx > remoteIdx;
    checks.push({
      id: 'unbound-block-order',
      label: 'Unbound block order (server → remote-control → forward-zone)',
      status: orderOk ? 'pass' : 'fail',
      detail: orderOk ? 'Ordem correta' : 'Ordem incorreta',
    });

    const threads = config.threads || 4;
    const expectedSlabs = computeSlabs(threads);
    checks.push({
      id: 'unbound-slabs',
      label: `Unbound slabs (${threads} threads → ${expectedSlabs} slabs)`,
      status: content.includes(`msg-cache-slabs: ${expectedSlabs}`) ? 'pass' : 'fail',
      detail: content.includes(`msg-cache-slabs: ${expectedSlabs}`) ? 'Correto' : `Esperado ${expectedSlabs}`,
    });
  }

  // ═══ 20. IPv6 consistency ═══
  if (config.enableIpv6) {
    const v6Table = nftFiles.find(f => f.path.includes('0003-table-ipv6'));
    const v6PreHook = nftFiles.find(f => f.path.includes('0052-hook-ipv6'));
    const v6OutHook = nftFiles.find(f => f.path.includes('0054-hook-ipv6'));
    checks.push({
      id: 'ipv6-completeness',
      label: 'IPv6 dual-stack completo',
      status: v6Table && v6PreHook && v6OutHook ? 'pass' : 'fail',
      detail: [
        v6Table ? '✓ table ip6 nat' : '✗ table',
        v6PreHook ? '✓ PREROUTING v6' : '✗ PREROUTING v6',
        v6OutHook ? '✓ OUTPUT v6' : '✗ OUTPUT v6',
      ].join(' · '),
    });
  }

  return checks;
}

/**
 * Check if interception config has any blocking failures.
 */
export function isInterceptionConfigValid(config: WizardConfig): boolean {
  const checks = validateInterceptionModeConfig(config);
  return checks.every(c => c.status !== 'fail');
}

/**
 * Extract diagnostics summary from config for pre-deploy audit display.
 */
export function extractDiagnostics(config: WizardConfig): ConfigDiagnostics {
  const threads = config.threads || 4;
  return {
    threads,
    slabs: computeSlabs(threads),
    msgCacheSize: config.msgCacheSize || '512m',
    rrsetCacheSize: config.rrsetCacheSize || '512m',
    cacheMinTtl: config.cacheMinTtl ?? 300,
    serveExpired: config.serveExpired !== false,
    serveExpiredTtl: config.serveExpiredTtl ?? 86400,
    numQueriesPerThread: config.numQueriesPerThread || 3200,
    cidrApplied: config.ipv4Address || '—',
    upstreams: config.forwardAddrs?.length > 0 ? config.forwardAddrs : ['1.1.1.1', '1.0.0.1', '8.8.8.8', '9.9.9.9'],
    adForwardZones: (config.adForwardZones || [])
      .filter(z => z.domain?.trim() && z.dnsServers.length > 0)
      .map(z => ({ domain: z.domain, dcs: z.dnsServers })),
    hardenDnssecStripped: config.hardenDnssecStripped !== false,
    useCapsForId: config.useCapsForId === true,
  };
}

/**
 * Extract extended diagnostics for interception mode.
 */
export function extractInterceptionDiagnostics(config: WizardConfig): InterceptionDiagnostics {
  const base = extractDiagnostics(config);
  const nftFiles = generateNftablesModular(config);

  const serviceVips = config.serviceVips?.filter(v => v.ipv4) || [];
  const interceptedVips = config.interceptedVips?.filter(v => v.vipIp) || [];
  const allVipIpv4s = [
    ...serviceVips.map(v => v.ipv4),
    ...interceptedVips.map(v => v.vipIp),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  return {
    ...base,
    serviceVipCount: serviceVips.length,
    interceptedVipCount: interceptedVips.length,
    totalVipCount: allVipIpv4s.length,
    allVipIpv4s,
    backendCount: config.instances.length,
    backends: config.instances.map(i => `${i.name}@${i.bindIp}`),
    stickyTimeoutMin: Math.max(1, Math.floor((config.stickyTimeout || 1200) / 60)),
    egressDeliveryMode: config.egressDeliveryMode || 'host-owned',
    securityProfile: config.securityProfile || 'legacy',
    enableIpv6: config.enableIpv6 || false,
    hasOutputHook: nftFiles.some(f => f.path.includes('0053-hook')),
    nftFilesCount: nftFiles.filter(f => f.path.startsWith('/etc/nftables')).length,
    distributionPolicy: config.distributionPolicy || 'sticky-source',
  };
}
