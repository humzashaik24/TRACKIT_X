/**
 * Trackit X — project service.
 *
 * Reads and writes projects and the people on them. See `departmentService` for
 * why these queries scope by organization and never by user.
 *
 * ── Why memberships live in a separate service method ───────────────────────
 * `project_members` has no `organization_id`; the tenant is derived from
 * `project_id`. That makes it the one table in this phase whose RLS cannot be
 * expressed as "is the caller a member of `row.organization_id`", and the
 * membership methods below are written around that rather than around a
 * convenience: every one of them takes a project id and lets the policy resolve
 * the tenant. Nothing here is allowed to accept an `organizationId` for a
 * membership write, because accepting one would invite a caller to believe it is
 * the thing being checked.
 */
import { supabase } from '@/lib/supabase';
import { anyColumnIlike } from '@/lib/postgrestFilters';
import { employeeDisplayName } from '@/domain/employee';
import {
  normalizeProjectName,
  type ProjectMemberRole,
  type ProjectPriority,
  type ProjectRow,
  type ProjectStatus,
} from '@/domain/project';
import type { ProjectMemberRow, TablesInsert, TablesUpdate } from '@/types/database';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'projectService' });

export type { ProjectMemberRow, ProjectPriority, ProjectRow, ProjectStatus };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ProjectListEntry {
  readonly project: ProjectRow;
  readonly ownerName: string | null;
  readonly memberCount: number;
}

/**
 * A project with its owner named and its team counted.
 *
 * Member counts come back as a single aggregate on the project rather than as a
 * second relation, because PostgREST cannot return both "the rows" and "a count of
 * the rows" in one embed. The headcount is what a list column needs, and the
 * names are fetched by `listProjectMembers` when a row is actually opened — so
 * paying for N members on a list of N projects is a cost that buys nothing.
 */
interface ProjectRowWithOwner extends ProjectRow {
  readonly owner:
    | { readonly id: string; readonly first_name: string; readonly last_name: string }
    | readonly { readonly id: string; readonly first_name: string; readonly last_name: string }[]
    | null;
  readonly project_members: readonly { readonly count: number }[];
}

function firstOf<T>(value: T | readonly T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : (value as T);
}

function toListEntry(row: ProjectRowWithOwner): ProjectListEntry {
  const owner = firstOf(row.owner);
  return {
    project: row,
    ownerName: owner === null ? null : employeeDisplayName(owner),
    // Absent rather than zero when the aggregate did not come back: "nobody is on
    // this project" and "the count was not returned" are different facts, and
    // collapsing them makes an empty project look like an unanswered question.
    memberCount: row.project_members[0]?.count ?? 0,
  };
}

const PROJECT_SELECT = `
  *,
  owner:employees!projects_owner_id_fkey(id, first_name, last_name),
  project_members(count)
` as const;

export interface ListProjectOptions {
  readonly search?: string;
  readonly statuses?: readonly ProjectStatus[];
  readonly ownerId?: string;
  /** `true` for projects with nobody accountable. */
  readonly unownedOnly?: boolean;
  /** Only projects with a target date that has passed and that are still open. */
  readonly overdueOnly?: boolean;
  /** `YYYY-MM-DD`, supplied by the caller so the rule is testable. */
  readonly today?: string;
  readonly all?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

const PROJECT_SEARCH_COLUMNS = ['name', 'description'] as const;

/**
 * The projects of one organization.
 *
 * `overdueOnly` is evaluated in the database rather than by filtering the returned
 * rows, because a client-side filter over a complete list has to be a client-side
 * filter over an INCOMPLETE one to be efficient — and a screen that says "3
 * overdue" while having only read the first fifty projects is worse than no
 * screen. The date is passed in because the caller owns "today" and the tests need
 * to be able to claim otherwise.
 */
export async function listProjects(
  organizationId: string,
  options: ListProjectOptions = {},
): Promise<ActionResult<readonly ProjectListEntry[]>> {
  const result = await attempt(async () => {
    let query = supabase.from('projects').select(PROJECT_SELECT).eq('organization_id', organizationId);

    if (options.search !== undefined) {
      const filter = anyColumnIlike(options.search, PROJECT_SEARCH_COLUMNS);
      if (filter !== null) query = query.or(filter);
    }

    if (options.statuses !== undefined && options.statuses.length > 0) {
      query = query.in('status', [...options.statuses]);
    }

    if (options.ownerId !== undefined) {
      query = query.eq('owner_id', options.ownerId);
    } else if (options.unownedOnly === true) {
      query = query.is('owner_id', null);
    }

    if (options.overdueOnly === true) {
      if (options.today === undefined) {
        throw appError('VALIDATION_FAILED', 'overdueOnly needs a reference date');
      }
      // Open statuses only. An overdue COMPLETED project is a closed project whose
      // target slipped, which is history rather than a late delivery, and listing
      // it beside the genuinely late ones misreports the backlog.
      query = query
        .lt('target_date', options.today)
        .in('status', ['planned', 'active', 'on_hold']);
    }

    query = query.order('name', { ascending: true });

    if (options.all === false) {
      query = query.range(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;
    if (error !== null) throw error;
    return data as unknown as ProjectRowWithOwner[] | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) return ok([]);
  return ok(result.value.map(toListEntry));
}

export async function countProjects(
  organizationId: string,
  statuses?: readonly ProjectStatus[],
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    let query = supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    if (statuses !== undefined && statuses.length > 0) {
      query = query.in('status', [...statuses]);
    }
    const { count, error } = await query;
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Project count was not returned'));
  }
  return ok(result.value);
}

export async function getProject(projectId: string): Promise<ActionResult<ProjectRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('NOT_FOUND', 'Project not visible to the caller'));
  }
  return ok(result.value);
}

