/**
 * Workforce snapshot logic — the one real number on the dashboard.
 *
 * Two rules are under test, and both exist to stop the dashboard from stating
 * something untrue:
 *
 *  · `toCounted` never turns a failure into a number. A failed count that arrived as
 *    `0` would read on screen as "this business has nobody in it", which is a
 *    confident false statement rather than a visible error.
 *  · `deriveSnapshot` discards a count read for a different organization. Switching
 *    workspaces must not leave the previous business's headcount under the new
 *    business's name — not for one frame, which is why the comparison is a derivation
 *    rather than a cleanup effect.
 */
import {
  deriveSnapshot,
  toCounted,
  type CountedFor,
} from '@/features/dashboard/snapshot';
import { appError } from '@/utils/errors';
import { err, ok } from '@/utils/result';

// Hex letters on purpose: an all-digit id would make the case-sensitivity assertion
// below vacuous, since `'1111'.toUpperCase()` is `'1111'`.
const ORG_A = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const ORG_B = 'bb22cc33-dd44-4e55-8f66-001122334455';

const failure = appError('NETWORK_UNAVAILABLE', 'count(*) request failed');

const counted = (organizationId: string, memberCount: number): CountedFor => ({
  organizationId,
  memberCount,
  error: null,
});

const failed = (organizationId: string): CountedFor => ({
  organizationId,
  memberCount: null,
  error: failure,
});

describe('toCounted', () => {
  it('stamps a successful count with the organization it was counted for', () => {
    const result = toCounted(ORG_A, ok(7));
    expect(result).toEqual({ organizationId: ORG_A, memberCount: 7, error: null });
  });

  it('keeps a genuine zero as a number', () => {
    // Zero members is not the same as "could not count". The RLS-filtered count can
    // legitimately be low, and collapsing it into the failure path would hide it.
    const result = toCounted(ORG_A, ok(0));
    expect(result.memberCount).toBe(0);
    expect(result.error).toBeNull();
  });

  it('never produces a number from a failure', () => {
    const result = toCounted(ORG_A, err(failure));
    expect(result.memberCount).toBeNull();
    expect(result.error).not.toBeNull();
    expect(result.organizationId).toBe(ORG_A);
  });

  it('carries the AppError through rather than a provider string', () => {
    const result = toCounted(ORG_A, err(failure));
    expect(result.error?.code).toBe('NETWORK_UNAVAILABLE');
    expect(result.error?.userMessage.length).toBeGreaterThan(0);
    // The raw message stays out of anything a screen renders.
    expect(result.error?.userMessage).not.toContain('count(*)');
  });
});

describe('deriveSnapshot — before an answer exists', () => {
  it('reports loading with nothing committed', () => {
    const view = deriveSnapshot(null, ORG_A, false);
    expect(view.status).toBe('loading');
    expect(view.memberCount).toBeNull();
    expect(view.error).toBeNull();
  });

  it('reports loading when there is no organization at all', () => {
    const view = deriveSnapshot(null, null, false);
    expect(view.status).toBe('loading');
    expect(view.memberCount).toBeNull();
  });
});

describe('deriveSnapshot — a successful count', () => {
  it('reports it as ready', () => {
    const view = deriveSnapshot(counted(ORG_A, 12), ORG_A, false);
    expect(view.status).toBe('ready');
    expect(view.memberCount).toBe(12);
    expect(view.error).toBeNull();
  });

  it('reports a zero count as ready, not as loading', () => {
    // `memberCount === 0` is falsy; a `??`-free truthiness check anywhere in the
    // derivation would show a permanent skeleton for an empty workspace.
    const view = deriveSnapshot(counted(ORG_A, 0), ORG_A, false);
    expect(view.status).toBe('ready');
    expect(view.memberCount).toBe(0);
  });
});

describe('deriveSnapshot — a failed count', () => {
  it('reports error and surfaces the failure', () => {
    const view = deriveSnapshot(failed(ORG_A), ORG_A, false);
    expect(view.status).toBe('error');
    expect(view.error?.code).toBe('NETWORK_UNAVAILABLE');
  });

  it('reports no number alongside the error', () => {
    const view = deriveSnapshot(failed(ORG_A), ORG_A, false);
    expect(view.memberCount).toBeNull();
  });

  it('distinguishes a failure from an absent answer', () => {
    // Collapsing these leaves the panel spinning forever after a refused request,
    // with no retry offered.
    expect(deriveSnapshot(null, ORG_A, false).status).toBe('loading');
    expect(deriveSnapshot(failed(ORG_A), ORG_A, false).status).toBe('error');
  });
});

