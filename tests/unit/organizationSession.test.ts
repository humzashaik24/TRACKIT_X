/**
 * Organization session — the stale-organization regression.
 *
 * Phase 41, section 10: after sign-out, and after an account switch, the
 * previous account's organizations must not survive in any form. The
 * OrganizationProvider enforces this by stamping every committed membership read
 * with the user id it was read for and deriving what the app sees from the
 * CURRENT user — so a loaded value from the old account is `null` the moment the
 * user id changes, including the render that would otherwise still show it.
 *
 * These tests pin that one property at its pure decision point
 * (`resolveMembershipsForUser`), which is the derivation a refactor could lose
 * while every individual service test kept passing. The provider itself is not
 * rendered here: rendering would only re-assert that the provider calls the
 * function, which is less interesting than the rule the function encodes.
 */
import {
  resolveMembershipsForUser,
  type LoadedMemberships,
} from '@/contexts/OrganizationContext';
import type { OrganizationRow } from '@/types/database';

const ORG_A = '11111111-1111-4111-8111-111111111111';

/**
 * A committed read, as the provider would build it. `memberships` carries the
 * minimal shape the context exposes; nothing here asserts on the rows themselves,
 * only on which user may see them.
 */
function loadedRead(userId: string): LoadedMemberships {
  const organization = {
    id: ORG_A,
    name: 'Northwind',
  } as unknown as OrganizationRow;

  return {
    userId,
    memberships: [
      {
        membershipId: 'm-1',
        organization,
        role: 'owner',
        permissions: [],
        joinedAt: '2026-09-01T00:00:00.000Z',
      },
    ],
    error: null,
    activeId: ORG_A,
  };
}

describe('resolveMembershipsForUser — the stale-organization guard', () => {
  it('exposes a read to the user it was read for', () => {
    const read = loadedRead('user-a');
    expect(resolveMembershipsForUser(read, 'user-a')).toBe(read);
  });

  it('hides every read once signed out', () => {
    // After sign-out the current user is null, so a read committed under any real
    // user id must not be visible — this is the frame that would otherwise flash
    // the previous business under a signed-out shell.
    expect(resolveMembershipsForUser(loadedRead('user-a'), null)).toBeNull();
  });

  it('hides the previous account after a switch, before the new read lands', () => {
    // Account B signs in; the old read for A is still in memory. The derivation
    // must refuse it on the first B render, before B's own read completes.
    expect(resolveMembershipsForUser(loadedRead('user-a'), 'user-b')).toBeNull();
    expect(resolveMembershipsForUser(loadedRead('user-b'), 'user-b')).not.toBeNull();
  });

  it('treats no committed read as nothing', () => {
    expect(resolveMembershipsForUser(null, 'user-a')).toBeNull();
    expect(resolveMembershipsForUser(null, null)).toBeNull();
  });

  it('never returns a read for a blank current user', () => {
    // A `user?.id` that is an empty string is still "not this account". No real
    // user id is empty, and an empty id must not match a stored non-empty one.
    expect(resolveMembershipsForUser(loadedRead('user-a'), '')).toBeNull();
  });
});