/**
 * Trackit X — workspaces.
 *
 * The full-page answer to the header's workspace switch, and the screen the
 * dashboard's "Switch workspace" points at. Two things are true-of-the-data here:
 *
 *  · WHICH ORGANIZATIONS THE USER BELONGS TO, and which one queries are scoped to.
 *    This is the same membership list the header switch draws, so the two can
 *    never disagree about what is switchable.
 *  · WHO HAS ACCESS TO THE ACTIVE WORKSPACE, straight from
 *    `organization_members`. Names are not shown because this phase's schema
 *    joins no profile table onto the membership — the rows are roles and dates,
 *    and presenting them as more would be inventing data.
 *
 * It does not contain a create form. Creating a workspace is an onboarding act
 * with its own RPC (`create_organization`), and the router only lands a user in
 * onboarding when they have no memberships — so a create widget here would be a
 * button nobody should ever need.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { PageHeader } from '@/components/navigation/PageHeader';
import { membershipChoices } from '@/components/navigation/OrganizationSwitcher';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
  Button,
  Card,
  createStyles,
  DataTable,
  HStack,
  Icon,
  MetricCard,
  ScreenContainer,
  Text,
  useResponsive,
  useStyles,
  VStack,
  type DataTableColumn,
} from '@/design-system';
import { BUSINESS_TYPE_LABELS, ROLE_LABELS } from '@/domain/organization';
import { useWorkforceSnapshot } from '@/features/dashboard/useWorkforceSnapshot';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import * as organizations from '@/services/organizationService';
import { userMessage } from '@/utils/errors';
import { countLabel, formatDate, formatNumber } from '@/utils/format';
import type { AppError } from '@/utils/errors';
import type { OrganizationMemberRow } from '@/types/database';

const styles = createStyles((theme) => ({
  rows: {
    gap: theme.space[3],
  },
  membership: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[3],
    padding: theme.space[4],
  },
  membershipText: {
    flex: 1,
    minWidth: 0,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[3],
  },
  metric: {
    flexGrow: 1,
    flexBasis: 150,
  },
  detail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  detailItem: {
    flexGrow: 1,
    flexBasis: 140,
    gap: theme.space[1],
  },
}));

/** A fact in the organization's details grid. */
function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  const s = useStyles(styles);
  return (
    <VStack gap={1} style={s.detailItem}>
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
      <Text variant="bodySm">{children}</Text>
    </VStack>
  );
}