describe('deriveSnapshot — tenant freshness', () => {
  it('discards a count belonging to another organization', () => {
    const view = deriveSnapshot(counted(ORG_B, 40), ORG_A, false);
    expect(view.status).toBe('loading');
    expect(view.memberCount).toBeNull();
  });

  it('never leaks the other organization’s number', () => {
    const view = deriveSnapshot(counted(ORG_B, 40), ORG_A, false);
    expect(view.memberCount).not.toBe(40);
  });

  it('discards another organization’s error too', () => {
    // Showing organization B's failure on organization A's dashboard invites a
    // retry against a business the user is not looking at.
    const view = deriveSnapshot(failed(ORG_B), ORG_A, false);
    expect(view.status).toBe('loading');
    expect(view.error).toBeNull();
  });

  it('discards a count once the organization becomes null', () => {
    const view = deriveSnapshot(counted(ORG_A, 3), null, false);
    expect(view.status).toBe('loading');
    expect(view.memberCount).toBeNull();
  });

  it('matches on exact id, not on a prefix or case-insensitively', () => {
    expect(deriveSnapshot(counted(ORG_A, 3), ORG_A.slice(0, -1), false).status).toBe('loading');
    expect(deriveSnapshot(counted(ORG_A, 3), ORG_A.toUpperCase(), false).status).toBe('loading');
  });
});

describe('deriveSnapshot — refreshing', () => {
  it('keeps the existing number visible while a refresh is in flight', () => {
    // This is the whole reason `isRefreshing` is separate from `status`: a
    // pull-to-refresh must not replace a good figure with a skeleton.
    const view = deriveSnapshot(counted(ORG_A, 9), ORG_A, true);
    expect(view.isRefreshing).toBe(true);
    expect(view.status).toBe('ready');
    expect(view.memberCount).toBe(9);
  });

  it('passes the flag through without affecting the status', () => {
    for (const isRefreshing of [true, false]) {
      expect(deriveSnapshot(null, ORG_A, isRefreshing).status).toBe('loading');
      expect(deriveSnapshot(counted(ORG_A, 1), ORG_A, isRefreshing).status).toBe('ready');
      expect(deriveSnapshot(failed(ORG_A), ORG_A, isRefreshing).status).toBe('error');
      expect(deriveSnapshot(null, ORG_A, isRefreshing).isRefreshing).toBe(isRefreshing);
    }
  });
});

describe('deriveSnapshot — invariants', () => {
  const cases: readonly (readonly [CountedFor | null, string | null])[] = [
    [null, ORG_A],
    [null, null],
    [counted(ORG_A, 0), ORG_A],
    [counted(ORG_A, 5), ORG_A],
    [counted(ORG_B, 5), ORG_A],
    [failed(ORG_A), ORG_A],
    [failed(ORG_B), ORG_A],
    [counted(ORG_A, 5), null],
  ];

  it('reports an error only in the error status, and a number only in ready', () => {
    for (const [committed, organizationId] of cases) {
      const view = deriveSnapshot(committed, organizationId, false);
      if (view.error !== null) expect(view.status).toBe('error');
      if (view.memberCount !== null) expect(view.status).toBe('ready');
      if (view.status === 'ready') expect(view.error).toBeNull();
      if (view.status === 'loading') {
        expect(view.memberCount).toBeNull();
        expect(view.error).toBeNull();
      }
    }
  });

  it('never reports a number and an error at the same time', () => {
    for (const [committed, organizationId] of cases) {
      const view = deriveSnapshot(committed, organizationId, false);
      expect(view.memberCount !== null && view.error !== null).toBe(false);
    }
  });

  it('does not mutate what it is given', () => {
    const committed = counted(ORG_A, 4);
    const snapshot = { ...committed };
    deriveSnapshot(committed, ORG_B, true);
    expect(committed).toEqual(snapshot);
  });
});