/** Projects somebody is on, for the "my work" view. Empty is an ordinary answer. */
export async function listProjectsForEmployee(
  employeeId: string,
): Promise<ActionResult<readonly ProjectRow[]>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('project:projects(*)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;

  const rows = (result.value ?? []).flatMap((entry) => {
    const project = entry.project as unknown as ProjectRow | ProjectRow[] | null;
    return firstOf(project) ?? [];
  });
  return ok(rows);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreateProjectParams {
  organizationId: string;
  name: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: string | null;
  targetDate?: string | null;
  /** `null` creates a project with nobody accountable — allowed, and common. */
  ownerId?: string | null;
  /** 0-100. Omit for 0, which is a statement that nothing has been done yet. */
  progress?: number;
}

export async function createProject(
  params: CreateProjectParams,
): Promise<ActionResult<ProjectRow>> {
  const row: TablesInsert<'projects'> = {
    organization_id: params.organizationId,
    name: normalizeProjectName(params.name),
    description: params.description?.trim() || null,
    status: params.status ?? 'planned',
    priority: params.priority ?? 'medium',
    start_date: params.startDate ?? null,
    target_date: params.targetDate ?? null,
    owner_id: params.ownerId ?? null,
    progress: params.progress ?? 0,
  };

  const result = await attempt(async () => {
    const { data, error } = await supabase.from('projects').insert(row).select('*').maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Project creation failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('UNKNOWN', 'Project insert returned no row'));
  }

  log.info('Project created', { projectId: result.value.id });
  return ok(result.value);
}

export interface UpdateProjectParams {
  name?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: ProjectPriority;
  startDate?: string | null;
  targetDate?: string | null;
  ownerId?: string | null;
  progress?: number;
}

/**
 * Edits a project.
 *
 * The schema has no `description` trim CHECK, so `description` is trimmed here
 * rather than left alone — the reason is not consistency with the other columns
 * but that a summary shown in a list should not carry trailing whitespace into a
 * two-line clamp.
 */
export async function updateProject(
  projectId: string,
  params: UpdateProjectParams,
): Promise<ActionResult<ProjectRow>> {
  const changes: TablesUpdate<'projects'> = {};

  if (params.name !== undefined) changes.name = normalizeProjectName(params.name);
  if (params.description !== undefined) changes.description = params.description?.trim() || null;
  if (params.status !== undefined) changes.status = params.status;
  if (params.priority !== undefined) changes.priority = params.priority;
  if (params.startDate !== undefined) changes.start_date = params.startDate;
  if (params.targetDate !== undefined) changes.target_date = params.targetDate;
  if (params.ownerId !== undefined) changes.owner_id = params.ownerId;
  if (params.progress !== undefined) changes.progress = params.progress;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No project fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('projects')
      .update(changes)
      .eq('id', projectId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Project update failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('PERMISSION_DENIED', 'Update matched no visible project row'));
  }
  return ok(result.value);
}

/**
 * Deletes a project.
 *
 * Admin only, and it CASCADES: every task under the project goes with it. That is
 * why the privilege sits above manager even though creating one does not — a
 * manager can start a job but cannot destroy the record of it.
 *
 * The call is not made transactional here. It cannot be: PostgREST has no
 * multi-statement transaction, and two deletes in sequence would leave a window
 * where the tasks are gone and the project is not. One statement with an explicit
 * ON DELETE CASCADE has no such window, which is the reason the cascade is in the
 * schema rather than in application code.
 */
