// ============================================================
// IP utilities — normalize/split IPv4 and IPv6 from raw inputs
// Useful when the API returns a single "ip" field that has
// glued/concatenated IPv4 + IPv6 (no separator) or comma/space
// separated lists.
// ============================================================

const IPV4_REGEX = /(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?/g;
// Generic IPv6 capture: hex groups separated by ':' (allows '::' shortening)
// Excludes pure IPv4 by requiring at least one ':' in the match.
const IPV6_REGEX = /([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?/g;

export interface SplitIpResult {
  ipv4: string | null;
  ipv6: string | null;
  raw: string;
}

/**
 * Detect and split mixed IPv4/IPv6 from a single string.
 * Handles: "1.2.3.4", "::1", "1.2.3.42001:db8::1", "1.2.3.4, ::1".
 */
export function splitIp(value: string | null | undefined): SplitIpResult {
  const raw = (value ?? "").trim();
  if (!raw) return { ipv4: null, ipv6: null, raw: "" };

  const v4Matches = raw.match(IPV4_REGEX) ?? [];
  // Remove v4 occurrences before scanning for v6 to avoid false positives.
  let scrubbed = raw;
  for (const m of v4Matches) scrubbed = scrubbed.replace(m, " ");
  const v6Matches = (scrubbed.match(IPV6_REGEX) ?? []).filter((m) => m.includes(":") && m.length > 2);

  return {
    ipv4: v4Matches[0] ?? null,
    ipv6: v6Matches[0] ?? null,
    raw,
  };
}

/**
 * Pick best IPv4/IPv6 pair from multiple candidate fields.
 * Falls back to splitting a single mixed value if explicit fields are absent.
 */
export function resolveIpPair(opts: {
  ipv4?: string | null;
  ipv6?: string | null;
  ip?: string | null;
  ips?: Array<string | null | undefined> | null;
}): SplitIpResult {
  const explicitV4 = (opts.ipv4 ?? "").trim() || null;
  const explicitV6 = (opts.ipv6 ?? "").trim() || null;
  if (explicitV4 || explicitV6) {
    return { ipv4: explicitV4, ipv6: explicitV6, raw: `${explicitV4 ?? ""} ${explicitV6 ?? ""}`.trim() };
  }

  const candidates: string[] = [];
  if (opts.ip) candidates.push(opts.ip);
  if (Array.isArray(opts.ips)) {
    for (const v of opts.ips) if (v) candidates.push(v);
  }

  let v4: string | null = null;
  let v6: string | null = null;
  for (const c of candidates) {
    const split = splitIp(c);
    if (!v4 && split.ipv4) v4 = split.ipv4;
    if (!v6 && split.ipv6) v6 = split.ipv6;
    if (v4 && v6) break;
  }

  return { ipv4: v4, ipv6: v6, raw: candidates.join(" ") };
}
