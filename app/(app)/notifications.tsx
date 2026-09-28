/**
 * Trackit X — notifications screen.
 *
 * The full-page version of the header notification centre, rendering the same
 * feed through the same model. The feed is honest about its source: until a
 * notification table exists, `useNotifications` returns the `empty` state, and
 * this screen says so instead of inventing a timeline.
 */
import { ScrollView } from 'react-native';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { NotificationRow } from '@/components/navigation/NotificationCenter';
import { PageHeader } from '@/components/navigation/PageHeader';
import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  ScreenContainer,
  Text,
  VStack,
} from '@/design-system';
import { useNotifications } from '@/features/notifications/useNotifications';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

export default function NotificationsScreen() {
  const { view, unreadCount, refresh } = useNotifications();

  return (
    <ScreenContainer
      edges={['bottom']}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
    >
      <PageHeader
        title="Notifications"
        description="Alerts about your business as they happen."
        breadcrumbs={deriveBreadcrumbs('/notifications')}
        icon="notifications"
      />

      {view.kind === 'loading' && (
        <LoadingState variant="spinner" label="Loading notifications" fill />
      )}

      {view.kind === 'error' && (
        <ErrorState
          kind="network"
          message={view.message}
          inline
          onRetry={() => {
            void refresh();
          }}
        />
      )}

      {view.kind === 'empty' && (
        <Card variant="outline" padding={4}>
          <EmptyState
            variant="firstRun"
            icon="notifications"
            title="No notifications yet"
            description="Alerts about your business will appear here as they happen. Nothing is shown until a real source for them exists — this screen reports the genuine state of the inbox."
          />
        </Card>
      )}

      {view.kind === 'ready' && (
        <VStack gap={3}>
          {unreadCount > 0 && (
            <Text variant="bodySm" tone="secondary">
              {unreadCount} unread
            </Text>
          )}
          <ScrollView showsVerticalScrollIndicator={false}>
            <VStack gap={1}>
              {view.items.map((item) => (
                <NotificationRow key={item.id} item={item} />
              ))}
            </VStack>
          </ScrollView>
          <Text variant="caption" tone="tertiary">
            Marking items read and acting on them arrive with the notification source.
          </Text>
        </VStack>
      )}
    </ScreenContainer>
  );
}