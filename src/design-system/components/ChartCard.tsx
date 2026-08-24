/**
 * Trackit X — ChartCard.
 *
 * The frame every chart in the product sits in. The chart body itself is passed
 * as children, because the mark geometry differs per form; what this component
 * owns is everything around it that is easy to get wrong and easy to get wrong
 * inconsistently.
 *
 * The rules it enforces:
 *
 *  · A LEGEND WHENEVER THERE ARE TWO OR MORE SERIES. Identity is never carried by
 *    colour alone. One series needs no legend — the title names it.
 *  · COLOUR FOLLOWS THE ENTITY, NOT ITS RANK. Slots are resolved from the stable
 *    series key via `seriesColor`, so filtering a series out does not repaint the
 *    survivors.
 *  · EIGHT SLOTS, NEVER CYCLED. A ninth series is folded into "Other" rather than
 *    reusing slot 1, which would make two different entities the same colour.
 *  · NO SECONDARY AXIS. There is deliberately no prop for one. Two measures of
 *    different scale become two ChartCards, small multiples, or an indexed base.
 *  · A TABLE VIEW EXISTS. `onViewData` is the escape hatch that makes a chart
 *    readable by someone who cannot see it, and it is offered by default whenever
 *    the caller supplies a handler.
 *  · ONE STATE AT A TIME, in a fixed precedence: error → loading → empty →
 *    children. A chart that shows a spinner over stale marks is ambiguous about
 *    which numbers are current.
 */
import { useMemo } from 'react';
import { View, type ViewStyle } from 'react-native';

import { useTheme } from '../hooks/useTheme';
import { CHART_SERIES_SLOTS, seriesColor } from '../tokens';
import { Card } from './Card';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { IconButton } from './IconButton';
import { Icon, type IconName } from './Icon';
import { LoadingState } from './LoadingState';
import { HStack, VStack } from './Stack';
import { Text } from './Text';

export interface ChartSeries {
  /**
   * Stable identity — an entity id or slug, NOT a display index. This is what the
   * colour is resolved from, so it must not change when the visible set changes.
   */
  readonly key: string;
  /** What the legend shows. */
  readonly label: string;
  /**
   * Overrides the assigned slot. For the reserved cases only: a status series
   * that must be the status colour, or a "target" line.
   */
  readonly color?: string;
}

/** A resolved series with the colour the chart body should draw it in. */
export interface ResolvedChartSeries extends ChartSeries {
  readonly color: string;
  /** True when this entry stands for every series past the eighth slot. */
  readonly isOverflow: boolean;
}

export interface ChartCardProps {
  title: string;
  /** What the chart measures, its period, its unit — the reading instructions. */
  subtitle?: string;
  /**
   * Series in the chart. Drives the legend and the palette. Pass this even for a
   * single series: it is how the chart body gets its colour.
   */
  series?: readonly ChartSeries[];
  /**
   * Receives the resolved series so the body draws the same colours the legend
   * shows. Using a function here removes the chance of the two disagreeing.
   */
  children?: React.ReactNode | ((resolved: readonly ResolvedChartSeries[]) => React.ReactNode);
  /** Fixed plot height. Charts need a definite height; a flexed one collapses. */
  height?: number;
  loading?: boolean;
  /** Any thrown value. Rendered through ErrorState, never raw. */
  error?: string | undefined;
  onRetry?: () => void;
  /** True when the query succeeded and returned nothing. Distinct from loading. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Opens the same data as a table. This is an accessibility requirement, not a
   * nicety — it is the only way the numbers are available to a screen reader.
   */
  onViewData?: () => void;
  /** An overflow / options affordance, e.g. export or change period. */
  onMore?: () => void;
  /** Rendered between the header and the plot — a period switcher, a filter row. */
  toolbar?: React.ReactNode;
  /** Rendered under the plot — a source note, a caveat, a total. */
  footer?: React.ReactNode;
  /** Icon beside the title. */
  icon?: IconName;
  style?: ViewStyle;
}

const OVERFLOW_KEY = '__other__';

/**
 * Assigns colours to series in fixed slot order, folding the overflow into a
 * single "Other" entry.
 *
 * Exported because the fold is a rule worth testing directly: silently dropping
 * the ninth series, or cycling back to slot 1, are both wrong in ways that are
 * invisible in a screenshot.
 */
