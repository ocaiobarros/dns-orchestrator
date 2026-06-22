import { describe, it, expect } from 'vitest';
import {
  filterItemsByFamily,
  recencyKind,
} from '@/components/noc/NocUpstreamSilence';

describe('upstream-silence client-side derivations', () => {
  const items = [
    { ip: '1.1.1.1', family: 'ipv4' as const },
    { ip: '2.2.2.2', family: 'ipv4' as const },
    { ip: '2001:db8::1', family: 'ipv6' as const },
  ];

  it('filters by family', () => {
    expect(filterItemsByFamily(items, 'all')).toHaveLength(3);
    expect(filterItemsByFamily(items, 'ipv4')).toHaveLength(2);
    expect(filterItemsByFamily(items, 'ipv6')).toHaveLength(1);
  });

  it('marks recency below 1 min as recent and otherwise as old', () => {
    const now = 1_000_000;
    expect(recencyKind(now - 30, now)).toBe('recent');
    expect(recencyKind(now - 59, now)).toBe('recent');
    expect(recencyKind(now - 61, now)).toBe('old');
    expect(recencyKind(now - 600, now)).toBe('old');
  });
});
