import { resolveIpPair } from '@/lib/ip-utils';

interface IpAddressStackProps {
  ipv4?: string | null;
  ipv6?: string | null;
  fallback?: string | null;
  /** Optional list of additional candidate strings (e.g. bind_ips array). */
  ips?: Array<string | null | undefined> | null;
  className?: string;
  valueClassName?: string;
}

export default function IpAddressStack({
  ipv4,
  ipv6,
  fallback,
  ips,
  className = '',
  valueClassName = '',
}: IpAddressStackProps) {
  // Auto-normalize: if explicit fields are missing OR the single value is a
  // glued IPv4+IPv6 string, resolveIpPair will split them automatically.
  const resolved = resolveIpPair({ ipv4, ipv6, ip: fallback, ips });

  const rows = [
    resolved.ipv4 ? { label: 'IPv4', value: resolved.ipv4 } : null,
    resolved.ipv6 ? { label: 'IPv6', value: resolved.ipv6 } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (!rows.length) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`.trim()}>
      {rows.map((row) => (
        <div
          key={`${row.label}-${row.value}`}
          className="flex min-w-0 items-start gap-2 rounded border border-border/50 bg-muted/20 px-2 py-1"
        >
          <span className="w-10 shrink-0 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
            {row.label}
          </span>
          <span className={`min-w-0 break-all font-mono text-xs leading-snug text-foreground/90 ${valueClassName}`.trim()}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}