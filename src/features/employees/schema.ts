/**
 * Trackit X — employee and department form schemas.
 *
 * Mirrors the constraints declared on `public.employees` and `public.departments`:
 *
 *   · `employees_first_name_length`    — btrim(first_name) between 1 and 80
 *   · `employees_last_name_length`     — btrim(last_name) between 1 and 80
 *   · `employees_name_trimmed`         — both = btrim(·)
 *   · `employees_code_length`          — btrim(employee_code) between 1 and 40
 *   · `employees_email_shape`          — a deliberately permissive address pattern
 *   · `employees_email_trimmed`        — email = btrim(email)
 *   · `employees_phone_length`         — NULL or btrim(phone) between 6 and 32
 *   · `employees_job_title_length`     — NULL or btrim(job_title) between 2 and 120
 *   · `employees_not_own_manager`      — manager_id <> id
 *   · `departments_name_length`        — btrim(name) between 2 and 80
 *
 * Two of those are not reproduced here on purpose, and both are because Postgres
 * is better at them than any form is:
 *
 *   · the `employees_manager_id <> id` self-reference cannot be checked on a create
 *     form, because the id does not exist until the row does. It is enforced by
 *     the CHECK and by `guard_employee_references`;
 *   · same-organization integrity of `department_id` and `manager_id` is a
 *     database invariant, and a form that reimplemented it would be a second,
 *     weaker copy of a rule that must not drift.
 *
 * The database is the authority. Everything here exists to catch a mistake before
 * a round trip.
 */
import { z } from 'zod';

import {
  DEPARTMENT_NAME_MAX,
  DEPARTMENT_NAME_MIN,
  EMPLOYEE_CODE_MAX,
  EMPLOYEE_JOB_TITLE_MAX,
  EMPLOYEE_NAME_MAX,
  EMPLOYEE_PHONE_MAX,
  EMPLOYMENT_STATUSES,
  isValidEmployeeEmail,
  normalizeDepartmentName,
  normalizeEmployeeCode,
  normalizeEmployeeEmail,
  normalizePersonName,
  type EmploymentStatus,
} from '@/domain/employee';

/** `YYYY-MM-DD`, or empty. A regex, because `new Date()` accepts far more. */
const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the date picker.' })
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed)) return false;
    // Rejects 2026-02-31, which the regex happily accepts and Postgres does not.
    return new Date(parsed).toISOString().slice(0, 10) === value;
  }, { message: 'That date does not exist.' });

const firstNameField = z
  .string()
  .transform(normalizePersonName)
  .pipe(
    z
      .string()
      .min(1, { message: 'Required.' })
      .max(EMPLOYEE_NAME_MAX, { message: `Keep it under ${EMPLOYEE_NAME_MAX} characters.` }),
  );

const lastNameField = z
  .string()
  .transform(normalizePersonName)
  .pipe(
    z
      .string()
      .min(1, { message: 'Required.' })
      .max(EMPLOYEE_NAME_MAX, { message: `Keep it under ${EMPLOYEE_NAME_MAX} characters.` }),
  );

/**
 * Validated with the SAME permissive pattern as `employees_email_shape`.
 *
 * A stricter client rule would be the classic divergence: the form refuses
 * something the column would have accepted, and the user is told their address is
 * invalid for no reason they can act on. The typo is caught by the message that
 * never arrives.
 */
const emailField = z
  .string()
  .transform(normalizeEmployeeEmail)
  .refine(isValidEmployeeEmail, { message: 'Enter an email address.' });

const employeeCodeField = z
  .string()
  .transform(normalizeEmployeeCode)
  .pipe(
    z
      .string()
      .min(1, { message: 'Required. This is how people are referred to.' })
      .max(EMPLOYEE_CODE_MAX, { message: `Keep it under ${EMPLOYEE_CODE_MAX} characters.` }),
  );

/** Optional text: blank means NULL, which is a real state and not a failure. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .refine((value) => value === null || value.length <= max, {
      message: `Keep the ${label} under ${max} characters.`,
    });

/**
 * Phone is the one optional field with a MINIMUM as well as a maximum, because
 * `employees_phone_length` is 6..32. A 3-character number is a typo, and the
 * constraint exists to catch exactly that.
 */
