// ============================================================
// DNS Control — Open Resolver Migration Helpers
//
// Pure logic to plan the 1-click migration from securityProfile
// 'legacy' (open resolver) → 'isp-hardened' (restricted ACLs)
// WITHOUT risk of locking out legitimate subscribers.
//
// Coverage states (no longer a single boolean):
//   verified      — every known network is covered by the allow set.
//   incomplete    — at least one known network is NOT covered.
//   unverifiable  — no real source of subscriber networks; admin must
//                   explicitly confirm before the apply may proceed.
//   invalid       — at least one provided CIDR is invalid / malformed.
//
// IPv4 AND IPv6 are evaluated. ::/0 and 0.0.0.0/0 are both flagged as
// open in detectOpenAccessControl().
// ============================================================

import type { WizardConfig, AccessControlEntry } from './types';

// ───────────────────────── CIDR primitives ─────────────────────────

export interface ParsedCidr {
  raw: string;
  family: 4 | 6;
  /** Network base (after applying the mask), as BigInt. */
  base: bigint;
  prefix: number;
  bits: number; // 32 or 128
}

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const x = Number(p);
    if (x < 0 || x > 255) return null;
    n = (n << 8n) | BigInt(x);
  }
  return n;
}

function groupsToBigInt(parts: string[]): bigint | null {
  let n = 0n;
  for (const p of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    n = (n << 16n) | BigInt(parseInt(p, 16));
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  const s = ip.toLowerCase();
  // We reject embedded-IPv4 forms (::ffff:1.2.3.4) for simplicity; carriers
  // declare assinante ranges as pure IPv6.
  if (s.includes('.')) return null;
  if (s.includes(':::')) return null;
  if ((s.match(/::/g) || []).length > 1) return null;
  if (s.includes('::')) {
    const [h, t] = s.split('::');
    const head = h ? h.split(':') : [];
    const tail = t ? t.split(':') : [];
    if (head.length + tail.length > 8) return null;
    const fill = 8 - head.length - tail.length;
    const full = [...head, ...Array(fill).fill('0'), ...tail];
    if (full.length !== 8) return null;
    return groupsToBigInt(full);
  }
  const parts = s.split(':');
  if (parts.length !== 8) return null;
  return groupsToBigInt(parts);
}

export function parseCidr(input: string): ParsedCidr | null {
  const s = input.trim();
  const slash = s.indexOf('/');
  if (slash < 0) return null;
  const ip = s.slice(0, slash);
  const pfxStr = s.slice(slash + 1);
  if (!/^\d+$/.test(pfxStr)) return null;
  const pfx = Number(pfxStr);
  if (ip.includes(':')) {
    if (pfx < 0 || pfx > 128) return null;
    const n = ipv6ToBigInt(ip);
    if (n === null) return null;
    const mask =
      pfx === 0 ? 0n : ((1n << BigInt(pfx)) - 1n) << BigInt(128 - pfx);
    return { raw: s, family: 6, base: n & mask, prefix: pfx, bits: 128 };
  }
  if (pfx < 0 || pfx > 32) return null;
  const n = ipv4ToBigInt(ip);
  if (n === null) return null;
  const mask =
    pfx === 0 ? 0n : ((1n << BigInt(pfx)) - 1n) << BigInt(32 - pfx);
  return { raw: s, family: 4, base: n & mask, prefix: pfx, bits: 32 };
}

export function isValidIpv4Cidr(input: string): boolean {
  const p = parseCidr(input);
  return p !== null && p.family === 4;
}

export function isValidIpv6Cidr(input: string): boolean {
  const p = parseCidr(input);
  return p !== null && p.family === 6;
}

export function isValidCidr(input: string): boolean {
  return parseCidr(input) !== null;
}

/** True when `supernet` contains `subnet` (same family, equal-or-shorter prefix). */
export function cidrCovers(supernet: ParsedCidr, subnet: ParsedCidr): boolean {
  if (supernet.family !== subnet.family) return false;
  if (supernet.prefix > subnet.prefix) return false;
  const shift = BigInt(subnet.bits - supernet.prefix);
  return (subnet.base >> shift) === (supernet.base >> shift);
}

// ───────────────────────── Public surface ─────────────────────────

export function parseCidrList(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type CoverageState = 'verified' | 'incomplete' | 'unverifiable' | 'invalid';

export interface KnownNetwork {
  origin:
    | 'host-ipv4'
    | 'host-ipv6'
    | 'existing-acl-ipv4'
    | 'existing-acl-ipv6';
  cidr: string;
  family: 4 | 6;
  covered: boolean;
  /** The allowed CIDR that proved coverage (when covered). */
  coveredBy?: string;
  /** Optional label propagated from the source. */
  label?: string;
}

export interface MigrationPlan {
  /** Structured state. Do NOT collapse to a single boolean. */
  state: CoverageState;
  /**
   * Derived helper for legacy callsites: true only when the apply is safe to
   * release. For `unverifiable` it requires `options.unverifiableConfirmed`.
   */
  sufficient: boolean;
  reason?: string;
  knownNetworks: KnownNetwork[];
  uncovered: KnownNetwork[];
  invalidCidrs: string[];
  /** Effective allow list (loopback + host + operator + extras + CGNAT). */
  effectiveAclsIpv4: AccessControlEntry[];
  effectiveAclsIpv6: AccessControlEntry[];
  /** True when state==='unverifiable' AND admin has NOT confirmed yet. */
  requiresAdminConfirmation: boolean;
  /** Mutated config to apply (never mutates the input). */
  migrated: WizardConfig;
}

export interface AdditionalKnownNetwork {
  /** Free-form origin tag (e.g. 'runtime-inventory-ipv6', 'operator-declared'). */
  origin: KnownNetwork['origin'] | string;
  cidr: string;
  label?: string;
}

export interface PlanOptions {
  /**
   * Administrator explicitly confirmed the (possibly empty) coverage list
   * for the `unverifiable` case. Recorded in the apply comment.
   */
  unverifiableConfirmed?: boolean;
  /**
   * Extra subscriber networks that MUST be covered, supplied by the caller
   * from real sources outside the WizardConfig (e.g. runtime inventory,
   * settings, or operator-declared subscriber list). Each entry is parsed
   * with the same validator and contributes to `knownNetworks`.
   */
  additionalKnownNetworks?: AdditionalKnownNetwork[];
}

// ───────────────────────── Detection helpers ─────────────────────────

/**
 * Parse a generated unbound config and report whether it contains any
 * open access-control directive (0.0.0.0/0 or ::/0 with allow/allow_snoop).
 * Robust against whitespace and comments.
 */
export function detectOpenAccessControl(
  unboundConf: string,
): { ipv4Open: boolean; ipv6Open: boolean } {
  let ipv4Open = false;
  let ipv6Open = false;
  for (const raw of unboundConf.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(
      /^access-control:\s*([0-9a-fA-F:.]+\/\d{1,3})\s+(allow(?:_snoop)?)\b/i,
    );
    if (!m) continue;
    const parsed = parseCidr(m[1]);
    if (!parsed) continue;
    if (parsed.family === 4 && parsed.prefix === 0) ipv4Open = true;
    if (parsed.family === 6 && parsed.prefix === 0) ipv6Open = true;
  }
  return { ipv4Open, ipv6Open };
}

// ───────────────────────── Planner ─────────────────────────

function extractHostNetwork(addr: string | undefined): string | null {
  if (!addr) return null;
  const parsed = parseCidr(addr);
  if (!parsed) return null;
  if (parsed.family === 4) {
    // Re-emit as canonical network: derive dotted base.
    const b = parsed.base;
    const octets = [
      Number((b >> 24n) & 0xffn),
      Number((b >> 16n) & 0xffn),
      Number((b >> 8n) & 0xffn),
      Number(b & 0xffn),
    ];
    return `${octets.join('.')}/${parsed.prefix}`;
  }
  // IPv6: emit groups (no compression — clarity over brevity for audit).
  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((parsed.base >> BigInt(i * 16)) & 0xffffn).toString(16));
  }
  return `${groups.join(':')}/${parsed.prefix}`;
}

