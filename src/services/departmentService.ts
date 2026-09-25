/**
 * Trackit X — department service.
 *
 * Reads and writes the departments an organization groups its people into.
 *
 * Departments are a small table, read on nearly every workforce screen and written
 * by administrators only, so this service is the thinnest of the business-data
 * ones — but it is a service rather than an inline query so that the
 * `is_organization_member` guarantee is stated once, in one place, instead of
 * being re-derived at each call site.
 *
 * ── Why the queries filter on `organization_id` but never on a user ───────────
 * See `organizationService` for the full argument. In short: RLS restricts which
 * ROWS a caller can see, and no client-side filter can widen that. What the
 * explicit `.eq('organization_id', …)` does add is intent — it states which
 * tenant is being asked about, and it makes the returned set correct even if a
 * caller is a member of two organizations and only wants one. It is not the
 * security boundary, and it is not treated as one.
 *
 * A cross-tenant read here returns NOTHING rather than erroring, and callers must
 * treat that as an ordinary answer.
 */
import { supabase } from '@/lib/supabase';
import { anyColumnIlike } from '@/lib/postgrestFilters';
import type { DepartmentRow, TablesInsert, TablesUpdate } from '@/types/database';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'departmentService' });

export type { DepartmentRow };

export interface CreateDepartmentParams {
  organizationId: string;
  name: string;
  description?: string | null;
}

export interface DepartmentPatch {
  name?: string;
  description?: string | null;
}

export interface ListDepartmentOptions {
  /** Free text over name and description. Applied server-side. */
  readonly search?: string;
}

/**
 * The departments of one organization, alphabetically.
 *
 * Alphabetical rather than by creation date because this list is used to pick one,
 * and a picker people have to scroll to find "Production" in is a picker that gets
 * skipped.
 */
export async function listDepartments(
  organizationId: string,
  options: ListDepartmentOptions = {},
): Promise<ActionResult<readonly DepartmentRow[]>> {
  const filter = options.search === undefined ? null : anyColumnIlike(options.search, ['name', 'description']);

  const result = await attempt(async () => {
    let query = supabase
      .from('departments')
      .select('*')
      .eq('organization_id', organizationId);

    if (filter !== null) query = query.or(filter);

    const { data, error } = await query.order('name', { ascending: true });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not list departments', { code: result.error.code });
    return result;
  }
  return ok(result.value);
}

export async function countDepartments(
  organizationId: string,
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    const { count, error } = await supabase
      .from('departments')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Department count failed', { code: result.error.code });
    return result;
  }
  // An absent count is a failure the screen can retry, not a zero to display.
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Department count was not returned'));
  }
  return ok(result.value);
}

/**
 * One department by id.
 *
 * Resolves to `NOT_FOUND` rather than `PERMISSION_DENIED` when the caller cannot
 * see it, because a refusal would confirm the row exists in a tenant they are not
 * part of. That is the same rule `organizationService` follows, for the same
 * reason.
 */
export async function getDepartment(
  departmentId: string,
): Promise<ActionResult<DepartmentRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('departments')
      .select('*')
      .eq('id', departmentId)
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('NOT_FOUND', 'Department not visible to the caller'));
  }
  return ok(result.value);
}

/**
 * Creates a department.
 *
 * The INSERT policy requires `admin`. A member's insert therefore fails with
 * 42501 rather than returning quietly, which is the correct shape: this is a
 * refusal, not a missing row.
 */
export async function createDepartment(
  params: CreateDepartmentParams,
): Promise<ActionResult<DepartmentRow>> {
  const row: TablesInsert<'departments'> = {
    organization_id: params.organizationId,
    name: params.name,
    description: params.description ?? null,
  };

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('departments')
      .insert(row)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Department creation failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('UNKNOWN', 'Department insert returned no row'));
  }

  log.info('Department created', { departmentId: result.value.id });
  return ok(result.value);
}

/**
 * Updates a department.
 *
 * A caller below `admin` matches no row rather than erroring, so
 * `.select().maybeSingle()` is what turns that silence into an actionable result.
 */
export async function updateDepartment(
  departmentId: string,
  patch: DepartmentPatch,
): Promise<ActionResult<DepartmentRow>> {
  const changes: TablesUpdate<'departments'> = {};
  if (patch.name !== undefined) changes.name = patch.name;
  if (patch.description !== undefined) changes.description = patch.description;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No department fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('departments')
      .update(changes)
      .eq('id', departmentId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Department update failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('PERMISSION_DENIED', 'Update matched no visible department row'));
  }
  return ok(result.value);
}

/**
 * Deletes a department.
 *
 * Employees reference one with `on delete set null`, so deleting a department
 * never deletes a person — it leaves them unassigned. That is the intended
 * behaviour and the reason the column's foreign key is `SET NULL` rather than
 * `CASCADE`.
 */
export async function deleteDepartment(departmentId: string): Promise<ActionResult<void>> {
  const result = await attempt(async () => {
    const { error } = await supabase.from('departments').delete().eq('id', departmentId);
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Department delete failed', { code: result.error.code });
    return result;
  }
  return ok(undefined);
}
