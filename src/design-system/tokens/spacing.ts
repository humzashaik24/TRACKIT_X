/**
 * Trackit X — spacing, sizing and layout tokens.
 *
 * A 4px base grid. `space` is the primitive scale; `layout` holds composed
 * decisions (screen gutters, card padding, control heights) so screens stay
 * consistent without re-deriving numbers.
 */

/** 4px-step spacing scale. Keys are grid steps, values are pixels. */
export const space = {
  0: 0,
  /** Hairline — dividers, 1px offsets. */
  px: 1,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  3.5: 14,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  9: 36,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  32: 128,
} as const;

export type SpaceToken = keyof typeof space;

export const layout = {
  /** Horizontal screen gutter, per breakpoint tier. */
  screenPaddingX: { compact: space[4], regular: space[6], wide: space[8] },
  /** Vertical rhythm between major screen sections. */
  sectionGap: { compact: space[5], regular: space[6], wide: space[7] },
  /** Interior padding of a standard card. */
  cardPadding: { compact: space[4], regular: space[5], wide: space[5] },
  /** Gap between cards in a grid. */
  gridGap: { compact: space[3], regular: space[4], wide: space[4] },
  /** Maximum content width on very large screens — keeps lines readable. */
  maxContentWidth: 1520,
  /** Width of the persistent desktop navigation sidebar. */
  sidebarWidth: 268,
  sidebarCollapsedWidth: 76,
  /** Height of the desktop top bar. */
  topBarHeight: 60,
  /** Height of the mobile tab bar, excluding safe-area inset. */
  tabBarHeight: 58,
  /** Minimum touch target, per platform accessibility guidance. */
  minTouchTarget: 44,
} as const;

/** Heights for interactive controls, keyed by size. */
export const controlHeight = {
  xs: 28,
  sm: 34,
  md: 40,
  lg: 48,
  xl: 56,
} as const;

export type ControlSize = keyof typeof controlHeight;

/** Square icon sizes that pair with `controlHeight`. */
export const iconSize = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 44,
} as const;

export type IconSizeToken = keyof typeof iconSize;

/** Avatar diameters. */
export const avatarSize = {
  xs: 22,
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
  '2xl': 96,
} as const;

export type AvatarSizeToken = keyof typeof avatarSize;
