/**
 * Trackit X — Sidebar.
 *
 * The desktop's persistent navigation, reused as the content of the mobile
 * drawer. Both presentations share one component so the information
 * architecture cannot drift between form factors: the same sections render top
 * to bottom on the desktop and inside the drawer.
 *
 * Honesty rules that hold in both variants:
 *  · a destination with `ready: false` is visibly marked as not built and
 *    navigates to its placeholder screen, which says so in words;
 *  · the active route is highlighted by prefix match so a future detail route
 *    (`/projects/42`) keeps its parent lit;
 *  · a collapsed rail never hides a label from assistive technology — the
 *    accessibility label always carries the full name, and a tooltip restores
 *    it sighted users.
 *
 * Keyboard navigation works on the web because each item is a button-role
 * pressable in tab order; react-native-web activates button roles on Enter and
 * Space.
 */
import { router, usePathname } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Badge,
  createStyles,
  Divider,
  HStack,
  Icon,
  Text,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { ROLE_LABELS } from '@/domain/organization';
import {
  activeDestination,
  destinationsForSection,
  SECTION_LABELS,
  SECTION_ORDER,
} from '@/navigation/destinations';

/** Width of the expanded desktop sidebar, from the layout tokens. */
export const SIDEBAR_WIDTH = 268;

/** Width of the collapsed desktop rail. */
export const SIDEBAR_COLLAPSED_WIDTH = 76;

/** A destination's readiness, as a short footnote. */
function readyNote(destination: { ready: boolean; arrivesIn: string }): string {
  return destination.ready ? 'Available now' : destination.arrivesIn;
}

export interface SidebarProps {
  /** Business name for the sidebar header. */
  organizationName: string;
  /** The signed-in user's role label, for the sidebar badge. */
  roleLabel?: string | null;
  /** Icon-only rail on the desktop. Never used for the drawer. */
  collapsed?: boolean;
  /**
   * Called after an item navigates — the drawer listens so it can close.
   */
  onNavigate?: () => void;
}

const styles = createStyles((theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.space[3],
    paddingBottom: theme.space[6],
    gap: theme.space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    paddingHorizontal: theme.space[3],
    paddingBottom: theme.space[1],
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: theme.space[0.5],
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[1.5],
  },
  brandMark: {
    width: 32,
    height: 32,
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent.subtle,
    borderWidth: 1,
    borderColor: theme.colors.accent.border,
  },
  section: {
    gap: theme.space[1],
  },
  sectionLabel: {
    paddingHorizontal: theme.space[3],
    paddingTop: theme.space[2],
    paddingBottom: theme.space[0.5],
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2.5],
    borderRadius: theme.radius.md,
    minHeight: 40,
  },
  itemActive: {
    backgroundColor: theme.colors.accent.subtle,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceHover,
  },
  itemLabel: {
    flex: 1,
    minWidth: 0,
  },
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.textTertiary,
  },
  tooltip: {
    position: 'absolute',
    left: '100%',
    top: 0,
    transform: [{ translateY: -8 }],
    marginLeft: theme.space[3],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[1.5],
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceOverlay,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000000',
  },
}));

function SidebarItem({
  collapsed,
  active,
  onPress,
  label,
  icon,
  ready,
  arrivesIn,
  accessibilityLabel,
}: {
  collapsed: boolean;
  active: boolean;
  onPress: () => void;
  label: string;
  icon: Parameters<typeof Icon>[0]['name'];
  ready: boolean;
  arrivesIn: string;
  accessibilityLabel: string;
}) {
  const s = useStyles(styles);
  const { layers } = useTheme();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);

  const showTooltip = collapsed && (hovered || focused);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onFocus={onFocus}
      onBlur={onBlur}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      accessibilityHint={ready ? undefined : arrivesIn}
      tabIndex={0}
      style={[
        s.item,
        active && s.itemActive,
        hovered && !active && s.itemHovered,
        collapsed && { justifyContent: 'center', paddingHorizontal: 0 },
      ]}
    >
      <Icon
        name={icon}
        size="md"
        tone={active ? 'accent' : ready ? 'secondary' : 'tertiary'}
      />
      {!collapsed && (
        <>
          <Text
            variant="bodySm"
            tone={active ? 'accent' : 'secondary'}
            numberOfLines={1}
            style={s.itemLabel}
          >
            {label}
          </Text>
          {!ready && <View style={s.pendingDot} />}
        </>
      )}
      {showTooltip && (
        <View
          pointerEvents="none"
          style={[s.tooltip, { zIndex: layers.tooltip }]}
          importantForAccessibility="no-hide-descendants"
        >
          <Text variant="labelSm" numberOfLines={1}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function Sidebar({ organizationName, roleLabel, collapsed = false, onNavigate }: SidebarProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const pathname = usePathname();
  const current = activeDestination(pathname);
  const insets = useSafeAreaInsets();

  const navigate = useCallback(
    (path: string) => {
      router.push(path as never);
      onNavigate?.();
    },
    [onNavigate],
  );

  return (
    <VStack style={s.root} gap={3}>
      <View style={[s.header, { paddingTop: insets.top + theme.space[3] }]}>
        <View style={s.brandMark}>
          <Icon name="aiSpark" size="lg" tone="accent" />
        </View>

        {!collapsed && (
          <VStack style={s.headerCopy}>
            <HStack gap={1.5} align="center">
              <Text variant="overline" tone="tertiary">
                Trackit X
              </Text>
            </HStack>
            <Text variant="label" numberOfLines={1}>
              {organizationName}
            </Text>
            {roleLabel !== undefined && roleLabel !== null && (
              <View style={{ alignSelf: 'flex-start' }}>
                <Badge label={roleLabel} intent="accent" variant="soft" size="sm" />
              </View>
            )}
          </VStack>
        )}
      </View>

      <Divider />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {SECTION_ORDER.map((section) => {
          const entries = destinationsForSection(section);
          return (
            <View key={section} style={s.section}>
              {!collapsed && (
                <Text variant="overline" tone="tertiary" style={s.sectionLabel}>
                  {SECTION_LABELS[section]}
                </Text>
              )}
              {entries.map((entry) => (
                <SidebarItem
                  key={entry.path}
                  collapsed={collapsed}
                  active={current?.path === entry.path}
                  onPress={() => navigate(entry.path)}
                  label={entry.longLabel}
                  icon={entry.icon}
                  ready={entry.ready}
                  arrivesIn={entry.arrivesIn}
                  accessibilityLabel={
                    entry.ready
                      ? entry.longLabel
                      : `${entry.longLabel}, not available yet — ${readyNote(entry)}`
                  }
                />
              ))}
            </View>
          );
        })}
      </ScrollView>
    </VStack>
  );
}

// Keep a ROLE_LABELS reference so a future role-aware sidebar can reach it
// without a second import surface; the badge receives the label directly.
export type { DestinationSection } from '@/navigation/destinations';
export function roleLabelFor(role: keyof typeof ROLE_LABELS | null | undefined): string | null {
  return role === null || role === undefined ? null : ROLE_LABELS[role];
}