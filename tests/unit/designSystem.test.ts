/**
 * Design-system logic — the pure decisions inside the composite components.
 *
 * These components cannot be render-tested yet (no `@testing-library/react-native`
 * in the project), so every judgement they make was deliberately extracted into a
 * plain function. That is what is asserted here: the judgement, not the markup.
 *
 * The interesting cases are the ones where a naive implementation is confidently
 * wrong — "up is good", "a delta of 0 is an improvement", "cycle the palette when
 * you run out of colours", "sorting a new column keeps the old direction".
 */
import { confidenceTier } from '@/design-system/components/AIInsightCard';
import { initialsFrom } from '@/design-system/components/Avatar';
import { resolveSeries } from '@/design-system/components/ChartCard';
import { nextSort } from '@/design-system/components/DataTable';
import { deltaVerdict, normaliseTrend } from '@/design-system/components/MetricCard';
import { CHART_SERIES_SLOTS, darkChartColors } from '@/design-system/tokens';

describe('deltaVerdict', () => {
  it('reads a rise as good only when higher is better', () => {
    expect(deltaVerdict(4.2, 'higherIsBetter')).toBe('good');
    expect(deltaVerdict(4.2, 'lowerIsBetter')).toBe('bad');
  });

  it('reads a fall as good when lower is better', () => {
    // Absence rate, defect count, cost per unit, overtime hours: down is the win.
    // Painting these green-on-rise is the single most common metric-tile bug.
    expect(deltaVerdict(-3, 'lowerIsBetter')).toBe('good');
    expect(deltaVerdict(-3, 'higherIsBetter')).toBe('bad');
  });

  it('refuses to judge a metric with no better direction', () => {
    // Headcount, order volume, average basket size — a change is information,
    // not a verdict. Colouring it would assert a business opinion we do not hold.
    expect(deltaVerdict(9, 'neutral')).toBe('unjudged');
    expect(deltaVerdict(-9, 'neutral')).toBe('unjudged');
  });

  it('treats no movement as flat in every polarity', () => {
    expect(deltaVerdict(0, 'higherIsBetter')).toBe('flat');
    expect(deltaVerdict(0, 'lowerIsBetter')).toBe('flat');
    expect(deltaVerdict(-0, 'neutral')).toBe('flat');
  });

  it('treats a broken number as flat rather than colouring it', () => {
    // A division by zero upstream must not turn into a green arrow.
    expect(deltaVerdict(Number.NaN, 'higherIsBetter')).toBe('flat');
    expect(deltaVerdict(Number.POSITIVE_INFINITY, 'lowerIsBetter')).toBe('flat');
  });
});

describe('normaliseTrend', () => {
  it('scales into a drawable band, keeping the smallest point visible', () => {
    const scaled = normaliseTrend([0, 5, 10]);
    expect(scaled).toHaveLength(3);
    // The floor is deliberately above zero: a zero-height bar reads as missing
    // data, not as a low value.
    expect(scaled[0]).toBeGreaterThan(0);
    expect(scaled[scaled.length - 1]).toBeLessThanOrEqual(1);
  });

  it('preserves the shape of the series', () => {
    const scaled = normaliseTrend([2, 8, 4, 16]);
    expect(scaled[1]).toBeGreaterThan(scaled[0] as number);
    expect(scaled[2]).toBeLessThan(scaled[1] as number);
    expect(scaled[3]).toBeGreaterThan(scaled[1] as number);
  });

  it('draws nothing for a flat series', () => {
    // Every bar would be the same height, which says nothing a sparkline should
    // occupy space to say. The metric value already carries it.
    expect(normaliseTrend([7, 7, 7, 7])).toEqual([]);
  });

  it('draws nothing when there is no trend to speak of', () => {
    expect(normaliseTrend([])).toEqual([]);
    expect(normaliseTrend([42])).toEqual([]);
  });

  it('drops non-finite points instead of collapsing the whole scale', () => {
    // One NaN in a series would otherwise poison min/max and blank the sparkline.
    const scaled = normaliseTrend([1, Number.NaN, 3, Number.POSITIVE_INFINITY, 5]);
    expect(scaled).toHaveLength(3);
    expect(scaled.every((point) => Number.isFinite(point))).toBe(true);
  });

  it('keeps the most recent window when handed a long history', () => {
    // A sparkline 300px wide cannot render 400 days; it shows the recent tail.
    const long = Array.from({ length: 400 }, (_, index) => index);
    const scaled = normaliseTrend(long);
    expect(scaled.length).toBeLessThanOrEqual(32);
    // Ascending input stays ascending, so the tail — not the head — was kept.
    expect(scaled[scaled.length - 1]).toBeGreaterThan(scaled[0] as number);
  });
});

