/**
 * Trackit X — NotificationCenter.
 *
 * The notification panel in the top bar. It renders whatever the feed says the
 * UI should see — loading, error, empty or a real list — and deliberately
 * never assumes a list exists. In Phase 29 the feed is the honest `empty`
 * state; when a notification table lands, the hook behind this component starts
 * returning real items and this UI does not change.
 */
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import {
  Badge,
  Divider,
  EmptyState,
  ErrorState,
  HStack,
  Icon,
  LoadingState,
  Text,
  useTheme,
  VStack,
} from '@/design-system';
import { useNotifications } from '@/features/notifications/useNotifications';
import type { AppNotification } from '@/features/notifications/model';

import { HeaderPopover } from './HeaderPopover';

export interface NotificationCenterProps {
  onClose: () => void;
}

/**
 * One notification as a row. Shared by the header popover and the full
 * notifications screen so both render items identically.
 */
export function NotificationRow({ item }: { item: AppNotification }) {
  const theme = useTheme();
  const read = item.read;

  return (
    <Pressable
      onPress={() => {
        // Navigate to the record this notification is about, when one exists.
        if (item.actionPath !== undefined) {
          // The path comes from our own data model, never from a user string;
          // the cast bridges a stale typed-routes declaration file during the
          // interim between adding a route and Metro regenerating it.
          router.push(item.actionPath as unknown as Href);
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}${item.body === undefined ? '' : `, ${item.body}`}`}
      style={({ pressed }) => ({
        padding: theme.space[3],
        gap: theme.space[1],
        backgroundColor: pressed
          ? theme.colors.surfacePressed
          : read
            ? 'transparent'
            : theme.colors.accent.subtle,
        borderRadius: theme.radius.md,
      })}
    >
      <HStack gap={2.5} align="flex-start">
        <Icon name={item.kind === 'alert' ? 'warning' : item.kind === 'approval' ? 'check' : 'info'} size="md" tone="secondary" />
        <VStack gap={0.5} style={{ flex: 1, minWidth: 0 }}>
          <Text variant="labelSm" tone={read ? 'secondary' : 'primary'} numberOfLines={2}>
            {item.title}
          </Text>
          {item.body !== undefined && (
            <Text variant="caption" tone="tertiary" numberOfLines={3}>
              {item.body}
            </Text>
          )}
        </VStack>
        {!read && (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: theme.colors.accent.fg,
              marginTop: 5,
            }}
          />
        )}
      </HStack>
    </Pressable>
  );
}

export function NotificationCenter({ onClose }: NotificationCenterProps) {
  const theme = useTheme();
  const { view, unreadCount, refresh } = useNotifications();

  return (
    <HeaderPopover onClose={onClose} width={360}>
      <HStack gap={2} align="center" style={{ padding: theme.space[4], paddingBottom: theme.space[3] }}>
        <Text variant="h3" style={{ flex: 1 }}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <Badge label={`${unreadCount} unread`} intent="accent" variant="soft" size="sm" />
        )}
      </HStack>
      <Divider subtle />

      {view.kind === 'loading' && (
        <View style={{ padding: theme.space[4] }}>
          <LoadingState variant="spinner" label="Loading notifications" fill />
        </View>
      )}

      {view.kind === 'error' && (
        <View style={{ padding: theme.space[4] }}>
          <ErrorState kind="network" message={view.message} onRetry={() => void refresh()} inline />
        </View>
      )}

      {view.kind === 'empty' && (
        <View style={{ padding: theme.space[4] }}>
          <EmptyState
            variant="firstRun"
            icon="notifications"
            title="No notifications yet"
            description="Alerts about your business will appear here as they happen. Nothing is shown until a real source for them exists."
            inline
          />
        </View>
      )}

      {view.kind === 'ready' && (
        <ScrollView
          style={{ maxHeight: 340 }}
          contentContainerStyle={{ padding: theme.space[3], gap: theme.space[1] }}
          showsVerticalScrollIndicator={false}
        >
          {view.items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ScrollView>
      )}

      {view.kind === 'ready' && view.items.length > 0 && (
        <>
          <Divider subtle />
          <View style={{ padding: theme.space[3] }}>
            <Text variant="caption" tone="tertiary">
              Marking items read and acting on them arrive with the notification source.
            </Text>
          </View>
        </>
      )}
    </HeaderPopover>
  );
}