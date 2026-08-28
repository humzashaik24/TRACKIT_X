/**
 * Trackit X — chart tokens.
 *
 * THIS PALETTE IS COMPUTED, NOT HAND-PICKED.
 *
 * Every value below was produced and validated by
 * `scripts/design/derive-chart-palette.mjs`, which enumerates hue orderings
 * over the design system's ramps and keeps only those clearing the hard gates
 * in BOTH modes. Re-run that script before changing any colour here.
 *
 * ── Measured results (surfaces: light #FFFFFF, dark #12161D) ───────────────
 *
 *   Adjacent pairlist (bars, stacks, lines)
 *     worst CVD ΔE          14.1 light · 14.1 dark   (target 8)   PASS
 *     worst normal-vision ΔE 20.3 light · 20.3 dark  (floor 15)   PASS
 *
 *   All-pairs pairlist (scatter, bubble, choropleth, small multiples)
 *     first 4 slots clear every gate in both modes
 *     worst pair CVD ΔE 10.3 · normal ΔE 15.1
 *
 *   Contrast vs surface
 *     every slot clears 3:1 in both modes — no contrast relief required
 *
 *   Diverging poles CVD ΔE  28.5 light · 20.0 dark   (target 8)   PASS
 *
 * ── Rules that are not negotiable ──────────────────────────────────────────
 *
 *  · Assign categorical slots IN ORDER, never cycled. A 9th series folds into
 *    "Other", becomes small multiples, or gets a composite encoding.
 *  · Colour follows the entity, never its rank. Filtering a series out must
 *    not repaint the survivors — resolve colour from a stable key.
 *  · Never a dual-axis chart. Two measures of different scale become two
 *    charts, small multiples, or an indexed common base.
 *  · Sequential = one hue, light→dark. Diverging = two hues + a NEUTRAL grey
 *    midpoint. Never a rainbow, never a hue at the midpoint.
 *  · Scatter / bubble / map / small-multiple forms cap at 4 series (see above).
 *  · Status colours are reserved. They never stand in for "series 5", and they
 *    always ship with an icon and a label — several status colours sit in the
 *    same hue family as a categorical slot, so hue alone never carries meaning.
 *  · Text wears text tokens, never the series colour. A coloured mark beside a
 *    label carries identity; the label itself stays in ink.
 */

/**
 * Fixed categorical order. Slot 1 is indigo — the default single series.
 *
 * Note that this is deliberately NOT the brand accent (signal green). The
 * categorical ramp was validated as a set for colour-vision separation, and
 * repainting slot 1 to match a brand refresh would invalidate every adjacent-pair
 * measurement above. Chart identity and brand identity are separate jobs.
 */
export const CHART_SERIES_SLOTS = 8;

/**
 * Series identity forms where any two marks can end up adjacent cannot carry
 * the full eight slots — see the all-pairs measurement above.
 */
export const CHART_ALL_PAIRS_SERIES_CAP = 4;

export interface ChartColors {
  /** Categorical slots, in fixed assignment order. */
  readonly series: readonly string[];
  /** Single-hue magnitude ramp, low → high. */
  readonly sequential: readonly string[];
  /** Discrete ordered marks, first → last. Trimmed so every step is visible. */
  readonly ordinal: readonly string[];
  /** Diverging scale: unfavourable outer → neutral → favourable outer. */
  readonly diverging: {
    readonly negative: readonly string[];
    readonly neutral: string;
    readonly positive: readonly string[];
  };
  // --- Chrome --------------------------------------------------------------
  /** The surface charts are drawn on — the value the palette was validated against. */
  readonly surface: string;
  /** Hairline gridlines. Recessive by design. */
  readonly grid: string;
  /** Axis line and baseline. */
  readonly axis: string;
  /** Axis tick labels. */
  readonly axisLabel: string;
  /** Crosshair drawn on hover. */
  readonly crosshair: string;
  /** Tooltip container. */
  readonly tooltipSurface: string;
  readonly tooltipBorder: string;
  /** Fill used to separate touching marks (stack segments, adjacent bars). */
  readonly markGap: string;
  /** Reference / target line. */
  readonly reference: string;
  /** Area fill opacity beneath a line series. */
  readonly areaOpacity: number;
}

// ---------------------------------------------------------------------------
// Dark (primary)
// ---------------------------------------------------------------------------