const phoneField = z
  .string()
  .trim()
  .transform((value) => (value.length === 0 ? null : value))
  .refine(
    (value) =>
      value === null ||
      (value.length >= 6 && value.length <= EMPLOYEE_PHONE_MAX),
    {
      message: `Between 6 and ${EMPLOYEE_PHONE_MAX} characters, or leave it blank.`,
    },
  );

const statusField = z.enum(EMPLOYMENT_STATUSES, { message: 'Choose a status.' });

/** A UUID from a picker, or the literal "none". Never a free-text id. */
const optionalUuid = z
  .string()
  .trim()
  .refine(
    (value) =>
      value.length === 0 ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    { message: 'Pick from the list.' },
  )
  .transform((value) => (value.length === 0 ? null : value));

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

const departmentNameField = z
  .string()
  .transform(normalizeDepartmentName)
  .pipe(
    z
      .string()
      .min(DEPARTMENT_NAME_MIN, { message: `Use at least ${DEPARTMENT_NAME_MIN} characters.` })
      .max(DEPARTMENT_NAME_MAX, {
        message: `Keep it under ${DEPARTMENT_NAME_MAX} characters.`,
      }),
  );

export const createDepartmentSchema = z.object({
  name: departmentNameField,
  description: optionalText(400, 'description').optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = z
  .object({
    name: departmentNameField.optional(),
    description: optionalText(400, 'description').optional(),
  })
  .refine(
    (values) => values.name !== undefined || values.description !== undefined,
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateDepartmentInput = z.infer<typeof updateDepartmentSchema>;

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export const createEmployeeSchema = z.object({
  firstName: firstNameField,
  lastName: lastNameField,
  email: emailField,
  /**
   * Optional in the FORM even though the column is `not null`, because the service
   * fills in a suggestion when this is absent. The user can type their own scheme
   * or accept the one offered; the schema is not the place that decides.
   */
  employeeCode: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.union([employeeCodeField, z.undefined()]),
  ),
  jobTitle: optionalText(EMPLOYEE_JOB_TITLE_MAX, 'job title').optional(),
  phone: phoneField.optional(),
  departmentId: optionalUuid.optional(),
  managerId: optionalUuid.optional(),
  status: statusField.optional(),
  joiningDate: z.union([dateField, z.literal(''), z.undefined()]).optional(),
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z
  .object({
    firstName: firstNameField.optional(),
    lastName: lastNameField.optional(),
    email: emailField.optional(),
    employeeCode: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.union([employeeCodeField, z.undefined()]),
    ),
    jobTitle: optionalText(EMPLOYEE_JOB_TITLE_MAX, 'job title').optional(),
    phone: phoneField.optional(),
    departmentId: optionalUuid.optional(),
    managerId: optionalUuid.optional(),
    status: statusField.optional(),
    joiningDate: z.union([dateField, z.literal(''), z.undefined()]).optional(),
  })
  .refine(
    (values) => Object.values(values).some((value) => value !== undefined),
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

// ---------------------------------------------------------------------------
// Manager sanity
// ---------------------------------------------------------------------------

/**
 * A warning, not an error, and the distinction is the point.
 *
 * A person who manages themselves is impossible — the database refuses it — but the
 * usual cause is not a person setting that. It is an EDIT form that failed to
 * exclude the record being edited from its own manager picker. That is a bug in
 * the form, and it should be visible as such rather than arriving as "An employee
 * cannot be their own manager" after a save.
 *
 * Exported separately from the schema so the caller decides whether to show it:
 * `createEmployeeSchema` cannot do this check, because on a create the employee's
 * own id does not exist yet.
 */
export function managerSelfReferenceWarning(
  employeeId: string | null,
  managerId: string | null | undefined,
): string | null {
  if (employeeId === null || managerId === null || managerId === undefined) return null;
  if (employeeId !== managerId) return null;
  return 'This person cannot be their own manager. Pick somebody else.';
}

export { EMPLOYMENT_STATUSES, type EmploymentStatus };
