/**
 * Trackit X — create a project.
 *
 * Manager and above, matching `projects_insert_managers`.
 *
 * ── Three fields are optional on purpose, and each for a reason ──────────────
 * `ownerId`, `startDate` and `targetDate` are all nullable in the schema and all
 * optional here. A job that has been agreed but not staffed is a real project, and
 * blocking its creation on a staffing question nobody has answered yet would push
 * people to record it somewhere else — which is worse than an unowned project.
 *
 * The one field that is NOT optional is the name. A project with no name cannot be
 * referred to in a conversation, and an unnamed row in a list is indistinguishable
 * from a row that failed to load.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  Button,
  Divider,
  HStack,
  Input,
  Select,
  Text,
  VStack,
} from '@/design-system';
import { employeeDisplayName } from '@/domain/employee';
import {
  PROJECT_PRIORITY_LABELS,
  PROJECT_STATUS_DESCRIPTIONS,
  PROJECT_STATUS_LABELS,
  type ProjectPriority,
  type ProjectStatus,
} from '@/domain/project';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '@/domain/project';
import { createProjectSchema, type CreateProjectInput } from '@/features/projects/schema';
import { validateForm, type FieldErrors } from '@/features/auth/schema';
import { createProject } from '@/services/projectService';
import type { EmployeeListEntry } from '@/services/employeeService';
import { userMessage } from '@/utils/errors';

export interface ProjectCreateFormProps {
  readonly organizationId: string;
  /**
   * Candidate owners — everyone currently on the books.
   *
   * `EmployeeListEntry` rather than `ProjectListEntry`: an owner is a person, and the
   * project-shaped view model would make this form depend on a projects read it has
   * nothing to do with. The caller loads the roster; this file only maps it to
   * options.
   */
  readonly employees: readonly EmployeeListEntry[];
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}

function optionFor(entry: EmployeeListEntry) {
  return {
    value: entry.employee.id,
    label: entry.departmentName === null
      ? employeeDisplayName(entry.employee)
      : `${employeeDisplayName(entry.employee)} — ${entry.departmentName}`,
    description: entry.employee.job_title ?? entry.departmentName ?? undefined,
  };
}

export function ProjectCreateForm({
  organizationId,
  employees,
  onCancel,
  onSaved,
}: ProjectCreateFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus | null>('planned');
  const [priority, setPriority] = useState<ProjectPriority | null>('medium');
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [ownerId, setOwnerId] = useState<string | null>(null);

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<CreateProjectInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const statusOptions = useMemo(
    () =>
      PROJECT_STATUSES.map((value) => ({
        value,
        label: PROJECT_STATUS_LABELS[value],
        description: PROJECT_STATUS_DESCRIPTIONS[value],
      })),
    [],
  );

  const priorityOptions = useMemo(
    () => PROJECT_PRIORITIES.map((value) => ({ value, label: PROJECT_PRIORITY_LABELS[value] })),
    [],
  );

  const ownerOptions = useMemo(() => employees.map(optionFor), [employees]);

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(createProjectSchema, {
      name,
      description,
      status,
      priority,
      startDate,
      targetDate,
      ownerId: ownerId ?? '',
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await createProject({
      organizationId,
      name: parsed.values.name,
      description: parsed.values.description ?? null,
      startDate: parsed.values.startDate ?? null,
      targetDate: parsed.values.targetDate ?? null,
      ownerId: parsed.values.ownerId ?? null,
      ...(parsed.values.status === undefined ? {} : { status: parsed.values.status }),
      ...(parsed.values.priority === undefined ? {} : { priority: parsed.values.priority }),
      ...(parsed.values.progress === undefined ? {} : { progress: parsed.values.progress }),
    });
    setSubmitting(false);

    if (result.ok) {
      onSaved();
      return;
    }
    setFormError(userMessage(result.error));
  }, [
    organizationId,
    name,
    description,
    status,
    priority,
    startDate,
    targetDate,
    ownerId,
    onSaved,
  ]);

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
        label="Project name"
        value={name}
        onChangeText={setName}
        error={fieldErrors.name}
        autoCapitalize="words"
        placeholder="Kitchen refit — Fitzroy"
      />

      <Input
        label="Description"
        value={description}
        onChangeText={setDescription}
        error={fieldErrors.description}
        placeholder="What is being delivered, and for whom"
        multiline
        numberOfLines={4}
      />

      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={{ flex: 1 }}>
          <Select<ProjectStatus>
            label="Status"
            options={statusOptions}
            value={status}
            onChange={setStatus}
            error={fieldErrors.status}
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Select<ProjectPriority>
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
            label="Start date"
            value={startDate}
            onChangeText={setStartDate}
            error={fieldErrors.startDate}
            placeholder="YYYY-MM-DD"
            helperText="Optional."
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Target date"
            value={targetDate}
            onChangeText={setTargetDate}
            error={fieldErrors.targetDate}
            placeholder="YYYY-MM-DD"
            helperText="Optional, but never before the start."
          />
        </VStack>
      </HStack>

      <Select
        label="Accountable owner"
        options={ownerOptions}
        value={ownerId}
        onChange={setOwnerId}
        placeholder="Nobody yet"
        clearable
        searchable
        error={fieldErrors.ownerId}
        helperText="Optional. A project can be created before it is staffed."
      />

      <HStack gap={2} justify="flex-end">
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={submitting} />
        <Button
          label={submitting ? 'Creating…' : 'Create project'}
          variant="primary"
          loading={submitting}
          disabled={submitting}
          onPress={() => {
            void submit();
          }}
        />
      </HStack>
    </VStack>
  );
}
