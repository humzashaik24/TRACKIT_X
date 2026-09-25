/**
 * Trackit X — employee directory.
 *
 * The first screen in the product that shows real business records: the roster, read
 * from `public.employees` and shaped by RLS.
 *
 * ── The number this screen is careful about ──────────────────────────────────
 * "People" means headcount, not accounts. The dashboard shows a member count, which
 * is a different figure, and the two must never be substituted for one another — a
 * business with 40 staff and 6 logins is not a 6-person company. So the summary here
 * is computed from `employees` and nothing else, and the create form never creates
 * an account (see `EmployeeCreateForm`).
 *
 * Every state is rendered: loading, error, genuinely empty, and filtered-to-nothing.
 * The last two are different messages and conflating them is the failure this
 * screen most needs to avoid — "no employees" and "no employees match 'xyz'" tell a
 * user opposite things about whether they have staff.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
  createStyles,
  DataTable,
  Divider,
  FilterBar,
  HStack,
  MetricCard,
  Modal,
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
  employeeDisplayName,
  EMPLOYMENT_STATUS_LABELS,
  EMPLOYMENT_STATUSES,
  type EmploymentStatus,
} from '@/domain/employee';
import { hasAtLeastRole, ROLE_LABELS } from '@/domain/organization';
import { EmployeeCreateForm } from '@/features/employees/EmployeeCreateForm';
import {
  NO_DIRECTORY_FILTERS,
  useEmployeeDirectory,
  type DirectoryFilters,
  type EmployeeListEntry,
} from '@/features/employees/useEmployeeDirectory';
import { employmentBadgeSpec } from '@/features/shared/statusBadges';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { countLabel, formatDate, formatNumber } from '@/utils/format';

const styles = createStyles((theme) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  gridItem: {
    // Two per row on a phone, four on a tablet; flex basis lets the last item fill
    // the row rather than leaving a ragged gap.
    flexGrow: 1,
    flexBasis: 150,
  },
  grow: {
    flex: 1,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2.5],
    flex: 1,
  },
  personText: {
    flex: 1,
  },
}));

type SortKey = 'name' | 'status' | 'department' | 'joined';

/**
 * Chip key for "people with no department".
 *
 * A real UUID cannot be a person's department, so the sentinel is unreachable as an
 * id and cannot collide with a department. Naming it rather than inlining a literal
 * is what makes the `?? UNASSIGNED_DEPARTMENT_KEY` above readable.
 */
const UNASSIGNED_DEPARTMENT_KEY = '__unassigned__';

function sortRows(
  rows: readonly EmployeeListEntry[],
  sort: DataTableSort | undefined,
): readonly EmployeeListEntry[] {
  if (sort === undefined) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;

  const key = (entry: EmployeeListEntry): string | number => {
    switch (sort.columnKey as SortKey) {
      case 'status':
        // Ordered by the declared lifecycle, not the alphabet — a reader scans
        // probation → active → notice in that order, which sorting A-Z destroys.
        return EMPLOYMENT_STATUS_ORDER[entry.employee.employment_status];
      case 'department':
        // Unassigned sorts as an empty string, so it lands at one end predictably
        // instead of the database's NULL ordering, which is not obvious to a reader.
        return entry.departmentName ?? '';
      case 'joined':
        return entry.employee.joining_date ?? '';
      case 'name':
      default:
        return employeeDisplayName(entry.employee);
    }
  };

  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left === right) {
      // Stable tiebreak on the code, so re-sorting never shuffles equal names.
      return a.employee.employee_code.localeCompare(b.employee.employee_code);
    }
    return left < right ? -1 * direction : 1 * direction;
  });
}

/** Index in `EMPLOYMENT_STATUSES` — the lifecycle order, used as a sort rank. */
const EMPLOYMENT_STATUS_ORDER: Record<EmploymentStatus, number> = {
  active: 0,
  probation: 1,
  on_leave: 2,
  notice_period: 3,
  inactive: 4,
};

