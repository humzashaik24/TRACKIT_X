/**
 * Trackit X — one task.
 *
 * Read, move, reassign, edit, delete — the whole life of a work item on one screen.
 *
 * ── Why this screen is a screen and not a modal ───────────────────────────────
 * A task is the one record in this app with a lifecycle. A person opens it, moves it
 * along, comes back to it tomorrow, and needs the back button to return to the list
 * they were triaging. A modal cannot be linked to, which means "send me the task" has
 * nowhere to point.
 *
 * ── Why the three inline writes are separate from the edit form ───────────────
 * Status, progress and assignee are the three things somebody changes while reading
 * the task, and all three are one field each. Putting them behind "Edit" would mean
 * opening a form to move a task from To do to In progress, and the most common action
 * in the app would become the most cumbersome. Each writes immediately and shows its
 * own pending state; the edit form is for the things that need typing.
 *
 * The split is also why `useTaskActions` exists rather than each control calling
 * `updateTask` directly — see its header for the tenant guard every write shares.
 *
 * ── Why the two draft-holding pieces are keyed components ────────────────────
 * The edit form and the progress box hold a DRAFT that starts as a copy of the task.
 * Seeding that copy in an effect means a second render after the first, and a form that
 * briefly shows last task's values. Instead each is its own component with a `key` of
 * the task id: React discards the instance when the id changes and the `useState`
 * initialisers run once against the new task. No effect, no flash, and no chance of
 * the two disagreeing.
 */
import { useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import {
  Badge,
  Button,
  Card,
  createStyles,
  Divider,
  EmptyState,
  ErrorState,
  HStack,
  Icon,
  Input,
  Modal,
  ProgressBar,
  ScreenContainer,
  Select,
  Text,
  useResponsive,
  useStyles,
  VStack,
  type SelectOption,
} from '@/design-system';
import { employeeDisplayName } from '@/domain/employee';
import { impliedProgressForTaskStatus, progressToRatio } from '@/domain/progress';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_DESCRIPTIONS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  canAssignTaskTo,
  canDeleteTasks,
  canEditTask,
  daysUntilDue,
  isTaskOverdue,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/task';
import { validateForm, type FieldErrors } from '@/features/auth/schema';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { useProjectList } from '@/features/projects/useProjects';
import { updateTaskSchema, type UpdateTaskInput } from '@/features/tasks/schema';
import { taskBadgeSpec } from '@/features/shared/statusBadges';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import { useCurrentEmployeeId, useTaskDetail } from '@/features/tasks/useTasks';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';
import { userMessage } from '@/utils/errors';
import { formatDate, formatNumber } from '@/utils/format';
import type { ActionResult } from '@/utils/result';
import type { TaskRow } from '@/types/database';

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
  fieldPair: {
    gap: theme.space[3],
  },
  half: {
    flex: 1,
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

// ---------------------------------------------------------------------------
// The edit form. Keyed by task id by its only caller.
// ---------------------------------------------------------------------------

interface TaskEditCardProps {
  readonly task: TaskRow;
  readonly organizationId: string | null;
  readonly projects: readonly SelectOption[];
  readonly onCancel: () => void;
  readonly onSaved: () => Promise<void>;
}

function TaskEditCard({
  task,
  organizationId,
  projects,
  onCancel,
  onSaved,
}: TaskEditCardProps) {
  const actions = useTaskActions(organizationId);
  const s = useStyles(styles);

  // Seeded from the task's own fields. `task` here is fixed for this instance's life —
  // the parent keys the component on the id — so a refresh cannot move the cursor out
  // of a field somebody is typing in.
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [projectId, setProjectId] = useState<string | null>(task.project_id);
  const [priority, setPriority] = useState<TaskPriority | null>(task.priority);
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<UpdateTaskInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const priorityOptions = useMemo<SelectOption<TaskPriority>[]>(
    () => TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] })),
    [],
  );

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(updateTaskSchema, {
      title,
      description,
      projectId: projectId ?? '',
      priority: priority ?? undefined,
      dueDate,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    const result = await actions.update(task.id, {
      title: parsed.values.title ?? task.title,
      description: parsed.values.description ?? null,
      projectId: parsed.values.projectId ?? null,
      ...(parsed.values.priority === undefined ? {} : { priority: parsed.values.priority }),
      dueDate: parsed.values.dueDate ?? null,
    });

    if (result.ok) {
      await onSaved();
      return;
    }
    setFormError(userMessage(result.error));
  }, [actions, task, title, description, projectId, priority, dueDate, onSaved]);

  return (
    <Card>
      <VStack gap={4}>
        {formError === undefined ? null : (
          <>
            <Text variant="bodySm" tone="danger">
              {formError}
            </Text>
            <Divider subtle />
          </>
        )}

        <Input
          label="Task"
          value={title}
          onChangeText={setTitle}
          error={fieldErrors.title}
          maxLength={200}
          showCounter
          required
        />

        <Input
          label="Description"
          value={description}
          onChangeText={setDescription}
          error={fieldErrors.description}
          multiline
          numberOfLines={5}
        />

        <Select
          label="Project"
          options={projects}
          value={projectId}
          onChange={setProjectId}
          onClear={() => {
            setProjectId(null);
          }}
          placeholder="No project"
          clearable
          searchable
          error={fieldErrors.projectId}
        />

        <HStack gap={3} align="flex-start" style={s.fieldPair}>
          <VStack gap={1} style={s.half}>
            <Select<TaskPriority>
              label="Priority"
              options={priorityOptions}
              value={priority}
              onChange={setPriority}
              error={fieldErrors.priority}
            />
          </VStack>
          <VStack gap={1} style={s.half}>
            <Input
              label="Due date"
              value={dueDate}
              onChangeText={setDueDate}
              error={fieldErrors.dueDate}
              placeholder="YYYY-MM-DD"
            />
          </VStack>
        </HStack>

        <HStack gap={2} justify="flex-end">
          <Button label="Cancel" variant="ghost" disabled={actions.isSubmitting} onPress={onCancel} />
          <Button
            label={actions.isSubmitting ? 'Saving…' : 'Save changes'}
            variant="primary"
            loading={actions.isSubmitting}
            disabled={actions.isSubmitting}
            onPress={() => {
              void submit();
            }}
          />
        </HStack>
      </VStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The progress box. Also keyed by task id.
// ---------------------------------------------------------------------------

function TaskProgressControl({
  task,
  organizationId,
  onSaved,
}: {
  readonly task: TaskRow;
  readonly organizationId: string | null;
  readonly onSaved: () => Promise<void>;
}) {
  const actions = useTaskActions(organizationId);
  const [draft, setDraft] = useState(String(task.progress));
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  const save = useCallback(async (): Promise<void> => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      setFieldError('Enter a whole number between 0 and 100.');
      return;
    }
    if (parsed < 0 || parsed > 100) {
      setFieldError('Enter a number between 0 and 100.');
      return;
    }
    setFieldError(undefined);
    const result = await actions.setProgress(task.id, parsed);
    if (result.ok) {
      await onSaved();
    }
  }, [actions, task, draft, onSaved]);

  return (
    <VStack gap={1.5}>
      <Input
        label="Progress"
        value={draft}
        onChangeText={setDraft}
        keyboardType="number-pad"
        editable={!actions.isSubmitting}
        error={fieldError}
        helperText="0–100, as a whole number."
      />
      <HStack gap={2} justify="flex-end">
        <Button
          label="Save progress"
          variant="secondary"
          disabled={actions.isSubmitting}
          loading={actions.pending === 'setProgress'}
          onPress={() => {
            void save();
          }}
        />
      </HStack>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// The screen.
// ---------------------------------------------------------------------------

export function TaskDetailView() {
  const router = useRouter();
  const s = useStyles(styles);
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const taskId = typeof rawId === 'string' && rawId.length > 0 ? rawId : null;

  const detail = useTaskDetail(organizationId, taskId);
  const currentEmployeeId = useCurrentEmployeeId(organizationId);
  const directory = useEmployeeDirectory(organizationId);
  const projects = useProjectList(organizationId);
  const actions = useTaskActions(organizationId);

  const [actionError, setActionError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const task = detail.task?.task ?? null;

  const mayEdit = task === null ? false : canEditTask(task, { role, currentEmployeeId });
  const mayDelete = canDeleteTasks(role);
  const statusSpec = task === null ? null : taskBadgeSpec(task.status);
  const overdue = task === null ? false : isTaskOverdue(task, detail.today);
  const implied = task === null ? null : impliedProgressForTaskStatus(task.status);

  const projectOptions = useMemo<SelectOption[]>(
    () =>
      projects.rows.map((entry) => ({
        value: entry.project.id,
        label: entry.project.name,
        description: entry.ownerName === null ? 'No owner' : entry.ownerName,
      })),
    [projects.rows],
  );

  /**
   * The same filter the create form uses, for the same reason: a member is offered
   * themselves and nobody, and anybody else is absent rather than present and refused.
   *
   * The currently-assigned person is always offered, even where the rule would exclude
   * them. Otherwise a member looking at a task assigned to a colleague would see an
   * assignee picker that does not contain the person it is displaying, which reads as a
   * data bug rather than as a permission.
   */
  const assigneeOptions = useMemo<SelectOption[]>(
    () =>
      directory.rows
        .filter(
          (entry) =>
            entry.employee.id === task?.assignee_id ||
            canAssignTaskTo(role, currentEmployeeId, entry.employee.id),
        )
        .map((entry) => ({
          value: entry.employee.id,
          label: employeeDisplayName(entry.employee),
          description: entry.employee.job_title ?? entry.departmentName ?? undefined,
        })),
    [directory.rows, role, currentEmployeeId, task?.assignee_id],
  );

  const statusOptions = useMemo<SelectOption<TaskStatus>[]>(
    () =>
      TASK_STATUSES.map((value) => ({
        value,
        label: TASK_STATUS_LABELS[value],
        description: TASK_STATUS_DESCRIPTIONS[value],
      })),
    [],
  );

  /*
   * Names, resolved from the two reads this screen already makes.
   *
   * `getTask` returns the task row alone, so `useTaskDetail` hands over null names and
   * the alternative was a joined read purely for two strings. But the project and
   * assignee pickers need both rosters regardless, so this screen already holds them,
   * and resolving here means the header, the summary row and the picker are all reading
   * the SAME list. A separate join could disagree with the picker — "assigned to Farah"
   * above a menu with no Farah in it — and that is a worse bug than a null.
   *
   * The "not in the list" case is separated from the "no value" case on purpose. An
   * inactive employee is still somebody the task names, and reporting them as
   * "Unassigned" would state that nobody owns work that has an owner. Each falls back to
   * a different sentence so the two are never confused.
   */
  const projectNameById = useMemo(
    () => new Map(projects.rows.map((entry) => [entry.project.id, entry.project.name])),
    [projects.rows],
  );

  const assigneeNameById = useMemo(
    () =>
      new Map(
        directory.rows.map((entry) => [entry.employee.id, employeeDisplayName(entry.employee)]),
      ),
    [directory.rows],
  );

  const shownProjectName =
    task === null || task.project_id === null
      ? null
      : (projectNameById.get(task.project_id) ?? 'Unknown project');

  const shownAssigneeName =
    task === null || task.assignee_id === null
      ? null
      : (assigneeNameById.get(task.assignee_id) ?? 'Unknown person');

  /**
   * Status and assignee write immediately and are controlled by the task itself, so
   * they need no draft and no seeding — which is why they live here rather than in a
   * keyed child. Both go through `runWrite`, so the previous error is cleared and a
   * refusal becomes a message rather than a control that looks like it saved.
   */
  const runWrite = useCallback(
    async (work: () => Promise<ActionResult<unknown>>): Promise<void> => {
      setActionError(null);
      const result = await work();
      if (result.ok) {
        await detail.refresh();
        return;
      }
      setActionError(userMessage(result.error));
    },
    [detail],
  );

  const onStatusChange = useCallback(
    (status: TaskStatus) => {
      if (task === null) return;
      void runWrite(() => actions.setStatus(task.id, status));
    },
    [task, actions, runWrite],
  );

  const onAssigneeChange = useCallback(
    (assigneeId: string) => {
      if (task === null) return;
      void runWrite(() => actions.assign(task.id, assigneeId));
    },
    [task, actions, runWrite],
  );

  const onAssigneeClear = useCallback(() => {
    if (task === null) return;
    void runWrite(() => actions.assign(task.id, null));
  },
  [task, actions, runWrite]);

  const refresh = useCallback(async (): Promise<void> => {
    await detail.refresh();
  }, [detail]);

  const onDelete = useCallback(async (): Promise<void> => {
    if (task === null) return;
    const result = await actions.remove(task.id);
    if (result.ok) {
      setIsConfirmingDelete(false);
      router.back();
      return;
    }
    setIsConfirmingDelete(false);
    setActionError(userMessage(result.error));
  }, [task, actions, router]);

  // ── States that replace the body ────────────────────────────────────────────
  if (taskId === null) {
    return (
      <ScreenContainer edges={['bottom']} gap={sectionGap}>
        <PageHeader title="Task" breadcrumbs={deriveBreadcrumbs('/tasks')} />
        <EmptyState
          variant="noResults"
          icon="tasks"
          title="No task was named"
          description="That address does not include a task id."
          action={{
            label: 'Back to tasks',
            onPress: () => {
              router.replace('/tasks');
            },
          }}
        />
      </ScreenContainer>
    );
  }

  if (detail.notFound) {
    /*
      NOT_FOUND is an empty state, never an error banner. A red "not found" confirms to
      somebody probing ids that a row of that shape exists in an organization they cannot
      see — the banner is the leak, not the 404.
    */
    return (
      <ScreenContainer edges={['bottom']} gap={sectionGap}>
        <PageHeader title="Task" breadcrumbs={deriveBreadcrumbs(`/tasks/${taskId}`)} />
        <EmptyState
          variant="noResults"
          icon="tasks"
          title="That task is not here"
          description="It may have been deleted, or it may belong to an organization you are not in."
          action={{
            label: 'Back to tasks',
            onPress: () => {
              router.replace('/tasks');
            },
          }}
        />
      </ScreenContainer>
    );
  }

  if (task === null) {
    return (
      <ScreenContainer
        edges={['bottom']}
        gap={sectionGap}
        refreshing={detail.isRefreshing}
        onRefresh={() => {
          void detail.refresh();
        }}
        loading={detail.isLoading}
        loadingLabel="Loading the task"
        error={detail.error ?? undefined}
        onRetry={() => {
          void detail.refresh();
        }}
      >
        <PageHeader title="Task" breadcrumbs={deriveBreadcrumbs(`/tasks/${taskId}`)} />
      </ScreenContainer>
    );
  }

  const shownProgress = implied ?? task.progress;
  const daysLeft = daysUntilDue(task.due_date, detail.today);
  const dueSummary =
    daysLeft === null
      ? 'It has no due date.'
      : daysLeft < 0
        ? `It was due ${formatNumber(Math.abs(daysLeft))} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} ago.`
        : daysLeft === 0
          ? 'It is due today.'
          : `It is due in ${formatNumber(daysLeft)} ${daysLeft === 1 ? 'day' : 'days'}.`;

  return (
    <ScreenContainer
      edges={['bottom']}
      gap={sectionGap}
      maxWidth={720}
      refreshing={detail.isRefreshing}
      onRefresh={() => {
        void detail.refresh();
      }}
    >
      <PageHeader
        title={task.title}
        description={
          task !== null && task.project_id !== null && projectNameById.has(task.project_id) ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Project ${shownProjectName}`}
              onPress={() => router.push(`/projects/${task.project_id}`)}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignSelf: 'flex-start' })}
            >
              <HStack gap={1} align="center">
                <Icon name="externalLink" size="sm" tone="accent" />
                <Text variant="body" tone="accent">
                  {shownProjectName}
                </Text>
                <Icon name="chevronRight" size="sm" tone="accent" />
              </HStack>
            </Pressable>
          ) : (
            (shownProjectName ?? 'No project')
          )
        }
        breadcrumbs={deriveBreadcrumbs(`/tasks/${taskId}`)}
        status={
          <HStack gap={2} align="center" wrap>
            {statusSpec === null ? null : (
              <Badge
                label={TASK_STATUS_LABELS[task.status]}
                intent={statusSpec.intent}
                variant={statusSpec.variant}
                size="sm"
              />
            )}
            {overdue ? <Badge label="Overdue" intent="danger" variant="soft" size="sm" /> : null}
          </HStack>
        }
        primaryAction={
          mayEdit
            ? {
                label: isEditing ? 'Stop editing' : 'Edit',
                icon: isEditing ? 'close' : 'edit',
                variant: isEditing ? 'ghost' : 'primary',
                onPress: () => {
                  setIsEditing((open) => !open);
                },
              }
            : undefined
        }
        secondaryAction={
          mayDelete
            ? {
                label: 'Delete',
                icon: 'delete',
                variant: 'danger',
                onPress: () => {
                  setIsConfirmingDelete(true);
                },
              }
            : undefined
        }
      />

      {actionError === null ? null : (
        <ErrorState
          inline
          kind="generic"
          title="That did not save"
          message={actionError}
          onRetry={() => {
            setActionError(null);
            void detail.refresh();
          }}
        />
      )}

      {mayEdit ? null : (
        <Text variant="caption" tone="tertiary">
          {task.assignee_id === null
            ? 'Nobody owns this task, so only a manager can change it. Assigning it is what moves it forward.'
            : 'You can read this task but not change it — it belongs to somebody else.'}
        </Text>
      )}

      {isEditing && mayEdit ? (
        <TaskEditCard
          key={task.id}
          task={task}
          organizationId={organizationId}
          projects={projectOptions}
          onCancel={() => {
            setIsEditing(false);
          }}
          onSaved={async () => {
            setIsEditing(false);
            await refresh();
          }}
        />
      ) : (
        <Card>
          <VStack gap={4}>
            <View style={s.facts}>
              <Fact label="Status">
                <Text variant="bodySm">{TASK_STATUS_LABELS[task.status]}</Text>
              </Fact>
              <Fact label="Priority">
                <Text variant="bodySm">{TASK_PRIORITY_LABELS[task.priority]}</Text>
              </Fact>
              <Fact label="Assignee">
                <Text variant="bodySm" tone={shownAssigneeName === null ? 'tertiary' : 'primary'}>
                  {shownAssigneeName ?? 'Unassigned'}
                </Text>
              </Fact>
              <Fact label="Due">
                <Text variant="bodySm" tone={overdue ? 'danger' : 'primary'}>
                  {task.due_date === null ? 'No due date' : formatDate(task.due_date)}
                </Text>
              </Fact>
            </View>

            <VStack gap={1.5}>
              <View style={s.barValue}>
                <Text variant="caption" tone="tertiary">
                  Progress
                </Text>
                <Text variant="caption" tone="secondary">
                  {`${formatNumber(shownProgress)}%`}
                </Text>
              </View>
              <ProgressBar
                value={progressToRatio(shownProgress)}
                intent={implied === 100 ? 'success' : 'accent'}
                label="Task progress"
              />
              <Text variant="caption" tone="tertiary">
                {implied === 100
                  ? 'Shown as 100% because the task is done. The stored figure is left exactly as recorded.'
                  : 'A recorded figure, not a computed one — nothing here is derived from the task.'}
              </Text>
            </VStack>

            {task.description === null || task.description === '' ? null : (
              <VStack gap={1.5}>
                <Text variant="caption" tone="tertiary">
                  Description
                </Text>
                <Text variant="bodySm">{task.description}</Text>
              </VStack>
            )}
          </VStack>
        </Card>
      )}

      {mayEdit && !isEditing ? (
        <VStack gap={3}>
          <Text variant="label">Move this task</Text>

          <Card>
            <VStack gap={4}>
              <Select<TaskStatus>
                label="Status"
                options={statusOptions}
                value={task.status}
                onChange={onStatusChange}
                disabled={actions.isSubmitting}
                helperText="Saves as soon as you choose. In review hands the work to somebody else."
              />

              <TaskProgressControl
                key={task.id}
                task={task}
                organizationId={organizationId}
                onSaved={refresh}
              />

              <Select
                label="Assignee"
                options={assigneeOptions}
                value={task.assignee_id}
                onChange={onAssigneeChange}
                onClear={onAssigneeClear}
                placeholder="Unassigned"
                clearable
                searchable
                disabled={actions.isSubmitting}
                helperText="Saves as soon as you choose. Unassigning leaves the task unowned."
              />
            </VStack>
          </Card>
        </VStack>
      ) : null}

      <Text variant="caption" tone="tertiary">
        {`${dueSummary} `}
        {mayDelete
          ? 'Deleting a task is permanent, and only managers and above can do it.'
          : 'Only managers and above can delete a task.'}
      </Text>

      {/*
        Not dismissible by a stray backdrop tap: a destructive action must not be one
        tap away from destroying the record of work somebody did.
      */}
      <Modal
        visible={isConfirmingDelete}
        onClose={() => {
          setIsConfirmingDelete(false);
        }}
        title="Delete this task?"
        description="It cannot be undone, and the record of the work goes with it."
        intent="danger"
        size="sm"
        dismissOnBackdrop={false}
        footer={
          <HStack gap={2} justify="flex-end">
            <Button
              label="Keep it"
              variant="ghost"
              disabled={actions.isSubmitting}
              onPress={() => {
                setIsConfirmingDelete(false);
              }}
            />
            <Button
              label={actions.isSubmitting ? 'Deleting…' : 'Delete task'}
              variant="danger"
              loading={actions.isSubmitting}
              disabled={actions.isSubmitting}
              onPress={() => {
                void onDelete();
              }}
            />
          </HStack>
        }
      />
    </ScreenContainer>
  );
}
