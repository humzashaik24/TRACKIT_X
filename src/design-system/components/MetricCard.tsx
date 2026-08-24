/**
 * Trackit X — MetricCard.
 *
 * A single number with the context needed to read it correctly: what it measures,
 * how it changed, and against what.
 *
 * Two decisions here exist to stop the tile from lying:
 *
 *  · POLARITY. "Down 8%" is good news for defect rate and bad news for revenue.
 *    A tile that always paints a fall red is wrong half the time, so the caller
 *    declares `polarity` and the colour is derived from it. `neutral` is the
 *    honest answer for a count that is neither good nor bad when it moves.
 *  · NEVER COLOUR ALONE. The delta always carries an arrow glyph and a text
 *    label. Red-versus-green is invisible to a large minority of readers and to
 *    anyone printing in greyscale, so it is only ever reinforcement.
 *
 * The value itself is a pre-formatted string. Formatting a currency or a duration
 * needs locale and organization settings, which is business logic and does not
 * belong in a presentational component.
 */
import { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import type { IntentColors } from '../tokens';
import { Card, type CardProps } from './Card';
import { Icon, type IconName } from './Icon';
import { Skeleton } from './Skeleton';
import { HStack, VStack } from './Stack';
import { Text } from './Text';

/**
 * Whether a rise in this metric is good news.
 *
 * `neutral` means the direction carries no judgement — headcount, open tasks,
 * total records. The delta is still shown, just in ink rather than in a verdict
 * colour.
 */
export type MetricPolarity = 'higherIsBetter' | 'lowerIsBetter' | 'neutral';

export interface MetricDelta {
  /**
   * Signed change. Only the sign is read — it picks the arrow and the verdict.
   * Magnitude is never formatted here; pass `text` for that.
   */
  readonly value: number;
  /** Pre-formatted change, e.g. `'+12.4%'` or `'−3 days'`. Falls back to the sign. */
  readonly text?: string;
  /** What the change is measured against, e.g. `'vs last month'`. */
  readonly comparison?: string;
}

export interface MetricCardProps {
  /** What the number measures. Always visible — a bare number is not a metric. */
  label: string;
  /** The number, already formatted by the caller. */
  value: string;
  /** Unit shown beside the value, e.g. `'units'`, `'hrs'`. */
  unit?: string;
  delta?: MetricDelta;
  /** Defaults to `neutral`, the only assumption that is never wrong. */
  polarity?: MetricPolarity;
  /**
   * Recent values, oldest → newest, for the sparkline. Shape only: it carries no
   * axis and no labels, so it is decoration for the trend and is hidden from
   * assistive technology.
   */
  trend?: readonly number[];
  /** Tints the icon and the accent edge. Does not imply a verdict on the delta. */
  intent?: 'neutral' | 'accent' | 'ai' | 'success' | 'warning' | 'danger' | 'info';
  icon?: IconName;
  /** Small print under the value — a caveat, a period, a denominator. */
  footnote?: string;
  /** Renders skeletons in place of the value and delta, keeping the tile's size. */
  loading?: boolean;
  onPress?: () => void;
  /** Announced instead of the composed sentence, when the default reads poorly. */
  accessibilityLabel?: string;
  style?: ViewStyle;
  /** Passed through to the underlying Card. */
  variant?: CardProps['variant'];
}

type DeltaVerdict = 'good' | 'bad' | 'flat' | 'unjudged';

/** Maps a signed change plus polarity onto a verdict. Exported for testing. */
export function deltaVerdict(value: number, polarity: MetricPolarity): DeltaVerdict {
  if (!Number.isFinite(value) || value === 0) return 'flat';
  if (polarity === 'neutral') return 'unjudged';
  const rose = value > 0;
  const roseIsGood = polarity === 'higherIsBetter';
  return rose === roseIsGood ? 'good' : 'bad';
}

/** The glyph for a direction. There is no minus glyph in the registry, so flat uses a horizontal arrow. */
function deltaIcon(value: number): IconName {
  if (!Number.isFinite(value) || value === 0) return 'arrowRight';
  return value > 0 ? 'trendUp' : 'trendDown';
}

function verdictColors(theme: ReturnType<typeof useTheme>, verdict: DeltaVerdict): IntentColors {
  switch (verdict) {
    case 'good':
      return theme.colors.success;
    case 'bad':
      return theme.colors.danger;
    default:
      return theme.colors.neutral;
  }
}

/** Words for the direction, so the tile reads correctly when spoken. */
function spokenDirection(value: number): string {
  if (!Number.isFinite(value) || value === 0) return 'unchanged';
  return value > 0 ? 'up' : 'down';
}

const SPARKLINE_HEIGHT = 30;
const SPARKLINE_MAX_POINTS = 32;

/**
 * Skeleton block heights, sized to the type they stand in for so nothing shifts
 * when the value arrives. Literal because `TextStyle.fontSize` is optional in the
 * token type, and a placeholder that silently collapses to zero is worse than one
 * that is a pixel off.
 */
const metricSkeletonHeight = 34;
const deltaSkeletonHeight = 16;

/**
 * Normalises a trend series into bar heights in the range 0…1.
 *
 * Returns an empty array for anything unplottable — no points, one point, or all
 * points equal — because a bar chart of a constant is a misleading picture of
 * "no change". Non-finite values are dropped rather than allowed to poison the
 * min/max.
 */
export function normaliseTrend(trend: readonly number[]): readonly number[] {
  const clean = trend.filter((point) => Number.isFinite(point));
  if (clean.length < 2) return [];

  const points = clean.slice(-SPARKLINE_MAX_POINTS);
  let min = points[0] as number;
  let max = min;
  for (const point of points) {
    if (point < min) min = point;
    if (point > max) max = point;
  }

  const range = max - min;
  if (range === 0) return [];

  // A floor of 0.08 keeps the lowest bar visible as a mark rather than vanishing,
  // which would read as missing data instead of a low value.
  return points.map((point) => 0.08 + ((point - min) / range) * 0.92);
}

interface SparklineProps {
  heights: readonly number[];
  color: string;
  trackColor: string;
}

/**
 * A bar sparkline built from Views.
 *
 * Deliberately dependency-free: pulling a charting library in for 30px of shape
 * costs bundle size on web and a native module on device. Bars rather than a
 * polyline because a polyline needs SVG, and bars survive being 3px wide.
 */
function Sparkline({ heights, color, trackColor }: SparklineProps) {
  const theme = useTheme();

  return (
    <View
      // Shape without labels or an axis carries no information a screen reader
      // can use, and the tile's own label already states the trend.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        height: SPARKLINE_HEIGHT,
        gap: 2,
      }}
    >
      {heights.map((height, index) => {
        const isLast = index === heights.length - 1;
        return (
          <View
            key={index}
            style={{
              flex: 1,
              height: Math.max(2, height * SPARKLINE_HEIGHT),
              minWidth: 2,
              // The most recent bar is the one the reader is looking for.
              backgroundColor: isLast ? color : trackColor,
              borderTopLeftRadius: theme.radius.xs / 2,
              borderTopRightRadius: theme.radius.xs / 2,
            }}
          />
        );
      })}
    </View>
  );
}