export function resolveSeries(
  series: readonly ChartSeries[],
  palette: readonly string[],
): readonly ResolvedChartSeries[] {
  const order = series.map((entry) => entry.key);
  const visible = series.slice(0, CHART_SERIES_SLOTS);

  const resolved: ResolvedChartSeries[] = visible.map((entry) => ({
    ...entry,
    color: entry.color ?? seriesColor(entry.key, order, palette),
    isOverflow: false,
  }));

  const overflowCount = series.length - visible.length;
  if (overflowCount > 0) {
    const last = palette[palette.length - 1] ?? '#888888';
    resolved.push({
      key: OVERFLOW_KEY,
      label: `Other (${overflowCount})`,
      color: last,
      isOverflow: true,
    });
  }

  return resolved;
}

interface LegendProps {
  series: readonly ResolvedChartSeries[];
}

/**
 * The legend.
 *
 * Swatches are small rounded marks, and the label wears an ink token rather than
 * the series colour — coloured text on a dark surface fails contrast at label
 * sizes, and the swatch beside it already carries identity.
 */
function Legend({ series }: LegendProps) {
  const theme = useTheme();

  return (
    <HStack
      gap={4}
      wrap
      accessibilityLabel={`Series: ${series.map((entry) => entry.label).join(', ')}`}
    >
      {series.map((entry) => (
        <HStack key={entry.key} gap={1} align="center">
          <View
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              backgroundColor: entry.color,
              // A ring in the surface colour keeps two adjacent swatches from
              // reading as one wider mark.
              borderWidth: 2,
              borderColor: theme.chart.markGap,
            }}
          />
          <Text variant="caption" tone="secondary">
            {entry.label}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
}

export function ChartCard({
  title,
  subtitle,
  series = [],
  children,
  height = 220,
  loading = false,
  error,
  onRetry,
  empty = false,
  emptyTitle = 'No data for this period',
  emptyDescription,
  onViewData,
  onMore,
  toolbar,
  footer,
  icon,
  style,
}: ChartCardProps) {
  const theme = useTheme();

  const resolved = useMemo(
    () => resolveSeries(series, theme.chart.series),
    [series, theme.chart.series],
  );

  // Precedence is fixed and single-valued. Overlapping states are how a chart
  // ends up showing a spinner on top of numbers from the previous query.
  const body = (() => {
    if (error !== undefined) {
      return (
        <ErrorState
          inline
          message={error}
          {...(onRetry === undefined ? {} : { onRetry })}
          style={{ height }}
        />
      );
    }
    if (loading) {
      return <LoadingState variant="skeleton" label={`Loading ${title}`} style={{ height }} />;
    }
    if (empty) {
      return (
        <EmptyState
          inline
          variant="noResults"
          icon="chart"
          title={emptyTitle}
          {...(emptyDescription === undefined ? {} : { description: emptyDescription })}
          style={{ height }}
        />
      );
    }
    return (
      <View style={{ height }}>
        {typeof children === 'function' ? children(resolved) : children}
      </View>
    );
  })();

  const showLegend = !loading && error === undefined && !empty && resolved.length >= 2;

  return (
    <Card variant="raised" padding="none" style={style}>
      <VStack gap={4} style={{ padding: theme.space[4] }}>
        <HStack gap={2} justify="space-between" align="flex-start">
          <HStack gap={2} align="flex-start" style={{ flex: 1 }}>
            {icon === undefined ? null : (
              <View style={{ paddingTop: 2 }}>
                <Icon name={icon} size="md" tone="tertiary" />
              </View>
            )}
            <VStack gap={0} style={{ flex: 1 }}>
              <Text variant="h4" tone="primary" numberOfLines={2}>
                {title}
              </Text>
              {subtitle === undefined ? null : (
                <Text variant="caption" tone="tertiary" numberOfLines={2}>
                  {subtitle}
                </Text>
              )}
            </VStack>
          </HStack>

          <HStack gap={1} align="center">
            {onViewData === undefined ? null : (
              <IconButton
                icon="database"
                accessibilityLabel={`View ${title} as a table`}
                variant="ghost"
                intent="neutral"
                size="sm"
                onPress={onViewData}
              />
            )}
            {onMore === undefined ? null : (
              <IconButton
                icon="more"
                accessibilityLabel={`More options for ${title}`}
                variant="ghost"
                intent="neutral"
                size="sm"
                onPress={onMore}
              />
            )}
          </HStack>
        </HStack>

        {toolbar === undefined ? null : <View>{toolbar}</View>}

        {showLegend ? <Legend series={resolved} /> : null}

        {body}

        {footer === undefined ? null : <View>{footer}</View>}
      </VStack>
    </Card>
  );
}
