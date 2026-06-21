/**
 * POL-1 (read) + POL-2a (operator block CRUD) — API surface smoke tests.
 * Network-level behavior is covered by backend/tests/test_policy_plane.py.
 */

import { describe, it, expect } from 'vitest';
import { api } from '@/lib/api';

describe('Policy plane API surface', () => {
  it('exposes all POL-1 read-only methods', () => {
    expect(typeof api.getPolicySummary).toBe('function');
    expect(typeof api.getPolicyRules).toBe('function');
    expect(typeof api.getPolicyViews).toBe('function');
    expect(typeof api.getPolicyTenants).toBe('function');
    expect(typeof api.getPolicyFeedSources).toBe('function');
  });

  it('exposes POL-2a operator block mutators (admin-only; backend enforces RBAC)', () => {
    expect(typeof api.createOperatorBlock).toBe('function');
    expect(typeof api.updatePolicyRule).toBe('function');
    expect(typeof api.deletePolicyRule).toBe('function');
  });

  it('POL-2a mutators are scoped to operator block only (no judicial/feed mutator surface)', () => {
    const apiAny = api as unknown as Record<string, unknown>;
    const policyKeys = Object.keys(apiAny).filter(k => k.toLowerCase().includes('policy') || k.toLowerCase().includes('operatorblock'));
    for (const key of policyKeys) {
      // No "judicial", "feed", "anablock" mutators — those are out of scope.
      expect(key.toLowerCase()).not.toMatch(/judicial|anablock|createfeed|deletefeed|updatefeed/);
    }
  });
});
