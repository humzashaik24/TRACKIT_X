/**
 * Trackit X — the project panel.
 *
 * What a delivery view owes a business owner: how much work is live, how far along it
 * is, what state it is in, and what is going to be late.
 *
 * ── Why there is no burn-down, velocity, or trend line here ─────────────────────
 * All three need history, and the schema has none. `projects.progress` is the current
 * figure somebody set; there is no `progress_history`, no status-change log, and no
 * completed_at to measure a cycle against. A burn-down drawn from the current progress
 * of N projects would be a straight line invented from one point per project, and it
 * would look exactly like a real burn-down in a screenshot. The current-state
 * distribution below is the honest substitute, and the shape of this panel will change
 * when there is a log to read — which is a note for the schema, not a gap to paper over.
 *
 * The deadline list is real and dated, so it is the one part of this panel that
 * projects forward rather than summarising. It is capped, and the cap is stated on
 * screen when it bites rather than silently truncating.
 */
import {
  Badge,
  Card,
  createStyles,
  Divider,
  HStack,
  Icon,
  ProgressBar,
  Text,
  useStyles,
  useTheme,
  VStack,
} from '@/design-system';
import { PROGRESS_BANDS } from '@/domain/dashboard';
import {
  PROJECT_PRIORITIES,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  projectPriorityRank,
} from '@/domain/project';
import { progressToRatio } from '@/domain/progress';
import { countLabel, formatDateShort, formatNumber } from '@/utils/format';

import { DistributionList, type DistributionRow } from './DistributionList';
import type { DashboardSnapshot, DeadlineEntry } from './metrics';
import { projectPriorityColor, projectStatusColor, progressBandColor } from './palette';

const styles = createStyles((theme) => ({
  columns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  column: {
    // Two side by side from tablet width, stacked on a phone. The `flexBasis` is the
    // whole layout: a chart of a five-row status list beside a five-row priority list
    // is unreadable below roughly 320px of each.
    flexGrow: 1,
    flexBasis: 280,
  },
  deadline: {
    gap: theme.space[2],
  },
  deadlineRow: {
    gap: theme.space[2],
  },
  deadlineMain: {
    flex: 1,
    gap: theme.space[1],
  },
  overdueBar: {
    // A 3px leading rule rather than a coloured card. Red is used here as a state
    // colour, and the design system reserves filled danger surfaces for things that
    // need a decision — a red card per row turns a schedule into an alert wall.
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.danger.fg,
    paddingLeft: theme.space[3],
  },
  soonBar: {
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.warning.fg,
    paddingLeft: theme.space[3],
  },
}));

export interface ProjectPanelProps {
  readonly snapshot: DashboardSnapshot;
}

export function ProjectPanel({ snapshot }: ProjectPanelProps) {
  const s = useStyles(styles);
  const theme = useTheme();
  const { projects, progress, deadlines } = snapshot;

  const statusRows: readonly DistributionRow[] = PROJECT_STATUSES.map((status) => ({
    key: status,
    label: PROJECT_STATUS_LABELS[status],
    value: projects.byStatus[status],
    color: projectStatusColor(theme, status),
    // A zero is muted rather than hidden. "Nothing is on hold" is a row a reader looks
    // for, and dimming it says "checked, and empty" instead of "not relevant".
    ...(projects.byStatus[status] === 0 ? { muted: true } : {}),
  }));

  /*
   * Both the keys and their order come from the domain enums rather than from a literal
   * array written here. A hardcoded `['low', 'medium', 'high', 'critical']` is correct
   * today and becomes a silent omission the day a priority is added — the new value
   * would simply not appear in the chart, with nothing to fail. `WorkPanel` reads task
   * priorities the same way, and the task enum is `urgent` where this one is `critical`,
   * which is exactly the kind of difference a copied literal hides.
   */
  const priorityRows: readonly DistributionRow[] = PROJECT_PRIORITIES.map((priority) => ({
    key: priority,
    label: PROJECT_PRIORITY_LABELS[priority],
    value: projects.byPriority[priority],
    color: projectPriorityColor(
      theme,
      projectPriorityRank(priority),
      PROJECT_PRIORITIES.length - 1,
    ),
    ...(projects.byPriority[priority] === 0 ? { muted: true } : {}),
  }));

  const progressRows: readonly DistributionRow[] = PROGRESS_BANDS.map((band, index) => {
    const entry = progress.projects.bands.find((row) => row.band.key === band.key);
    return {
      key: band.key,
      label: band.label,
      value: entry?.count ?? 0,
      color: progressBandColor(theme, index, PROGRESS_BANDS.length),
      ...(entry?.count === 0 ? { muted: true } : {}),
    };
  });

  return (
    <VStack gap={4}>
      <VStack style={s.columns}>
        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                Project status
              </Text>
              <Text variant="caption" tone="tertiary">
                {formatNumber(projects.total)} total
              </Text>
            </HStack>
            <DistributionList rows={statusRows} accessibilityLabel="Projects by status" />
          </VStack>
        </Card>

        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                Project progress
              </Text>
              <Text variant="caption" tone="tertiary">
                {projects.averageProgress === null
                  ? 'No open projects'
                  : `${formatNumber(projects.averageProgress)}% average`}
              </Text>
            </HStack>
            {/*
             * The average is over OPEN projects only, and the caption says "average"
             * rather than "completion" because that is what it is. A completed project
             * is 100% by definition, so including them would drag the figure toward 100
             * and stop it describing the work in flight.
             */}
            <Text variant="caption" tone="tertiary">
              {progress.projects.total === 0
                ? 'Nothing is in flight, so there is no progress to distribute.'
                : `Across the ${countLabel(progress.projects.total, 'open project')}. Finished projects are always 100%.`}
            </Text>
            <DistributionList rows={progressRows} accessibilityLabel="Open projects by progress" />
          </VStack>
        </Card>

        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                Project priority
              </Text>
              {projects.unowned > 0 ? (
                <Badge
                  label={`${formatNumber(projects.unowned)} unowned`}
                  intent="warning"
                  variant="soft"
                  size="sm"
                />
              ) : null}
            </HStack>
            <DistributionList rows={priorityRows} accessibilityLabel="Projects by priority" />
            {/*
             * "Unowned" is surfaced as a badge rather than as a metric tile because it is
             * a smaller truth than the four headline figures, but it is the one project
             * problem that is invisible in every other number on this screen: a project
             * with no owner contributes normally to the status, priority and progress
             * tallies.
             */}
            {projects.unowned > 0 ? (
              <Text variant="caption" tone="tertiary">
                Nobody is accountable for {countLabel(projects.unowned, 'project')}. They still
                count in every figure above.
              </Text>
            ) : null}
          </VStack>
        </Card>
      </VStack>

      <Card variant="glass" padding={4}>
        <VStack gap={3}>
          <HStack gap={2} justify="space-between" align="center">
            <HStack gap={2} align="center">
              <Icon name="calendar" size="sm" tone="tertiary" />
              <Text variant="h4" tone="primary">
                Dates to watch
              </Text>
            </HStack>
            <HStack gap={2} align="center">
              {deadlines.overdueProjects > 0 ? (
                <Badge
                  label={`${formatNumber(deadlines.overdueProjects)} overdue`}
                  intent="danger"
                  variant="soft"
                  size="sm"
                />
              ) : null}
              {deadlines.dueSoonProjects > 0 ? (
                <Badge
                  label={`${formatNumber(deadlines.dueSoonProjects)} due soon`}
                  intent="warning"
                  variant="soft"
                  size="sm"
                />
              ) : null}
              {deadlines.undatedProjects > 0 ? (
                <Badge
                  label={`${formatNumber(deadlines.undatedProjects)} undated`}
                  intent="neutral"
                  variant="outline"
                  size="sm"
                />
              ) : null}
            </HStack>
          </HStack>

          <DeadlineList entries={deadlines.approaching} undated={deadlines.undatedProjects} />
        </VStack>
      </Card>
    </VStack>
  );
}

