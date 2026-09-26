/**
 * Trackit X — the workload panel.
 *
 * How open work is spread across the people carrying it, and — for a manager only.
 *
 * ── The most important thing in this file is what it does not do ─────────────────
 * It does not rank, score, grade, flag or rate anybody. It prints counts.
 *
 * That restraint is not squeamishness, it is a claim about the data. The schema holds
 * the current state of a `tasks` row: who it is assigned to, what state it is in, when
 * it is due. It holds no output, no hours worked, no quality signal, no estimate, and
 * no history of any of them. A figure derived from that and presented as a judgement
 * about a person is not a measurement — and the person at the bottom of such a list has
 * no way to contest it, because there is nothing behind the number to check.
 *
 * The concrete consequence is in the labels. `WORKLOAD_BANDS` in
 * `src/domain/dashboard.ts` are "None", "1-2", "3-5", "6 or more" — descriptions of a
 * queue. The obvious upgrade is "free", "balanced" and "overloaded", and every one of
 * those words asserts that some amount of open work is the CORRECT amount of open work,
 * which depends on whether the work is a two-hour job or a six-week one. The schema has
 * no estimate column, so the panel cannot tell those apart, and would be guessing with
 * somebody's name attached.
 *
 * The panel is therefore two things, answering two questions, and it is explicit about
 * which is which:
 *   · the distribution — "is this work spread out, or pooled on a few people?"
 *   · the list      — "how much, and whose?"
 *
 * A third thing it deliberately does not do is compare people to each other in a way
 * that implies a ranking. The list is sorted by open tasks because that is the order a
 * scheduler needs them in, and the sort is visible in the numbers themselves rather
 * than in an ordinal, a rank badge, or a position column. Nothing on this screen says
 * "1st".
 */
import { View } from 'react-native';

