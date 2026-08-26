/**
 * Trackit X — application shell.
 *
 * The chrome around every signed-in screen: a floating glass tab bar on a phone,
 * a persistent sidebar on a desktop.
 *
 * ── Why this is not `<Tabs>` ────────────────────────────────────────────────
 * Expo Router's tab navigator gives per-tab state retention — switch away from a
 * scrolled list and back, and the scroll position survives. This shell does not:
 * it renders one `Stack` and swaps the route, so each destination remounts.
 *
 * That is a real trade-off, taken deliberately and worth stating rather than
 * discovering later. What it buys is one navigation model across three form
 * factors: the same six destinations render as a bottom bar, or as a sidebar, or
 * (later) as a sidebar plus a detail pane, without a tab navigator's assumption
 * that chrome lives at the bottom of the screen. Retention comes back when it is
 * needed, by lifting list state into a query cache — which is where it has to live
 * anyway for a shared list to stay consistent across two panes.
 */
import { router, usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Badge,
  createStyles,
  Divider,
  GlassSurface,
  HStack,
  Icon,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { ROLE_LABELS } from '@/domain/organization';
import {
  activeDestination,
  destinations,
  type Destination,
  type DestinationPath,
} from '@/navigation/destinations';

export interface AppShellProps {
  children: ReactNode;
  /** Business name for the sidebar header. */
  organizationName: string;
  /** The signed-in user's role, for the sidebar badge. */
  role: keyof typeof ROLE_LABELS | null;
}

const SIDEBAR_WIDTH = 268;

const styles = createStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.canvas,
  },
  wideRoot: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: theme.colors.canvas,
  },
  content: {
    flex: 1,
    // `minWidth: 0` lets the content column shrink instead of pushing the
    // sidebar off-screen when a wide child (a table) exceeds the viewport.
    minWidth: 0,
  },

  // --- Sidebar -------------------------------------------------------------
  sidebar: {
    width: SIDEBAR_WIDTH,
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSubtle,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[5],
    gap: theme.space[4],
  },
  sidebarHeader: {
    paddingHorizontal: theme.space[2],
    gap: theme.space[1],
  },
  railItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
    borderRadius: theme.radius.md,
  },
  railItemActive: {
    backgroundColor: theme.colors.accent.subtle,
  },
  railItemHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },

  // --- Bottom bar ----------------------------------------------------------
  bar: {
    position: 'absolute',
    left: theme.space[3],
    right: theme.space[3],
    flexDirection: 'row',
    paddingHorizontal: theme.space[2],
    paddingTop: theme.space[2],
    paddingBottom: theme.space[2],
    zIndex: theme.layers.chrome,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: theme.space[1],
    paddingVertical: theme.space[1],
    borderRadius: theme.radius.md,
  },
  /**
   * The "not built yet" marker. A 6px dot rather than a word, because the label
   * beneath it has room for one short word and nothing else. The screen itself
   * carries the full explanation — this only prevents the tap being a surprise.
   */
  pendingDot: {
    position: 'absolute',
    top: 0,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.warning.fg,
  },
  iconWrap: {
    position: 'relative',
  },
}));

function navigate(path: DestinationPath): void {
  // `replace`, not `push`: the six destinations are peers, so stacking them would
  // build a back stack of sideways moves and make the hardware back button walk
  // through a history the user never intended to create.
  router.replace(path);
}

interface NavItemProps {
  destination: Destination;
  active: boolean;
}

function SidebarItem({ destination, active }: NavItemProps) {
  const s = useStyles(styles);

  return (
    <Pressable
      onPress={() => navigate(destination.path)}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        destination.ready
          ? destination.longLabel
          : `${destination.longLabel}, not available yet — ${destination.arrivesIn}`
      }
      // Only `pressed` is in React Native's Pressable state — `hovered` is a
      // react-native-web extension and is not in the shared typings, so the
      // hover affordance stays out until the web build needs it.
      style={({ pressed }) => [
        s.railItem,
        active && s.railItemActive,
        pressed && !active && s.railItemHovered,
      ]}
    >
      <Icon
        name={destination.icon}
        size="md"
        tone={active ? 'accent' : destination.ready ? 'secondary' : 'tertiary'}
      />
      <Text
        variant="label"
        tone={active ? 'accent' : destination.ready ? 'primary' : 'tertiary'}
        numberOfLines={1}
        style={{ flex: 1 }}
      >
        {destination.longLabel}
      </Text>
      {destination.ready ? null : <Badge label="Soon" intent="warning" variant="soft" size="sm" />}
    </Pressable>
  );
}

function BottomTab({ destination, active }: NavItemProps) {
  const s = useStyles(styles);

  return (
    <Pressable
      onPress={() => navigate(destination.path)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        destination.ready
          ? destination.label
          : `${destination.label}, not available yet — ${destination.arrivesIn}`
      }
      style={s.tab}
      // A 44pt-tall target regardless of the label's height.
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
    >
      <View style={s.iconWrap}>
        <Icon
          name={destination.icon}
          size="md"
          tone={active ? 'accent' : destination.ready ? 'secondary' : 'tertiary'}
        />
        {destination.ready ? null : <View style={s.pendingDot} />}
      </View>
      <Text
        variant="caption"
        tone={active ? 'accent' : destination.ready ? 'secondary' : 'tertiary'}
        numberOfLines={1}
      >
        {destination.label}
      </Text>
    </Pressable>
  );
}

export function AppShell({ children, organizationName, role }: AppShellProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { isWide } = useResponsive();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const current = activeDestination(pathname);

  if (isWide) {
    return (
      <View style={s.wideRoot}>
        <View style={[s.sidebar, { paddingTop: insets.top + theme.space[5] }]}>
          <VStack gap={1} style={s.sidebarHeader}>
            <HStack gap={2} align="center">
              <Icon name="aiSpark" size="sm" tone="accent" />
              <Text variant="overline" tone="tertiary" uppercase>
                Trackit X
              </Text>
            </HStack>
            <Text variant="h4" numberOfLines={2}>
              {organizationName}
            </Text>
            {role === null ? null : (
              <View style={{ alignSelf: 'flex-start' }}>
                <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
              </View>
            )}
          </VStack>

          <Divider />

          <VStack gap={1}>
            {destinations.map((destination) => (
              <SidebarItem
                key={destination.path}
                destination={destination}
                active={current?.path === destination.path}
              />
            ))}
          </VStack>
        </View>

        <View style={s.content}>{children}</View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.content}>{children}</View>

      <GlassSurface
        strong
        corner="xl"
        style={[
          s.bar,
          {
            // Sits above the home indicator. `space[3]` on a device with no inset
            // keeps it off the very edge of the screen.
            bottom: insets.bottom > 0 ? insets.bottom : theme.space[3],
          },
        ]}
        // `tablist` is the accurate role and, unlike `navigation`, is a real
        // React Native accessibility role rather than a web-only ARIA value.
        accessibilityRole="tablist"
      >
        {destinations.map((destination) => (
          <BottomTab
            key={destination.path}
            destination={destination}
            active={current?.path === destination.path}
          />
        ))}
      </GlassSurface>
    </View>
  );
}

/**
 * How much bottom padding a screen needs so its last row is not hidden behind the
 * floating bar. Exported because only the shell knows the bar's height.
 */
export const BOTTOM_BAR_CLEARANCE = 84;
