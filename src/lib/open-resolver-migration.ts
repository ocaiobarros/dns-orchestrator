// ============================================================
// DNS Control — Open Resolver Migration Helpers
// Pure logic to plan the 1-click migration from securityProfile
// 'legacy' (open resolver) → 'isp-hardened' (restricted ACLs)
// WITHOUT risk of locking out legitimate subscribers.
// ============================================================

import type { WizardConfig, AccessControlEntry } from './types';

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/(\d|[12]\d|3[0-2])$/;

export function isValidIpv4Cidr(input: string): boolean {
  const v = input.trim();
  if (!CIDR_RE.test(v)) return false;
  const [ip, mask] = v.split('/');
  const octets = ip.split('.').map((o) => parseInt(o, 10));
  if (octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return false;
  const m = parseInt(mask, 10);
  return m >= 0 && m <= 32;
}

export function parseCidrList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface MigrationPlan {
  /** True if the migration can proceed safely. */
  sufficient: boolean;
  /** Reason when not sufficient. */
  reason?: string;
  /** ACL entries that will be effectively allowed after migration (for preview). */
  effectiveAcls: AccessControlEntry[];
  /** Mutated config to apply (NEVER mutates the input). */
  migrated: WizardConfig;
}

/**
 * Build a migration plan to close an open resolver.
 *
 * Safety contract:
 *  - NEVER returns sufficient=true if the operator has no subscriber coverage
 *    (i.e., no host-CIDR and no operator-supplied CIDRs). Applying would
 *    silently REFUSE legitimate subscribers.
 *  - Loopback (127/8) and CGNAT (100.64/10) are always added by the
 *    generator but DO NOT count as subscriber coverage.
 */
export function planOpenResolverMigration(
  current: WizardConfig,
  extraCidrs: string[] = [],
): MigrationPlan {
  // 1) Collect operator ACL entries (existing + extra ones provided in the flow).
  const existing = (current.accessControlIpv4 || []).filter(
    (e) => e.action === 'allow' && e.network && e.network !== '0.0.0.0/0',
  );
  const cleanExtras = extraCidrs.map((s) => s.trim()).filter(Boolean);
  const invalidExtras = cleanExtras.filter((c) => !isValidIpv4Cidr(c));
  const validExtras = cleanExtras.filter(isValidIpv4Cidr);

  const mergedAcls: AccessControlEntry[] = [...existing];
  for (const cidr of validExtras) {
    if (!mergedAcls.some((e) => e.network === cidr)) {
      mergedAcls.push({ network: cidr, action: 'allow', label: 'Assinante (migração)' });
    }
  }

  // 2) Determine subscriber coverage.
  const hostCidrMatch = current.ipv4Address?.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  const hasHostCidr = Boolean(hostCidrMatch);
  const hasOperatorAcls = mergedAcls.length > 0;

  // 3) Build the effective preview list (loopback + host + operator + CGNAT).
  const effectiveAcls: AccessControlEntry[] = [
    { network: '127.0.0.0/8', action: 'allow', label: 'Loopback' },
  ];
  if (hostCidrMatch) {
    effectiveAcls.push({
      network: `${hostCidrMatch[1]}/${hostCidrMatch[2]}`,
      action: 'allow',
      label: 'Rede do host',
    });
  }
  effectiveAcls.push(...mergedAcls);
  effectiveAcls.push({ network: '100.64.0.0/10', action: 'allow', label: 'CGNAT (backends)' });

  // 4) Decide if it is safe to proceed.
  if (invalidExtras.length > 0) {
    return {
      sufficient: false,
      reason: `CIDR(s) inválido(s): ${invalidExtras.join(', ')}`,
      effectiveAcls,
      migrated: { ...current },
    };
  }
  if (!hasHostCidr && !hasOperatorAcls) {
    return {
      sufficient: false,
      reason:
        'Nenhum range de assinante coberto. Informe os CIDRs dos assinantes para evitar REFUSED.',
      effectiveAcls,
      migrated: { ...current },
    };
  }

  // 5) Produce the migrated config copy (no mutation of input).
  const migrated: WizardConfig = {
    ...current,
    securityProfile: 'isp-hardened',
    accessControlIpv4: mergedAcls.length > 0 ? mergedAcls : current.accessControlIpv4 || [],
    openResolverConfirmed: false,
  };

  return { sufficient: true, effectiveAcls, migrated };
}