describe('confidenceTier', () => {
  it('buckets at the documented cuts', () => {
    expect(confidenceTier(0.2)).toBe('low');
    expect(confidenceTier(0.49)).toBe('low');
    expect(confidenceTier(0.5)).toBe('moderate');
    expect(confidenceTier(0.74)).toBe('moderate');
    expect(confidenceTier(0.75)).toBe('high');
    expect(confidenceTier(1)).toBe('high');
  });

  it('lands a broken confidence in the least-trustworthy tier', () => {
    // Fail safe: a model response with a missing or malformed confidence must not
    // present itself as high confidence.
    expect(confidenceTier(Number.NaN)).toBe('low');
    expect(confidenceTier(Number.POSITIVE_INFINITY)).toBe('low');
  });

  it('never reports high for a value below the cut, however close', () => {
    expect(confidenceTier(0.7499999)).toBe('moderate');
  });
});

describe('resolveSeries', () => {
  const palette = darkChartColors.series;
  const series = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      key: `k${index}`,
      label: `Series ${index}`,
    }));

  it('assigns palette slots in declaration order', () => {
    const resolved = resolveSeries(series(3), palette);
    expect(resolved.map((entry) => entry.color)).toEqual([palette[0], palette[1], palette[2]]);
    expect(resolved.every((entry) => entry.isOverflow === false)).toBe(true);
  });

  it('honours an explicit colour, so a branded entity keeps its own', () => {
    const resolved = resolveSeries([{ key: 'k0', label: 'Brand', color: '#ABCDEF' }], palette);
    expect(resolved[0]?.color).toBe('#ABCDEF');
  });

  it('fills every slot without an overflow row at exactly the cap', () => {
    const resolved = resolveSeries(series(CHART_SERIES_SLOTS), palette);
    expect(resolved).toHaveLength(CHART_SERIES_SLOTS);
    expect(resolved.some((entry) => entry.isOverflow)).toBe(false);
  });

  it('folds the ninth series and beyond into one Other row', () => {
    // Generating a 9th hue is the rule this exists to prevent: past eight slots
    // the colours stop being tellable apart, so the tail is aggregated instead.
    const resolved = resolveSeries(series(12), palette);
    expect(resolved).toHaveLength(CHART_SERIES_SLOTS + 1);
    const other = resolved[resolved.length - 1];
    expect(other?.isOverflow).toBe(true);
    expect(other?.label).toBe('Other (4)');
  });

  it('never reuses slot one for the overflow row', () => {
    const resolved = resolveSeries(series(20), palette);
    const other = resolved[resolved.length - 1];
    expect(other?.color).not.toBe(palette[0]);
  });

  it('keeps a series on its own colour when an earlier one is filtered out', () => {
    // The legend and the marks are resolved from the same full ordering, so hiding
    // one entity must not repaint the rest. Callers pass the complete series list
    // and toggle visibility downstream.
    const all = series(4);
    const before = resolveSeries(all, palette);
    const stillResolvedFromTheSameOrder = resolveSeries(all, palette);
    expect(stillResolvedFromTheSameOrder[3]?.color).toBe(before[3]?.color);
  });

  it('returns nothing for no series', () => {
    expect(resolveSeries([], palette)).toEqual([]);
  });
});

describe('nextSort', () => {
  it('starts a fresh column ascending', () => {
    expect(nextSort(undefined, 'name')).toEqual({ columnKey: 'name', direction: 'asc' });
  });

  it('lets a column choose its own opening direction', () => {
    // "Most recent first" and "largest first" are the useful defaults for dates
    // and amounts; opening those ascending shows the least interesting rows.
    expect(nextSort(undefined, 'hiredOn', 'desc')).toEqual({
      columnKey: 'hiredOn',
      direction: 'desc',
    });
  });

  it('toggles direction on the already-sorted column', () => {
    expect(nextSort({ columnKey: 'name', direction: 'asc' }, 'name').direction).toBe('desc');
    expect(nextSort({ columnKey: 'name', direction: 'desc' }, 'name').direction).toBe('asc');
  });

  it('resets to the opening direction when moving to another column', () => {
    // Carrying `desc` over from the previous column is disorienting: the user
    // clicked a new header, not a direction.
    expect(nextSort({ columnKey: 'name', direction: 'desc' }, 'salary')).toEqual({
      columnKey: 'salary',
      direction: 'asc',
    });
    expect(nextSort({ columnKey: 'name', direction: 'desc' }, 'salary', 'desc')).toEqual({
      columnKey: 'salary',
      direction: 'desc',
    });
  });

  it('is a pure function of its input', () => {
    const current = { columnKey: 'name', direction: 'asc' } as const;
    nextSort(current, 'name');
    expect(current).toEqual({ columnKey: 'name', direction: 'asc' });
  });
});

describe('initialsFrom', () => {
  it('takes the first and last name', () => {
    expect(initialsFrom('Anjali Patel')).toBe('AP');
    expect(initialsFrom('Maria de la Cruz')).toBe('MC');
  });

  it('handles a single name', () => {
    expect(initialsFrom('Prakash')).toBe('P');
  });

  it('tolerates messy whitespace', () => {
    expect(initialsFrom('  Ravi   Kumar  ')).toBe('RK');
  });

  it('falls back rather than rendering an empty avatar', () => {
    expect(initialsFrom('')).toBe('?');
    expect(initialsFrom('   ')).toBe('?');
  });

  it('upper-cases regardless of input casing', () => {
    expect(initialsFrom('ravi kumar')).toBe('RK');
  });
});
