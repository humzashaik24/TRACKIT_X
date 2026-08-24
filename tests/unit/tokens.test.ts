/**
 * Design tokens — the invariants the palette was derived to satisfy.
 *
 * `scripts/design/derive-chart-palette.mjs` computed these colours and printed
 * the measurements. This suite is the regression net: it re-checks the structural
 * properties in CI so a hand edit to a hex value cannot quietly break a rule that
 * only a colourblind reader, or a greyscale printout, would notice.
 *
 * Perceptual separation (CVD ΔE) is deliberately NOT re-derived here — that is
 * the script's job, and duplicating an OKLab implementation in a test would just
 * mean two implementations to keep in step. What is checked here is everything
 * expressible without one: counts, ordering, monotonicity, contrast, and the
 * assignment rules.
 */
import {
  CHART_ALL_PAIRS_SERIES_CAP,
  CHART_SERIES_SLOTS,
  chartMarks,
  darkChartColors,
  darkColors,
  fontFamily,
  layout,
  lightChartColors,
  lightColors,
  seriesColor,
  space,
  typography,
  type ChartColors,
} from '@/design-system/tokens';

// --- Colour maths, WCAG relative luminance ---------------------------------

function hexToRgb(hex: string): readonly [number, number, number] {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const scaled = channel / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** True when the sequence is strictly monotone in either direction. */
function isStrictlyMonotone(values: readonly number[]): boolean {
  if (values.length < 2) return true;
  const rising = (values[1] as number) > (values[0] as number);
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1] as number;
    const current = values[index] as number;
    if (rising ? current <= previous : current >= previous) return false;
  }
  return true;
}

const modes: readonly (readonly [string, ChartColors])[] = [
  ['dark', darkChartColors],
  ['light', lightChartColors],
];

