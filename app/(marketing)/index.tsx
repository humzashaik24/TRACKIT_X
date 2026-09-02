/**
 * Trackit X — public entry.
 *
 * The route Expo Router lands on at `/`. It replaces the previous bare redirect,
 * which sent every visitor straight to `/sign-in`: the door now has a front.
 *
 * ── Why this is gated, on a public page ─────────────────────────────────────
 * `RouteGate allow="auth"` renders the landing page for a visitor who has no
 * session, and redirects everyone else to where they already belong — the dashboard
 * for a member, organization setup for someone mid-onboarding. That is the exact
 * behaviour the old `app/index.tsx` had, so nothing about the existing entry
 * contract changes; the only difference is what an unauthenticated visitor sees.
 *
 * It also means the marketing surface never renders for a signed-in user, so there
 * is no state in which a session exists and a public page is mounted.
 *
 * The gate's loading branch matters as much as its redirects: while the session is
 * being restored it holds the splash rather than guessing, which is what stops a
 * returning user from being shown a marketing page for a few hundred milliseconds
 * before landing on their dashboard.
 */
import { LandingPage } from '@/components/marketing';
import { RouteGate } from '@/components/navigation/RouteGate';

export default function MarketingIndex() {
  return (
    <RouteGate allow="auth">
      <LandingPage />
    </RouteGate>
  );
}
