/**
 * Trackit X — the work panel.
 *
 * The state of the work queue, and the two figures on it that answer a question the
 * status breakdown cannot: what is late, and what nobody owns.
 *
 * ── "Unassigned" is a headline here, not a filter ───────────────────────────────
 * It gets a tile of its own because unowned work is the failure mode a delivery view
 * exists to catch. A task with no assignee is not on anybody's list, is not on
 * anybody's reminders, and will not be missed by anybody — it simply will not happen.
 * The tasks screen reports it in a filter; a dashboard reports it in the same breath as
 * the counts, because a number that needs a filter applied to be seen is a number
 * nobody looks at.
 *
 * The same reasoning puts overdue beside it. Both are counts of work that is currently
 * not being done by anyone, and they are the only two figures in this panel that imply
 * somebody should do something.
 *
 * Everything else here is a distribution, deliberately. `done` is a distribution and not
 * a tile, because "4 of 60 tasks delivered" is a rate rather than an achievement — and
 * a rate on a dashboard top row is how a quiet quarter starts reading as a good one.
 */
import {
  Badge,
  Card,
  createStyles,
  HStack,
  Icon,
  MetricCard,
  Text,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_STATUSES, TASK_STATUS_LABELS, taskPriorityRank } from '@/domain/task';
import { formatNumber } from '@/utils/format';

import { DistributionList, type DistributionRow } from './DistributionList';
import type { DashboardSnapshot } from './metrics';
import { taskPriorityColor, taskStatusColor } from './palette';

const styles = createStyles((theme) => ({
  attention: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  attentionItem: {
    flexGrow: 1,
    flexBasis: 160,
  },
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  column: {
    flexGrow: 1,
    flexBasis: 260,
  },
  quiet: {
    gap: theme.space[2],
    padding: theme.space[3],
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceInset,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
}));

export interface WorkPanelProps {
  readonly snapshot: DashboardSnapshot;
}

export function WorkPanel({ snapshot }: WorkPanelProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { tasks } = snapshot;

  const statusRows: readonly DistributionRow[] = TASK_STATUSES.map((status) => ({
    key: status,
    label: TASK_STATUS_LABELS[status],
    value: tasks.byStatus[status],
    color: taskStatusColor(theme, status),
    ...(tasks.byStatus[status] === 0 ? { muted: true } : {}),
  }));

  const lastPriorityRank = TASK_PRIORITIES.length - 1;
  const priorityRows: readonly DistributionRow[] = TASK_PRIORITIES.map((priority) => ({
    key: priority,
    label: TASK_PRIORITY_LABELS[priority],
    value: tasks.byPriority[priority],
    color: taskPriorityColor(theme, taskPriorityRank(priority), lastPriorityRank),
    ...(tasks.byPriority[priority] === 0 ? { muted: true } : {}),
  }));

  return (
    <VStack gap={4}>
      {/*
       * The two figures that imply an action, first, so they are the first thing read
       * on a phone. `intent` is chosen from the number rather than hard-coded: a tile
       * that is red while nothing is late teaches a reader to ignore red, which costs
       * the signal its value the first time something really is late.
       */}
      <VStack style={s.attention}>
        <MetricCard
          style={s.attentionItem}
          label="Overdue"
          value={formatNumber(tasks.overdue)}
          icon="warning"
          intent={tasks.overdue > 0 ? 'danger' : 'neutral'}
          footnote={
            tasks.overdue > 0
              ? 'Open, past its date'
              : tasks.open === 0
                ? 'No open tasks to be late'
                : 'Everything open is on time'
          }
        />
        <MetricCard
          style={s.attentionItem}
          label="Nobody's task"
          value={formatNumber(tasks.unassigned)}
          icon="user"
          intent={tasks.unassigned > 0 ? 'warning' : 'neutral'}
          footnote={
            tasks.unassigned > 0
              ? 'Open work with no owner'
              : 'Every open task has an owner'
          }
        />
      </VStack>

      <VStack style={s.columns}>
        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                Task status
              </Text>
              <Text variant="caption" tone="tertiary">
                {formatNumber(tasks.total)} total
              </Text>
            </HStack>
            <DistributionList rows={statusRows} accessibilityLabel="Tasks by status" />
          </VStack>
        </Card>

        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                Task priority
              </Text>
              <Text variant="caption" tone="tertiary">
                {formatNumber(tasks.open)} open
              </Text>
            </HStack>
            {/*
             * A sequential ramp rather than red-for-urgent. Priority is an ordered scale
             * with no good/bad reading — an urgent task is not a failure — so painting it
             * in the same red as `blocked` would tell the reader that a choice of urgency
             * is a state of distress.
             */}
            <DistributionList rows={priorityRows} accessibilityLabel="Tasks by priority" />
            {tasks.inReview > 0 ? (
              <Badge
                label={`${formatNumber(tasks.inReview)} waiting on sign-off`}
                intent="info"
                variant="soft"
                size="sm"
              />
            ) : null}
          </VStack>
        </Card>
      </VStack>

      {/*
       * The quiet reading, stated in a sentence. A queue that is entirely `todo` and has
       * never been late is a real and common state — a business that has just captured
       * its work — and a screen that shows only a bar chart of it reads as a stalled
       * system. Saying it out loud is the difference between "nothing is happening" and
       * "nothing is late, and here is what exists".
       */}
      {tasks.total > 0 ? (
        <HStack gap={3} align="flex-start" style={s.quiet}>
          <Icon name="info" size="sm" tone="tertiary" />
          <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
            {describeQueue(tasks)}
          </Text>
        </HStack>
      ) : null}
    </VStack>
  );
}

/**
 * One sentence describing the queue, composed from the counts.
 *
 * Written as a function rather than as a template in the JSX because the branching is
 * the whole thing: the interesting cases are the combinations, not any single figure.
 * It says what the numbers are and nothing about what they mean — no "going well", no
 * "needs attention", because those are the judgements this phase refuses to make.
 */
function describeQueue(tasks: DashboardSnapshot['tasks']): string {
  if (tasks.total === 0) return 'No tasks have been recorded yet.';

  const parts: string[] = [];
  if (tasks.inProgress > 0) parts.push(`${formatNumber(tasks.inProgress)} in progress`);
  if (tasks.toDo > 0) parts.push(`${formatNumber(tasks.toDo)} not started`);
  if (tasks.blocked > 0) parts.push(`${formatNumber(tasks.blocked)} blocked`);
  if (tasks.inReview > 0) parts.push(`${formatNumber(tasks.inReview)} awaiting sign-off`);
  if (tasks.overdue > 0) parts.push(`${formatNumber(tasks.overdue)} past their date`);
  if (tasks.unassigned > 0) parts.push(`${formatNumber(tasks.unassigned)} with no owner`);

  if (parts.length === 0) {
    return 'Every task on record is delivered. Nothing is open, late, or unowned.';
  }

  const open = `${formatNumber(tasks.open)} of ${formatNumber(tasks.total)} open`;
  return `${open} — ${joinWithAnd(parts)}.`;
}

/** "a, b and c". Small enough not to warrant a dependency. */
function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