export const darkChartColors: ChartColors = {
  series: [
    '#5B6FF0', // 1 indigo  — brand, the default single series
    '#DB2777', // 2 pink
    '#D97706', // 3 amber
    '#0891B2', // 4 cyan
    '#DC2626', // 5 red
    '#7A45E6', // 6 violet
    '#059669', // 7 emerald
    '#2563EB', // 8 blue
  ],
  sequential: ['#1D2366', '#28308A', '#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5', '#9CA9F8'],
  ordinal: ['#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5', '#9CA9F8'],
  diverging: {
    // Outer → inner, so the array reads left-to-right across the scale.
    negative: ['#F87171', '#DC2626', '#B91C1C', '#991B1B'],
    neutral: '#2A303B',
    positive: ['#3540B0', '#4453D6', '#5B6FF0', '#7B8BF5'],
  },
  surface: '#12161D',
  grid: 'rgba(255, 255, 255, 0.06)',
  axis: 'rgba(255, 255, 255, 0.14)',
  axisLabel: '#6A7385',
  crosshair: 'rgba(255, 255, 255, 0.22)',
  tooltipSurface: '#171C25',
  tooltipBorder: 'rgba(255, 255, 255, 0.12)',
  markGap: '#12161D',
  reference: 'rgba(255, 255, 255, 0.28)',
  areaOpacity: 0.16,
};

// ---------------------------------------------------------------------------
// Light
// ---------------------------------------------------------------------------

export const lightChartColors: ChartColors = {
  series: [
    '#4453D6', // 1 indigo
    '#DB2777', // 2 pink
    '#D97706', // 3 amber
    '#0891B2', // 4 cyan
    '#DC2626', // 5 red
    '#7A45E6', // 6 violet
    '#059669', // 7 emerald
    '#1D4ED8', // 8 blue
  ],
  sequential: ['#DEE4FD', '#BFC9FB', '#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6', '#3540B0'],
  ordinal: ['#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6', '#3540B0'],
  diverging: {
    negative: ['#991B1B', '#B91C1C', '#DC2626', '#F87171'],
    neutral: '#EDEFF3',
    positive: ['#9CA9F8', '#7B8BF5', '#5B6FF0', '#4453D6'],
  },
  surface: '#FFFFFF',
  grid: 'rgba(13, 16, 21, 0.07)',
  axis: 'rgba(13, 16, 21, 0.16)',
  axisLabel: '#6E7787',
  crosshair: 'rgba(13, 16, 21, 0.24)',
  tooltipSurface: '#FFFFFF',
  tooltipBorder: 'rgba(13, 16, 21, 0.12)',
  markGap: '#FFFFFF',
  reference: 'rgba(13, 16, 21, 0.3)',
  areaOpacity: 0.14,
};

// ---------------------------------------------------------------------------
// Mark geometry
// ---------------------------------------------------------------------------

/**
 * Marks are thin; the data is the loud part. A 2px gap in the surface colour
 * separates touching fills so stack segments and adjacent bars never merge.
 */
export const chartMarks = {
  /** Line series stroke width. */
  lineWidth: 2,
  /** Reference / target line stroke width. */
  referenceWidth: 1.5,
  /** Gridline stroke width. */
  gridWidth: 1,
  /** Minimum diameter of a point marker — below this it is not a hit target. */
  markerSize: 8,
  /** Radius on the value end of a bar; the baseline end stays square. */
  barEndRadius: 4,
  /** Surface-coloured gap between touching fills. */
  markGapWidth: 2,
  /** Ring drawn around overlapping marks so they stay separable. */
  markRingWidth: 2,
  /** Bar thickness as a fraction of the band. */
  barBandRatio: 0.62,
  /** Extra invisible padding around a mark to make hover forgiving. */
  hitSlop: 12,
} as const;

/**
 * Resolves a categorical colour from a STABLE entity key rather than from the
 * render index, so filtering a series out never repaints the survivors.
 *
 * @param key    stable identifier for the entity (project id, status, team…)
 * @param order  the full ordered list of keys the chart can show
 * @param colors the active theme's `series` array
 */
export function seriesColor(
  key: string,
  order: readonly string[],
  colors: readonly string[],
): string {
  const index = order.indexOf(key);
  const slot = index >= 0 ? index : order.length;
  // Past the last slot, series fold into "Other" rather than cycling hues.
  return colors[Math.min(slot, colors.length - 1)] ?? colors[0]!;
}
