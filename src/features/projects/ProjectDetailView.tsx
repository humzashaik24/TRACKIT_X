/**
 * Trackit X — one project.
 *
 * The list screen can now point at a project, and this route is where the pointer
 * lands. It is read-only on purpose: the answer it gives ("who owns this, what is
 * its state, who is on it") is the question a project link is usually answering.
 * Writing — editing, team changes, ownership changes — is real feature work with
 * permission gates of its own, and a link from a list must not silently grow an
 * editing surface no list asked for.
 *
 * The owner's name travels ON the project entry (`useProjectList` resolves it in
 * the join), so the header can name the accountable person without a second read.
 * The members are a separate read, keyed on the same project id, because a team
 * that loads after the project must not make the project itself appear slow.
 */
import { useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { PageHeader } from '@/components/navigation/PageHeader';
import {
  Badge,
  Card,
  createStyles,
  DataTable,
  EmptyState,
  HStack,
  ProgressBar,
  ScreenContainer,
  Text,
  useResponsive,
  useStyles,
  VStack,
  type DataTableColumn,
} from '@/design-system';
import {
  PROJECT_MEMBER_ROLE_LABELS,
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_LABELS,
  isOverdue,
} from '@/domain/project';
import { progressToRatio } from '@/domain/progress';
import { useProjectDetail, type ProjectMemberEntry } from '@/features/projects/useProjects';
import { projectBadgeSpec } from '@/features/shared/statusBadges';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { formatDate, formatNumber } from '@/utils/format';

const styles = createStyles((theme) => ({
  facts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[4],
  },
  fact: {
    flexGrow: 1,
    flexBasis: 130,
    gap: theme.space[1],
  },
  barValue: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
}));

/** One label/value pair in the summary grid. Hooks its own styles so call sites read. */
function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  const s = useStyles(styles);
  return (
    <VStack gap={1} style={s.fact}>
      <Text variant="caption" tone="tertiary">
        {label}
      </Text>
      {children}
    </VStack>
  );
}

