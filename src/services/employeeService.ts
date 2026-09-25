/**
 * Trackit X — employee service.
 *
 * Reads and writes the people a business employs. See `src/domain/employee.ts` for
 * why employees are not memberships, and `departmentService` for why these queries
 * scope by organization and never by user.
 *
 * The one thing this service does that the others do not: it RESOLVES names.
 * A directory is read, not managed — nobody wants `[object Object]` next to a
 * manager — so `listEmployees` returns display-ready rows by embedding the
 * department and manager in the same round trip rather than fanning out into
 * extra queries per row.
 */
import { supabase } from '@/lib/supabase';
import { anyColumnIlike } from '@/lib/postgrestFilters';
import {
  buildDepartmentLookup,
  employeeDisplayName,
  normalizeEmployeeCode,
  normalizeEmployeeEmail,
  normalizePersonName,
  suggestEmployeeCode,
  type DepartmentRow,
  type EmployeeRow,
  type EmploymentStatus,
} from '@/domain/employee';
import type { TablesInsert, TablesUpdate } from '@/types/database';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'employeeService' });

export type { DepartmentRow, EmployeeRow, EmploymentStatus };

/**
 * The unique indexes on `employees` are on `lower(email)` and on `email`, and the
 * one on `employee_code` is plain. Emitted with the index name so a duplicate
 * message names the field rather than saying "duplicate key".
 */
type UniqueViolation = { code: '23505'; constraint: string | null; message: string | null };

function isUniqueViolation(value: unknown): value is UniqueViolation {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505' && typeof candidate.constraint === 'string';
}

/**
 * A unique index that fired, as a message the form can show.
 *
 * This is the only place in the Phase 32 services where a database constraint is
 * turned into user-facing copy, and it is worth being explicit about why the copy
 * is here rather than in the form: the alternative is the form guessing from a
 * localized error string, and any change to the wording upstream silently breaks
 * the mapping. The index name is the contract.
 */