describe.each(modes)('%s chart palette', (_mode, palette) => {
  it('fills exactly the fixed number of categorical slots', () => {
    expect(CHART_SERIES_SLOTS).toBe(8);
    expect(palette.series).toHaveLength(CHART_SERIES_SLOTS);
  });

  it('has no duplicate slot, so two entities can never share a colour', () => {
    expect(new Set(palette.series).size).toBe(palette.series.length);
  });

  it('clears 3:1 against its own surface for every slot', () => {
    // The derivation script reported "contrast relief: none" for both modes.
    // If this fails, a fill has become indistinguishable from the background and
    // the chart needs visible labels or a table view instead.
    for (const color of palette.series) {
      expect(contrastRatio(color, palette.surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the sequential ramp monotone in lightness', () => {
    expect(palette.sequential.length).toBeGreaterThanOrEqual(5);
    expect(isStrictlyMonotone(palette.sequential.map(relativeLuminance))).toBe(true);
  });

  it('draws the ordinal ramp as a contiguous slice of the sequential one', () => {
    // Discrete ordered marks reuse the magnitude ramp rather than inventing steps,
    // so an ordered category and a magnitude read as the same family.
    const joined = palette.sequential.join(' ');
    expect(joined).toContain(palette.ordinal.join(' '));
  });

  it('keeps each diverging arm monotone', () => {
    expect(isStrictlyMonotone(palette.diverging.negative.map(relativeLuminance))).toBe(true);
    expect(isStrictlyMonotone(palette.diverging.positive.map(relativeLuminance))).toBe(true);
  });

  it('uses a neutral midpoint, never a hue', () => {
    // The midpoint is a grey from the surface family, so it is allowed a slight
    // temperature (dark's #2A303B spreads 17 points cool, matching the blue-tinted
    // dark surface). What it may never do is read as a third hue competing with
    // the poles, so the test is relative: measured spreads are 17 vs 135 (dark)
    // and 6 vs 126 (light), an order of magnitude apart.
    const spread = (color: string): number => {
      const [r, g, b] = hexToRgb(color);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    const neutral = spread(palette.diverging.neutral);
    expect(neutral).toBeLessThanOrEqual(20);
    expect(neutral * 4).toBeLessThanOrEqual(spread(palette.diverging.negative[0] as string));
    expect(neutral * 4).toBeLessThanOrEqual(
      spread(palette.diverging.positive[palette.diverging.positive.length - 1] as string),
    );
  });

  it('recedes at the midpoint and is loudest at the poles', () => {
    // The midpoint means "nothing", so it must sit closest to the surface and the
    // outer poles furthest from it. This is what makes a diverging scale readable
    // in both modes without flipping the ramp.
    const distance = (color: string): number =>
      Math.abs(relativeLuminance(color) - relativeLuminance(palette.surface));

    const negativePole = palette.diverging.negative[0] as string;
    const positivePole = palette.diverging.positive[
      palette.diverging.positive.length - 1
    ] as string;

    expect(distance(palette.diverging.neutral)).toBeLessThan(distance(negativePole));
    expect(distance(palette.diverging.neutral)).toBeLessThan(distance(positivePole));
  });

  it('paints the mark gap in the surface colour', () => {
    // The 2px separator between touching fills only works if it IS the background.
    expect(palette.markGap).toBe(palette.surface);
  });

  it('keeps chrome recessive relative to the data', () => {
    // Gridlines must not compete with marks; axis labels are ink, not a series hue.
    expect(palette.grid).toMatch(/rgba\(/);
    expect(palette.series).not.toContain(palette.axisLabel);
    expect(palette.areaOpacity).toBeGreaterThan(0);
    expect(palette.areaOpacity).toBeLessThan(0.35);
  });
});

describe('the two modes are selected, not flipped', () => {
  it('re-steps the ramps for each surface rather than inverting one', () => {
    // A dark palette produced by inverting a light one lands on the wrong steps.
    // Slot 1 differs between modes precisely because it was re-derived.
    expect(darkChartColors.series[0]).not.toBe(lightChartColors.series[0]);
    expect(darkChartColors.surface).not.toBe(lightChartColors.surface);
    expect(darkChartColors.sequential).not.toEqual([...lightChartColors.sequential].reverse());
  });

  it('anchors each palette to the surface it was validated against', () => {
    expect(darkChartColors.surface).toBe('#12161D');
    expect(lightChartColors.surface).toBe('#FFFFFF');
  });
});

describe('seriesColor', () => {
  const order = ['proj-a', 'proj-b', 'proj-c', 'proj-d'];
  const palette = darkChartColors.series;

  it('assigns slots in the order given', () => {
    expect(seriesColor('proj-a', order, palette)).toBe(palette[0]);
    expect(seriesColor('proj-c', order, palette)).toBe(palette[2]);
  });

  it('keeps a colour attached to the entity when the visible set shrinks', () => {
    // THE rule: filtering a series out must not repaint the survivors. The order
    // list is the full set the chart can show, not what is currently drawn.
    const before = seriesColor('proj-d', order, palette);
    const stillDrawn = ['proj-a', 'proj-d'];
    // Resolved against the same stable order, proj-d keeps slot 4…
    expect(seriesColor('proj-d', order, palette)).toBe(before);
    // …and would only change if the caller wrongly re-derived the order.
    expect(seriesColor('proj-d', stillDrawn, palette)).not.toBe(before);
  });

  it('folds past the last slot instead of cycling back to the first', () => {
    const nine = Array.from({ length: 9 }, (_, index) => `s${index}`);
    const ninth = seriesColor('s8', nine, palette);
    expect(ninth).toBe(palette[palette.length - 1]);
    expect(ninth).not.toBe(palette[0]);
  });

  it('gives an unknown key the overflow colour rather than throwing', () => {
    expect(seriesColor('not-in-order', order, palette)).toBe(palette[order.length]);
  });

  it('caps the any-two-marks-adjacent forms below the full slot count', () => {
    expect(CHART_ALL_PAIRS_SERIES_CAP).toBe(4);
    expect(CHART_ALL_PAIRS_SERIES_CAP).toBeLessThan(CHART_SERIES_SLOTS);
  });
});

describe('chartMarks', () => {
  it('keeps marks thin and hit targets forgiving', () => {
    expect(chartMarks.lineWidth).toBeLessThanOrEqual(3);
    expect(chartMarks.gridWidth).toBeLessThanOrEqual(chartMarks.lineWidth);
    expect(chartMarks.referenceWidth).toBeLessThanOrEqual(chartMarks.lineWidth);
    // A marker below 8px is not a hit target, and a hit slop smaller than the
    // marker makes hover a game of precision.
    expect(chartMarks.markerSize).toBeGreaterThanOrEqual(8);
    expect(chartMarks.hitSlop).toBeGreaterThanOrEqual(chartMarks.markerSize);
  });

  it('leaves a visible gap between touching fills', () => {
    expect(chartMarks.markGapWidth).toBeGreaterThanOrEqual(2);
    expect(chartMarks.markRingWidth).toBeGreaterThanOrEqual(2);
  });

  it('leaves breathing room between bars', () => {
    expect(chartMarks.barBandRatio).toBeGreaterThan(0.4);
    expect(chartMarks.barBandRatio).toBeLessThan(0.9);
  });
});

describe('spacing and layout', () => {
  it('rises monotonically across the scale', () => {
    const values = Object.entries(space)
      // 'px' is a hairline exception outside the numeric grid.
      .filter(([key]) => key !== 'px')
      .map(([key, value]) => [Number(key), value] as const)
      .sort((a, b) => a[0] - b[0])
      .map(([, value]) => value);
    expect(isStrictlyMonotone(values)).toBe(true);
  });

  it('meets the minimum touch target', () => {
    expect(layout.minTouchTarget).toBeGreaterThanOrEqual(44);
  });

  it('caps the reading width so a table row stays scannable', () => {
    expect(layout.maxContentWidth).toBeGreaterThan(1200);
    expect(layout.maxContentWidth).toBeLessThan(1800);
  });

  it('grows gutters and gaps with the viewport', () => {
    expect(layout.screenPaddingX.compact).toBeLessThan(layout.screenPaddingX.regular);
    expect(layout.screenPaddingX.regular).toBeLessThan(layout.screenPaddingX.wide);
    expect(layout.sectionGap.compact).toBeLessThanOrEqual(layout.sectionGap.regular);
  });
});

describe('typography', () => {
  it('gives every figure variant tabular numerals', () => {
    // Proportional digits make 1,111 and 9,999 different widths, and a column of
    // figures stops being scannable. Every metric variant opts in.
    for (const name of ['metricLg', 'metric', 'metricSm'] as const) {
      expect(typography[name].fontVariant).toContain('tabular-nums');
    }
  });

  it('leaves mono to its font, which already fixes digit advance', () => {
    // `tabular-nums` on a monospace face is a no-op; the alignment comes from the
    // family. Asserting it here would be asserting a redundancy.
    expect(typography.mono.fontFamily).toBe(fontFamily.mono);
    expect(typography.mono.fontVariant).toBeUndefined();
  });

  it('does not put tabular numerals on prose', () => {
    expect(typography.body.fontVariant).toBeUndefined();
    expect(typography.h1.fontVariant).toBeUndefined();
  });
});

describe('theme colours', () => {
  it('keeps text legible on the canvas in both modes', () => {
    // 4.5:1 is the AA floor for body text; secondary text still clears 3:1.
    expect(contrastRatio(darkColors.text, darkColors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(lightColors.text, lightColors.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkColors.textSecondary, darkColors.canvas)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(lightColors.textSecondary, lightColors.canvas)).toBeGreaterThanOrEqual(3);
  });

  it('is dark-first: the dark canvas is the darker of the two', () => {
    expect(relativeLuminance(darkColors.canvas)).toBeLessThan(
      relativeLuminance(lightColors.canvas),
    );
  });
});
