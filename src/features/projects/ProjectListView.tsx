/**
 * Trackit X — projects.
 *
 * The second screen showing real records, read from `public.projects`.
 *
 * ── Why progress is shown, and why it is not a formula ───────────────────────
 * `projects.progress` is stored, not derived from the tasks underneath it, and
 * `progressToRatio` is what turns the 0-100 column into the 0-1 `ProgressBar` wants.
 * The temptation is to average the tasks. It is wrong for a reason stated at the
 * column itself: a task with no due date and no estimate cannot average into
 * anything meaningful, and a project delivered at 80% with three tasks outstanding
 * is a legitimate state a business owner chose. So the figure shown is the figure
 * somebody set, and the screen never presents it as a computation.
 *
 * `completed` shows 100 and `cancelled` shows nothing — `impliedProgressForProjectStatus`
 * is the only place that rule exists, and it returns `null` rather than 0 for a
 * cancelled project, because work somebody deliberately stopped is not work that
 * failed to progress.
 */
import { useCallback, useMemo, useState } from 'react';
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
  EmptyState,
  FilterBar,
  FilterChip,
  HStack,
  MetricCard,
  Modal,
  ProgressBar,
  ScreenContainer,
  SearchBar,
  Text,
  useResponsive,
  useStyles,
  VStack,
  type DataTableColumn,
  type DataTableSort,
  type FilterOption,
} from '@/design-system';
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  canManageProjects,
  isOverdue,
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@/domain/project';
import { impliedProgressForProjectStatus, progressToRatio } from '@/domain/progress';
import { ROLE_LABELS } from '@/domain/organization';
import { ProjectCreateForm } from '@/features/projects/ProjectCreateForm';
import {
  NO_PROJECT_FILTERS,
  useProjectList,
  type ProjectFilters,
  type ProjectListEntry,
} from '@/features/projects/useProjects';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { useOpenTaskCounts } from '@/features/tasks/useTasks';
import { projectBadgeSpec } from '@/features/shared/statusBadges';
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
  projectCell: {
    flex: 1,
    gap: theme.space[1],
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    flex: 1,
  },
}));

type SortKey = 'name' | 'status' | 'priority' | 'target';

function sortRows(
  rows: readonly ProjectListEntry[],
  sort: DataTableSort | undefined,
): readonly ProjectListEntry[] {
  if (sort === undefined) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;

  const key = (entry: ProjectListEntry): string | number => {
    switch (sort.columnKey as SortKey) {
      case 'status':
        // Lifecycle rank, not alphabetical. A reader scans planned → active → hold →
        // done; A-Z would put Active before Cancelled and break that reading.
        return PROJECT_STATUSES.indexOf(entry.project.status);
      case 'priority':
        // Descending is the useful default for a risk column, which is why the
        // table's numeric columns start descending.
        return PROJECT_PRIORITY_ORDER[entry.project.priority];
      case 'target':
        return entry.project.target_date ?? '';
      case 'name':
      default:
        return entry.project.name;
    }
  };

  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === right) return a.project.id.localeCompare(b.project.id);
    return left < right ? -1 * direction : 1 * direction;
  });
}

const PROJECT_PRIORITY_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const;

