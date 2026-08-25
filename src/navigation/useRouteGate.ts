/**
 * Trackit X — routing zone resolution.
 *
 * Turns two async contexts (auth, organization) into ONE answer: which zone of
 * the app the current user belongs in right now. Every layout asks this and either
 * renders its children or redirects; no layout re-derives the rule.
 *
 * That centralisation is the point. Auth gating spread across four `_layout`
 * files disagrees with itself the first time one of them forgets that "still
 * loading" is not "signed out" — and the symptom is a redirect loop, which is one
 * of the harder bugs to reason about after the fact.
 */
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import type { AppError } from '@/utils/errors';

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

export interface RouteGateState {
  readonly zone: RouteZone;
  /** Set only when `zone === 'error'`. Render `error.userMessage`, never `message`. */
  readonly error: AppError | null;
  retry(): Promise<void>;
}

/** Where each zone's navigation starts. */
export const zoneEntryPath: Record<Exclude<RouteZone, 'loading' | 'error'>, string> = {
  auth: '/sign-in',
  onboarding: '/create-organization',
  app: '/dashboard',
};

export function useRouteGate(): RouteGateState {
  const { status: authStatus } = useAuth();
  const {
    status: organizationStatus,
    error,
    memberships,
    refresh,
  } = useOrganization();

  const zone: RouteZone = (() => {
    if (authStatus === 'restoring') return 'loading';
    if (authStatus === 'signedOut') return 'auth';

    // Signed in from here on.
    if (organizationStatus === 'loading') return 'loading';
    if (organizationStatus === 'error') return 'error';
    return memberships.length === 0 ? 'onboarding' : 'app';
  })();

  return { zone, error: zone === 'error' ? error : null, retry: refresh };
}