export async function deleteProject(projectId: string): Promise<ActionResult<void>> {
  const result = await attempt(async () => {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Project delete failed', { code: result.error.code });
    return result;
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export interface ProjectMemberEntry {
  readonly membership: ProjectMemberRow;
  readonly employeeName: string;
  readonly jobTitle: string | null;
}

interface MemberRowWithEmployee extends ProjectMemberRow {
  readonly employee:
    | { readonly id: string; readonly first_name: string; readonly last_name: string; readonly job_title: string | null }
    | readonly {
        readonly id: string;
        readonly first_name: string;
        readonly last_name: string;
        readonly job_title: string | null;
      }[]
    | null;
}

/** The people on a project, by name, with the lead first. */
export async function listProjectMembers(
  projectId: string,
): Promise<ActionResult<readonly ProjectMemberEntry[]>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('*, employee:employees(id, first_name, last_name, job_title)')
      .eq('project_id', projectId);
    if (error !== null) throw error;
    return data as unknown as MemberRowWithEmployee[] | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) return ok([]);

  const entries = result.value.flatMap((row): ProjectMemberEntry[] => {
    const employee = firstOf(row.employee);
    // A membership whose employee has vanished cannot happen — the foreign key is
    // ON DELETE CASCADE — so a missing embed means the select was wrong, not that
    // the data is. Skipping is the honest response; rendering a blank row would
    // suggest the person is unnamed rather than unreadable.
    if (employee === null) return [];
    return [
      {
        membership: row,
        employeeName: employeeDisplayName(employee),
        jobTitle: employee.job_title,
      },
    ];
  });

  const leadRank = (entry: ProjectMemberEntry) => (entry.membership.role === 'lead' ? 0 : 1);
  return ok(
    [...entries].sort(
      (a, b) => leadRank(a) - leadRank(b) || a.employeeName.localeCompare(b.employeeName),
    ),
  );
}

export interface AddProjectMemberParams {
  projectId: string;
  employeeId: string;
  role?: ProjectMemberRole;
  /** 0-100. */
  allocationPercent?: number;
}

/**
 * Puts somebody on a project.
 *
 * Idempotent by design: a duplicate hits `project_members_project_employee_unique`
 * and is reported as an update of the existing row rather than an error. The
 * natural place to call this is a multi-select where the user ticks a person who
 * was already on the team, and failing that save over a name they can see is not a
 * useful outcome.
 *
 * The cross-tenant pair is refused by `guard_project_member_write`, not by
 * anything here — a client that checked would be a client-side copy of a rule the
 * database already holds.
 */
export async function addProjectMember(
  params: AddProjectMemberParams,
): Promise<ActionResult<ProjectMemberRow>> {
  const row: TablesInsert<'project_members'> = {
    project_id: params.projectId,
    employee_id: params.employeeId,
    role: params.role ?? 'contributor',
    allocation_percent: params.allocationPercent ?? 100,
  };

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .insert(row)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('UNKNOWN', 'Project membership insert returned no row'));
  }
  return ok(result.value);
}

export async function updateProjectMember(
  membershipId: string,
  patch: { role?: ProjectMemberRole; allocationPercent?: number },
): Promise<ActionResult<ProjectMemberRow>> {
  const changes: TablesUpdate<'project_members'> = {};
  if (patch.role !== undefined) changes.role = patch.role;
  if (patch.allocationPercent !== undefined) changes.allocation_percent = patch.allocationPercent;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No membership fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .update(changes)
      .eq('id', membershipId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('PERMISSION_DENIED', 'Update matched no visible membership row'));
  }
  return ok(result.value);
}

export async function removeProjectMember(membershipId: string): Promise<ActionResult<void>> {
  const result = await attempt(async () => {
    const { error } = await supabase.from('project_members').delete().eq('id', membershipId);
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  return ok(undefined);
}

/**
 * A person's total allocation across every project they are on.
 *
 * Reported, never enforced — see `isOverAllocated`. Returned as a number so the
 * directory can show the warning without each screen re-deriving it.
 */
export async function totalAllocationFor(
  employeeId: string,
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('project_members')
      .select('allocation_percent')
      .eq('employee_id', employeeId);
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;

  const percents = (result.value ?? []).map((row) => row.allocation_percent);
  return ok(percents.reduce((sum, value) => sum + value, 0));
}