import {
  Badge,
  Card,
  createStyles,
  HStack,
  Icon,
  Text,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { WORKLOAD_BANDS } from '@/domain/dashboard';
import { countLabel, formatNumber } from '@/utils/format';

import { DistributionList, type DistributionRow } from './DistributionList';
import type { DashboardSnapshot, WorkloadEntry } from './metrics';
import { workloadBandColor } from './palette';

const styles = createStyles((theme) => ({
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  column: {
    flexGrow: 1,
    flexBasis: 280,
  },
  list: {
    gap: theme.space[2],
  },
  row: {
    gap: theme.space[3],
    alignItems: 'center',
  },
  name: {
    flex: 1,
    gap: 0,
  },
  counts: {
    alignItems: 'flex-end',
    gap: 0,
  },
  late: {
    color: theme.colors.danger.fg,
  },
}));

/** Rows listed before the panel defers to the directory. */
const ENTRY_LIMIT = 8;

export interface WorkloadPanelProps {
  readonly snapshot: DashboardSnapshot;
}

export function WorkloadPanel({ snapshot }: WorkloadPanelProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { workload } = snapshot;

  /*
   * Reached only when `snapshot.workload !== null`. The screen checks that before
   * rendering this, so `null` here would be a caller that ignored the gate — and a
   * silent `null` return would turn that mistake into a blank panel that looks like an
   * empty organization. Better to say so.
   */
  if (workload === null) return null;

  /*
   * The population the distribution covers is everyone it accounts for: the people
   * carrying work plus the current headcount carrying none. It is not `peopleWithOpenWork`
   * on its own — the `none` band would then be a share of people who are, by definition,
   * not in the population. `metrics.ts` builds both the count and the caption's
   * denominator from the same subtraction, so they cannot disagree.
   */
  const accountedFor = workload.peopleWithOpenWork + workload.withoutOpenWork;

  const distributionRows: readonly DistributionRow[] = workload.distribution.map((entry, index) => ({
    key: entry.band.key,
    label: entry.band.label,
    value: entry.people,
    color: workloadBandColor(theme, index, workload.distribution.length),
    // The share is printed beside the count rather than encoded as the bar width: the
    // bar is already scaled to the largest row, so its length is not a share, and a
    // reader who assumes it is would misread every row.
    note: accountedFor > 0 ? formatPercent(entry.share) : undefined,
    ...(entry.people === 0 ? { muted: true } : {}),
  }));

  const visible = workload.entries.slice(0, ENTRY_LIMIT);
  const hidden = workload.entries.length - visible.length;

  return (
    <VStack style={s.columns}>
      <Card variant="glass" padding={4} style={s.column}>
        <VStack gap={3}>
          <HStack gap={2} justify="space-between" align="center">
            <HStack gap={2} align="center">
              <Icon name="team" size="sm" tone="tertiary" />
              <Text variant="h4" tone="primary">
                How work is spread
              </Text>
            </HStack>
            <Text variant="caption" tone="tertiary">
              {countLabel(workload.peopleWithOpenWork, 'person')}
            </Text>
          </HStack>

          <DistributionList rows={distributionRows} accessibilityLabel="People by open task count" />

          {/*
           * The denominator is stated because a distribution without one is the easiest
           * chart in the product to misread. "50%" of two people is one person.
           */}
          <Text variant="caption" tone="tertiary">
            {accountedFor === 0
              ? 'Nobody is on the books, so there is no spread to show.'
              : `Share of the ${countLabel(accountedFor, 'person')} on the books, by how many open tasks each is carrying. Nobody idle is a real band, not a zero.`}
          </Text>
        </VStack>
      </Card>

      <Card variant="glass" padding={4} style={s.column}>
        <VStack gap={3}>
          <HStack gap={2} justify="space-between" align="center">
            <HStack gap={2} align="center">
              <Icon name="user" size="sm" tone="tertiary" />
              <Text variant="h4" tone="primary">
                Who is carrying it
              </Text>
            </HStack>
            {workload.meanOpenTasksPerPerson === null ? null : (
              <Text variant="caption" tone="tertiary">
                {formatNumber(workload.meanOpenTasksPerPerson)} average
              </Text>
            )}
          </HStack>

          {workload.entries.length === 0 ? (
            <Text variant="bodySm" tone="secondary">
              {workload.totalOpenTasks === 0
                ? 'No open work is assigned to anybody.'
                : 'Open work exists but none of it has an owner, so there is nobody to list.'}
            </Text>
          ) : (
            <VStack gap={2} style={s.list}>
              {visible.map((entry) => (
                <WorkloadRow key={entry.employeeId} entry={entry} />
              ))}
              {hidden > 0 ? (
                <Text variant="caption" tone="tertiary">
                  {countLabel(hidden, 'other person', 'other people')} not shown. The
                  directory lists everyone.
                </Text>
              ) : null}
            </VStack>
          )}

          {/*
           * The case the two headline numbers cannot reconcile, stated rather than
           * smoothed over. `updateEmployee` deliberately leaves a person's tasks alone
           * when their employment ends, so somebody off the books can still be the
           * busiest name in this list. Clamping `withoutOpenWork` at zero hides that
           * arithmetic; this line is what makes it visible.
           */}
          {workload.offWorkforceWithOpenWork > 0 ? (
            <HStack gap={2} align="flex-start">
              <Badge
                label={`${formatNumber(workload.offWorkforceWithOpenWork)}`}
                intent="warning"
                variant="soft"
                size="sm"
              />
              <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
                {workload.offWorkforceWithOpenWork === 1
                  ? 'One person above is no longer on the books but still holds open work. Changing a status does not reassign tasks — that is a scheduling decision, so it is left to whoever owns it.'
                  : `${formatNumber(workload.offWorkforceWithOpenWork)} people above are no longer on the books but still hold open work. Changing a status does not reassign tasks — that is a scheduling decision, so it is left to whoever owns it.`}
              </Text>
            </HStack>
          ) : null}
        </VStack>
      </Card>
    </VStack>
  );
}

/** One person's counts. No rank, no position, no score. */
function WorkloadRow({ entry }: { readonly entry: WorkloadEntry }) {
  const s = useStyles(styles);
  const theme = useTheme();

  return (
    <HStack gap={3} style={s.row}>
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          backgroundColor: workloadBandColor(
            theme,
            WORKLOAD_BANDS.findIndex((band) => band.key === entry.band.key),
            WORKLOAD_BANDS.length,
          ),
        }}
      />
      <VStack gap={0} style={s.name}>
        <Text variant="bodySm" tone="primary" numberOfLines={1}>
          {entry.name}
        </Text>
        <Text variant="caption" tone="tertiary">
          {entry.band.label} open
        </Text>
      </VStack>
      <VStack gap={0} align="flex-end" style={s.counts}>
        <HStack gap={1} align="baseline">
          <Text variant="bodySm" tone="primary">
            {formatNumber(entry.openTasks)}
          </Text>
          <Text variant="caption" tone="tertiary">
            open
          </Text>
        </HStack>
        {entry.overdueTasks > 0 ? (
          <Text variant="caption" style={s.late}>
            {formatNumber(entry.overdueTasks)} late
          </Text>
        ) : (
          <Text variant="caption" tone="tertiary">
            {formatNumber(entry.doneTasks)} delivered
          </Text>
        )}
      </VStack>
    </HStack>
  );
}

/** Share of a distribution band, as a whole percentage. */
function formatPercent(share: number): string {
  return `${formatNumber(Math.round(share * 100))}%`;
}
