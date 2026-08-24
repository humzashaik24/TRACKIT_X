/**
 * Trackit X — corner radius tokens.
 *
 * The product reads as "soft hardware": generous, consistent radii with square
 * corners reserved for full-bleed surfaces.
 */
export const radius = {
  none: 0,
  /** Chips, small badges, inline code. */
  xs: 6,
  /** Inputs, small buttons, table cells. */
  sm: 10,
  /** Buttons, list rows, nested cards. */
  md: 13,
  /** Standard card. */
  lg: 18,
  /** Feature card, modal. */
  xl: 24,
  /** Sheet, hero panel. */
  '2xl': 32,
  /** Fully rounded — pills, avatars, toggles. */
  pill: 999,
} as const;

export type RadiusToken = keyof typeof radius;
