/**
 * POL-1 — Policy plane API client smoke tests.
 * Asserts that the read-only mock fallback returns honest empty-state shape.
 */

import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api';

describe('POL-1 policy plane API (mock fallback)', () => {
  it('summary returns empty counts with legend', async () => {
    const r = await api.getPolicySummary();
    expect(r.success).toBe(true);
    expect(r.data!.total_rules).toBe(0);
    expect(r.data!.layers_legend['100']).toMatch(/judicial/i);
    expect(r.data!.layers_legend['400']).toMatch(/allowlist|exce/i);
  });

  it('rules / views / tenants / feeds return empty lists', async () => {
    for (const fn of [
      () => api.getPolicyRules(),
      () => api.getPolicyViews(),
      () => api.getPolicyTenants(),
      () => api.getPolicyFeedSources(),
    ]) {
      const r = await fn();
      expect(r.success).toBe(true);
      expect(r.data!.items).toEqual([]);
      expect(r.data!.total).toBe(0);
    }
  });

  it('rules query supports layer filter param', async () => {
    const r = await api.getPolicyRules({ layer: 200, enabled_only: true });
    expect(r.success).toBe(true);
  });
});
