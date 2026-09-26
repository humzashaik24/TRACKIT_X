/**
 * Trackit X — a distribution bar list.
 *
 * One primitive behind every "how is this spread out" chart on the dashboard: task
 * status, task priority, project status, project progress, workload.
 *
 * ── Why bars and not a pie, a donut, or a library chart ────────────────────────
 * There is no charting dependency in this project, and adding one for five horizontal
 * bar lists would be a large dependency to draw rectangles. More to the point, the
 * things that are easy to get wrong about categorical charts are all decisions this
 * component makes once, in one place:
 *
 *  · IDENTITY IS NEVER CARRIED BY COLOUR ALONE. Every row prints its own label and its
 *    own number, so the chart is readable in greyscale, by a screen reader, and by
 *    someone who cannot distinguish the hues. The bar is a reinforcement of the number,
 *    never the carrier of it.
 *  · THE BARS SHARE A SCALE. Every row's width is a fraction of the same maximum — the
 *    largest value in THIS list — so two bars can be compared by eye. Each list scaling
 *    to its own maximum is what makes a set of charts lie by making a 3 look like a 30.
 *  · A ZERO IS SHOWN AS AN EMPTY TRACK, not omitted. "Nothing is blocked" is a
 *    meaningful row on a delivery view, and dropping it would make an empty state
 *    indistinguishable from a chart that has not finished loading.
 *  · THE COLOUR IS THE ENTITY'S, not its rank. The caller passes a colour per key, so
 *    filtering or reordering rows never repaints the survivors.
 *
 * There is deliberately no axis, no gridline and no tooltip. Every value is printed
 * next to its bar, which makes an axis redundant, and a tooltip would hide the one
 * number the reader came for behind an interaction they may not know exists.
 */
import { View } from 'react-native';

import {
  createStyles,
  HStack,
  Text,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';

const styles = createStyles((theme) => ({
  track: {
    // The unfilled part of the bar. Kept visible at every density so an empty row
    // still reads as "a row with nothing in it" rather than as a missing row.
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceInset,
    overflow: 'hidden',
  },
  fill: {
    height: 8,
    borderRadius: 4,
  },
  // The minimum visible width for a non-zero value. Without it, a bar for 1 out of 200
  // rounds to zero pixels and the row reads as an empty track — a value that is
  // present but has been made invisible by the scale.
  sliver: {
    minWidth: 3,
  },
  label: {
    flexShrink: 0,
  },
  value: {
    flexShrink: 0,
  },
  grow: {
    flex: 1,
  },
}));

export interface DistributionRow {
  /** Stable identity — a status, a priority, a band key. Never the index. */
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /**
   * The entity's colour. Required rather than defaulted, because "let the chart pick"
   * is how a status chart ends up repainted whenever the row order changes.
   */
  readonly color: string;
  /** Shown after the value — a share, a caveat. Omit for a bare count. */
  readonly note?: string;
  /** Dims the row. For a value that is a real zero rather than a missing one. */
  readonly muted?: boolean;
}

export interface DistributionListProps {
  readonly rows: readonly DistributionRow[];
  /** Announced as a unit, e.g. "Task status". */
  readonly accessibilityLabel?: string;
}

/**
 * The maximum a bar is drawn at.
 *
 * Zero-width when every row is zero, which returns a track for all of them rather than
 * dividing by zero and producing `NaN` widths — a `NaN` in a style is silently dropped
 * by React Native, which would render no bar at all and look like a crashed chart
 * rather than an organization with nothing in it.
 */
function scale(rows: readonly DistributionRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.value), 0);
}

export function DistributionList({ rows, accessibilityLabel }: DistributionListProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const max = scale(rows);

  return (
    <VStack
      gap={3}
      accessibilityRole="list"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
    >
      {rows.map((row) => {
        const ratio = max <= 0 ? 0 : row.value / max;
        return (
          <VStack
            key={row.key}
            gap={1}
            accessibilityRole="text"
            // The whole row reads as one sentence, because "To do, 12" split across a
            // bar and two labels is announced as three unrelated fragments.
            accessibilityLabel={`${row.label}: ${row.value}`}
          >
            <HStack gap={2} justify="space-between" align="center">
              <HStack gap={2} align="center" style={s.label}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    backgroundColor: row.color,
                    borderWidth: 2,
                    borderColor: theme.chart.markGap,
                  }}
                />
                <Text variant="bodySm" tone={row.muted === true ? 'tertiary' : 'secondary'}>
                  {row.label}
                </Text>
              </HStack>
              <HStack gap={1} align="baseline" style={s.value}>
                <Text variant="bodySm" tone={row.muted === true ? 'tertiary' : 'primary'}>
                  {row.value}
                </Text>
                {row.note === undefined ? null : (
                  <Text variant="caption" tone="tertiary">
                    {row.note}
                  </Text>
                )}
              </HStack>
            </HStack>
            <View style={[s.track, s.grow]}>
              <View
                style={[
                  s.fill,
                  { width: `${ratio * 100}%`, backgroundColor: row.color },
                  row.value > 0 ? s.sliver : null,
                ]}
              />
            </View>
          </VStack>
        );
      })}
    </VStack>
  );
}
