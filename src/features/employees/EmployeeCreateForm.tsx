/**
 * Trackit X — add an employee.
 *
 * Admin only, and the form reflects that: the caller has already decided whether to
 * show it, and this file does not re-check.
 *
 * ── What is deliberately absent ──────────────────────────────────────────────
 * There is no role field, and there is no "send an invitation" toggle. A role
 * belongs to `organization_members` and a person added to the directory is not
 * necessarily an account at all — most of a small business's workforce never signs
 * in, which is the whole reason employees and memberships are separate tables. A
 * form that created both at once would force an owner to invent a login for
 * somebody who has never asked for one.
 *
 * `employee_code` is left blank by default and the service fills in a suggestion,
 * because a business with its own numbering scheme should type its own and a
 * business without one should not be asked to invent one.
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
import {
  EMPLOYMENT_STATUS_DESCRIPTIONS,
  EMPLOYMENT_STATUS_LABELS,
  type DepartmentRow,
  type EmploymentStatus,
} from '@/domain/employee';
import { createEmployee } from '@/services/employeeService';
import type { EmployeeListEntry } from '@/services/employeeService';
import { EMPLOYMENT_STATUSES, createEmployeeSchema, type CreateEmployeeInput } from '@/features/employees/schema';
import { validateForm, type FieldErrors } from '@/features/auth/schema';
import { userMessage } from '@/utils/errors';

export interface EmployeeCreateFormProps {
  readonly organizationId: string;
  readonly departments: readonly DepartmentRow[];
  /** Existing people, so a new employee cannot be made their own manager. */
  readonly existing: readonly EmployeeListEntry[];
  readonly onCancel: () => void;
  readonly onSaved: () => void;
}

function nameOf(entry: EmployeeListEntry): string {
  return `${entry.employee.first_name} ${entry.employee.last_name}`.trim();
}

export function EmployeeCreateForm({
  organizationId,
  departments,
  existing,
  onCancel,
  onSaved,
}: EmployeeCreateFormProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [status, setStatus] = useState<EmploymentStatus | null>('active');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors<CreateEmployeeInput>>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const departmentOptions = useMemo(
    () => departments.map((department) => ({ value: department.id, label: department.name })),
    [departments],
  );

  /**
   * The manager picker, searchable.
   *
   * A Select rather than a free-text field, because `manager_id` is a foreign key
   * to a real person and a typed name is not one. The list is long — it is the whole
   * workforce — so the component's own search is what makes it usable.
   */
  const managerOptions = useMemo(
    () =>
      existing.map((entry) => ({
        value: entry.employee.id,
        label: nameOf(entry),
        description: entry.employee.job_title ?? undefined,
      })),
    [existing],
  );

  const statusOptions = useMemo(
    () =>
      EMPLOYMENT_STATUSES.map((value) => ({
        value,
        label: EMPLOYMENT_STATUS_LABELS[value],
        description: EMPLOYMENT_STATUS_DESCRIPTIONS[value],
      })),
    [],
  );

  const submit = useCallback(async (): Promise<void> => {
    setFormError(undefined);

    const parsed = validateForm(createEmployeeSchema, {
      firstName,
      lastName,
      email,
      employeeCode,
      jobTitle,
      phone,
      departmentId: departmentId ?? '',
      managerId: managerId ?? '',
      status,
    });
    if (!parsed.ok) {
      setFieldErrors(parsed.errors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    const result = await createEmployee({
      organizationId,
      firstName: parsed.values.firstName,
      lastName: parsed.values.lastName,
      email: parsed.values.email,
      employeeCode: parsed.values.employeeCode ?? null,
      jobTitle: parsed.values.jobTitle ?? null,
      phone: parsed.values.phone ?? null,
      departmentId: parsed.values.departmentId ?? null,
      managerId: parsed.values.managerId ?? null,
      ...(parsed.values.status === undefined ? {} : { status: parsed.values.status }),
    });
    setSubmitting(false);

    if (result.ok) {
      onSaved();
      return;
    }
    // A duplicate email or code arrives as VALIDATION_FAILED with a message the
    // service wrote for exactly this case, so it is shown as a form error rather
    // than a banner — see `uniqueViolationMessage` in the service.
    setFormError(userMessage(result.error));
  }, [
    organizationId,
    firstName,
    lastName,
    email,
    employeeCode,
    jobTitle,
    phone,
    departmentId,
    managerId,
    status,
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

      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            error={fieldErrors.firstName}
            autoCapitalize="words"
            textContentType="givenName"
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            error={fieldErrors.lastName}
            autoCapitalize="words"
            textContentType="familyName"
          />
        </VStack>
      </HStack>

      <Input
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="emailAddress"
        helperText="Their contact address, not their sign-in."
      />

      <Input
        label="Employee code"
        value={employeeCode}
        onChangeText={setEmployeeCode}
        error={fieldErrors.employeeCode}
        autoCapitalize="characters"
        helperText="Optional. One is suggested if you leave this blank."
      />

      <HStack gap={3} align="flex-start">
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Job title"
            value={jobTitle}
            onChangeText={setJobTitle}
            error={fieldErrors.jobTitle}
            autoCapitalize="words"
          />
        </VStack>
        <VStack gap={1} style={{ flex: 1 }}>
          <Input
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            error={fieldErrors.phone}
            keyboardType="phone-pad"
          />
        </VStack>
      </HStack>

      <Select
        label="Department"
        options={departmentOptions}
        value={departmentId}
        onChange={setDepartmentId}
        placeholder="No department"
        clearable
        error={fieldErrors.departmentId}
        helperText="Departments are optional and can be set up later."
      />

      <Select
        label="Reports to"
        options={managerOptions}
        value={managerId}
        onChange={setManagerId}
        placeholder="Nobody"
        clearable
        searchable
        error={fieldErrors.managerId}
        helperText="Optional. Leave blank for a person who does not manage anyone."
      />

      <Select<EmploymentStatus>
        label="Status"
        options={statusOptions}
        value={status}
        onChange={setStatus}
        error={fieldErrors.status}
      />

      <HStack gap={2} justify="flex-end">
        <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={submitting} />
        <Button
          label={submitting ? 'Adding…' : 'Add employee'}
          variant="primary"
          onPress={() => {
            void submit();
          }}
          loading={submitting}
          disabled={submitting}
        />
      </HStack>
    </VStack>
  );
}
