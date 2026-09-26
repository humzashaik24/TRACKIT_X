/**
 * Trackit X — raise a task.
 *
 * Every role can use this. `tasks_insert_members` gates only WHERE THE WORK GOES, not
 * whether a person may notice something needs doing, and a member who cannot raise
 * their own ticket is a member who writes it on paper instead.
 *
 * ── Why this is a screen and not a modal ─────────────────────────────────────
 * `ProjectCreateForm` opens in a `Modal` and that is the right call for a project. A
 * task form is longer — a description, a due date, a progress figure — and a modal
 * with a software keyboard open on a phone is a worse place to type than a screen that
 * scrolls under the keyboard. It is also a route, so a task can be linked to, and so
 * the list's primary action goes somewhere real rather than toggling local state.
 *
 * ── The assignee picker offers two options to a member ────────────────────────
 * `canAssignTaskTo` is the whole of it: a member may choose nobody or themselves, and
 * a manager may choose anybody on the books. Anyone else is not in the list at all,
 * rather than present and refused on save — a control the database is certain to
 * reject is worse than no control, because it makes the form look broken.
 *
 * The database still decides. This is a UI affordance, and `tasks_insert_members` and
 * `guard_task_references` are the authority on both the tenant and the assignment.
 */
import { useCallback, useMemo, useState } from 'react';

import { validateForm, type FieldErrors } from '@/features/auth/schema';
import { createTaskSchema, type CreateTaskInput } from '@/features/tasks/schema';
import { employeeDisplayName } from '@/domain/employee';
import type { OrganizationRole } from '@/domain/organization';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_DESCRIPTIONS,
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  canAssignTaskTo,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/task';
import type { ProjectListEntry } from '@/features/projects/useProjects';
import type { EmployeeListEntry } from '@/services/employeeService';
import { useTaskActions } from '@/features/tasks/useTaskActions';
import { Button, Divider, HStack, Input, Select, Text, VStack } from '@/design-system';
import { userMessage } from '@/utils/errors';

export interface TaskCreateFormProps {
  readonly organizationId: string | null;
  readonly role: OrganizationRole | null;
  /** The caller's own employee row, or `null` for a login that is not on the payroll. */
  readonly currentEmployeeId: string | null;
  /** Every project, for the picker. Loaded by the caller, not by this file. */
  readonly projects: readonly ProjectListEntry[];
  /** Everyone on the books, for the assignee picker. */
  readonly employees: readonly EmployeeListEntry[];
  readonly onCancel: () => void;
  /** Receives the saved row, so the caller can open it or move the list. */
  readonly onSaved: (taskId: string) => void;
}

function projectOption(entry: ProjectListEntry) {
  return {
    value: entry.project.id,
    label: entry.project.name,
    description: entry.ownerName === null ? 'No owner' : entry.ownerName,
  };
}

function employeeOption(entry: EmployeeListEntry) {
  return {
    value: entry.employee.id,
    label: employeeDisplayName(entry.employee),
    description: entry.employee.job_title ?? entry.departmentName ?? undefined,
  };
}

