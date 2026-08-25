/**
 * Trackit X — dashboard.
 *
 * ── The rule this screen is built around ────────────────────────────────────
 * Not one number on this screen is invented. Phase 1 has exactly two tables —
 * `organizations` and `organization_members` — so exactly one real business figure
 * exists: how many people have access to this workspace. That figure is read from
 * the database and shown. Everything else says, in words, that it is not built yet.
 *
 * The temptation here is obvious and worth naming: a dashboard with one number on it
 * looks unfinished, and filling the space with plausible revenue, a health score of
 * 78, and three AI insights would make it look finished in a screenshot. It would
 * also be the single most damaging thing this codebase could do — a business owner
 * who acts on a fabricated figure loses real money, and once they discover one
 * invented number they are right to distrust every other number in the product.
 *
 * So the sections are laid out in their final shape, and each one states what it
 * will show and what has to exist first. An empty frame is honest. A full one built
 * from nothing is not.
 */
import { useCallback } from 'react';

import { BOTTOM_BAR_CLEARANCE } from '@/components/navigation/AppShell';
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
  MetricCard,
  ScreenContainer,
  Text,
  useResponsive,
  useStyles,
  VStack,
} from '@/design-system';
import { BUSINESS_TYPE_LABELS, ROLE_LABELS } from '@/domain/organization';
import { DashboardSection } from '@/features/dashboard/DashboardSection';
import { useWorkforceSnapshot } from '@/features/dashboard/useWorkforceSnapshot';
import { countLabel, formatNumber } from '@/utils/format';
import { isBusinessType } from '@/domain/organization';

const styles = createStyles((theme) => ({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  gridItem: {
    // Two per row on a phone, three on a tablet, and the flex basis lets the last
    // item stretch rather than leaving a ragged gap.
    flexGrow: 1,
    flexBasis: 150,
  },
  grow: {
    flex: 1,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[3],
  },
}));

/**
 * The body of a section whose tables do not exist yet: what it will show, and the
 * one thing that has to be built first. No fake rows, no disabled buttons.
 */
function NotBuiltYet({
  icon,
  headline,
  detail,
}: {
  icon: 'projects' | 'tasks' | 'inventory' | 'aiInsight' | 'health';
  headline: string;
  detail: string;
}) {
  const s = useStyles(styles);

  return (
    <Card variant="outline" padding={4}>
      <VStack gap={2} style={s.pendingRow}>
        <HStack gap={3} align="flex-start">
          <Icon name={icon} size="md" tone="tertiary" />
          <VStack gap={1} style={s.grow}>
            <Text variant="label">{headline}</Text>
            <Text variant="bodySm" tone="secondary">
              {detail}
            </Text>
          </VStack>
        </HStack>
      </VStack>
    </Card>
  );
}

