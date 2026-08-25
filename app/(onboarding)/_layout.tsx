/**
 * Trackit X — onboarding group layout.
 *
 * Only reachable by a user who is signed in and belongs to no organization. The
 * gate is what makes that true in both directions: a signed-out visitor is sent to
 * sign in, and a user who already has a business cannot come back here and create a
 * duplicate one by typing the URL.
 */
import { Stack } from 'expo-router';

import { RouteGate } from '@/components/navigation/RouteGate';

export default function OnboardingLayout() {
  return (
    <RouteGate allow="onboarding" loadingLabel="Loading your workspace">
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
    </RouteGate>
  );
}
