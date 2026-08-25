/**
 * Trackit X — entry gate.
 *
 * The route Expo Router lands on at `/`. It renders no UI of its own: it resolves
 * which zone the current user belongs in and hands over.
 *
 * `RouteGate allow="app"` does the whole job. When the user belongs in the app it
 * renders its children — a redirect to the dashboard. When they belong anywhere
 * else, the gate itself redirects there. And while the session or membership list is
 * still resolving it holds the splash, which is the one thing a naive
 * `<Redirect href="/sign-in" />` here would get wrong: it would sign out every
 * returning user for the few hundred milliseconds restoration takes.
 */
import { Redirect } from 'expo-router';

import { RouteGate } from '@/components/navigation/RouteGate';

export default function Index() {
  return (
    <RouteGate allow="app">
      <Redirect href="/dashboard" />
    </RouteGate>
  );
}
