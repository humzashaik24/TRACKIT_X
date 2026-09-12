/**
 * Trackit X — AppHeader.
 *
 * The top bar of the authenticated shell: page context on the left, global
 * search in the available space, and account chrome on the right — notifications,
 * the workspace switcher and the user menu.
 *
 * Everything the right side opens is a `HeaderPopover`, so the three menus
 * share dismissal behaviour and presentation. The drawer and the search overlay
 * belong to the shell, not this header: the menu button and search trigger here
 * simply ask the shell to open them.
 */
import { usePathname } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createStyles,
  HStack,
  Icon,
  IconButton,
  Text,
  useResponsive,
  useStyles,
  useTheme,
} from '@/design-system';
import { useNotifications } from '@/features/notifications/useNotifications';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

import { Breadcrumbs } from './Breadcrumbs';
import { NotificationCenter } from './NotificationCenter';
import { OrganizationSwitcher } from './OrganizationSwitcher';
import { UserMenu } from './UserMenu';

export interface AppHeaderProps {
  /** Opens the mobile drawer. Only wired on compact screens. */
  onOpenMenu: () => void;
  /** Opens the global search overlay. */
  onOpenSearch: () => void;
  /** Toggles the desktop sidebar between expanded and collapsed. */
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
}

const styles = createStyles((theme) => ({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderSubtle,
    paddingHorizontal: theme.space[4],
    flexShrink: 0,
  },
  searchTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2.5],
    height: 36,
    maxWidth: 460,
    flex: 1,
    paddingHorizontal: theme.space[3],
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceInset,
  },
  searchTriggerHovered: {
    borderColor: theme.colors.borderStrong,
  },
}));

export function AppHeader({
  onOpenMenu,
  onOpenSearch,
  onToggleSidebar,
  sidebarCollapsed,
}: AppHeaderProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { isCompact } = useResponsive();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const crumbs = useMemo(() => deriveBreadcrumbs(pathname), [pathname]);
  const currentLabel = useMemo(() => {
    if (crumbs.length === 0) return 'Trackit X';
    return crumbs[crumbs.length - 1]?.label ?? 'Trackit X';
  }, [crumbs]);

  const topInset = isCompact ? insets.top : 0;

  return (
    <View style={[s.root, { height: topInset + theme.layout.topBarHeight, paddingTop: topInset }]}>
      {isCompact ? (
        <IconButton
          icon="menu"
          accessibilityLabel="Open navigation"
          variant="ghost"
          onPress={onOpenMenu}
        />
      ) : (
        <IconButton
          icon="sidebar"
          accessibilityLabel={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          variant="ghost"
          onPress={onToggleSidebar}
        />
      )}

      <View style={{ flexShrink: 1, minWidth: 0 }}>
        {isCompact ? (
          <Text variant="label" numberOfLines={1}>
            {currentLabel}
          </Text>
        ) : (
          <Breadcrumbs crumbs={crumbs} />
        )}
      </View>

      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center' }}>
        {isCompact ? (
          <IconButton
            icon="search"
            accessibilityLabel="Search"
            variant="ghost"
            onPress={onOpenSearch}
          />
        ) : (
          <Pressable
            onPress={onOpenSearch}
            accessibilityRole="button"
            accessibilityLabel="Search your workspace"
            tabIndex={0}
            style={({ hovered }) => [
              s.searchTrigger,
              hovered && s.searchTriggerHovered,
              { width: '100%' },
            ]}
          >
            <Icon name="search" size="md" tone="tertiary" />
            <Text variant="bodySm" tone="tertiary" numberOfLines={1} style={{ flex: 1 }}>
              Search your workspace…
            </Text>
            <Text variant="caption" tone="tertiary">
              ⌘K
            </Text>
          </Pressable>
        )}
      </View>

      <HStack gap={2} align="center">
        {unreadCount > 0 ? (
          <View>
            <IconButton
              icon="notifications"
              accessibilityLabel={`Notifications, ${unreadCount} unread`}
              variant="ghost"
              onPress={() => setNotificationsOpen(true)}
            />
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: theme.colors.accent.fg,
                borderWidth: 1,
                borderColor: theme.colors.surface,
              }}
            />
          </View>
        ) : (
          <IconButton
            icon="notifications"
            accessibilityLabel="Notifications"
            variant="ghost"
            onPress={() => setNotificationsOpen(true)}
          />
        )}

        <OrganizationSwitcher />
        <UserMenu />
      </HStack>

      {notificationsOpen && <NotificationCenter onClose={() => setNotificationsOpen(false)} />}
    </View>
  );
}