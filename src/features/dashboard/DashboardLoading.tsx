/**
 * Trackit X — the dashboard's waiting state.
 *
 * ── Why this mirrors the real layout instead of showing a spinner ────────────────
 * `useDashboardSnapshot` reads three tables and derives one snapshot, so a dashboard is
 * either absent or complete. There is no state in which the headline numbers are real
 * and the distributions are still arriving, and the panel components correctly have no
 * loading branch of their own — a partial set of bars drawn over real numbers would be
 * exactly the misleading-zero case the phase forbids.
 *
 * That leaves the wait, and a spinner in the middle of an empty page is the wrong thing
 * to put in it. The reader arrives from the sidebar knowing what a dashboard looks like;
 * a centred circle tells them nothing about how long they are waiting and leaves a
 * blank area that fills in abruptly when the data lands. So the shape of the page is
 * drawn first, at the size it will actually be, with the values withheld.
 *
 * The bars keep their real heights and the cards keep their real widths. The result is
 * a page that holds still: nothing moves when the snapshot arrives except the numbers
 * and the bar fills. That is the whole purpose — a layout that reshapes itself under the
 * reader is how a loading state turns into a jump.
 *
 * ── On the a11y wrapper ──────────────────────────────────────────────────────────
 * One node, not one per placeholder. `LoadingState` sets
 * `accessibilityRole="progressbar"`, so nesting it here would announce the same state
 * four to six times on entry; the inner `Skeleton`s are already `accessible={false}` and
 * are used directly instead. A screen-reader user hears "Loading your dashboard" once,
 * which is the useful version of the information.
 *
 * The skeleton is paired with a real failure path on the screen — `readDashboardFacts`
 * returns an `ActionResult`, and any read failure renders `ErrorState` with a retry
 * rather than an indefinite pulse. That pairing is the rule the design system's
 * `Skeleton` doc calls for, and it is why this can animate at all.
 */
import { View } from 'react-native';

import {
  Card,
  createStyles,
  Skeleton,
  SkeletonText,
  useStyles,
  VStack,
} from '@/design-system';

const styles = createStyles((theme) => ({
  page: {
    gap: theme.space[5],
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  tile: {
    // Matches `DashboardOverview`'s basis so the row reflows identically when the real
    // numbers replace these.
    flexGrow: 1,
    flexBasis: 150,
  },
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  column: {
    flexGrow: 1,
    flexBasis: 280,
  },
  block: {
    gap: theme.space[3],
  },
}));

/** Row counts chosen to match the longest real list in each block. */
const TILE_COUNT = 4;
const COLUMN_COUNT = 2;
/** Five rows: the tallest list any of the three panels renders. */
const STATUS_ROWS = 5;
/** A distribution row is a label plus a bar, so a pair of blocks stands in for one. */
const DISTRIBUTION_ROWS = 4;

export function DashboardLoading() {
  const s = useStyles(styles);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading your dashboard"
      accessibilityValue={{ text: 'Loading' }}
      style={s.page}
    >
      <VStack gap={4}>
        <VStack style={s.tiles}>
          {Array.from({ length: TILE_COUNT }, (_, index) => (
            <Card key={index} variant="glass" padding={4} style={s.tile}>
              <VStack gap={3} style={s.block}>
                <Skeleton width="55%" height={11} />
                <Skeleton width="40%" height={26} corner="sm" />
              </VStack>
            </Card>
          ))}
        </VStack>

        <VStack style={s.columns}>
          {Array.from({ length: COLUMN_COUNT }, (_, column) => (
            <Card key={column} variant="glass" padding={4} style={s.column}>
              <VStack gap={3} style={s.block}>
                <Skeleton width="45%" height={11} />
                {Array.from({ length: STATUS_ROWS }, (_, row) => (
                  <VStack key={row} gap={2}>
                    <Skeleton width="70%" height={10} />
                    <Skeleton width="100%" height={8} corner="pill" />
                  </VStack>
                ))}
              </VStack>
            </Card>
          ))}
        </VStack>

        <Card variant="glass" padding={4}>
          <VStack gap={3} style={s.block}>
            <Skeleton width="40%" height={11} />
            {Array.from({ length: DISTRIBUTION_ROWS }, (_, row) => (
              <SkeletonText key={row} lines={1} lastLineWidth="80%" />
            ))}
          </VStack>
        </Card>
      </VStack>
    </View>
  );
}