/**
 * Build a migration plan to close an open resolver.
 *
 * Safety contract:
 *  - NEVER returns `sufficient=true` if there are uncovered known subscriber
 *    networks (state='incomplete') or no source to evaluate coverage
 *    (state='unverifiable', unless admin explicitly confirmed).
 *  - Loopback (127/8) and CGNAT (100.64/10) are auto-injected by the
 *    generator but do NOT count as subscriber coverage.
 */
export function planOpenResolverMigration(
  current: WizardConfig,
  extras: string[] = [],
  options: PlanOptions = {},
): MigrationPlan {
  // ── 1. Sanitize extras and split by family ──
  const cleanExtras = extras.map((s) => s.trim()).filter(Boolean);
  const parsedExtras = cleanExtras.map((c) => ({ raw: c, parsed: parseCidr(c) }));
  const invalidCidrs = parsedExtras.filter((e) => e.parsed === null).map((e) => e.raw);
  const validExtrasV4 = parsedExtras
    .filter((e) => e.parsed && e.parsed.family === 4)
    .map((e) => ({ raw: e.raw, parsed: e.parsed! }));
  const validExtrasV6 = parsedExtras
    .filter((e) => e.parsed && e.parsed.family === 6)
    .map((e) => ({ raw: e.raw, parsed: e.parsed! }));

  // ── 2. Existing operator ACLs (ground truth from prior config). ──
  const existingV4 = (current.accessControlIpv4 || []).filter(
    (e) =>
      e.action === 'allow' &&
      e.network &&
      e.network !== '0.0.0.0/0' &&
      isValidIpv4Cidr(e.network),
  );
  const existingV6 = (current.accessControlIpv6 || []).filter(
    (e) =>
      e.action === 'allow' &&
      e.network &&
      e.network !== '::/0' &&
      isValidIpv6Cidr(e.network),
  );

  // ── 3. Host networks (CIDR derived from host address). ──
  const hostV4 = extractHostNetwork(current.ipv4Address);
  const hostV6 = current.enableIpv6 ? extractHostNetwork(current.ipv6Address) : null;

  // ── 4. Build the merged allow set used for the new config. ──
  const mergedV4: AccessControlEntry[] = [...existingV4];
  for (const { raw } of validExtrasV4) {
    if (!mergedV4.some((e) => e.network === raw)) {
      mergedV4.push({ network: raw, action: 'allow', label: 'Assinante (migração)' });
    }
  }
  const mergedV6: AccessControlEntry[] = [...existingV6];
  for (const { raw } of validExtrasV6) {
    if (!mergedV6.some((e) => e.network === raw)) {
      mergedV6.push({ network: raw, action: 'allow', label: 'Assinante (migração)' });
    }
  }

  // ── 5. Compose the effective allow set used by the generator preview. ──
  const effectiveAclsIpv4: AccessControlEntry[] = [
    { network: '127.0.0.0/8', action: 'allow', label: 'Loopback' },
  ];
  if (hostV4) effectiveAclsIpv4.push({ network: hostV4, action: 'allow', label: 'Rede do host' });
  effectiveAclsIpv4.push(...mergedV4);
  effectiveAclsIpv4.push({ network: '100.64.0.0/10', action: 'allow', label: 'CGNAT (backends)' });

  const effectiveAclsIpv6: AccessControlEntry[] = current.enableIpv6
    ? [{ network: '::1/128', action: 'allow', label: 'Loopback IPv6' }]
    : [];
  if (hostV6) effectiveAclsIpv6.push({ network: hostV6, action: 'allow', label: 'Rede do host IPv6' });
  effectiveAclsIpv6.push(...mergedV6);

  // ── 6. Build the list of KNOWN subscriber networks to evaluate. ──
  //
  // Real sources used (no fabrication):
  //   • host-CIDR derived from current.ipv4Address / current.ipv6Address
  //   • previously-configured accessControlIpv4 / accessControlIpv6 entries
  //     with action='allow' (operator-declared subscriber ranges).
  //
  // Listeners / VIPs / service IPs are NOT subscriber networks and are
  // intentionally excluded.
  const known: KnownNetwork[] = [];
  if (hostV4) {
    known.push({ origin: 'host-ipv4', cidr: hostV4, family: 4, covered: false, label: 'Rede do host' });
  }
  if (hostV6) {
    known.push({ origin: 'host-ipv6', cidr: hostV6, family: 6, covered: false, label: 'Rede do host IPv6' });
  }
  for (const e of existingV4) {
    known.push({
      origin: 'existing-acl-ipv4',
      cidr: e.network,
      family: 4,
      covered: false,
      label: e.label || undefined,
    });
  }
  for (const e of existingV6) {
    known.push({
      origin: 'existing-acl-ipv6',
      cidr: e.network,
      family: 6,
      covered: false,
      label: e.label || undefined,
    });
  }
  // Caller-supplied known networks (e.g., runtime inventory, settings).
  for (const extra of options.additionalKnownNetworks || []) {
    const parsed = parseCidr(extra.cidr);
    if (!parsed) {
      // Surface invalid additional CIDRs through the invalid-CIDRs channel
      // so the state classifier reports them and blocks.
      invalidCidrs.push(extra.cidr);
      continue;
    }
    known.push({
      origin: (extra.origin as KnownNetwork['origin']),
      cidr: extra.cidr,
      family: parsed.family,
      covered: false,
      label: extra.label,
    });
  }



  // ── 7. Coverage evaluation: for each known network, look for an allowed
  //       supernet in the EFFECTIVE allow set (operator + auto-injected
  //       host CIDR + loopback + CGNAT). Prefer the broadest supernet
  //       (smallest prefix) so `coveredBy` is meaningful for audit.
  const sortByPrefixAsc = (
    a: { parsed: ParsedCidr },
    b: { parsed: ParsedCidr },
  ) => a.parsed.prefix - b.parsed.prefix;
  const allowedV4Parsed = effectiveAclsIpv4
    .filter((e) => e.action === 'allow')
    .map((e) => ({ raw: e.network, parsed: parseCidr(e.network) }))
    .filter((x): x is { raw: string; parsed: ParsedCidr } => x.parsed !== null)
    .sort(sortByPrefixAsc);
  const allowedV6Parsed = effectiveAclsIpv6
    .filter((e) => e.action === 'allow')
    .map((e) => ({ raw: e.network, parsed: parseCidr(e.network) }))
    .filter((x): x is { raw: string; parsed: ParsedCidr } => x.parsed !== null)
    .sort(sortByPrefixAsc);

  for (const k of known) {
    const subnet = parseCidr(k.cidr);
    if (!subnet) continue;
    const pool = k.family === 4 ? allowedV4Parsed : allowedV6Parsed;
    const hit = pool.find((cand) => cidrCovers(cand.parsed, subnet));
    if (hit) {
      k.covered = true;
      k.coveredBy = hit.raw;
    }
  }
  const uncovered = known.filter((k) => !k.covered);

  // ── 8. Classify state. ──
  let state: CoverageState;
  let reason: string | undefined;

  if (invalidCidrs.length > 0) {
    state = 'invalid';
    reason = `CIDR(s) inválido(s): ${invalidCidrs.join(', ')}`;
  } else if (known.length === 0) {
    state = 'unverifiable';
    reason =
      'Sem fonte confiável para identificar as redes de assinantes (sem host CIDR e sem ACLs prévias). ' +
      'Reveja e confirme explicitamente a lista completa de redes antes de liberar o preview.';
  } else if (uncovered.length > 0) {
    state = 'incomplete';
    reason = `Redes conhecidas não cobertas (${uncovered.length}): ${uncovered
      .map((u) => `${u.cidr} [${u.origin}]`)
      .join(', ')}`;
  } else {
    state = 'verified';
  }

  const requiresAdminConfirmation = state === 'unverifiable' && !options.unverifiableConfirmed;
  const sufficient =
    state === 'verified' ||
    (state === 'unverifiable' && options.unverifiableConfirmed === true);

  // ── 9. Produce migrated config copy (never mutates input). ──
  const migrated: WizardConfig = {
    ...current,
    securityProfile: 'isp-hardened',
    accessControlIpv4: mergedV4.length > 0 ? mergedV4 : current.accessControlIpv4 || [],
    accessControlIpv6: mergedV6.length > 0 ? mergedV6 : current.accessControlIpv6 || [],
    openResolverConfirmed: false,
  };

  return {
    state,
    sufficient,
    reason,
    knownNetworks: known,
    uncovered,
    invalidCidrs,
    effectiveAclsIpv4,
    effectiveAclsIpv6,
    requiresAdminConfirmation,
    migrated,
  };
}
