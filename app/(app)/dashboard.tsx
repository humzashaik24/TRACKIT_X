/**
 * Trackit X — dashboard.
 *
 * ── What changed in Phase 34 ────────────────────────────────────────────────────
 * The previous version of this screen had exactly one real figure on it, because the
 * database had two tables. It now has fourteen and five data sources, so the same rule
 * that governed that version governs this one, at a hundred times the temptation:
 *
 *   Every number here is counted from a row that exists.
 *
 * `useDashboardSnapshot` reads `employees`, `projects` and `tasks` for the active
 * organization, counts `organization_members`, and hands the result to a pure function
 * that derives every figure on this screen. Nothing is entered by hand, nothing is
 * estimated, and nothing is sampled. The full derivation lives in
 * `src/features/dashboard/metrics.ts`, and `DashboardSnapshot` is the typed contract
 * that comes out of it — which is also the shape a later AI provider would consume,
 * should one ever be built. Building the contract now, with no provider behind it, is
 * the point: an assistant added later gets a verified summary to reason over rather
 * than a query it invented at runtime.
 *
 * ── What is deliberately absent, and the four questions behind it ───────────────
 * 1. NO TREND LINES AND NO DELTAS. A `MetricCard` here can draw a sparkline and a
 *    signed change. Neither is used, because a delta needs two points in time and this
 *    schema stores current state with no history. It is the most conspicuous omission
 *    on the screen and the most defensible.
 * 2. NO ACTIVITY FEED. There is no event log, so a feed would have to be inferred from
 *    row timestamps, which is a guess about what happened rather than a record of it.
 * 3. NO HEALTH SCORE, REVENUE, OR AI INSIGHT. Kept below as named `notBuilt` sections
 *    so the absence is visible and explained instead of looking like an oversight.
 * 4. NO WORKLOAD FOR MEMBERS. Counts of other people's open tasks are not shown to a
 *    non-manager. See `canViewTeamWorkload`.
 *
 * ── On the permission gate, precisely ───────────────────────────────────────────
 * `organization_members` is readable by any member of the organization — an owner is an
 * employee too, and reading that table is how a member sees their own headcount. So a
 * workload panel is not a second security boundary; it is a product decision about
 * whose attention a number is for. The honest version of that decision is to not render
 * the panel at all, with no lock icon and no "restricted" badge, rather than a
 * placeholder that invites a reader to wonder what they are not being shown.
 */
import { useCallback, useMemo } from 'react';

import { useRouter } from 'expo-router';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
import { PageHeader } from '@/components/navigation/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
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
import { BUSINESS_TYPE_LABELS, isBusinessType, ROLE_LABELS } from '@/domain/organization';
import { DashboardLoading } from '@/features/dashboard/DashboardLoading';
import { DashboardOverview } from '@/features/dashboard/DashboardOverview';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { ProjectPanel } from '@/features/dashboard/ProjectPanel';
import { useDashboardSnapshot } from '@/features/dashboard/useDashboardSnapshot';
import { WorkPanel } from '@/features/dashboard/WorkPanel';
import { WorkloadPanel } from '@/features/dashboard/WorkloadPanel';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import {
  destinationFor,
  type Destination,
  type DestinationPath,
} from '@/navigation/destinations';

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
  notBuiltGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  notBuiltItem: {
    flexGrow: 1,
    flexBasis: 260,
  },
}));

/**
 * The gaps worth naming on a dashboard, and only those.
 *
 * The sidebar already lists every unfinished destination, so repeating all twenty here
 * would be noise. This is the subset a business owner would reasonably expect to find on
 * a dashboard and cannot: the score, the money, the stock, and the assistant. Each one
 * is absent because a table it depends on does not exist, and saying so is more useful
 * than leaving a hole in the layout.
 *
 * The labels, summaries and phase names come from `destinations.ts` — the same table the
 * navigation is built from — so this cannot drift from the sidebar, and tapping a card
 * lands on the destination's own placeholder screen, which says the same thing in full.
 */
const DASHBOARD_GAPS: readonly DestinationPath[] = [
  '/business-health',
  '/finance',
  '/inventory',
  '/ai',
];

