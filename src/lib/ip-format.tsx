import { Fragment, type ReactNode } from 'react';

/**
 * Render an IP address with logical break opportunities.
 *
 * - IPv4 (no ':' or single dotted form) → rendered as-is, no breaks.
 * - IPv6 (contains ':') → split on ':' and emit <wbr/> after each colon so the
 *   browser can wrap CLEANLY at the colon separators when the container is
 *   narrow. No horizontal scrollbar, no char-by-char break-all.
 *
 * Pair with CSS `break-words` (NOT `break-all`) on the container so the
 * browser only breaks at the <wbr/> opportunities we inserted.
 */
export function formatIpWithBreaks(ip: string | null | undefined): ReactNode {
  if (!ip) return ip ?? '';
  const s = String(ip);
  if (!s.includes(':')) return s; // IPv4 or hostname — no breaks
  const parts = s.split(':');
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              {':'}
              <wbr />
            </>
          )}
        </Fragment>
      ))}
    </>
  );
}