export function EmployeeDirectoryView() {
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const directory = useEmployeeDirectory(organization?.id ?? null);

  const [sort, setSort] = useState<DataTableSort | undefined>({ columnKey: 'name', direction: 'asc' });
  const [isCreating, setIsCreating] = useState(false);

  // Employees are an administrative record, so only an admin adds one. The policy
  // is `employees_insert_admins` and would refuse anybody else regardless; this
  // only stops the button being offered to someone it will not work for.
  const canAddEmployee = hasAtLeastRole(role, 'admin');

  const rows = useMemo(() => sortRows(directory.filteredRows, sort), [directory.filteredRows, sort]);

  const setSearch = useCallback(
    (search: string) => {
      directory.setFilters({ ...directory.filters, search } satisfies DirectoryFilters);
    },
    [directory],
  );

  const toggleStatus = useCallback(
    (key: string) => {
      const status = key as EmploymentStatus;
      const active = directory.filters.statuses.includes(status);
      const statuses = active
        ? directory.filters.statuses.filter((entry) => entry !== status)
        : [...directory.filters.statuses, status];
      directory.setFilters({ ...directory.filters, statuses } satisfies DirectoryFilters);
    },
    [directory],
  );

  const setDepartment = useCallback(
    (key: string) => {
      directory.setFilters({
        ...directory.filters,
        // `null` is a real filter — "only people with no department" — and is not
        // the same as clearing the filter, which is `undefined`.
        departmentId: key === 'all' ? undefined : key === UNASSIGNED_DEPARTMENT_KEY ? null : key,
      } satisfies DirectoryFilters);
    },
    [directory],
  );

  /**
   * Department filter chips, with the headcount on each.
   *
   * The counts are the whole reason to show the count: a chip labelled "Production"
   * and a chip labelled "2 people" are the same chip, and the number is what tells a
   * manager which filter is worth pressing before they press it.
   */
  const departmentChips = useMemo<FilterOption[]>(() => {
    const byDepartment = new Map<string, number>();
    let unassigned = 0;
    for (const { employee } of directory.rows) {
      if (employee.department_id === null) {
        unassigned += 1;
        continue;
      }
      byDepartment.set(employee.department_id, (byDepartment.get(employee.department_id) ?? 0) + 1);
    }
    return [
      { key: 'all', label: 'Everyone', count: directory.rows.length },
      ...directory.departmentList
        .filter((department) => byDepartment.has(department.id))
        .map((department) => ({
          key: department.id,
          label: department.name,
          count: byDepartment.get(department.id) ?? 0,
        })),
      // Only offered when somebody is actually in it. A permanent "No department"
      // chip on an empty bucket is a control that leads nowhere.
      ...(unassigned === 0
        ? []
        : [{ key: UNASSIGNED_DEPARTMENT_KEY, label: 'No department', count: unassigned }]),
    ];
  }, [directory.rows, directory.departmentList]);

  /**
   * Status chips, in lifecycle order, with each state's headcount.
   *
   * Every status is offered even at zero, unlike the department chips. A reader
   * looking for "inactive" wants to discover that nobody is inactive, and hiding the
   * chip would leave them unsure whether the state exists.
   */
  const statusChips = useMemo<FilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const { employee } of directory.rows) {
      const status = employee.employment_status;
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }
    return EMPLOYMENT_STATUSES.map((status) => ({
      key: status,
      label: EMPLOYMENT_STATUS_LABELS[status],
      count: counts.get(status) ?? 0,
    }));
  }, [directory.rows]);

  /**
   * Which department chip is lit.
   *
   * `null` and `undefined` mean different things — "including the unassigned" versus
   * "not filtering by department" — and they have to map to different chips, so
   * this cannot collapse to a single falsy check.
   */
  const activeDepartmentKey =
    directory.filters.departmentId === undefined
      ? 'all'
      : directory.filters.departmentId ?? UNASSIGNED_DEPARTMENT_KEY;
  const activeStatusKeys = directory.filters.statuses as readonly string[];

  const columns = useMemo<DataTableColumn<EmployeeListEntry>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        width: 2.2,
        sortable: true,
        primary: true,
        render: (entry) => (
          <View style={s.person}>
            <VStack gap={0.5} style={s.personText}>
              <Text variant="label" numberOfLines={1}>
                {employeeDisplayName(entry.employee)}
              </Text>
              <Text variant="caption" tone="tertiary" numberOfLines={1}>
                {entry.employee.job_title ?? entry.employee.email}
              </Text>
            </VStack>
          </View>
        ),
      },
      {
        key: 'code',
        header: 'Code',
        width: 0.9,
        render: (entry) => entry.employee.employee_code,
      },
      {
        key: 'department',
        header: 'Department',
        width: 1.4,
        sortable: true,
        render: (entry) => entry.departmentName ?? '—',
      },
      {
        key: 'manager',
        header: 'Reports to',
        width: 1.4,
        hideOnCompact: true,
        render: (entry) => entry.managerName ?? '—',
      },
      {
        key: 'status',
        header: 'Status',
        width: 1.1,
        sortable: true,
        render: (entry) => {
          const spec = employmentBadgeSpec(entry.employee.employment_status);
          return (
            <Badge
              label={EMPLOYMENT_STATUS_LABELS[entry.employee.employment_status]}
              intent={spec.intent}
              variant={spec.variant}
              size="sm"
            />
          );
        },
      },
      {
        key: 'joined',
        header: 'Joined',
        width: 1,
        sortable: true,
        hideOnCompact: true,
        render: (entry) =>
          entry.employee.joining_date === null ? '—' : formatDate(entry.employee.joining_date),
      },
    ],
    [s],
  );

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={directory.isRefreshing}
      onRefresh={() => {
        void directory.refresh();
      }}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
      loading={directory.isLoading && directory.rows.length === 0}
      loadingLabel="Loading your team"
    >
      <PageHeader
        title="Employees"
        description="Everyone on the books, and who they report to."
        breadcrumbs={deriveBreadcrumbs('/employees')}
        status={
          <HStack gap={2} align="center" wrap>
            {role === null ? null : (
              <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
            )}
            <Badge
              label={
                directory.summary.total === 0
                  ? 'No employees yet'
                  : countLabel(directory.summary.total, 'employee')
              }
              intent="neutral"
              variant="outline"
              size="sm"
            />
          </HStack>
        }
        primaryAction={
          canAddEmployee
            ? {
                label: 'Add employee',
                icon: 'add',
                variant: 'primary',
                onPress: () => {
                  setIsCreating(true);
                },
              }
            : undefined
        }
      />

      {/* ── Summary ──────────────────────────────────────────────────────────── */}
      <VStack gap={3} style={s.grid}>
        <MetricCard
          label="On the books"
          value={directory.isLoading && directory.rows.length === 0 ? '—' : formatNumber(directory.summary.total)}
          icon="employees"
          intent="accent"
          loading={directory.isLoading && directory.rows.length === 0}
          footnote="Every employee record, past and present"
          style={s.gridItem}
        />
        <MetricCard
          label="Currently working"
          value={formatNumber(directory.summary.current)}
          icon="team"
          footnote="Active, on probation or on leave"
          style={s.gridItem}
        />
        <MetricCard
          label="No manager"
          value={formatNumber(directory.summary.unmanaged)}
          icon="warning"
          intent={directory.summary.unmanaged === 0 ? 'neutral' : 'warning'}
          footnote={
            directory.summary.unmanaged === 0
              ? 'Everyone reports to somebody'
              : 'Including owners and the person who is nobody’s manager'
          }
          style={s.gridItem}
        />
        <MetricCard
          label="No department"
          value={formatNumber(directory.summary.unassigned)}
          icon="organization"
          footnote="Worth grouping before a resourcing view"
          style={s.gridItem}
        />
      </VStack>

      {/* ── Filters ──────────────────────────────────────────────────────────── */}
      <VStack gap={3}>
        <SearchBar
          value={directory.filters.search}
          onChangeText={setSearch}
          placeholder="Search by name, code, email or job title"
          accessibilityLabel="Search employees"
        />

        <FilterBar
          filters={departmentChips}
          activeKeys={[activeDepartmentKey]}
          onToggle={setDepartment}
          onClearAll={
            directory.hasActiveFilters
              ? () => {
                  directory.setFilters(NO_DIRECTORY_FILTERS);
                }
              : undefined
          }
        />

        {/* Status is its own row rather than a `Select`, because it is a MULTI-select
            and a dropdown that applies on change is the wrong control for that — you
            cannot see which statuses are currently narrowing the list without opening
            it. Chips show the active set at a glance, which is the thing a reader
            needs here. */}
        <FilterBar
          filters={statusChips}
          activeKeys={activeStatusKeys}
          onToggle={toggleStatus}
        />

        {directory.hasActiveFilters ? (
          <Text variant="caption" tone="tertiary">
            Showing {formatNumber(rows.length)} of {formatNumber(directory.summary.total)} employees.
          </Text>
        ) : null}
      </VStack>

      <Divider subtle />

      {/* ── The roster ───────────────────────────────────────────────────────── */}
      <DataTable
        columns={columns}
        rows={rows}
        keyExtractor={(entry) => entry.employee.id}
        {...(sort === undefined ? {} : { sort })}
        onSortChange={(next) => {
          setSort(next);
        }}
        loading={directory.isLoading && directory.rows.length === 0}
        error={directory.error ?? undefined}
        onRetry={() => {
          void directory.refresh();
        }}
        accessibilityLabel="Employees"
        emptyTitle={directory.hasActiveFilters ? 'No employees match' : 'No employees yet'}
        emptyDescription={
          directory.hasActiveFilters
            ? 'Try a different search, or clear the filters to see everyone.'
            : canAddEmployee
              ? 'Add the first person to start building your team. Accounts are separate — an employee does not need a sign-in.'
              : 'An administrator can add people to this organization.'
        }
        footer={
          <HStack gap={2} justify="space-between" align="center">
            <Text variant="caption" tone="tertiary">
              {directory.hasActiveFilters
                ? `${formatNumber(rows.length)} of ${formatNumber(directory.summary.total)}`
                : countLabel(directory.summary.total, 'employee')}
            </Text>
            {hasAtLeastRole(role, 'admin') ? null : (
              <Text variant="caption" tone="tertiary">
                Only administrators can add or edit employees
              </Text>
            )}
          </HStack>
        }
      />

      {/* ── Add employee ─────────────────────────────────────────────────────── */}
      <Modal
        visible={isCreating}
        onClose={() => {
          setIsCreating(false);
        }}
        title="Add employee"
        description="A person on the payroll. They do not need a sign-in to exist here."
        size="md"
        scrollable
      >
        <EmployeeCreateForm
          organizationId={organization?.id ?? ''}
          departments={directory.departmentList}
          existing={directory.rows}
          onCancel={() => {
            setIsCreating(false);
          }}
          onSaved={() => {
            setIsCreating(false);
            void directory.refresh();
          }}
        />
      </Modal>
    </ScreenContainer>
  );
}