export function OrganizationsView() {
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { memberships, organization, role, selectOrganization } = useOrganization();
  const activeId = organization?.id ?? null;

  const choices = membershipChoices(memberships, activeId);
  const access = useWorkforceSnapshot(activeId);
  const rosters = useOrganizationMembers(activeId);

  const memberColumns = useMemo<readonly DataTableColumn<OrganizationMemberRow>[]>(
    () => [
      {
        key: 'role',
        header: 'Role',
        width: 1,
        primary: true,
        render: (row) => ROLE_LABELS[row.role],
      },
      {
        key: 'joined',
        header: 'Joined',
        width: 1,
        render: (row) => formatDate(row.created_at.slice(0, 10)),
      },
      {
        key: 'permissions',
        header: 'Extra grants',
        width: 2,
        render: (row) => (row.permissions.length === 0 ? '—' : row.permissions.join(', ')),
      },
    ],
    [],
  );

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth={900}
      refreshing={rosters.isRefreshing}
      onRefresh={() => {
        void rosters.refresh();
      }}
    >
      <PageHeader
        title="Workspaces"
        description="The businesses you belong to, and the one you are working in."
        breadcrumbs={deriveBreadcrumbs('/organizations')}
      />

      <VStack gap={3}>
        <Text variant="label">Your workspaces</Text>
        <VStack style={s.rows}>
          {choices.length === 0 ? (
            <Card padding={4}>
              <Text variant="bodySm" tone="tertiary">
                No workspaces yet. Creating one is part of onboarding.
              </Text>
            </Card>
          ) : (
            choices.map((choice) => (
              <Card key={choice.id} padding={0}>
                <HStack gap={3} align="center" style={s.membership}>
                  <Icon
                    name="organization"
                    size="md"
                    tone={choice.active ? 'accent' : 'secondary'}
                  />
                  <VStack style={s.membershipText}>
                    <Text variant="body" tone="primary" numberOfLines={1}>
                      {choice.name}
                    </Text>
                    <Text variant="caption" tone="tertiary" numberOfLines={1}>
                      {choice.roleLabel}
                    </Text>
                  </VStack>
                  {choice.active ? (
                    <Badge label="Active" intent="accent" variant="soft" size="sm" />
                  ) : (
                    <Button
                      label="Make active"
                      variant="secondary"
                      size="sm"
                      onPress={() => selectOrganization(choice.id)}
                    />
                  )}
                </HStack>
              </Card>
            ))
          )}
        </VStack>
      </VStack>

      {organization === null ? null : (
        <VStack gap={3}>
          <Text variant="label">Current workspace</Text>
          <Card padding={4}>
            <VStack gap={4}>
              <View style={s.detail}>
                <Fact label="Name">{organization.name}</Fact>
                <Fact label="Business type">
                  {BUSINESS_TYPE_LABELS[organization.business_type]}
                </Fact>
                <Fact label="Timezone">{organization.timezone}</Fact>
                <Fact label="Currency">{organization.currency}</Fact>
              </View>
              <Text variant="caption" tone="tertiary">
                Timezone and currency are the authoritative ones for any
                schedule and payroll modules. Your role here is{' '}
                {role === null ? 'unknown' : ROLE_LABELS[role]}.
              </Text>
            </VStack>
          </Card>
        </VStack>
      )}

      <VStack gap={3}>
        <Text variant="label">Who has access</Text>

        <VStack style={s.metrics}>
          <MetricCard
            style={s.metric}
            label="With access"
            value={access.status === 'ready' ? formatNumber(access.memberCount ?? 0) : '—'}
            icon="shield"
            intent="neutral"
            footnote="Login accounts on this workspace"
          />
        </VStack>

        <DataTable
          columns={memberColumns}
          rows={rosters.rows}
          keyExtractor={(row) => row.id}
          loading={rosters.isLoading}
          loadingRows={2}
          error={rosters.error ?? undefined}
          onRetry={() => {
            void rosters.refresh();
          }}
          emptyTitle="No members on record"
          emptyDescription="That is unexpected for a workspace you can see."
          accessibilityLabel="Workspace members"
          scrollEnabled
        />

        <Text variant="caption" tone="tertiary">
          {countLabel(rosters.rows.length, 'membership', 'memberships')} visible. Names are
          not shown here — a profile join is not part of the current schema, so
          each row is a role and a date, honestly.
        </Text>
      </VStack>
    </ScreenContainer>
  );
}

interface MemberLoad {
  readonly organizationId: string | null;
  readonly rows: readonly OrganizationMemberRow[];
  readonly error: AppError | null;
}

const NO_MEMBERS: readonly OrganizationMemberRow[] = [];
const UNREAD: MemberLoad = { organizationId: null, rows: NO_MEMBERS, error: null };

/**
 * The members of one organization, tagged with the organization they were read
 * for — the same tenant-tag discipline as the other reads in this app, so a
 * roster for the previous workspace never renders under the new one.
 */
function useOrganizationMembers(organizationId: string | null) {
  const [load, setLoad] = useState<MemberLoad>(UNREAD);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;
    void organizations.listMembers(organizationId).then((result) => {
      if (cancelled) return;
      setLoad({
        organizationId,
        rows: result.ok ? result.value : NO_MEMBERS,
        error: result.ok ? null : result.error,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;
    setIsRefreshing(true);
    try {
      const result = await organizations.listMembers(organizationId);
      setLoad((current) =>
        current.organizationId !== organizationId
          ? current
          : {
              organizationId,
              rows: result.ok ? result.value : current.rows,
              error: result.ok ? null : result.error,
            },
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  const isCurrent = load.organizationId === organizationId;
  return {
    rows: isCurrent ? load.rows : NO_MEMBERS,
    error: isCurrent ? (load.error === null ? null : userMessage(load.error)) : null,
    isLoading: organizationId !== null && !isCurrent,
    isRefreshing,
    refresh,
  };
}