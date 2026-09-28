/**
 * Trackit X — workforce.
 *
 * What is true about the people in this organization, from data that exists:
 * how many are on the books, how many have access, how they are split by
 * employment state, and how they split across departments.
 *
 * ── What this screen refuses to claim ─────────────────────────────────────────
 * There are no shifts, hours, or wage-cost tables in this schema. "Workforce" is
 * tempting to build as attendance and payroll, and every figure any of those
 * would show would have to be invented. So this screen shows people only, and
 * says on-screen that the schedule modules are not built — the same honesty rule
 * the dashboard follows for the same reason.
 *
 * The access figure is a database count (`countMembers`), not the roster length:
 * someone can have a login without being a listed employee, and separating the
 * two is what keeps "who works here" and "who can get in" honest.
 */
import { useMemo } from 'react';

import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Card,
  createStyles,
  EmptyState,
  HStack,
  MetricCard,
  ScreenContainer,
  Text,
  useResponsive,
  useStyles,
  useTheme,
  VStack,
  seriesColor,
} from '@/design-system';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  isCurrentEmployee,
} from '@/domain/employee';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { DistributionList, type DistributionRow } from '@/features/dashboard/DistributionList';
import { useWorkforceSnapshot } from '@/features/dashboard/useWorkforceSnapshot';
import { employmentStatusColor } from '@/features/dashboard/palette';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { countLabel, formatNumber } from '@/utils/format';

const styles = createStyles((theme) => ({
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  metric: {
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
    flexBasis: 260,
  },
}));

export function WorkforceView() {
  const s = useStyles(styles);
  const theme = useTheme();
  const { sectionGap } = useResponsive();
  const { organization } = useOrganization();
  const organizationId = organization?.id ?? null;

  const directory = useEmployeeDirectory(organizationId);
  const access = useWorkforceSnapshot(organizationId);

  const rows = directory.rows;

  const current = useMemo(
    () => rows.filter((entry) => isCurrentEmployee(entry.employee.employment_status)).length,
    [rows],
  );

  const statusRows = useMemo<readonly DistributionRow[]>(
    () =>
      EMPLOYMENT_STATUSES.map((status) => {
        const value = rows.filter((entry) => entry.employee.employment_status === status).length;
        return {
          key: status,
          label: EMPLOYMENT_STATUS_LABELS[status],
          value,
          color: employmentStatusColor(theme, status),
          ...(value === 0 ? { muted: true } : {}),
        };
      }),
    [rows, theme],
  );

  /**
   * Department spread, drawn from the roster's own join.
   *
   * Colour is assigned by the department's position in a fixed per-render order
   * (size, then name) so a department's hue never depends on the order rows
   * happened to arrive in.
   */
  const departments = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of rows) {
      const key = entry.departmentName ?? 'No department';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const order = [...counts.keys()].sort((a, b) => {
      const byCount = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return byCount !== 0 ? byCount : a.localeCompare(b);
    });
    const rowsOut: DistributionRow[] = order.map((name) => ({
      key: name,
      label: name,
      value: counts.get(name) ?? 0,
      color: name === 'No department' ? theme.colors.neutral.fg : seriesColor(name, order, theme.chart.series),
    }));
    return rowsOut;
  }, [rows, theme]);

  const isLoaded = organizationId !== null && !directory.isLoading;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth={1000}
      refreshing={directory.isRefreshing}
      onRefresh={() => {
        void directory.refresh();
        void access.refresh();
      }}
    >
      <PageHeader
        title="Workforce"
        description="Who works here, by employment state."
        breadcrumbs={deriveBreadcrumbs('/workforce')}
      />

      <VStack style={s.metrics}>
        <MetricCard
          style={s.metric}
          label="On the books"
          value={directory.isLoading && !isLoaded ? '—' : formatNumber(current)}
          icon="team"
          intent="neutral"
          footnote="Active, probation and on leave"
        />
        <MetricCard
          style={s.metric}
          label="On record"
          value={isLoaded ? formatNumber(rows.length) : '—'}
          icon="employees"
          intent="neutral"
          footnote={countLabel(rows.length, 'person', 'people')}
        />
        <MetricCard
          style={s.metric}
          label="With access"
          value={access.status === 'ready' ? formatNumber(access.memberCount ?? 0) : '—'}
          icon="shield"
          intent="neutral"
          footnote="Login accounts on this organization"
        />
      </VStack>

      <VStack style={s.columns}>
        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                By employment state
              </Text>
              <Text variant="caption" tone="tertiary">
                {formatNumber(rows.length)} total
              </Text>
            </HStack>
            <DistributionList rows={statusRows} accessibilityLabel="Employees by employment state" />
          </VStack>
        </Card>

        <Card variant="glass" padding={4} style={s.column}>
          <VStack gap={3}>
            <HStack gap={2} justify="space-between" align="center">
              <Text variant="h4" tone="primary">
                By department
              </Text>
              <Text variant="caption" tone="tertiary">
                {formatNumber(rows.length)} total
              </Text>
            </HStack>
            {departments.length === 0 ? (
              <Text variant="caption" tone="tertiary">
                No people have been recorded yet.
              </Text>
            ) : (
              <DistributionList rows={departments} accessibilityLabel="Employees by department" />
            )}
          </VStack>
        </Card>
      </VStack>

      <Text variant="caption" tone="tertiary">
        This is a directory of people and their employment state. Shifts, hours,
        leave and wage cost are not part of the so-far-built data and are not
        shown or estimated here.
      </Text>

      {isLoaded && rows.length === 0 ? (
        <EmptyState
          inline
          variant="firstRun"
          icon="employees"
          title="No people recorded yet"
          description="Add the first employee from the People screen, and headcounts will appear here."
        />
      ) : null}
    </ScreenContainer>
  );
}