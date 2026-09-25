/**
 * Trackit X — employee and department domain rules.
 *
 * Pure functions and constant tables. No Supabase import, no React, no I/O — so
 * every rule below is unit-testable without a database or a renderer.
 *
 * ⚠ WHAT AN EMPLOYEE IS NOT ──────────────────────────────────────────────────
 * An employee is NOT a membership. `organization_members` counts the accounts
 * that can open this workspace; `employees` counts the people the business
 * employs. They overlap — an owner is usually also an employee — and they are
 * deliberately different tables, because:
 *
 *   · most employees never sign in, so they have no `auth.users` row and no
 *     membership. Modelling them as members would mean inventing logins for the
 *     workforce;
 *   · a membership can exist for a consultant, an auditor or an accountant who
 *     is not on the payroll at all;
 *   · an employee carries job facts — department, title, manager, joining date —
 *     that a login has no business holding.
 *
 * `employees.user_id` is the nullable bridge, and it is null more often than not.
 * Conflating the two counts is how a product ends up reporting a headcount that
 * is really a licence count.
 *
 * Departments live here rather than in a file of their own because in this phase
 * they exist to classify employees; a module per lookup table would fragment the
 * workforce rules across three files that always change together.
 */
import type { DepartmentRow, EmployeeRow, EmploymentStatus } from '@/types/database';

export type { DepartmentRow, EmployeeRow, EmploymentStatus };

/**
 * Every employment state, in the order a person passes through them.
 *
 * The order is meaningful — it is how a reader scans the list and how a status
 * filter is presented — so it is a declared sequence rather than an alphabetised
 * set. `inactive` is last because it is the only state that is not "working".
 */
export const EMPLOYMENT_STATUSES = [
  'active',
  'probation',
  'on_leave',
  'notice_period',
  'inactive',
] as const;

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  active: 'Active',
  probation: 'Probation',
  on_leave: 'On leave',
  notice_period: 'Notice period',
  inactive: 'Inactive',
};

/**
 * What each state means, shown in the create form and as helper text.
 *
 * Present because "Notice period" does not tell an owner what they are
 * recording, and the difference between `on_leave` and `inactive` decides whether
 * the person is still on the payroll.
 */
export const EMPLOYMENT_STATUS_DESCRIPTIONS: Record<EmploymentStatus, string> = {
  active: 'Working normally.',
  probation: 'Employed and working, still within the notice period.',
  on_leave: 'Employed but currently away. The leave itself is recorded elsewhere.',
  notice_period: 'Has resigned and is still working out the notice.',
  inactive: 'Has left. The record is kept so payroll and project history still resolve.',
};

/**
 * The states that mean this person is currently on the books.
 *
 * Used for the headcount figure. Excludes `inactive` (has left) and
 * `notice_period` (resigned, but still being paid until the notice ends — the
 * business decides which side of the line that falls on, and it is not this
 * module's call to make silently).
 */
export const CURRENT_EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  'active',
  'probation',
  'on_leave',
];

export function isEmploymentStatus(value: unknown): value is EmploymentStatus {
  return (
    typeof value === 'string' && (EMPLOYMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isCurrentEmployee(status: EmploymentStatus): boolean {
  return CURRENT_EMPLOYMENT_STATUSES.includes(status);
}

/** Ready for the design system's `Select`. */
export const employmentStatusOptions: readonly { value: EmploymentStatus; label: string }[] =
  EMPLOYMENT_STATUSES.map((value) => ({ value, label: EMPLOYMENT_STATUS_LABELS[value] }));

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Mirrors the `employees_*_length` CHECK constraints. */
export const EMPLOYEE_NAME_MAX = 80;
export const EMPLOYEE_CODE_MAX = 40;
export const EMPLOYEE_PHONE_MAX = 32;
export const EMPLOYEE_JOB_TITLE_MAX = 120;

export const DEPARTMENT_NAME_MIN = 2;
export const DEPARTMENT_NAME_MAX = 80;

/**
 * Brings a typed name into the shape the columns accept.
 *
 * The employee table has `name = btrim(name)` constraints, so an untrimmed value
 * is rejected outright. Normalising here means a trailing space never becomes a
 * validation error the user cannot see — the same reasoning as
 * `normalizeOrganizationName`.
 */
export function normalizePersonName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeEmployeeCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function normalizeDepartmentName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * "Ramesh  Kumar" → "Ramesh Kumar".
 *
 * Separated from the column rule so it can also be applied to a search term: a
 * user typing two spaces between names should find the person whose record has
 * one.
 */
export function employeeDisplayName(employee: {
  readonly first_name: string;
  readonly last_name: string;
}): string {
  return `${normalizePersonName(employee.first_name)} ${normalizePersonName(employee.last_name)}`.trim();
}

/**
 * The default `employee_code` for a business that has none.
 *
 * A SUGGESTION, never an identity. It is derived from a count, so two people
 * saving at once can collide — the unique index and the form's error copy handle
 * that, and it is the better failure than a code nobody chose. Generated here
 * rather than in SQL so the format is one definition, and the user can see and
 * edit it before it is saved.
 */
export function suggestEmployeeCode(existingCount: number): string {
  const next = Math.max(0, existingCount) + 1;
  return `EMP-${String(next).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Mirrors `employees_email_shape`.
 *
 * Deliberately as permissive as the CHECK constraint. The database accepts
 * `a@b.c`; a stricter client rule that rejected it would make the form and the
 * schema disagree, and the disagreement shows up as a save failure the form said
 * was impossible.
 */
const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function isValidEmployeeEmail(value: unknown): value is string {
  return typeof value === 'string' && EMAIL_SHAPE.test(value.trim());
}

/** Lowercased, because the unique index is on `lower(email)`. */
export function normalizeEmployeeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Departments
// ---------------------------------------------------------------------------

/**
 * A lookup of department id → name.
 *
 * Built once per read so that rendering N employees does not run N queries, and
 * so that a screen never has to handle a department id it could not resolve. An
 * unresolvable id renders as `null`, not as the raw UUID: showing a user a UUID
 * because a join missed is a bug that looks like data.
 */
export type DepartmentLookup = ReadonlyMap<string, string> | null;

export function buildDepartmentLookup(
  departments: readonly DepartmentRow[] | null | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const department of departments ?? []) {
    lookup.set(department.id, department.name);
  }
  return lookup;
}

export function departmentNameFor(
  lookup: DepartmentLookup,
  departmentId: string | null | undefined,
): string | null {
  if (departmentId === null || departmentId === undefined) return null;
  if (lookup === null) return null;
  return lookup.get(departmentId) ?? null;
}

/** "Production · Fabrication", or null when the person has no department. */
export function describeEmployeeDepartment(
  lookup: DepartmentLookup,
  employee: { readonly department_id: string | null },
  jobTitle: string | null,
): string | null {
  const department = departmentNameFor(lookup, employee.department_id);
  if (department !== null) return department;
  return jobTitle;
}
