/**
 * Route zone resolution — where a user is sent, and when.
 *
 * This is the highest-consequence pure function in the app: it is the only thing
 * standing between a signed-out visitor and the dashboard, and the only thing
 * standing between a correct app and a redirect loop. So it is tested exhaustively
 * rather than by example — every one of the 3 × 3 status combinations is asserted,
 * plus the membership branch on both sides.
 *
 * Two properties are worth naming, because they are the ones a future edit would
 * plausibly break:
 *
 *  · `loading` is never a redirect. `RouteGate` redirects when `zone !== allow`, so
 *    a zone returned during an unresolved session sends the user somewhere and then
 *    sends them back when the session lands. That is the loop.
 *  · `restoring` outranks everything. A half-restored session must not read as
 *    signed out for even one render, because the auth zone would then be entered by
 *    a user who is in fact signed in.
 */
import type { AuthStatus } from '@/contexts/AuthContext';
import type { OrganizationStatus } from '@/contexts/OrganizationContext';
import { resolveZone, zoneEntryPath, type NavigableZone, type RouteZone } from '@/navigation/routeZone';

const AUTH_STATUSES: readonly AuthStatus[] = ['restoring', 'signedIn', 'signedOut'];
const ORGANIZATION_STATUSES: readonly OrganizationStatus[] = ['loading', 'ready', 'error'];

describe('resolveZone — while the session is unresolved', () => {
  it('reports loading regardless of what the organization context says', () => {
    for (const organizationStatus of ORGANIZATION_STATUSES) {
      for (const count of [0, 1, 7]) {
        expect(resolveZone('restoring', organizationStatus, count)).toBe('loading');
      }
    }
  });

  it('never reports auth — a restoring session is not a signed-out one', () => {
    for (const organizationStatus of ORGANIZATION_STATUSES) {
      expect(resolveZone('restoring', organizationStatus, 0)).not.toBe('auth');
    }
  });
});

describe('resolveZone — signed out', () => {
  it('sends the user to auth whatever the organization context reports', () => {
    for (const organizationStatus of ORGANIZATION_STATUSES) {
      expect(resolveZone('signedOut', organizationStatus, 0)).toBe('auth');
    }
  });

  it('ignores a stale membership list left over from a previous session', () => {
    // A count above zero with no session means the organization context has not
    // cleared yet. Reading it as `app` would show the previous user's workspace.
    expect(resolveZone('signedOut', 'ready', 3)).toBe('auth');
  });
});

describe('resolveZone — signed in', () => {
  it('waits while the membership list is still being read', () => {
    expect(resolveZone('signedIn', 'loading', 0)).toBe('loading');
    // Even with memberships already in hand: `loading` means the list may still
    // change, and committing to `app` on a partial list picks the wrong tenant.
    expect(resolveZone('signedIn', 'loading', 2)).toBe('loading');
  });

  it('reports error rather than guessing when the list could not be read', () => {
    // Guessing `onboarding` invites a duplicate organization; guessing `app` shows
    // a dashboard with no tenant. Both are worse than saying so.
    expect(resolveZone('signedIn', 'error', 0)).toBe('error');
    expect(resolveZone('signedIn', 'error', 5)).toBe('error');
  });

  it('routes a user with no memberships to onboarding', () => {
    expect(resolveZone('signedIn', 'ready', 0)).toBe('onboarding');
  });

  it('routes a user with any membership into the app', () => {
    expect(resolveZone('signedIn', 'ready', 1)).toBe('app');
    expect(resolveZone('signedIn', 'ready', 12)).toBe('app');
  });
});

describe('resolveZone — the whole decision table', () => {
  it('answers every status combination with exactly one zone', () => {
    const expected: Record<AuthStatus, Record<OrganizationStatus, RouteZone>> = {
      restoring: { loading: 'loading', ready: 'loading', error: 'loading' },
      signedOut: { loading: 'auth', ready: 'auth', error: 'auth' },
      signedIn: { loading: 'loading', ready: 'app', error: 'error' },
    };

    for (const authStatus of AUTH_STATUSES) {
      for (const organizationStatus of ORGANIZATION_STATUSES) {
        // One membership, so the `ready` cell reads `app`; the zero case is
        // covered above.
        expect(resolveZone(authStatus, organizationStatus, 1)).toBe(
          expected[authStatus][organizationStatus],
        );
      }
    }
  });

  it('is total — no combination falls through to undefined', () => {
    const zones: readonly RouteZone[] = ['loading', 'auth', 'onboarding', 'app', 'error'];

    for (const authStatus of AUTH_STATUSES) {
      for (const organizationStatus of ORGANIZATION_STATUSES) {
        for (const count of [0, 1]) {
          expect(zones).toContain(resolveZone(authStatus, organizationStatus, count));
        }
      }
    }
  });

  it('is pure — the same inputs give the same answer', () => {
    const first = resolveZone('signedIn', 'ready', 0);
    const second = resolveZone('signedIn', 'ready', 0);
    expect(first).toBe(second);
  });
});

describe('zoneEntryPath', () => {
  it('has an entry point for every zone a user can be sent to', () => {
    const navigable: readonly NavigableZone[] = ['auth', 'onboarding', 'app'];
    for (const zone of navigable) {
      expect(typeof zoneEntryPath[zone]).toBe('string');
      expect(zoneEntryPath[zone]).toMatch(/^\//);
    }
  });

  it('has no entry point for loading or error', () => {
    // These are states, not places. A path for either would invite a redirect from
    // a zone that must never redirect.
    expect(Object.keys(zoneEntryPath).sort()).toEqual(['app', 'auth', 'onboarding']);
  });

  it('points each zone at a distinct route', () => {
    const paths = Object.values(zoneEntryPath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('points at the routes that actually exist in app/', () => {
    // Asserted as literals on purpose: renaming a route file without updating this
    // table is exactly the change that produces a silent redirect to nowhere.
    expect(zoneEntryPath.auth).toBe('/sign-in');
    expect(zoneEntryPath.onboarding).toBe('/create-organization');
    expect(zoneEntryPath.app).toBe('/dashboard');
  });
});
