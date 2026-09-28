/**
 * Trackit X — reports.
 *
 * A dated copy of the workspace's figures, presented as a page. It reuses the
 * exact panels the dashboard renders — same snapshot, same derivations — so a
 * report and the dashboard can never disagree about a number.
 *
 * ── What a report is allowed to be here ───────────────────────────────────────
 * The schema keeps the current state of a row and no history, so this screen can
 * produce exactly one kind of report: a point-in-time count, stamped with the day
 * it was computed. There is deliberately no trend, no export, and no scheduled
 * run — a trend needs two points in time and an export needs a format nothing
 * here stands to gain — and the stamp below exists so a reader does not mistake a
 * figure for a running total.
 *
 * Modules like payroll and finance are not panels-with-missing-row on this page;
 * they are whole modules whose tables do not exist, and the destinations table
 * already says so in the navigation. Repeating that here would be noise.
 */
import { useMemo } from 'react';

import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Button,
  Card,
  createStyles,
  Divider,
  EmptyState,
  HStack,
  Icon,
  ScreenContainer,
  Text,
  useResponsive,
  useStyles,
  VStack,
} from '@/design-system';
import { canViewTeamWorkload } from '@/domain/dashboard';
import { DashboardLoading } from '@/features/dashboard/DashboardLoading';
import { DashboardOverview } from '@/features/dashboard/DashboardOverview';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { ProjectPanel } from '@/features/dashboard/ProjectPanel';
import { useDashboardSnapshot } from '@/features/dashboard/useDashboardSnapshot';
import { WorkPanel } from '@/features/dashboard/WorkPanel';
import { WorkloadPanel } from '@/features/dashboard/WorkloadPanel';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

const styles = createStyles((theme) => ({
  grow: {
    flex: 1,
  },
  stamp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
    paddingHorizontal: theme.space[3],
    paddingVertical: theme.space[2],
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.surfaceInset,
    borderWidth: 1,
    borderColor: theme.colors.borderSubtle,
  },
}));

export function ReportsView() {
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const dashboard = useDashboardSnapshot(organizationId, role);
  const { snapshot, status, error, isRefreshing, refresh } = dashboard;

  const hasBusinessData = useMemo(
    () =>
      snapshot !== null &&
      (snapshot.employees.total > 0 || snapshot.projects.total > 0 || snapshot.tasks.total > 0),
    [snapshot],
  );

  const showWorkload = canViewTeamWorkload(role) && snapshot?.workload != null;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={isRefreshing}
      onRefresh={() => {
        void refresh();
      }}
    >
      <PageHeader
        title="Reports"
        description="This workspace's figures, as of today."
        breadcrumbs={deriveBreadcrumbs('/reports')}
      />

      {status === 'loading' ? <DashboardLoading /> : null}

      {status === 'error' ? (
        <DashboardSection
          title="Could not read the figures"
          description="Nothing below is shown, because a partial count would be worse than no count."
          aside={
            <Button
              label="Retry"
              variant="ghost"
              size="sm"
              iconLeft="retry"
              onPress={() => {
                void refresh();
              }}
            />
          }
        >
          <Card variant="outline" intent="danger" padding={4}>
            <HStack gap={3} align="flex-start">
              <Icon name="warning" size="md" tone="danger" />
              <VStack gap={1} style={s.grow}>
                <Text variant="label">The figures did not load</Text>
                <Text variant="bodySm" tone="secondary">
                  {error ?? 'Something went wrong reaching the database. Trying again usually works.'}
                </Text>
              </VStack>
            </HStack>
          </Card>
        </DashboardSection>
      ) : null}

      {status === 'ready' && !hasBusinessData ? (
        <EmptyState
          icon="reports"
          title="Nothing to report yet"
          description="This workspace has no employees, projects, or tasks on record, so there are no figures to report. Add the first records and this page fills itself in — every number here is counted from your own records, never estimated."
        />
      ) : null}

      {status === 'ready' && hasBusinessData && snapshot !== null ? (
        <>
          <DashboardSection
            title="At a glance"
            description="Counted from your records, across this workspace only."
          >
            <VStack gap={3}>
              <DashboardOverview snapshot={snapshot} canViewWorkload={showWorkload} />
              {snapshot.asOf === null ? null : (
                <HStack gap={2} align="center" style={s.stamp}>
                  <Icon name="time" size="sm" tone="tertiary" />
                  <Text variant="caption" tone="tertiary" style={s.grow}>
                    Computed on {snapshot.asOf}, your time. This is a point-in-time
                    figure, not a running total — the schema stores current state, not
                    history, so there is no trend on this page.
                  </Text>
                </HStack>
              )}
            </VStack>
          </DashboardSection>

          <Divider subtle />

          <DashboardSection
            title="Projects"
            description="What is live, what state it is in, and what is going to be late."
          >
            <ProjectPanel snapshot={snapshot} />
          </DashboardSection>

          <Divider subtle />

          <DashboardSection
            title="Work"
            description="The task queue, and the two things in it that nobody is on."
          >
            <WorkPanel snapshot={snapshot} />
          </DashboardSection>

          {showWorkload ? (
            <>
              <Divider subtle />
              <DashboardSection
                title="Workload"
                description="How open work is spread across the people carrying it."
              >
                <WorkloadPanel snapshot={snapshot} />
              </DashboardSection>
            </>
          ) : null}
        </>
      ) : null}
    </ScreenContainer>
  );
}