export default function DashboardScreen() {
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { displayName } = useAuth();
  const { organization, role, memberships, status: organizationStatus } = useOrganization();
  const workforce = useWorkforceSnapshot(organization?.id ?? null);

  const refresh = useCallback(async (): Promise<void> => {
    await workforce.refresh();
  }, [workforce]);

  const businessTypeLabel = isBusinessType(organization?.business_type)
    ? BUSINESS_TYPE_LABELS[organization.business_type]
    : null;

  return (
    <ScreenContainer
      edges={['top', 'bottom']}
      gap={sectionGap}
      maxWidth="none"
      refreshing={workforce.status === 'loading' && workforce.memberCount !== null}
      onRefresh={() => {
        void refresh();
      }}
      contentStyle={{ paddingBottom: BOTTOM_BAR_CLEARANCE }}
      loading={organizationStatus === 'loading' && organization === null}
      loadingLabel="Loading your dashboard"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <VStack gap={2}>
        <Text variant="bodySm" tone="tertiary">
          {displayName}
        </Text>
        <Text variant="h2">{organization?.name ?? 'Your business'}</Text>
        <HStack gap={2} align="center" wrap>
          {role === null ? null : (
            <Badge label={ROLE_LABELS[role]} intent="accent" variant="soft" size="sm" />
          )}
          {businessTypeLabel === null ? null : (
            <Badge label={businessTypeLabel} intent="neutral" variant="outline" size="sm" />
          )}
          {organization === null ? null : (
            <Badge label={organization.currency} intent="neutral" variant="outline" size="sm" />
          )}
        </HStack>
      </VStack>

      {/* ── 1. Business health ─────────────────────────────────────────────── */}
      <DashboardSection
        title="Business health"
        description="A single score across cash, delivery, workforce and stock."
        notBuilt="Not scored yet"
      >
        <NotBuiltYet
          icon="health"
          headline="No score can be computed yet"
          detail={
            'The score is a weighted read of finance, project delivery, attendance and ' +
            'inventory. None of those tables exist yet, and a score derived from nothing ' +
            'would be a number with no meaning — so there is none.'
          }
        />
      </DashboardSection>

      <Divider subtle />

      {/* ── 2. Today's focus ───────────────────────────────────────────────── */}
      <DashboardSection
        title="Today’s focus"
        description="The few things that need a decision from you today."
        notBuilt="Phase 2"
      >
        <NotBuiltYet
          icon="tasks"
          headline="Nothing to surface yet"
          detail={
            'This fills in from overdue tasks, approvals waiting on you, and projects ' +
            'drifting past their milestone dates once tasks and projects exist.'
          }
        />
      </DashboardSection>

      <Divider subtle />

      {/* ── 3. Active projects ─────────────────────────────────────────────── */}
      <DashboardSection
        title="Active projects"
        description="Live jobs with their budget and schedule position."
        notBuilt="Phase 2"
      >
        <NotBuiltYet
          icon="projects"
          headline="No projects table yet"
          detail={
            'Each card will show one project’s spend against budget and days against ' +
            'schedule, sorted so the one in trouble is first.'
          }
        />
      </DashboardSection>

      <Divider subtle />

      {/* ── 4. Workforce — the one section with real data ───────────────────── */}
      <DashboardSection
        title="Workforce"
        description="People with access to this workspace, counted in the database."
        aside={
          workforce.status === 'error' ? (
            <Button
              label="Retry"
              variant="ghost"
              size="sm"
              iconLeft="retry"
              onPress={() => {
                void refresh();
              }}
            />
          ) : undefined
        }
      >
        {workforce.status === 'error' ? (
          <Card variant="outline" intent="danger" padding={4}>
            <HStack gap={3} align="flex-start">
              <Icon name="warning" size="md" tone="danger" />
              <VStack gap={1} style={s.grow}>
                <Text variant="label">Could not read your team</Text>
                <Text variant="bodySm" tone="secondary">
                  {workforce.error?.userMessage ??
                    'Something went wrong. Trying again usually works.'}
                </Text>
              </VStack>
            </HStack>
          </Card>
        ) : (
          <VStack gap={3}>
            <VStack gap={3} style={s.grid}>
              <MetricCard
                label="People with access"
                value={
                  workforce.memberCount === null ? '—' : formatNumber(workforce.memberCount)
                }
                icon="team"
                intent="accent"
                loading={workforce.status === 'loading'}
                footnote={
                  workforce.memberCount === null
                    ? undefined
                    : countLabel(workforce.memberCount, 'member')
                }
                style={s.gridItem}
              />
              <MetricCard
                label="Workspaces you belong to"
                value={formatNumber(memberships.length)}
                icon="organization"
                footnote={memberships.length === 1 ? 'This one' : 'Switchable'}
                style={s.gridItem}
              />
            </VStack>

            <Text variant="caption" tone="tertiary">
              Employee records, attendance and wage cost arrive in Phase 2. Until then
              this counts accounts with access, which is not the same as headcount.
            </Text>
          </VStack>
        )}
      </DashboardSection>

      <Divider subtle />

      {/* ── 5. Inventory alerts ────────────────────────────────────────────── */}
      <DashboardSection
        title="Inventory alerts"
        description="Stock that is about to stop work."
        notBuilt="A later phase"
      >
        <NotBuiltYet
          icon="inventory"
          headline="No stock is being tracked"
          detail={
            'Alerts will come from items below reorder level, batches near expiry, and ' +
            'stock committed to a project that is not on hand.'
          }
        />
      </DashboardSection>

      <Divider subtle />

      {/* ── 6. AI insights ─────────────────────────────────────────────────── */}
      <DashboardSection
        title="AI insights"
        description="Observations drawn from your data — never invented."
        notBuilt="A later phase"
      >
        <VStack gap={3}>
          <NotBuiltYet
            icon="aiInsight"
            headline="The assistant has nothing to read yet"
            detail={
              'Insights are computed from your own records and every one shows what it ' +
              'was derived from. With two tables and no history there is nothing to draw ' +
              'a conclusion from, so none are shown.'
            }
          />
          <EmptyState
            variant="firstRun"
            icon="aiSpark"
            title="Insights need history"
            description="Once projects, tasks and attendance are recorded, this section fills itself in — with the data basis attached to every claim."
            inline
          />
        </VStack>
      </DashboardSection>
    </ScreenContainer>
  );
}
