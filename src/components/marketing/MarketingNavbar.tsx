/**
 * Trackit X — marketing navigation.
 *
 * A floating bar rather than a full-width one. It is pinned above the scrolling
 * page, so a transparent strip would eventually be reading across whatever section
 * happened to be underneath it; an inset glass pill stays legible over everything
 * and does not draw a horizontal seam across the hero.
 *
 * ── The mobile decision ─────────────────────────────────────────────────────
 * The secondary navigation is dropped below tablet instead of being folded into a
 * hamburger. A drawer implies destinations, and these five labels are section
 * anchors on a single page — a menu of them on a phone would be a menu of scroll
 * positions. What survives at every width is the wordmark and the one action that
 * matters, which is the point of the bar.
 */
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Button,
  createStyles,
  GlassSurface,
  HStack,
  space,
  Text,
  useResponsive,
  useStyles,
  useTheme,
} from '@/design-system';

import { NAV_LINKS } from './content';
import { Wordmark } from './Wordmark';

export interface MarketingNavbarProps {
  /** Scrolls the page to a section anchor. */
  onNavigate: (section: string) => void;
  /** Primary action: into the product. */
  onEnter: () => void;
  /** Secondary action: the AI section of this page. */
  onSeeAi: () => void;
  /** Top safe-area inset, supplied by the page. */
  insetTop: number;
}

const styles = createStyles((theme) => ({
  dock: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: theme.layers.chrome,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: theme.layout.maxContentWidth,
    paddingLeft: theme.space[4],
    paddingRight: theme.space[2],
    paddingVertical: theme.space[2],
    ...theme.shadows.md,
  },
  link: {
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.sm,
  },
}));

/**
 * Hover state is tracked with `onHoverIn`/`onHoverOut` rather than Pressable's
 * style callback, matching Button and Card: the callback's typed argument is
 * `pressed` only, and reading a web-only `hovered` off it does not type-check.
 */
function NavLinkItem({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme();
  const s = useStyles(styles);
  const [hovered, setHovered] = useState(false);
  const onHoverIn = useCallback(() => setHovered(true), []);
  const onHoverOut = useCallback(() => setHovered(false), []);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      // `link` plus `focusable` is what gives the web build a real tab stop; an
      // unlabelled Pressable is invisible to both keyboards and screen readers.
      accessibilityRole="link"
      accessibilityLabel={label}
      focusable
      style={[s.link, hovered && { backgroundColor: theme.colors.surfaceHover }]}
    >
      <Text variant="label" tone={hovered ? 'primary' : 'secondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function MarketingNavbar({ onNavigate, onEnter, onSeeAi, insetTop }: MarketingNavbarProps) {
  const s = useStyles(styles);
  const { isCompact, isWide, screenPaddingX } = useResponsive();

  return (
    <View
      // `box-none` matters: the dock spans the full width, and without it the
      // transparent area beside the bar would swallow taps meant for the hero.
      pointerEvents="box-none"
      style={[s.dock, { paddingTop: insetTop + space[3], paddingHorizontal: screenPaddingX }]}
    >
      <GlassSurface strong corner="pill" style={s.bar}>
        <HStack justify="space-between" gap={4}>
          <Wordmark />

          {isWide && (
            <HStack gap={0}>
              {NAV_LINKS.map((link) => (
                <NavLinkItem
                  key={link.section}
                  label={link.label}
                  onPress={() => onNavigate(link.section)}
                />
              ))}
            </HStack>
          )}

          <HStack gap={2}>
            {!isCompact && (
              <Button label="See AI in Action" variant="ghost" size="sm" onPress={onSeeAi} />
            )}
            <Button label="Enter Workspace" size="sm" onPress={onEnter} />
          </HStack>
        </HStack>
      </GlassSurface>
    </View>
  );
}