export function TaskCreateForm({
  organizationId,
  role,
  currentEmployeeId,
  projects,
  employees,
  onCancel,
  onSaved,
}: TaskCreateFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskStatus | null>('todo');
  const [priority, setPriority] = useState<TaskPriority | null>('medium');
  const [progress, setProgress] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<CreateTaskInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);

  const actions = useTaskActions(organizationId);

  const projectOptions = useMemo(() => projects.map(projectOption), [projects]);

  /**
   * A member's list is themselves and nobody.
   *
   * Filtered on the domain predicate rather than on role, because `canAssignTaskTo` is
   * the rule the database holds — and it is the rule that has the awkward case in it
   * (a member may always choose `null`, but may only choose themselves when they have
   * an employee row at all), which is exactly the kind of thing that gets re-implemented
   * slightly wrong at a call site.
   */
  const assigneeOptions = useMemo(
    () =>
      employees
        .filter((entry) => canAssignTaskTo(role, currentEmployeeId, entry.employee.id))
        .map(employeeOption),
    [employees, role, currentEmployeeId],
  );

  const statusOptions = useMemo(
    () =>
      TASK_STATUSES.map((value) => ({
        value,
        label: TASK_STATUS_LABELS[value],
        description: TASK_STATUS_DESCRIPTIONS[value],
      })),
    [],
  );

  const priorityOptions = useMemo(
    () => TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] })),
    [],
  );

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(createTaskSchema, {
      title,
      description,
      projectId: projectId ?? '',
      assigneeId: assigneeId ?? '',
      status,
      priority,
      progress: progress.trim() === '' ? undefined : Number(progress),
      dueDate,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    const result = await actions.create({
      organizationId: organizationId ?? '',
      title: parsed.values.title,
      description: parsed.values.description ?? null,
      projectId: parsed.values.projectId ?? null,
      assigneeId: parsed.values.assigneeId ?? null,
      ...(parsed.values.status === undefined ? {} : { status: parsed.values.status }),
      ...(parsed.values.priority === undefined ? {} : { priority: parsed.values.priority }),
      ...(parsed.values.progress === undefined ? {} : { progress: parsed.values.progress }),
      dueDate: parsed.values.dueDate ?? null,
    });

    if (result.ok) {
      onSaved(result.value.id);
      return;
    }
    setFormError(userMessage(result.error));
  }, [
    actions,
    organizationId,
    title,
    description,
    projectId,
    assigneeId,
    status,
    priority,
    progress,
    dueDate,
    onSaved,
  ]);

  const canSubmit = organizationId !== null;

  return (
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
        autoCapitalize="sentences"
        placeholder="Replace the filter belts on line 3"
        maxLength={200}
        showCounter
        required
      />

      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        error={fieldErrors.description}
        placeholder="What is being done, and anything somebody else would need to know"
        helperText="Optional. For a blocked task, record here what it is waiting on."
        multiline
        numberOfLines={4}
      />

      {/*
        A task belongs to no project by default, and the picker says so rather than
        leaving a blank field that looks unfilled. See the header of
        `src/domain/task.ts` for why a catch-all project was rejected.
      */}
      <Select
        label="Project"
        options={projectOptions}
        value={projectId}
        onChange={setProjectId}
        onClear={() => {
          setProjectId(null);
        }}
        placeholder="No project"
        clearable
        searchable
        error={fieldErrors.projectId}
        helperText="Optional. Work that belongs to no project is a real thing."
      />

      <Select
        label="Assignee"
        options={assigneeOptions}
        value={assigneeId}
        onChange={setAssigneeId}
        onClear={() => {
          setAssigneeId(null);
        }}
        placeholder="Unassigned"
        clearable
        searchable
        error={fieldErrors.assigneeId}
        helperText={
          assigneeOptions.length === 0
            ? 'You can only assign work to yourself or leave it unassigned.'
            : 'Optional. An unassigned task is a real state, not an unfinished form.'
        }
      />

      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={{ flex: 1 }}>
          <Select<TaskStatus>
            label="Status"
            options={statusOptions}
            value={status}
            onChange={setStatus}
            error={fieldErrors.status}
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Select<TaskPriority>
            label="Priority"
            options={priorityOptions}
            value={priority}
            onChange={setPriority}
            error={fieldErrors.priority}
          />
        </VStack>
      </HStack>

      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Progress"
            value={progress}
            onChangeText={setProgress}
            error={fieldErrors.progress}
            placeholder="0"
            keyboardType="number-pad"
            helperText="0–100, as a whole number."
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Due date"
            value={dueDate}
            onChangeText={setDueDate}
            error={fieldErrors.dueDate}
            placeholder="YYYY-MM-DD"
            helperText="Optional."
          />
        </VStack>
      </HStack>

      <HStack gap={2} justify="flex-end">
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={actions.isSubmitting} />
        <Button
          label={actions.isSubmitting ? 'Creating…' : 'Create task'}
          variant="primary"
          loading={actions.isSubmitting}
          disabled={actions.isSubmitting || !canSubmit}
          onPress={() => {
            void submit();
          }}
        />
      </HStack>
    </VStack>
  );
}