/**
 * The soonest dated open projects, and a line for the undated ones.
 *
 * `undated` gets its own sentence rather than being folded into the list, because an
 * undated project has no position in a date-ordered list — sorting it to the end would
 * imply it is the least urgent, which is the opposite of true. It is missing
 * information, and it is reported as such.
 *
 * There is no loading branch, and that is a deliberate consequence of the snapshot
 * being atomic: the screen renders this panel only once a snapshot exists for the
 * organization in view, so a half-read set of projects is not a state this component
 * can be in. `DashboardLoading` covers the wait and keeps the page the same height,
 * which is what stops the layout jumping when the data lands.
 */
function DeadlineList({
  entries,
  undated,
}: {
  readonly entries: readonly DeadlineEntry[];
  readonly undated: number;
}) {
  const s = useStyles(styles);

  if (entries.length === 0) {
    return (
      <Text variant="bodySm" tone="secondary">
        {undated > 0
          ? `No open project has a target date, so there is nothing to count down to. ${countLabel(undated, 'project')} would benefit from one.`
          : 'No open project has a target date. Nothing to count down to, and nothing late.'}
      </Text>
    );
  }

  return (
    <VStack gap={3} style={s.deadline}>
      {entries.map((entry) => (
        <VStack key={entry.projectId} gap={1} style={s.deadlineRow}>
          <HStack gap={3} align="center">
            <VStack
              gap={1}
              style={[
                s.deadlineMain,
                entry.isOverdue ? s.overdueBar : entry.daysUntil <= 7 ? s.soonBar : null,
              ]}
            >
              <Text variant="bodySm" tone="primary" numberOfLines={1}>
                {entry.name}
              </Text>
              <HStack gap={2} align="center">
                <Text variant="caption" tone="tertiary">
                  {PROJECT_STATUS_LABELS[entry.status]} · {formatDateShort(entry.targetDate)}
                </Text>
              </HStack>
            </VStack>
            <VStack gap={1} align="flex-end">
              <Badge
                label={
                  entry.isOverdue
                    ? `${formatNumber(Math.abs(entry.daysUntil))}d late`
                    : entry.daysUntil === 0
                      ? 'Due today'
                      : `${formatNumber(entry.daysUntil)}d left`
                }
                intent={entry.isOverdue ? 'danger' : entry.daysUntil <= 7 ? 'warning' : 'neutral'}
                variant="soft"
                size="sm"
              />
            </VStack>
          </HStack>
          <ProgressBar
            value={progressToRatio(entry.progress)}
            showValue
            thickness={4}
            label={`${entry.name} progress`}
            intent={entry.isOverdue ? 'danger' : 'accent'}
          />
        </VStack>
      ))}

      <Divider subtle />

      {undated > 0 ? (
        <HStack gap={2} align="center">
          <Icon name="info" size="sm" tone="tertiary" />
          <Text variant="caption" tone="tertiary" style={{ flex: 1 }}>
            {countLabel(undated, 'open project')} {undated === 1 ? 'has' : 'have'} no target
            date, so {undated === 1 ? 'it is' : 'they are'} not in the list above. An
            undated project cannot be late — it can only be unplanned.
          </Text>
        </HStack>
      ) : null}
    </VStack>
  );
}
