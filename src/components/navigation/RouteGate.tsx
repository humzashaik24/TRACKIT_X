/**
 * Trackit X — route guard.
 *
 * Wraps a route group's children and enforces that the current user belongs in
 * that group. Four layouts share it, so the redirect rule exists once.
 *
 * ── Why declarative `<Redirect>` and not `router.replace()` in an effect ─────
 * An effect fires AFTER the children render, so a guarded screen paints once
 * before being replaced — visible as a flash of the dashboard on a signed-out
 * cold start. `<Redirect>` is evaluated during render, so the guarded screen never
 * mounts at all.
 *
 * ── Why loading never redirects ─────────────────────────────────────────────
 * While the session is resolving, no zone is correct. Redirecting on an unknown
 * answer is exactly how a two-layout redirect loop starts: this layout sends the
 * user to `/sign-in`, restoration completes, the auth layout sends them back, and
 * the cycle continues until something wins by accident.
 */
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { BrandSplash } from '@/components/BrandSplash';
import { ErrorState, ScreenContainer } from '@/design-system';
import { useRouteGate, zoneEntryPath, type RouteZone } from '@/navigation/useRouteGate';

export interface RouteGateProps {
  /** The zone this layout serves. Anything else is redirected away. */
  allow: Exclude<RouteZone, 'loading' | 'error'>;
  children: ReactNode;
  /** Shown on the splash while the zone is being resolved. */
  loadingLabel?: string;
}

export function RouteGate({ allow, children, loadingLabel }: RouteGateProps) {
  const { zone, error, retry } = useRouteGate();

  if (zone === 'loading') {
    return <BrandSplash {...(loadingLabel === undefined ? {} : { label: loadingLabel })} />;
  }

  if (zone === 'error') {
    // Rendered rather than redirected: whether this user needs onboarding is
    // genuinely unknown, and sending them anywhere would be a guess. Retry is the
    // only honest affordance.
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <ErrorState
          kind="network"
          title="We could not load your organizations"
          message={error?.userMessage ?? 'Something went wrong. Trying again usually works.'}
          onRetry={() => {
            void retry();
          }}
        />
      </ScreenContainer>
    );
  }

  if (zone !== allow) return <Redirect href={zoneEntryPath[zone]} />;

  return <>{children}</>;
}
