/**
 * Trackit X — tasks.
 *
 * The work list, read from `public.tasks` and shaped by RLS.
 *
 * ── Why the progress figure is shown, and why it is not computed ──────────────
 * `tasks.progress` is stored, and `progressToRatio` turns the 0-100 column into the
 * ratio `ProgressBar` wants. Nothing here averages anything, for the same reason
 * `ProjectListView` does not average tasks into a project: a figure somebody set is
 * history, and a figure that looks derived is trusted more than an owned one. A task
 * delivered at 60% with the box ticked is a legitimate state.
 *
 * ── Why this screen links to `/projects` but does not roll up from it ─────────
 * A task names its project, and a project's open-task count comes from the task
 * service — see `openTaskCountsByProject`, and the "Open tasks" column on the project
 * list. Neither number is derived from the other table at render time, so the two
 * screens cannot disagree and neither has to hold both tables in memory to answer a
 * question about one.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
  createStyles,
  DataTable,
  Divider,
  FilterBar,
  FilterChip,
  HStack,
  MetricCard,
  ProgressBar,
  ScreenContainer,
  SearchBar,
  Select,
  Text,
  useResponsive,
  useStyles,
  VStack,
  type DataTableColumn,
  type DataTableSort,
  type FilterOption,
  type SelectOption,
} from '@/design-system';
import { employeeDisplayName } from '@/domain/employee';
import { ROLE_LABELS } from '@/domain/organization';
import { impliedProgressForTaskStatus, progressToRatio } from '@/domain/progress';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  isTaskOverdue,
  isTaskSortKey,
  sortTasks,
  type TaskPriority,
  type TaskSort,
  type TaskStatus,
} from '@/domain/task';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { useProjectList } from '@/features/projects/useProjects';
import { taskBadgeSpec } from '@/features/shared/statusBadges';
import {
  NO_TASK_FILTERS,
  useTaskList,
  type TaskFilters,
  type TaskListEntry,
} from '@/features/tasks/useTasks';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { countLabel, formatDate, formatNumber } from '@/utils/format';

const styles = createStyles((theme) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: 150,
  },
  taskCell: {
    flex: 1,
    gap: theme.space[1],
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    gap: theme.space[3],
    alignItems: 'flex-start',
  },
  filterField: {
    flex: 1,
  },
}));

export function TaskListView({ seedProjectId }: { seedProjectId?: string | null }) {
  const router = useRouter();
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const tasks = useTaskList(organizationId);
  // The pickers need people and projects, so both are read here. Two independent reads
  // rather than one joined response: a person who is not an employee cannot be an
  // assignee, and a project in another organization cannot be a parent — so neither
  // list is derivable from the tasks themselves.
  const directory = useEmployeeDirectory(organizationId);
  const projects = useProjectList(organizationId);

  // A project filter can arrive in the URL (e.g. /tasks?project=<id> from a project
  // screen's "View tasks"). It only SEEDS the filter — the screen stays a live list.
  // Keyed on the pair so it re-seeds when someone switches organization while the
  // screen is mounted, then drifts from the fixed string as the user refines it.
  useEffect(() => {
    if (seedProjectId === null || seedProjectId === undefined) return;
    tasks.setFilters({ ...tasks.filters, projectId: seedProjectId } satisfies TaskFilters);
    // Intentionally not retriggering on setFilters identity: this is a mount/keyed
    // seed, not a subscription to the filter value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, seedProjectId]);

  const [sort, setSort] = useState<DataTableSort | undefined>({
    columnKey: 'due',
    direction: 'asc',
  });
  const { today } = tasks;

  const taskSort = useMemo<TaskSort | undefined>(() => {
    if (sort === undefined) return undefined;
    return {
      key: isTaskSortKey(sort.columnKey) ? sort.columnKey : 'title',
      direction: sort.direction,
    };
  }, [sort]);

  const rows = useMemo(
    () => sortTasks(tasks.filteredRows, taskSort, (entry) => entry.task),
    [tasks.filteredRows, taskSort],
  );

  const setSearch = useCallback(
    (search: string) => {
      tasks.setFilters({ ...tasks.filters, search } satisfies TaskFilters);
    },
    [tasks],
  );

  const toggleStatus = useCallback(
    (key: string) => {
      const status = key as TaskStatus;
      const active = tasks.filters.statuses.includes(status);
      tasks.setFilters({
        ...tasks.filters,
        statuses: active
          ? tasks.filters.statuses.filter((entry) => entry !== status)
          : [...tasks.filters.statuses, status],
      } satisfies TaskFilters);
    },
    [tasks],
  );

  const togglePriority = useCallback(
    (key: string) => {
      const priority = key as TaskPriority;
      const active = tasks.filters.priorities.includes(priority);
      tasks.setFilters({
        ...tasks.filters,
        priorities: active
          ? tasks.filters.priorities.filter((entry) => entry !== priority)
          : [...tasks.filters.priorities, priority],
      } satisfies TaskFilters);
    },
    [tasks],
  );

  const toggleMine = useCallback(() => {    tasks.setFilters({
      ...tasks.filters,
      mineOnly: !tasks.filters.mineOnly,
    } satisfies TaskFilters);
  }, [tasks]);

  const toggleOverdue = useCallback(() => {
    tasks.setFilters({
      ...tasks.filters,
      overdueOnly: !tasks.filters.overdueOnly,
    } satisfies TaskFilters);
  }, [tasks]);

  const statusChips = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { task } of tasks.rows) {
      counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
    }
    return TASK_STATUSES.map((status) => ({
      key: status,
      label: TASK_STATUS_LABELS[status],
      count: counts.get(status) ?? 0,
    }));
  }, [tasks.rows]);

  /*
   * Priority gets its own row rather than a place in the status bar. Both are chips
   * that look identical, so mixing them would leave a number whose meaning depends on
   * which side of the row it is on — and a separate row also keeps each chip's count
   * counting the same thing. No "Clear all" here: the one in the status bar above
   * already clears everything, and two buttons doing the same job is one too many.
   */
  const priorityChips = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { task } of tasks.rows) {
      counts.set(task.priority, (counts.get(task.priority) ?? 0) + 1);
    }
    return TASK_PRIORITIES.map((priority) => ({
      key: priority,
      label: TASK_PRIORITY_LABELS[priority],
      count: counts.get(priority) ?? 0,
    }));
  }, [tasks.rows]);

  const projectOptions = useMemo<SelectOption[]>(
    () =>
      projects.rows.map((entry) => ({
        value: entry.project.id,
        label: entry.project.name,
        description: entry.ownerName === null ? 'No owner' : entry.ownerName,
      })),
    [projects.rows],
  );

  const assigneeOptions = useMemo<SelectOption[]>(
    () =>
      directory.rows.map((entry) => ({
        value: entry.employee.id,
        label: employeeDisplayName(entry.employee),
        description: entry.departmentName ?? undefined,
      })),
    [directory.rows],
  );

  /**
   * The progress cell.
   *
   * Mirrors the project list: an open task with nothing entered shows an EMPTY track
   * rather than a filled-to-zero bar, because no fill is the honest rendering of "no
   * figure has been recorded" and a 0% bar says the same thing with the authority of a
   * measurement. `done` shows 100 — that is `impliedProgressForTaskStatus`'s rule and
   * the only place it lives.
   */
  const progressCell = useCallback(
    (entry: TaskListEntry) => {
      const implied = impliedProgressForTaskStatus(entry.task.status);
      if (implied === null && entry.task.progress === 0) {
        return <Text variant="caption" tone="tertiary">Not set</Text>;
      }
      const value = implied ?? entry.task.progress;
      return (
        <View style={s.progressRow}>
          <ProgressBar
            value={progressToRatio(value)}
            intent={implied === 100 ? 'success' : 'accent'}
            thickness={6}
            style={{ flex: 1 }}
          />
          <Text
            variant="caption"
            tone="secondary"
            style={{ minWidth: 34, textAlign: 'right' }}
            accessibilityLabel={`${value} percent complete`}
          >
            {`${value}%`}
          </Text>
        </View>
      );
    },
    [s],
  );

  const columns = useMemo<DataTableColumn<TaskListEntry>[]>(
    () => [
      {
        key: 'title',
        header: 'Task',
        width: 2.6,
        sortable: true,
        primary: true,
        render: (entry) => (
          <VStack gap={0.5} style={s.taskCell}>
            <Text variant="label" numberOfLines={1}>
              {entry.task.title}
            </Text>
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {entry.projectName ?? 'No project'}
            </Text>
          </VStack>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 1.1,
        sortable: true,
        render: (entry) => {
          const spec = taskBadgeSpec(entry.task.status);
          return (
            <HStack gap={1.5} wrap>
              <Badge
                label={TASK_STATUS_LABELS[entry.task.status]}
                intent={spec.intent}
                variant={spec.variant}
                size="sm"
              />
              {/* Overdue is its own badge, not a red status: the task has not changed
                  state, it has simply passed its date. */}
              {isTaskOverdue(entry.task, today) ? (
                <Badge label="Overdue" intent="danger" variant="soft" size="sm" />
              ) : null}
            </HStack>
          );
        },
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 0.9,
        sortable: true,
        render: (entry) => TASK_PRIORITY_LABELS[entry.task.priority],
      },
      {
        key: 'assignee',
        header: 'Assignee',
        width: 1.3,
        sortable: true,
        compactLabel: 'Assigned to',
        render: (entry) =>
          entry.assigneeName === null ? (
            <Text variant="caption" tone="tertiary">Unassigned</Text>
          ) : (
            entry.assigneeName
          ),
      },
      {
        key: 'progress',
        header: 'Progress',
        width: 1.4,
        render: progressCell,
      },
      {
        key: 'due',
        header: 'Due',
        width: 1,
        sortable: true,
        hideOnCompact: true,
        render: (entry) =>
          entry.task.due_date === null ? '—' : formatDate(entry.task.due_date),
      },
    ],
    [s, today, progressCell],
  );

  const hasNoEmployeeRow = tasks.currentEmployeeId === null;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={tasks.isRefreshing}
      onRefresh={() => {
        void tasks.refresh();
      }}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
      loading={tasks.isLoading && tasks.rows.length === 0}
      loadingLabel="Loading your tasks"
    >
      <PageHeader
        title="Tasks"
        description="The work itself — what is assigned, what is late and what is blocked."
        breadcrumbs={deriveBreadcrumbs('/tasks')}
        status={
          <HStack gap={2} align="center" wrap>
            {role === null ? null : (
              <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
            )}
            <Badge
              label={
                tasks.summary.total === 0
                  ? 'No tasks yet'
                  : countLabel(tasks.summary.total, 'task')
              }
              intent="neutral"
              variant="outline"
              size="sm"
            />
          </HStack>
        }
        primaryAction={{
          label: 'New task',
          icon: 'add',
          variant: 'primary',
          onPress: () => {
            router.push('/tasks/create');
          },
        }}
      />

      <VStack gap={3} style={s.grid}>
        <MetricCard
          label="Open tasks"
          value={
            tasks.isLoading && tasks.rows.length === 0 ? '—' : formatNumber(tasks.summary.open)
          }
          icon="tasks"
          intent="accent"
          loading={tasks.isLoading && tasks.rows.length === 0}
          footnote="To do, in progress, blocked or in review"
          style={s.gridItem}
        />
        <MetricCard
          label="Past due"
          value={formatNumber(tasks.summary.overdue)}
          icon="warning"
          intent={tasks.summary.overdue === 0 ? 'success' : 'danger'}
          footnote={
            tasks.summary.overdue === 0 ? 'Nothing is running late' : 'Open and past their due date'
          }
          style={s.gridItem}
        />
        <MetricCard
          label="Blocked"
          value={formatNumber(tasks.summary.blocked)}
          icon="blocked"
          intent={tasks.summary.blocked === 0 ? 'success' : 'warning'}
          footnote="Waiting on something"
          style={s.gridItem}
        />
        <MetricCard
          label="Unassigned"
          value={formatNumber(tasks.summary.unassigned)}
          icon="user"
          intent={tasks.summary.unassigned === 0 ? 'neutral' : 'warning'}
          footnote="Nobody is accountable"
          style={s.gridItem}
        />
      </VStack>

      <VStack gap={3}>
        <SearchBar
          value={tasks.filters.search}
          onChangeText={setSearch}
          placeholder="Search by task, description, project or person"
          accessibilityLabel="Search tasks"
        />

        <FilterBar
          filters={statusChips}
          activeKeys={tasks.filters.statuses as readonly string[]}
          onToggle={toggleStatus}
          onClearAll={
            tasks.hasActiveFilters
              ? () => {
                  tasks.setFilters(NO_TASK_FILTERS);
                }
              : undefined
          }
          trailing={
            <HStack gap={2} wrap>
              {/* FilterChip rather than Badge: these are controls. Both are hidden when
                  they could only return nothing — offering a filter guaranteed to be
                  empty is noise. */}
              {tasks.summary.overdue === 0 ? null : (
                <FilterChip
                  label="Past due"
                  active={tasks.filters.overdueOnly}
                  icon="warning"
                  count={tasks.summary.overdue}
                  onPress={toggleOverdue}
                />
              )}
              <FilterChip
                label="Mine"
                active={tasks.filters.mineOnly}
                icon="user"
                disabled={hasNoEmployeeRow}
                onPress={toggleMine}
              />
            </HStack>
          }
        />

        <FilterBar
          filters={priorityChips}
          activeKeys={tasks.filters.priorities as readonly string[]}
          onToggle={togglePriority}
          leading={
            <Text variant="caption" tone="tertiary">
              Priority
            </Text>
          }
        />

        {/*
          Project and assignee are Selects rather than chips because both lists are long
          and neither is a short set of mutually exclusive states. A login with no
          employee row cannot be shown to have "my" tasks, so the assignee filter is
          disabled outright rather than left inert — an inert control is a bug report.
        */}        <View style={s.filterRow}>
          <VStack gap={1} style={s.filterField}>
            <Select
              label="Project"
              options={projectOptions}
              value={tasks.filters.projectId ?? null}
              onChange={(value) => {
                tasks.setFilters({ ...tasks.filters, projectId: value } satisfies TaskFilters);
              }}
              onClear={() => {
                tasks.setFilters({ ...tasks.filters, projectId: undefined } satisfies TaskFilters);
              }}
              placeholder="Any project"
              clearable
              searchable
              accessibilityLabel="Filter by project"
            />
          </VStack>
          <VStack gap={1} style={s.filterField}>
            <Select
              label="Assignee"
              options={assigneeOptions}
              value={tasks.filters.assigneeId ?? null}
              onChange={(value) => {
                tasks.setFilters({ ...tasks.filters, assigneeId: value } satisfies TaskFilters);
              }}
              onClear={() => {
                tasks.setFilters({ ...tasks.filters, assigneeId: undefined } satisfies TaskFilters);
              }}
              placeholder="Anyone"
              clearable
              searchable
              disabled={hasNoEmployeeRow && directory.rows.length === 0}
              accessibilityLabel="Filter by assignee"
            />
          </VStack>
        </View>

        {tasks.hasActiveFilters ? (
          <Text variant="caption" tone="tertiary">
            Showing {formatNumber(rows.length)} of {formatNumber(tasks.summary.total)} tasks.
          </Text>
        ) : null}
      </VStack>

      <Divider subtle />

      <DataTable
        columns={columns}
        rows={rows}
        keyExtractor={(entry) => entry.task.id}
        {...(sort === undefined ? {} : { sort })}
        onSortChange={(next) => {
          setSort(next);
        }}
        onRowPress={(entry) => {
          router.push(`/tasks/${entry.task.id}`);
        }}
        loading={tasks.isLoading && tasks.rows.length === 0}
        error={tasks.error ?? undefined}
        onRetry={() => {
          void tasks.refresh();
        }}
        accessibilityLabel="Tasks"
        emptyTitle={tasks.hasActiveFilters ? 'No tasks match' : 'No tasks yet'}
        emptyDescription={
          tasks.hasActiveFilters
            ? 'Try a different search, or clear the filters.'
            : 'Raise the first task to start tracking work. It can belong to a project, or to none.'
        }
        footer={
          <HStack gap={2} justify="space-between" align="center">
            <Text variant="caption" tone="tertiary">
              {tasks.hasActiveFilters
                ? `${formatNumber(rows.length)} of ${formatNumber(tasks.summary.total)}`
                : countLabel(tasks.summary.total, 'task')}
            </Text>
            {hasNoEmployeeRow ? (
              <Text variant="caption" tone="tertiary">
                This login is not on the payroll, so “Mine” is unavailable
              </Text>
            ) : null}
          </HStack>
        }
      />

      {/*
        A note about the priority vocabulary. Stated on the screen rather than in a
        comment, because the next person to extend this will be looking at the screen
        and not at the domain file.
      */}
      {tasks.summary.total > 0 ? (
        <Text variant="caption" tone="tertiary">
          {`Priority runs ${TASK_PRIORITIES.map((p) => TASK_PRIORITY_LABELS[p]).join(' → ')}. `}
          A task with no project is not a mistake — some work belongs to no job.
        </Text>
      ) : null}
    </ScreenContainer>
  );
}
