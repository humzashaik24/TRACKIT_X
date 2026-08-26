/**
 * Trackit X — routing zone resolution.
 *
 * Turns two async contexts (auth, organization) into ONE answer: which zone of
 * the app the current user belongs in right now. Every layout asks this and either
 * renders its children or redirects; no layout re-derives the rule.
 *
 * The rule itself lives in `./routeZone`, which imports only types — this file is
 * the thin React binding that feeds it the two statuses. Consumers can keep
 * importing `RouteZone` and `zoneEntryPath` from here.
 */
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '@/contexts/AuthContext';
import type { AppError } from '@/utils/errors';

import { resolveZone, zoneEntryPath, type NavigableZone, type RouteZone } from './routeZone';

export { resolveZone, zoneEntryPath };
export type { NavigableZone, RouteZone };

export interface RouteGateState {
  readonly zone: RouteZone;
  /** Set only when `zone === 'error'`. Render `error.userMessage`, never `message`. */
  readonly error: AppError | null;
  retry(): Promise<void>;
}

export function useRouteGate(): RouteGateState {
  const { status: authStatus } = useAuth();
  const { status: organizationStatus, error, memberships, refresh } = useOrganization();

  const zone = resolveZone(authStatus, organizationStatus, memberships.length);

  // The error is surfaced only in the zone that means "we could not tell" — carrying
  // a stale read failure into `app` would put a warning on a screen that is working.
  return { zone, error: zone === 'error' ? error : null, retry: refresh };
}
