/**
 * Trackit X — "coming next" placeholder.
 *
 * The screen behind an unfinished navigation destination.
 *
 * This exists to prevent one specific dishonesty. A Projects tab that renders an
 * empty list looks identical to a business that has no projects — so the user
 * cannot tell whether the software is unfinished or their data is missing, and the
 * only way to find out is to try to add a project and fail. This screen says which
 * it is, in words, before they spend that time.
 *
 * It deliberately offers no fake affordance: no disabled "New project" button, no
 * placeholder rows. The only action is back to the part of the app that works.
 */
import { router } from 'expo-router';

import { EmptyState, ScreenContainer, Text, VStack } from '@/design-system';
import type { Destination } from '@/navigation/destinations';

import { BOTTOM_BAR_CLEARANCE } from './AppShell';

export interface ComingNextProps {
  destination: Destination;
}

export function ComingNext({ destination }: ComingNextProps) {
  return (
    <ScreenContainer
      edges={['bottom']}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
    >
      <VStack gap={4} justify="center" flex={1}>
        <EmptyState
          icon={destination.icon}
          title={`${destination.longLabel} is not built yet`}
          description={destination.summary}
          action={{
            label: 'Back to dashboard',
            onPress: () => router.replace('/dashboard'),
            icon: 'dashboard',
          }}
        />
        <Text variant="caption" tone="tertiary" align="center">
          Planned for {destination.arrivesIn.toLowerCase()}
        </Text>
      </VStack>
    </ScreenContainer>
  );
}
