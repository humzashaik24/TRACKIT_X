/**
 * Trackit X — application shell.
 *
 * The chrome around every signed-in screen: on a phone, a glass tab bar plus a
 * slide-in navigation drawer; on a desktop, a section-grouped sidebar plus a top
 * bar with global search, notifications and the workspace switcher.
 *
 * ── Why this is not `<Tabs>` ────────────────────────────────────────────────
 * Expo Router's tab navigator gives per-tab state retention — switch away from a
 * scrolled list and back, and the scroll position survives. This shell does not:
 * it renders one `Stack` and swaps the route, so each destination remounts.
 *
 * That is a real trade-off, taken deliberately and worth stating rather than
 * discovering later. What it buys is one navigation model across three form
 * factors: the same destinations render as a bottom bar, or as a sidebar, or as
 * a drawer, without a tab navigator's assumption that chrome lives at the bottom
 * of the screen. Retention comes back when it is needed, by lifting list state
 * into a query cache — which is where it has to live anyway for a shared list to
 * stay consistent across two panes.
 *
 * ── The chrome is composed, not re-implemented ──────────────────────────────
 * The Phase 29 navigation components — `AppHeader`, `Sidebar`, `MobileDrawer` and
 * `GlobalSearch` — were built and then left unwired. This shell now mounts them
 * rather than drawing its own flat rail, so the information architecture
 * (sections, readiness dots, bottom-bar subset) lives in the components and the
 * destinations table, and the shell only owns the three states the chrome needs:
 * whether the desktop sidebar is collapsed, whether the search overlay is open,
 * and whether the mobile drawer is open.
 */
import { router, usePathname } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createStyles,
  GlassSurface,
  Icon,
  Text,
  useResponsive,
  useStyles,
  useTheme,
} from '@/design-system';
import type { ROLE_LABELS } from '@/domain/organization';
import {
  activeDestination,
  bottomBarDestinations,
  type Destination,
  type DestinationPath,
} from '@/navigation/destinations';
import { roleLabelFor, Sidebar } from './Sidebar';

import { AppHeader } from './AppHeader';
import { GlobalSearch } from './GlobalSearch';
import { MobileDrawer } from './MobileDrawer';

export interface AppShellProps {
  children: ReactNode;
  /** Business name for the sidebar header. */
  organizationName: string;
  /** The signed-in user's role, for the sidebar badge. */
  role: keyof typeof ROLE_LABELS | null;
}

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
  contentFill: {
    flex: 1,
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
  // `replace`, not `push`: the six bottom-bar destinations are peers, so stacking
  // them would build a back stack of sideways moves and make the hardware back
  // button walk through a history the user never intended to create. The sidebar
  // and drawer navigate with `push`, which is right for a tree-shaped history —
  // going Home → Projects → Settings and pressing back should return, not quit.
  router.replace(path);
}

interface NavItemProps {
  destination: Destination;
  active: boolean;
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const roleLabel = roleLabelFor(role);

  const chrome = (
    <AppHeader
      onOpenMenu={() => setDrawerOpen(true)}
      onOpenSearch={() => setSearchOpen(true)}
      onToggleSidebar={() => setSidebarCollapsed((previous) => !previous)}
      sidebarCollapsed={sidebarCollapsed}
    />
  );

  if (isWide) {
    return (
      <View style={s.wideRoot}>
        <Sidebar
          organizationName={organizationName}
          roleLabel={roleLabel}
          collapsed={sidebarCollapsed}
        />
        <View style={s.content}>
          {chrome}
          <View style={s.contentFill}>{children}</View>
        </View>
        {searchOpen ? <GlobalSearch onClose={() => setSearchOpen(false)} /> : null}
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.content}>
        {chrome}
        <View style={s.contentFill}>{children}</View>
      </View>

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
        {/*
         * The compact bar can hold only a handful of tabs, and which half dozen
         * those are is decided in one place — `bottomBarDestinations` in
         * `destinations.ts` — so the bar and the test suite cannot drift about the
         * answer. Rendering the full `destinations` table here was a Phase 39
         * audit finding: twenty-four tabs in a row is not navigation.
         */}
        {bottomBarDestinations.map((destination) => (
          <BottomTab
            key={destination.path}
            destination={destination}
            active={current?.path === destination.path}
          />
        ))}
      </GlassSurface>

      {drawerOpen ? (
        <MobileDrawer onClose={() => setDrawerOpen(false)}>
          <Sidebar
            organizationName={organizationName}
            roleLabel={roleLabel}
            onNavigate={() => setDrawerOpen(false)}
          />
        </MobileDrawer>
      ) : null}

      {searchOpen ? <GlobalSearch onClose={() => setSearchOpen(false)} /> : null}
    </View>
  );
}

/**
 * How much bottom padding a screen needs so its last row is not hidden behind the
 * floating bar. Exported because only the shell knows the bar's height.
 */
export const BOTTOM_BAR_CLEARANCE = 84;