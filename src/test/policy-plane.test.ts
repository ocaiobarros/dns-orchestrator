/**
 * POL-1 — Policy plane API surface smoke test.
 * Verifies the api client exposes the read-only policy endpoints with the
 * expected signatures. Network-level behavior is covered by backend tests
 * (backend/tests/test_policy_plane.py).
 */

import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api';

describe('POL-1 policy plane API surface', () => {
  it('exposes all read-only methods', () => {
    expect(typeof api.getPolicySummary).toBe('function');
    expect(typeof api.getPolicyRules).toBe('function');
    expect(typeof api.getPolicyViews).toBe('function');
    expect(typeof api.getPolicyTenants).toBe('function');
    expect(typeof api.getPolicyFeedSources).toBe('function');
  });

  it('does NOT expose any mutating policy methods (POL-1 is read-only)', () => {
    const apiAny = api as unknown as Record<string, unknown>;
    for (const key of Object.keys(apiAny)) {
      if (!key.toLowerCase().includes('policy')) continue;
      // Only GET-equivalents allowed in POL-1.
      expect(key).toMatch(/^get/i);
    }
  });
});