function NotBuiltYet({ destination }: { readonly destination: Destination }) {
  const s = useStyles(styles);
  const router = useRouter();

  return (
    <Card variant="outline" padding={4} style={s.notBuiltItem}>
      <HStack gap={3} align="flex-start">
        <Icon name={destination.icon} size="md" tone="tertiary" />
        <VStack gap={1} style={s.grow}>
          <HStack gap={2} align="center" wrap>
            <Text variant="label">{destination.longLabel}</Text>
            <Badge label={destination.arrivesIn} intent="warning" variant="soft" size="sm" />
          </HStack>
          <Text variant="bodySm" tone="secondary">
            {destination.summary}
          </Text>
          <Button
            label="See what is planned"
            variant="ghost"
            size="sm"
            iconRight="chevronRight"
            onPress={() => router.push(destination.path)}
          />
        </VStack>
      </HStack>
    </Card>
  );
}

export default function DashboardScreen() {
  const s = useStyles(styles);
  const router = useRouter();
  const { sectionGap } = useResponsive();
  const { displayName } = useAuth();
  const { organization, role, memberships, status: organizationStatus } = useOrganization();

  const organizationId = organization?.id ?? null;
  const dashboard = useDashboardSnapshot(organizationId, role);
  const { snapshot, status, error, isRefreshing, refresh } = dashboard;

  const onRefresh = useCallback((): void => {
    void refresh();
  }, [refresh]);

  const businessTypeLabel = isBusinessType(organization?.business_type)
    ? BUSINESS_TYPE_LABELS[organization.business_type]
    : null;

  /*
   * `role` is passed to the hook rather than resolved to a boolean here, so the rule
   * lives in one place — `canViewTeamWorkload` — and both the tile and the panel ask the
   * same question of the same function. A second `role === 'owner' || ...` written here
   * would be free to drift from it.
   */
  const showWorkload = canViewTeamWorkload(role) && snapshot?.workload != null;

  /*
   * "Empty" is the absence of business records, which is not the same as an
   * organization with no members. A workspace can have ten people on it and no projects
   * yet, and that is an empty dashboard rather than an empty company — so the test looks
   * at the three business tables and not at the header.
   */
  const hasBusinessData = useMemo(
    () =>
      snapshot !== null &&
      (snapshot.employees.total > 0 || snapshot.projects.total > 0 || snapshot.tasks.total > 0),
    [snapshot],
  );

  /*
   * The organization context is still resolving on a cold start. The snapshot cannot be
   * requested without an `organization_id`, so this is a distinct wait from the read
   * itself and gets the organization's own label rather than the dashboard's.
   */
  const waitingForOrganization = organizationStatus === 'loading' && organization === null;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={isRefreshing}
      onRefresh={onRefresh}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
      loading={waitingForOrganization}
      loadingLabel="Loading your dashboard"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title={organization?.name ?? 'Your business'}
        description={`Welcome back, ${displayName}.`}
        breadcrumbs={deriveBreadcrumbs('/dashboard')}
        status={
          <HStack gap={2} align="center" wrap>
            {role === null ? null : (
              <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
            )}
            {businessTypeLabel === null ? null : (
              <Badge label={businessTypeLabel} intent="neutral" variant="outline" size="sm" />
            )}
            {organization === null ? null : (
              <Badge
                label={organization.currency}
                intent="neutral"
                variant="outline"
                size="sm"
              />
            )}
          </HStack>
        }
      />

      {/*
       * Waiting on the three reads. `DashboardLoading` draws the page's real shape with
       * the values withheld, so the screen does not reshuffle when the snapshot lands.
       */}
      {waitingForOrganization || status === 'loading' ? <DashboardLoading /> : null}

      {/*
       * A read failed. The whole dashboard is one snapshot, so there is nothing partial
       * to show alongside it — a screen with the tiles filled in and the distributions
       * empty would look like a business with no projects, which is a claim, and a
       * false one. Retry is offered because these are ordinary table reads and the
       * common cause is a dropped connection.
       */}
      {status === 'error' ? (
        <DashboardSection
          title="Could not read your dashboard"
          description="Nothing below is shown, because a partial count would be worse than no count."
          aside={
            <Button
              label="Retry"
              variant="ghost"
              size="sm"
              iconLeft="retry"
              onPress={onRefresh}
            />
          }
        >
          <Card variant="outline" intent="danger" padding={4}>
            <HStack gap={3} align="flex-start">
              <Icon name="warning" size="md" tone="danger" />
              <VStack gap={1} style={s.grow}>
                <Text variant="label">The figures did not load</Text>
                <Text variant="bodySm" tone="secondary">
                  {error ??
                    'Something went wrong reaching the database. Trying again usually works.'}
                </Text>
              </VStack>
            </HStack>
          </Card>
        </DashboardSection>
      ) : null}

      {/* ── No business records yet ────────────────────────────────────────── */}
      {status === 'ready' && !hasBusinessData ? (
        <EmptyState
          icon="organization"
          title="No business records yet"
          description={
            memberships.length > 1
              ? `This workspace has no employees, projects, or tasks. If you were expecting figures, you may be in the wrong workspace — you belong to ${
                  memberships.length - 1
                } others.`
              : 'This workspace has no employees, projects, or tasks yet. Add the first one and this page fills itself in — every figure here is counted from your own records, never estimated.'
          }
          action={
            memberships.length > 1
              ? {
                  label: 'Switch workspace',
                  onPress: () => router.push('/organizations'),
                }
              : { label: 'Go to projects', onPress: () => router.push('/projects') }
          }
        />
      ) : null}

      {/* ── The real dashboard ─────────────────────────────────────────────── */}
      {status === 'ready' && hasBusinessData && snapshot !== null ? (
        <>
          <DashboardSection
            title="At a glance"
            description="Counted from your records, across this workspace only."
            aside={
              <Button
                label="Refresh"
                variant="ghost"
                size="sm"
                iconLeft="retry"
                onPress={onRefresh}
              />
            }
          >
            <VStack gap={3}>
              <DashboardOverview snapshot={snapshot} canViewWorkload={showWorkload} />
              {/*
               * The as-of line, and a note that it is local time.
               *
               * Every figure above is a count of rows as they stand the moment the
               * snapshot is built, and "as of" is what stops a number being read as a
               * running total that updates itself. `todayKey` is derived in the
               * organization context's timezone, so a user in a different timezone from
               * the workspace owner sees their own day — which matters, because
               * "overdue" was computed against that same key and mixing the two would
               * make a task overdue by one day for one reader and not the other.
               */}
              {snapshot.asOf === null ? null : (
                <HStack gap={2} align="center" style={s.stamp}>
                  <Icon name="time" size="sm" tone="tertiary" />
                  <Text variant="caption" tone="tertiary" style={s.grow}>
                    As of {snapshot.asOf} your time. Pull down to recount.
                  </Text>
                </HStack>
              )}
            </VStack>
          </DashboardSection>

          <Divider subtle />

          {/* ── Projects ───────────────────────────────────────────────────── */}
          <DashboardSection
            title="Projects"
            description="What is live, what state it is in, and what is going to be late."
          >
            <ProjectPanel snapshot={snapshot} />
          </DashboardSection>

          <Divider subtle />

          {/* ── Work ───────────────────────────────────────────────────────── */}
          <DashboardSection
            title="Work"
            description="The task queue, and the two things in it that nobody is on."
          >
            <WorkPanel snapshot={snapshot} />
          </DashboardSection>

          {/* ── Workload ────────────────────────────────────────────────────── */}
          {/*
           * Rendered for a manager only, and rendered wholly or not at all. There is no
           * locked state and no "you do not have access" copy: a member is not being
           * denied a feature, they are being shown a dashboard suited to their job, and
           * a panel that announced its own absence would invite the question of what it
           * was hiding.
           */}
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

      {/*
       * ── Not built yet ──────────────────────────────────────────────────────
       * Below the real figures, not above them, so the dashboard leads with what is
       * true. Each card links to its own placeholder screen, which carries the full
       * explanation — so this section is a signpost rather than a second copy.
       */}
      {status === 'ready' ? (
        <>
          <Divider subtle />
          <DashboardSection
            title="Not built yet"
            description="Named here so their absence is deliberate rather than an oversight."
            notBuilt="Later phases"
          >
            <VStack style={s.notBuiltGrid}>
              {DASHBOARD_GAPS.map((path) => (
                <NotBuiltYet key={path} destination={destinationFor(path)} />
              ))}
            </VStack>
          </DashboardSection>
        </>
      ) : null}
    </ScreenContainer>
  );
}
