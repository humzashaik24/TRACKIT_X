/**
 * Trackit X — the routing decision, as pure data and one pure function.
 *
 * Separated from `useRouteGate` on purpose. The hook has to import both contexts,
 * which reach Supabase and AsyncStorage at module load; this file imports nothing but
 * types, so the rule that decides where a user is sent can be exercised exhaustively
 * in a unit test with no renderer, no session and no mocks.
 *
 * The rule lives in ONE place for a reason. Auth gating spread across four `_layout`
 * files disagrees with itself the first time one of them forgets that "still loading"
 * is not "signed out", and the symptom is a redirect loop — one of the harder bugs to
 * reason about after the fact.
 */
import type { Href } from 'expo-router';

import type { AuthStatus } from '@/contexts/AuthContext';
import type { OrganizationStatus } from '@/contexts/OrganizationContext';

/**
 * · `loading`    — a session or a membership list is still being resolved. Show a
 *                  splash. Never redirect from here: this is the state that
 *                  causes loops when treated as an answer.
 * · `auth`       — no session. Sign in, sign up, recover a password.
 * · `onboarding` — signed in, belongs to no organization. Create the first one.
 * · `app`        — signed in, has an organization. The product.
 * · `error`      — signed in, but the membership list could not be read, so
 *                  whether onboarding is needed is UNKNOWN. Guessing either way is
 *                  wrong: guessing `onboarding` invites a duplicate organization,
 *                  guessing `app` shows a dashboard with no tenant.
 */
export type RouteZone = 'loading' | 'auth' | 'onboarding' | 'app' | 'error';

/** The zones a user can be sent to. `loading` and `error` are states, not places. */
export type NavigableZone = Exclude<RouteZone, 'loading' | 'error'>;

/**
 * Where each zone's navigation starts.
 *
 * Typed as Expo Router's `Href` rather than `string`, so a zone pointing at a route
 * that does not exist fails to compile. With typed routes generated, `Href` is the
 * literal union of real routes; without the generated declaration it widens to
 * `string`, which degrades the check but never breaks the build.
 */
export const zoneEntryPath: Record<NavigableZone, Href> = {
  auth: '/sign-in',
  onboarding: '/create-organization',
  app: '/dashboard',
};

/**
 * The whole routing decision.
 *
 * `membershipCount` rather than the membership list: the decision depends on whether
 * there are any, never on which. A number also cannot tempt a future edit into
 * reading a tenant id out of an argument that exists to answer a yes/no question.
 */
export function resolveZone(
  authStatus: AuthStatus,
  organizationStatus: OrganizationStatus,
  membershipCount: number,
): RouteZone {
  // Order matters. "Still restoring" is checked before everything else because it
  // becomes a redirect loop the moment it is treated as an answer.
  if (authStatus === 'restoring') return 'loading';

  // No session is a complete answer regardless of what the organization context
  // says: with nobody signed in there are no memberships to wait for.
  if (authStatus === 'signedOut') return 'auth';

  // Signed in from here on.
  if (organizationStatus === 'loading') return 'loading';
  if (organizationStatus === 'error') return 'error';
  return membershipCount === 0 ? 'onboarding' : 'app';
}