function uniqueViolationMessage(error: UniqueViolation): string {
  switch (error.constraint) {
    case 'employees_organization_email_key':
      return 'That email address is already on the directory.';
    case 'employees_organization_code_key':
      return 'That employee code is already in use.';
    case 'employees_user_id_key':
      return 'That sign-in is already linked to an employee.';
    case 'employees_organization_user_key':
      return 'That sign-in is already linked to a different employee.';
    default:
      return 'Those details already belong to someone else.';
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * An employee with their department and manager named.
 *
 * A view model rather than an `EmployeeRow`, because the two embedded relations
 * are nullable and a screen should not be able to reach past a well-typed name
 * into a raw join object.
 */
export interface EmployeeListEntry {
  readonly employee: EmployeeRow;
  readonly departmentName: string | null;
  readonly managerName: string | null;
}

/** One employee, with the same two relations named. */
export interface EmployeeDetail extends EmployeeListEntry {
  /** People in this employee's reporting line, by id. Empty when nobody. */
  readonly directReportIds: readonly string[];
}

/**
 * The embedded relations PostgREST can return for `listEmployees`.
 *
 * The self-reference is the awkward part. `employees_manager_id_fkey` is a
 * many-to-one, but supabase-js's inference from a non-unique foreign key resolves
 * `manager:employees!manager_id(…)` to an ARRAY, while PostgREST's response for a
 * many-to-one embed is an OBJECT. The generated type is therefore wrong about the
 * wire format, and casting through it to a hand-written shape is how an `any`
 * gets into a service.
 *
 * So the value is accepted as object-or-array-or-null and normalized by
 * `firstOf`, which reads correctly under either answer. A person has at most one
 * manager, so a second element is impossible by the foreign key; taking the first
 * is a shape tolerance, not a choice about which manager wins.
 */
type ManagerRelation =
  | { readonly id: string; readonly first_name: string; readonly last_name: string }
  | readonly { readonly id: string; readonly first_name: string; readonly last_name: string }[]
  | null;

interface EmployeeRowWithRelations extends EmployeeRow {
  readonly department: { readonly id: string; readonly name: string } | readonly { id: string; name: string }[] | null;
  readonly manager: ManagerRelation;
}

function firstOf<T>(value: T | readonly T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : (value as T);
}

function toListEntry(row: EmployeeRowWithRelations): EmployeeListEntry {
  const department = firstOf(row.department);
  const manager = firstOf(row.manager);
  return {
    employee: row,
    departmentName: department?.name ?? null,
    managerName: manager === null ? null : employeeDisplayName(manager),
  };
}

const EMPLOYEE_RELATION_SELECT = `
  *,
  department:departments(id, name),
  manager:employees!manager_id(id, first_name, last_name)
` as const;

export interface ListEmployeeOptions {
  /** Free text over name, email, code and job title. Applied server-side. */
  readonly search?: string;
  readonly statuses?: readonly EmploymentStatus[];
  /** A department id, or `null` to include unassigned. `undefined` for no filter. */
  readonly departmentId?: string | null;
  /**
   * Whether a person with no department is included when `departmentId` is set.
   * `undefined` (the default) means no filter; `true` means departments only.
   */
  readonly departmentsOnly?: boolean;
  /** Return the full record set rather than the first page. Defaults to true. */
  readonly all?: boolean;
  /** Page size when `all` is false. */
  readonly limit?: number;
  readonly offset?: number;
}

const EMPLOYEE_SEARCH_COLUMNS = [
  'first_name',
  'last_name',
  'email',
  'employee_code',
  'job_title',
] as const;

/**
 * The employee directory for one organization.
 *
 * The default is the whole set, not a page. A workforce is a few hundred rows at
 * most, the list is read as a whole to be scanned rather than paged, and an
 * implicit first page would hide people past the cut with no indication they
 * exist. Callers that genuinely want pagination pass `all: false`.
 */
export async function listEmployees(
  organizationId: string,
  options: ListEmployeeOptions = {},
): Promise<ActionResult<readonly EmployeeListEntry[]>> {
  const result = await attempt(async () => {
    let query = supabase
      .from('employees')
      .select(EMPLOYEE_RELATION_SELECT)
      .eq('organization_id', organizationId);

    if (options.search !== undefined) {
      const filter = anyColumnIlike(options.search, EMPLOYEE_SEARCH_COLUMNS);
      if (filter !== null) query = query.or(filter);
    }

    if (options.statuses !== undefined && options.statuses.length > 0) {
      query = query.in('status', [...options.statuses]);
    }

    if (options.departmentId !== undefined) {
      if (options.departmentId === null) {
        query = query.is('department_id', null);
      } else {
        query = query.eq('department_id', options.departmentId);
      }
    } else if (options.departmentsOnly === true) {
      query = query.not('department_id', 'is', null);
    }

    query = query.order('last_name', { ascending: true }).order('first_name', { ascending: true });

    if (options.all === false) {
      query = query.range(
        options.offset ?? 0,
        (options.offset ?? 0) + (options.limit ?? 50) - 1,
      );
    }

    const { data, error } = await query;
    if (error !== null) throw error;
    return data as unknown as EmployeeRowWithRelations[] | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not list employees', { code: result.error.code });
    return result;
  }
  if (result.value === null) return ok([]);

  return ok(result.value.map(toListEntry));
}

export async function countEmployees(
  organizationId: string,
  statuses?: readonly EmploymentStatus[],
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    let query = supabase
      .from('employees')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    if (statuses !== undefined && statuses.length > 0) {
      query = query.in('status', [...statuses]);
    }
    const { count, error } = await query;
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Employee count failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Employee count was not returned'));
  }
  return ok(result.value);
}

/**
 * One employee by id, with their department, manager and direct reports.
 *
 * Direct reports are collected from the list rather than embedded, because
 * `employees` has no self-join to "reports" that PostgREST can name unambiguously
 * — the only self-reference is `manager_id` — and a mislabelled embedding would
 * silently return managers as reports. Building the list client-side cannot get
 * that wrong.
 */
export async function getEmployee(employeeId: string): Promise<ActionResult<EmployeeDetail>> {
  const found = await attempt(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select(EMPLOYEE_RELATION_SELECT)
      .eq('id', employeeId)
      .maybeSingle();
    if (error !== null) throw error;
    return data as unknown as EmployeeRowWithRelations | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!found.ok) return found;
  const employee = found.value;
  if (employee === null) {
    return err(appError('NOT_FOUND', 'Employee not visible to the caller'));
  }

  const entry = toListEntry(employee);

  const reports = await attempt(async () => {
    const { data, error } = await supabase
      .from('employees')
      .select('id')
      .eq('organization_id', employee.organization_id)
      .eq('manager_id', employeeId);
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!reports.ok) return reports;

  return ok({
    ...entry,
    directReportIds: (reports.value ?? []).map((row) => row.id),
  });
}

/**
 * Employees a project or task picker can offer.
 *
 * A separate call rather than a flag on `listEmployees` because the picker's job
 * is different: it must not offer someone who has left, and offering a former
 * employee as an assignee is a mistake that outlives the project.
 */
export async function listAssignableEmployees(
  organizationId: string,
  search?: string,
): Promise<ActionResult<readonly EmployeeListEntry[]>> {
  return listEmployees(organizationId, {
    statuses: ['active', 'probation', 'on_leave'],
    ...(search === undefined ? {} : { search }),
  });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreateEmployeeParams {
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  /**
   * An employee code. When omitted, one is derived from the current headcount —
   * see `suggestEmployeeCode` for why that is a suggestion and not an identity.
   * The column is `not null` with no database default, so it must always be
   * supplied; deriving it here rather than in SQL keeps the format in one place
   * and lets the form show the user what they are getting.
   */
  employeeCode?: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  status?: EmploymentStatus;
  /** The column is `joining_date`, not `joined_on`. */
  joiningDate?: string | null;
  /** Set once, to link a login to this person. See `linkEmployeeToUser`. */
  userId?: string | null;
}

/**
 * Adds a person to the directory.
 *
 * Admin only. Every string is normalized here rather than trusted, because the
 * columns carry `btrim` CHECK constraints and an untrimmed value is rejected by
 * Postgres with an error the form cannot explain.
 *
 * The headcount read and the insert are two round trips and are not atomic. Two
 * administrators saving at the same moment can both be handed `EMP-014`; the
 * unique index turns the second one into a `VALIDATION_FAILED` the form shows,
 * which is the correct outcome for a code nobody chose. Seeding the code from a
 * sequence in the database would remove the collision but would also remove the
 * organization's ability to use its own numbering scheme.
 */
export async function createEmployee(
  params: CreateEmployeeParams,
): Promise<ActionResult<EmployeeRow>> {
  const result = await attempt(async () => {
    const employeeCode =
      params.employeeCode === undefined ||
      params.employeeCode === null ||
      params.employeeCode.trim() === ''
        ? await nextSuggestedCode(params.organizationId)
        : normalizeEmployeeCode(params.employeeCode);

    const row: TablesInsert<'employees'> = {
      organization_id: params.organizationId,
      first_name: normalizePersonName(params.firstName),
      last_name: normalizePersonName(params.lastName),
      email: normalizeEmployeeEmail(params.email),
      employee_code: employeeCode,
      job_title: params.jobTitle?.trim() || null,
      phone: params.phone?.trim() || null,
      department_id: params.departmentId ?? null,
      manager_id: params.managerId ?? null,
      employment_status: params.status ?? 'active',
      joining_date: params.joiningDate ?? null,
      user_id: params.userId ?? null,
    };

    const { data, error } = await supabase.from('employees').insert(row).select('*').maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    if (isUniqueViolation(result.error.cause)) {
      return err(appError('VALIDATION_FAILED', uniqueViolationMessage(result.error.cause)));
    }
    log.warn('Employee creation failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('UNKNOWN', 'Employee insert returned no row'));
  }

  log.info('Employee created', { employeeId: result.value.id });
  return ok(result.value);
}

/** The headcount-derived code for a new employee. Throws on a failed count. */
async function nextSuggestedCode(organizationId: string): Promise<string> {
  const { count, error } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);
  if (error !== null) throw error;
  return suggestEmployeeCode(count ?? 0);
}

export interface UpdateEmployeeParams {
  firstName?: string;
  lastName?: string;
  email?: string;
  employeeCode?: string;
  jobTitle?: string | null;
  phone?: string | null;
  departmentId?: string | null;
  managerId?: string | null;
  status?: EmploymentStatus;
  joiningDate?: string | null;
}

/**
 * Edits an employee.
 *
 * `status` is the one field with a real rule attached: making someone `inactive`
 * does not unassign their open tasks, and that is intentional. Reassigning a
 * person's work is a scheduling decision with a real owner, and doing it
 * automatically would quietly move work to a colleague because somebody changed a
 * status. The UI surfaces the open tasks instead, so the owner sees what is
 * about to become unowned.
 */
export async function updateEmployee(
  employeeId: string,
  params: UpdateEmployeeParams,
): Promise<ActionResult<EmployeeRow>> {
  const changes: TablesUpdate<'employees'> = {};

  if (params.firstName !== undefined) changes.first_name = normalizePersonName(params.firstName);
  if (params.lastName !== undefined) changes.last_name = normalizePersonName(params.lastName);
  if (params.email !== undefined) changes.email = normalizeEmployeeEmail(params.email);
  if (params.employeeCode !== undefined) {
    // `not null` in the schema, so there is no "clear the code" path. A person
    // without a code cannot be referred to, which is the whole point of one.
    changes.employee_code = normalizeEmployeeCode(params.employeeCode);
  }
  if (params.jobTitle !== undefined) changes.job_title = params.jobTitle?.trim() || null;
  if (params.phone !== undefined) changes.phone = params.phone?.trim() || null;
  if (params.departmentId !== undefined) changes.department_id = params.departmentId;
  if (params.managerId !== undefined) changes.manager_id = params.managerId;
  if (params.status !== undefined) changes.employment_status = params.status;
  if (params.joiningDate !== undefined) changes.joining_date = params.joiningDate;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No employee fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('employees')
      .update(changes)
      .eq('id', employeeId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    if (isUniqueViolation(result.error.cause)) {
      return err(appError('VALIDATION_FAILED', uniqueViolationMessage(result.error.cause)));
    }
    log.warn('Employee update failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('PERMISSION_DENIED', 'Update matched no visible employee row'));
  }
  return ok(result.value);
}

/**
 * Removes a person from the directory.
 *
 * Admin only, and the design matters more than it looks: the `projects.owner_id`
 * and `project_members` foreign keys are `on delete restrict`, and `tasks.assignee_id`
 * is `on delete set null`. So a person who has ever owned a project CANNOT be
 * deleted — Postgres refuses, and the refusal is correct. Deleting them would
 * either erase the history of work they led or silently strip it of an owner.
 *
 * Setting a person to `inactive` is the exit. Deletion exists for the common case
 * of a record created in error.
 */
export async function deleteEmployee(employeeId: string): Promise<ActionResult<void>> {
  const result = await attempt(async () => {
    const { error } = await supabase.from('employees').delete().eq('id', employeeId);
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    if (result.error.cause !== null && result.error.cause !== undefined) {
      const cause = result.error.cause as { code?: unknown } | null;
      if (cause !== null && cause.code === '23503') {
        return err(
          appError(
            'VALIDATION_FAILED',
            'This person is referenced by project history. Set them to inactive instead of deleting them.',
          ),
        );
      }
    }
    log.warn('Employee delete failed', { code: result.error.code });
    return result;
  }
  return ok(undefined);
}

/**
 * Links a login to an employee record.
 *
 * Separate from `createEmployee` and `updateEmployee` because the two directions
 * are not symmetric: a person is often added to the directory before they are ever
 * issued a sign-in, and a login may exist before its employee row does. Only the
 * bridge field moves here.
 *
 * Idempotent in the way that matters — re-linking the same user to the same
 * employee is a no-op rather than an error, because the natural place to call this
 * is a sign-in hook that runs every time somebody opens the app.
 */
export async function linkEmployeeToUser(
  employeeId: string,
  userId: string,
): Promise<ActionResult<EmployeeRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('employees')
      .update({ user_id: userId })
      .eq('id', employeeId)
      .is('user_id', null)
      .select('*')
      .maybeSingle();

    if (error !== null) throw error;
    if (data !== null) return data;

    // Already linked. Confirm it is linked to THIS user before declaring success,
    // so a second person claiming the account is reported rather than absorbed.
    const { data: current, error: readError } = await supabase
      .from('employees')
      .select('*')
      .eq('id', employeeId)
      .maybeSingle();
    if (readError !== null) throw readError;
    if (current === null) return null;
    if (current.user_id !== userId) {
      throw Object.assign(new Error('Employee is already linked to another sign-in'), {
        code: 'LINKED_ELSEWHERE',
      });
    }
    return current;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('NOT_FOUND', 'Employee not visible to the caller'));
  }
  return ok(result.value);
}

/** The headcount basis for a directory screen: everyone currently on the books. */
export async function countCurrentEmployees(
  organizationId: string,
): Promise<ActionResult<number>> {
  return countEmployees(organizationId, ['active', 'probation', 'on_leave']);
}

// ---------------------------------------------------------------------------
// Directory roll-ups
// ---------------------------------------------------------------------------

export interface DepartmentHeadcount {
  readonly departmentId: string;
  readonly departmentName: string | null;
  /** Everyone on the books in this department, or the unassigned bucket. */
  readonly total: number;
  /** The subset still `active` — what a manager actually staffs from. */
  readonly active: number;
}

/**
 * Employees per department, for the directory's summary.
 *
 * Computed from the caller's own visible rows rather than from a `group()` on the
 * server, because the interesting split is `active` versus everything else, and
 * an aggregate that returns one number per group cannot express two. It is also
 * the only place in this service that does arithmetic in JavaScript, which is
 * acceptable precisely because the set is the whole directory — a few hundred
 * rows, already in memory.
 *
 * People with no department land in a single `null` bucket rather than vanishing.
 * Dropping them is how a directory ends up reporting fewer people than the
 * organization has.
 */
export async function departmentHeadcounts(
  organizationId: string,
  departments: readonly DepartmentRow[],
): Promise<ActionResult<readonly DepartmentHeadcount[]>> {
  const listed = await listEmployees(organizationId);
  if (!listed.ok) return listed;

  const lookup = buildDepartmentLookup(departments);
  const buckets = new Map<string, { name: string | null; total: number; active: number }>();

  const bucketFor = (departmentId: string | null) => {
    const key = departmentId ?? ' unassigned';
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        name: departmentId === null ? null : (lookup.get(departmentId) ?? null),
        total: 0,
        active: 0,
      };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  // Seed from the department list so a department with nobody in it is still
  // reported. A department absent from the summary reads as deleted.
  for (const department of departments) bucketFor(department.id);

  for (const { employee } of listed.value) {
    const bucket = bucketFor(employee.department_id);
    bucket.total += 1;
    if (employee.employment_status === 'active') bucket.active += 1;
  }

  const unassigned = buckets.get(' unassigned');
  if (unassigned !== undefined) unassigned.name = null;

  const rows: DepartmentHeadcount[] = [...buckets.entries()].map(([key, bucket]) => ({
    departmentId: key === ' unassigned' ? '' : key,
    departmentName: bucket.name,
    total: bucket.total,
    active: bucket.active,
  }));

  return ok(rows);
}
