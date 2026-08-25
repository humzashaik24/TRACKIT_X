/**
 * Trackit X — application group layout.
 *
 * Gates the group to signed-in users who have an organization, then wraps every
 * screen in the shell chrome so the tab bar / sidebar does not remount on each
 * navigation.
 */
import { Stack } from 'expo-router';

import { AppShell } from '@/components/navigation/AppShell';
import { RouteGate } from '@/components/navigation/RouteGate';
import { useOrganization } from '@/contexts/OrganizationContext';

/**
 * Separate from the default export because it reads `useOrganization()`, and inside
 * `RouteGate` that read is safe: the gate has already established that an
 * organization exists before these children render.
 */
function ShellHost() {
  const { organization, role } = useOrganization();

  return (
    <AppShell
      // The fallback should be unreachable — the gate guarantees an organization —
      // but a crash on a missing name would be a poor trade for one `??`.
      organizationName={organization?.name ?? 'Your business'}
      role={role}
    >
      <Stack
        screenOptions={{
          headerShown: false,
          // The chrome is persistent, so a slide would animate the content against
          // a stationary tab bar and read as a glitch rather than a transition.
          animation: 'none',
        }}
      />
    </AppShell>
  );
}

export default function AppLayout() {
  return (
    <RouteGate allow="app" loadingLabel="Loading your workspace">
      <ShellHost />
    </RouteGate>
  );
}