export function ProjectListView() {
  const router = useRouter();
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const projects = useProjectList(organizationId);
  // The create form needs people to choose an owner, so the roster is read here too.
  // Two independent reads rather than one joined response: a person who is not an
  // employee is not a candidate, and the picker must not offer them.
  const directory = useEmployeeDirectory(organizationId);
  // Open tasks per project, so the list can say where the work actually is rather
  // than only that a project exists. Its own read: a count is a fact about the tasks
  // pointing at a project, and folding it into the project query would mean the
  // project row cannot be rendered without it.
  const openTasks = useOpenTaskCounts(organizationId);

  const [sort, setSort] = useState<DataTableSort | undefined>({ columnKey: 'name', direction: 'asc' });
  const [isCreating, setIsCreating] = useState(false);

  const canCreate = canManageProjects(role);
  const { today } = projects;

  const rows = useMemo(() => sortRows(projects.filteredRows, sort), [projects.filteredRows, sort]);

  const setSearch = useCallback(
    (search: string) => {
      projects.setFilters({ ...projects.filters, search } satisfies ProjectFilters);
    },
    [projects],
  );

  const toggleStatus = useCallback(
    (key: string) => {
      const status = key as ProjectStatus;
      const active = projects.filters.statuses.includes(status);
      const statuses = active
        ? projects.filters.statuses.filter((entry) => entry !== status)
        : [...projects.filters.statuses, status];
      projects.setFilters({ ...projects.filters, statuses } satisfies ProjectFilters);
    },
    [projects],
  );

  const toggleOverdue = useCallback(() => {
    projects.setFilters({
      ...projects.filters,
      overdueOnly: !projects.filters.overdueOnly,
    } satisfies ProjectFilters);
  }, [projects]);

  const statusChips = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { project } of projects.rows) {
      counts.set(project.status, (counts.get(project.status) ?? 0) + 1);
    }
    return PROJECT_STATUSES.map((status) => ({
      key: status,
      label: PROJECT_STATUS_LABELS[status],
      count: counts.get(status) ?? 0,
    }));
  }, [projects.rows]);

  /**
   * The progress cell.
   *
   * An open project with nothing entered shows an EMPTY track, not 0% — the track
   * with no fill is the honest rendering of "no figure has been recorded", whereas a
   * filled-to-zero bar says the same thing with the authority of a measurement.
   */
  const progressCell = useCallback((entry: ProjectListEntry) => {
    const implied = impliedProgressForProjectStatus(entry.project.status);
    if (implied === null && entry.project.progress === 0) {
      return <Text variant="caption" tone="tertiary">Not set</Text>;
    }
    const value = implied ?? entry.project.progress;
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
  }, [s]);

  const columns = useMemo<DataTableColumn<ProjectListEntry>[]>(
    () => [
      {
        key: 'name',
        header: 'Project',
        width: 2.4,
        sortable: true,
        primary: true,
        render: (entry) => (
          <VStack gap={0.5} style={s.projectCell}>
            <Text variant="label" numberOfLines={1}>
              {entry.project.name}
            </Text>
            <Text variant="caption" tone="tertiary" numberOfLines={1}>
              {entry.ownerName === null ? 'No owner' : entry.ownerName}
            </Text>
          </VStack>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: 1,
        sortable: true,
        render: (entry) => {
          const spec = projectBadgeSpec(entry.project.status);
          const overdue = isOverdue(entry.project, today);
          return (
            <HStack gap={1.5} wrap>
              <Badge
                label={PROJECT_STATUS_LABELS[entry.project.status]}
                intent={spec.intent}
                variant={spec.variant}
                size="sm"
              />
              {/* Overdue is a separate badge rather than a red status: the project
                  has not changed state, it has simply passed its date. Overloading
                  the status badge would claim a status change that did not happen. */}
              {overdue ? <Badge label="Overdue" intent="danger" variant="soft" size="sm" /> : null}
            </HStack>
          );
        },
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 0.9,
        sortable: true,
        render: (entry) => PROJECT_PRIORITY_LABELS[entry.project.priority],
      },
      {
        key: 'progress',
        header: 'Progress',
        width: 1.5,
        render: progressCell,
      },
      {
        key: 'team',
        header: 'Team',
        width: 0.8,
        numeric: true,
        hideOnCompact: true,
        render: (entry) => formatNumber(entry.memberCount),
      },
      {
        /*
         * Open tasks, per project.
         *
         * Not sortable. The count arrives from a second read that lands
         * independently of the rows, so a header that sorts would re-order on a
         * number the caller did not choose and cannot see changing. A column that
         * reorders itself underneath a tap is worse than a column that stays put.
         */
        key: 'openTasks',
        header: 'Open tasks',
        width: 0.9,
        numeric: true,
        render: (entry) => {
          const open = openTasks.countFor(entry.project.id);
          return open === 0 ? '—' : formatNumber(open);
        },
      },
      {
        key: 'target',
        header: 'Target',
        width: 1.1,
        sortable: true,
        hideOnCompact: true,
        render: (entry) =>
          entry.project.target_date === null ? '—' : formatDate(entry.project.target_date),
      },
    ],
    [s, today, progressCell, openTasks],
  );

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={projects.isRefreshing}
      onRefresh={() => {
        void Promise.all([projects.refresh(), openTasks.refresh()]);
      }}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
      loading={projects.isLoading && projects.rows.length === 0}
      loadingLabel="Loading your projects"
    >
      <PageHeader
        title="Projects"
        description="Jobs with a schedule, an owner and a progress figure."
        breadcrumbs={deriveBreadcrumbs('/projects')}
        status={
          <HStack gap={2} align="center" wrap>
            {role === null ? null : (
              <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
            )}
            <Badge
              label={
                projects.summary.total === 0
                  ? 'No projects yet'
                  : countLabel(projects.summary.total, 'project')
              }
              intent="neutral"
              variant="outline"
              size="sm"
            />
          </HStack>
        }
        primaryAction={
          canCreate
            ? {
                label: 'New project',
                icon: 'add',
                variant: 'primary',
                onPress: () => {
                  setIsCreating(true);
                },
              }
            : undefined
        }
      />

      <VStack gap={3} style={s.grid}>
        <MetricCard
          label="Open projects"
          value={projects.isLoading && projects.rows.length === 0 ? '—' : formatNumber(projects.summary.open)}
          icon="projects"
          intent="accent"
          loading={projects.isLoading && projects.rows.length === 0}
          footnote="Planned, active or on hold"
          style={s.gridItem}
        />
        <MetricCard
          label="Past target date"
          value={formatNumber(projects.summary.overdue)}
          icon="warning"
          intent={projects.summary.overdue === 0 ? 'success' : 'danger'}
          footnote={
            projects.summary.overdue === 0
              ? 'Nothing is running late'
              : 'Open and past their target date'
          }
          style={s.gridItem}
        />
        <MetricCard
          label="No owner"
          value={formatNumber(projects.summary.unowned)}
          icon="user"
          intent={projects.summary.unowned === 0 ? 'neutral' : 'warning'}
          footnote="Nobody is accountable for delivery"
          style={s.gridItem}
        />
        <MetricCard
          label="Total projects"
          value={formatNumber(projects.summary.total)}
          icon="projects"
          footnote="Including delivered and cancelled"
          style={s.gridItem}
        />
      </VStack>

      <VStack gap={3}>
        <SearchBar
          value={projects.filters.search}
          onChangeText={setSearch}
          placeholder="Search by name, description or owner"
          accessibilityLabel="Search projects"
        />

        <FilterBar
          filters={statusChips}
          activeKeys={projects.filters.statuses as readonly string[]}
          onToggle={toggleStatus}
          onClearAll={
            projects.hasActiveFilters
              ? () => {
                  projects.setFilters(NO_PROJECT_FILTERS);
                }
              : undefined
          }
          trailing={
            projects.summary.overdue === 0 ? null : (
              // FilterChip rather than Badge: this one is a control, and a Badge is
              // not. It is hidden entirely when nothing is late, because offering a
              // filter that is guaranteed to return nothing is noise.
              <FilterChip
                label="Past target"
                active={projects.filters.overdueOnly}
                icon="warning"
                count={projects.summary.overdue}
                onPress={toggleOverdue}
              />
            )
          }
        />

        {projects.hasActiveFilters ? (
          <Text variant="caption" tone="tertiary">
            Showing {formatNumber(rows.length)} of {formatNumber(projects.summary.total)} projects.
          </Text>
        ) : null}
      </VStack>

      <Divider subtle />

      <DataTable
        columns={columns}
        rows={rows}
        keyExtractor={(entry) => entry.project.id}
        {...(sort === undefined ? {} : { sort })}
        onSortChange={(next) => {
          setSort(next);
        }}
        loading={projects.isLoading && projects.rows.length === 0}
        error={projects.error ?? undefined}
        onRetry={() => {
          void projects.refresh();
        }}
        onRowPress={(entry) => {
          router.push(`/projects/${entry.project.id}`);
        }}
        accessibilityLabel="Projects"
        emptyTitle={projects.hasActiveFilters ? 'No projects match' : 'No projects yet'}
        emptyDescription={
          projects.hasActiveFilters
            ? 'Try a different search, or clear the filters.'
            : 'Create the first project to start tracking delivery. It can be created before it is staffed.'
        }
        footer={
          <HStack gap={2} justify="space-between" align="center">
            <Text variant="caption" tone="tertiary">
              {projects.hasActiveFilters
                ? `${formatNumber(rows.length)} of ${formatNumber(projects.summary.total)}`
                : countLabel(projects.summary.total, 'project')}
            </Text>
            {canCreate ? null : (
              <Text variant="caption" tone="tertiary">
                Only managers and above can create projects
              </Text>
            )}
          </HStack>
        }
      />

      {/*
        A note about what this screen deliberately does not show. Stated on the screen
        rather than in a comment, because the next person to extend it will be looking
        at the screen and not at this file.
      */}
      {projects.summary.total > 0 ? (
        <EmptyState
          inline
          variant="firstRun"
          icon="tasks"
          title="Tasks are not on this screen yet"
          description={
            'Projects exist and are read from the database. Work items — the things assigned to ' +
            'people with due dates — are stored and secured, and get their own screen in a later ' +
            'phase. Nothing here is estimated or rolled up from tasks.'
          }
        />
      ) : null}

      <Modal
        visible={isCreating}
        onClose={() => {
          setIsCreating(false);
        }}
        title="New project"
        description="A unit of work. It can be created before it is staffed."
        size="md"
        scrollable
      >
        {/* Keyed so a workspace switch cannot carry a half-typed draft or stale
            picker values from one organization into another. */}
        <ProjectCreateForm
          key={organizationId ?? 'none'}
          organizationId={organizationId ?? ''}
          employees={directory.rows}
          onCancel={() => {
            setIsCreating(false);
          }}
          onSaved={() => {
            setIsCreating(false);
            void projects.refresh();
          }}
        />
      </Modal>
    </ScreenContainer>
  );
}
