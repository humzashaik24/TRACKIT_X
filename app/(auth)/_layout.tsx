/**
 * Trackit X — auth group layout.
 *
 * Guards the group so a signed-in user cannot land back on the sign-in form
 * (which would look broken: correct credentials, then a redirect straight back).
 *
 * Note what is NOT here: `/reset-password` lives at the route root, outside this
 * group, on purpose. Following a recovery link establishes a real session, so a
 * user completing a password reset is *signed in* — this layout would bounce them
 * to the dashboard before they could type a new password.
 */
import { Stack } from 'expo-router';

import { RouteGate } from '@/components/navigation/RouteGate';

export default function AuthLayout() {
  return (
    <RouteGate allow="auth" loadingLabel="Checking your session">
      <Stack
        screenOptions={{
          headerShown: false,
          // Within the group the moves ARE drill-downs (sign in → forgot
          // password), so a horizontal push is the honest animation here.
          animation: 'slide_from_right',
        }}
      />
    </RouteGate>
  );
}
