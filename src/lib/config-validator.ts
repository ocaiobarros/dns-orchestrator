// ============================================================
// DNS Control — Unbound Config Structural Validator
// Validates generated config artifacts before deploy
// ============================================================

import type { WizardConfig } from './types';
import { generateUnboundConf, computeSlabs } from './config-generator';

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