export function MetricCard({
  label,
  value,
  unit,
  delta,
  polarity = 'neutral',
  trend,
  intent = 'neutral',
  icon,
  footnote,
  loading = false,
  onPress,
  accessibilityLabel,
  style,
  variant = 'raised',
}: MetricCardProps) {
  const theme = useTheme();

  const heights = useMemo(() => (trend === undefined ? [] : normaliseTrend(trend)), [trend]);

  const verdict = delta === undefined ? 'flat' : deltaVerdict(delta.value, polarity);
  const deltaColors = verdictColors(theme, verdict);
  const intentColors = theme.colors[intent];

  // One sentence for the whole tile: a screen reader should not have to stitch
  // four separate nodes together to learn what the number means.
  const spoken =
    accessibilityLabel ??
    [
      `${label}: ${value}${unit === undefined ? '' : ` ${unit}`}`,
      delta === undefined
        ? undefined
        : `${spokenDirection(delta.value)}${delta.text === undefined ? '' : ` ${delta.text}`}${
            delta.comparison === undefined ? '' : ` ${delta.comparison}`
          }`,
      footnote,
    ]
      .filter((part) => part !== undefined && part.length > 0)
      .join('. ');

  const body = (
    <VStack gap={2}>
      <HStack gap={2} justify="space-between" align="flex-start">
        <Text variant="label" tone="secondary" numberOfLines={2} style={{ flex: 1 }}>
          {label}
        </Text>
        {icon === undefined ? null : (
          <View
            style={{
              width: theme.controlHeight.sm,
              height: theme.controlHeight.sm,
              borderRadius: theme.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: intentColors.surface,
            }}
          >
            <Icon name={icon} size="md" color={intentColors.fg} />
          </View>
        )}
      </HStack>

      {loading ? (
        <Skeleton width="60%" height={metricSkeletonHeight} corner="sm" />
      ) : (
        <HStack gap={1} align="baseline">
          <Text variant="metric" tone="primary">
            {value}
          </Text>
          {unit === undefined ? null : (
            <Text variant="bodySm" tone="tertiary">
              {unit}
            </Text>
          )}
        </HStack>
      )}

      {loading ? (
        <Skeleton width="40%" height={deltaSkeletonHeight} corner="sm" />
      ) : delta === undefined ? null : (
        <HStack gap={1} align="center">
          <Icon name={deltaIcon(delta.value)} size="sm" color={deltaColors.fg} />
          <Text variant="labelSm" color={deltaColors.fg}>
            {delta.text ?? spokenDirection(delta.value)}
          </Text>
          {delta.comparison === undefined ? null : (
            <Text variant="caption" tone="tertiary" numberOfLines={1} style={{ flexShrink: 1 }}>
              {delta.comparison}
            </Text>
          )}
        </HStack>
      )}

      {heights.length === 0 ? null : (
        <Sparkline
          heights={heights}
          color={verdict === 'unjudged' || verdict === 'flat' ? intentColors.fg : deltaColors.fg}
          trackColor={theme.colors.track}
        />
      )}

      {footnote === undefined ? null : (
        <Text variant="caption" tone="tertiary" numberOfLines={2}>
          {footnote}
        </Text>
      )}
    </VStack>
  );

  // The Card handles its own press affordance; this component only needs to make
  // the whole tile one accessibility node either way.
  if (onPress !== undefined) {
    return (
      <Card
        variant={variant}
        intent={intent}
        onPress={onPress}
        accessibilityLabel={spoken}
        accessibilityRole="button"
        style={style}
      >
        {body}
      </Card>
    );
  }

  return (
    <Card variant={variant} intent={intent} style={style}>
      <View accessible accessibilityLabel={spoken}>
        {body}
      </View>
    </Card>
  );
}
