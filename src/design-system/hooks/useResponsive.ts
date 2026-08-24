/**
 * Trackit X — responsive layout hook.
 *
 * Trackit X ships one codebase to phone, tablet, laptop and large desktop. A
 * screen asks for its *density tier* and picks a layout; it does not compare
 * pixel widths inline. That keeps "what does this look like on a tablet?"
 * answerable by reading one switch instead of auditing a component tree.
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import {
  breakpointForWidth,
  densityForWidth,
  gridColumns,
  layout,
  resolveResponsive,
  type Breakpoint,
  type DensityTier,
} from '../tokens';

export interface ResponsiveInfo {
  readonly width: number;
  readonly height: number;
  readonly breakpoint: Breakpoint;
  readonly density: DensityTier;
  /** Phone-class layout: single column, bottom tabs, sheets. */
  readonly isCompact: boolean;
  /** Tablet-class layout: two columns, collapsible sidebar. */
  readonly isRegular: boolean;
  /** Desktop-class layout: multi-column, persistent sidebar, modals. */
  readonly isWide: boolean;
  readonly isPortrait: boolean;
  /** Columns for a metric grid at this density. */
  readonly columns: number;
  /** Horizontal screen gutter at this density. */
  readonly screenPaddingX: number;
  /** Vertical gap between major sections at this density. */
  readonly sectionGap: number;
  /** Interior padding of a card at this density. */
  readonly cardPadding: number;
  /** Gap between cards in a grid at this density. */
  readonly gridGap: number;
  /** Picks a value per density tier. `regular` falls back to `compact`. */
  select<T>(values: { compact: T; regular?: T; wide?: T }): T;
  /** Picks a value per breakpoint, falling back to the nearest smaller one. */
  selectBreakpoint<T>(values: Partial<Record<Breakpoint, T>>, fallback: T): T;
}

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();

  return useMemo(() => {
    const density = densityForWidth(width);
    const breakpoint = breakpointForWidth(width);

    return {
      width,
      height,
      breakpoint,
      density,
      isCompact: density === 'compact',
      isRegular: density === 'regular',
      isWide: density === 'wide',
      isPortrait: height >= width,
      columns: gridColumns[density],
      screenPaddingX: layout.screenPaddingX[density],
      sectionGap: layout.sectionGap[density],
      cardPadding: layout.cardPadding[density],
      gridGap: layout.gridGap[density],
      select<T>(values: { compact: T; regular?: T; wide?: T }): T {
        if (density === 'wide') return values.wide ?? values.regular ?? values.compact;
        if (density === 'regular') return values.regular ?? values.compact;
        return values.compact;
      },
      selectBreakpoint<T>(values: Partial<Record<Breakpoint, T>>, fallback: T): T {
        return resolveResponsive(values, width) ?? fallback;
      },
    };
  }, [width, height]);
}

/** Just the active breakpoint, for consumers that need nothing else. */
export function useBreakpoint(): Breakpoint {
  const { width } = useWindowDimensions();
  return breakpointForWidth(width);
}

/** Just the density tier. */
export function useDensity(): DensityTier {
  const { width } = useWindowDimensions();
  return densityForWidth(width);
}