export function ProjectDetailView() {
  const router = useRouter();
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const projectId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;

  const detail = useProjectDetail(projectId);
  const entry = detail.project;
  const project = entry?.project ?? null;

  const memberColumns = useMemo<readonly DataTableColumn<ProjectMemberEntry>[]>(
    () => [
      {
        key: 'name',
        header: 'Name',
        width: 3,
        primary: true,
        render: (row) => row.employeeName,
      },
      {
        key: 'role',
        header: 'Role',
        width: 2,
        render: (row) => PROJECT_MEMBER_ROLE_LABELS[row.membership.role],
      },
      {
        key: 'allocation',
        header: 'Allocation',
        width: 1,
        numeric: true,
        render: (row) => `${formatNumber(row.membership.allocation_percent)}%`,
      },
    ],
    [],
  );

  // ── States that replace the body ────────────────────────────────────────────
  if (projectId === null) {
    return (
      <ScreenContainer edges={['bottom']} gap={sectionGap}>
        <PageHeader title="Project" breadcrumbs={deriveBreadcrumbs('/projects')} />
        <EmptyState
          variant="noResults"
          icon="projects"
          title="No project was named"
          description="That address does not include a project id."
          action={{
            label: 'Back to projects',
            onPress: () => {
              router.replace('/projects');
            },
          }}
        />
      </ScreenContainer>
    );
  }

  if (detail.notFound) {
    return (
      <ScreenContainer edges={['bottom']} gap={sectionGap}>
        <PageHeader title="Project" breadcrumbs={deriveBreadcrumbs(`/projects/${projectId}`)} />
        <EmptyState
          variant="noResults"
          icon="projects"
          title="That project is not here"
          description="It may have been deleted, or it may belong to an organization you are not in."
          action={{
            label: 'Back to projects',
            onPress: () => {
              router.replace('/projects');
            },
          }}
        />
      </ScreenContainer>
    );
  }

  if (project === null) {
    return (
      <ScreenContainer
        edges={['bottom']}
        gap={sectionGap}
        refreshing={detail.isRefreshing}
        onRefresh={() => {
          void detail.refresh();
        }}
        loading={detail.isLoading}
        loadingLabel="Loading the project"
        error={detail.error ?? undefined}
        onRetry={() => {
          void detail.refresh();
        }}
      >
        <PageHeader title="Project" breadcrumbs={deriveBreadcrumbs(`/projects/${projectId}`)} />
      </ScreenContainer>
    );
  }

  const statusSpec = projectBadgeSpec(project.status);
  const overdue = isOverdue(project, detail.today);
  const ownerLine =
    entry === null
      ? 'No owner'
      : entry.ownerName === null
        ? 'No owner claimed'
        : `Owned by ${entry.ownerName}`;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth={900}
      refreshing={detail.isRefreshing}
      onRefresh={() => {
        void detail.refresh();
      }}
    >
      <PageHeader
        title={project.name}
        description={ownerLine}
        breadcrumbs={deriveBreadcrumbs(`/projects/${projectId}`)}
        status={
          <HStack gap={2} align="center" wrap>
            <Badge
              label={PROJECT_STATUS_LABELS[project.status]}
              intent={statusSpec.intent}
              variant={statusSpec.variant}
              size="sm"
            />
            {overdue && project.status !== 'completed' && project.status !== 'cancelled' ? (
              <Badge label="Past target" intent="danger" variant="soft" size="sm" />
            ) : null}
          </HStack>
        }
      />

      <Card>
        <VStack gap={4}>
          <View style={s.facts}>
            <Fact label="Status">
              <Text variant="bodySm">{PROJECT_STATUS_LABELS[project.status]}</Text>
            </Fact>
            <Fact label="Priority">
              <Text variant="bodySm">{PROJECT_PRIORITY_LABELS[project.priority]}</Text>
            </Fact>
            <Fact label="Owner">
              <Text variant="bodySm" tone={entry?.ownerName === null ? 'tertiary' : 'primary'}>
                {entry?.ownerName ?? 'Unclaimed'}
              </Text>
            </Fact>
            <Fact label="Started">
              <Text variant="bodySm">
                {project.start_date === null ? 'Not set' : formatDate(project.start_date)}
              </Text>
            </Fact>
            <Fact label="Target">
              <Text variant="bodySm" tone={overdue ? 'danger' : 'primary'}>
                {project.target_date === null ? 'Not set' : formatDate(project.target_date)}
              </Text>
            </Fact>
          </View>

          <VStack gap={1.5}>
            <View style={s.barValue}>
              <Text variant="caption" tone="tertiary">
                Progress
              </Text>
              <Text variant="caption" tone="secondary">
                {`${formatNumber(project.progress)}%`}
              </Text>
            </View>
            <ProgressBar
              value={progressToRatio(project.progress)}
              intent={project.progress === 100 ? 'success' : 'accent'}
              label="Project progress"
            />
            <Text variant="caption" tone="tertiary">
              A figure set by the owner, not derived from its tasks.
            </Text>
          </VStack>

          {project.description === null || project.description === '' ? null : (
            <VStack gap={1.5}>
              <Text variant="caption" tone="tertiary">
                Description
              </Text>
              <Text variant="bodySm">{project.description}</Text>
            </VStack>
          )}
        </VStack>
      </Card>

      <VStack gap={3}>
        <HStack justify="space-between" align="baseline">
          <Text variant="label">Team</Text>
          <Text variant="caption" tone="secondary">
            {`${formatNumber(detail.members.length)} ${detail.members.length === 1 ? 'member' : 'members'}`}
          </Text>
        </HStack>

        <DataTable
          columns={memberColumns}
          rows={detail.members}
          keyExtractor={(row) => row.membership.id}
          loading={detail.isLoading}
          loadingRows={2}
          emptyTitle="Nobody is on this project yet"
          emptyDescription="A team that works on it has not been added."
          accessibilityLabel="Project members"
          scrollEnabled
        />
      </VStack>

      <Text variant="caption" tone="tertiary">
        {overdue && project.status !== 'completed' && project.status !== 'cancelled'
          ? 'This project is past its target date but still open.'
          : project.status === 'completed'
            ? 'Marked complete. The progress and targets above are the recorded ones.'
            : 'Allocation is a share of working time, set per member.'}
      </Text>
    </ScreenContainer>
  );
}