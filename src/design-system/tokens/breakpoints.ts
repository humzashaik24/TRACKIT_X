/**
 * Trackit X — responsive breakpoints.
 *
 * Trackit X is one codebase across phone, tablet, laptop and large desktop.
 * Layouts are chosen from a *density tier*, not from raw pixel widths, so a
 * screen declares "this is a regular-density layout" instead of scattering
 * width comparisons through the tree.
 */

export const breakpoints = {
  /** Small phone. */
  xs: 0,
  /** Large phone. */
  sm: 480,
  /** Tablet portrait. */
  md: 768,
  /** Tablet landscape / small laptop. */
  lg: 1024,
  /** Desktop. */
  xl: 1280,
  /** Large desktop / ultrawide. */
  '2xl': 1600,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/** Ordered smallest → largest, for resolving the active breakpoint. */
export const breakpointOrder: readonly Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl'];

/**
 * Layout density tiers. These drive structural decisions:
 *  - `compact`  phone: single column, bottom tab bar, sheets
 *  - `regular`  tablet: two columns, collapsible sidebar
 *  - `wide`     desktop: multi-column, persistent sidebar, modals
 */
export type DensityTier = 'compact' | 'regular' | 'wide';

export function densityForWidth(width: number): DensityTier {
  if (width >= breakpoints.lg) return 'wide';
  if (width >= breakpoints.md) return 'regular';
  return 'compact';
}

export function breakpointForWidth(width: number): Breakpoint {
  let active: Breakpoint = 'xs';
  for (const key of breakpointOrder) {
    if (width >= breakpoints[key]) {
      active = key;
    }
  }
  return active;
}

/**
 * Resolves a per-breakpoint value for the given width, falling back to the
 * nearest smaller breakpoint that is defined.
 *
 * @example
 * resolveResponsive({ xs: 1, md: 2, xl: 4 }, 900) // → 2
 */
export function resolveResponsive<T>(
  values: Partial<Record<Breakpoint, T>>,
  width: number,
): T | undefined {
  let resolved: T | undefined;
  for (const key of breakpointOrder) {
    if (width >= breakpoints[key] && values[key] !== undefined) {
      resolved = values[key];
    }
  }
  return resolved;
}

/** Number of columns a metric grid should use at a given density. */
export const gridColumns: Record<DensityTier, number> = {
  compact: 2,
  regular: 3,
  wide: 4,
};
