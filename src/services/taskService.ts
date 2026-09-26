/**
 * Trackit X — task service.
 *
 * Reads and writes work items. See `departmentService` for why these queries scope
 * by organization and never by user.
 *
 * ── Why this service checks ownership that the database also checks ──────────
 * `tasks_update_own_or_managers` decides which rows a caller may write, and it is
 * the only Phase 32 policy that depends on WHO the caller is rather than what
 * role they hold. That makes it the policy most likely to be met with a surprised
 * report — "I could not save my own task" — and `updateTask` is written to produce
 * an answer that explains it rather than a bare 42501. The database still decides.
 * This is a diagnostic, not a gate.
 */
import { supabase } from '@/lib/supabase';
import { anyColumnIlike } from '@/lib/postgrestFilters';
import { employeeDisplayName, type EmployeeRow } from '@/domain/employee';
import {
  isTaskOverdue,
  normalizeTaskTitle,
  OPEN_TASK_STATUSES,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '@/domain/task';
import { clampProgress } from '@/domain/progress';
import type { TablesInsert, TablesUpdate } from '@/types/database';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'taskService' });

export type { TaskPriority, TaskRow, TaskStatus };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface TaskListEntry {
  readonly task: TaskRow;
  readonly projectName: string | null;
  readonly assigneeName: string | null;
}

/**
 * A task with its project and assignee named.
 *
 * `project` is nullable BY DESIGN — see the header of `src/domain/task.ts` — so
 * the relation is nullable here too and an unprojected task renders as "No
 * project" rather than as a broken row.
 */
interface TaskRowWithRelations extends TaskRow {
  readonly project: { readonly id: string; readonly name: string } | readonly { id: string; name: string }[] | null;
  readonly assignee:
    | { readonly id: string; readonly first_name: string; readonly last_name: string }
    | readonly { readonly id: string; readonly first_name: string; readonly last_name: string }[]
    | null;
}

function firstOf<T>(value: T | readonly T[] | null | undefined): T | null {
  if (value === null || value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : (value as T);
}

function toListEntry(row: TaskRowWithRelations): TaskListEntry {
  const project = firstOf(row.project);
  const assignee = firstOf(row.assignee);
  return {
    task: row,
    projectName: project?.name ?? null,
    assigneeName: assignee === null ? null : employeeDisplayName(assignee),
  };
}

const TASK_SELECT = `
  *,
  project:projects(id, name),
  assignee:employees!tasks_assignee_id_fkey(id, first_name, last_name)
` as const;

export interface ListTaskOptions {
  readonly search?: string;
  readonly statuses?: readonly TaskStatus[];
  readonly projectId?: string;
  readonly assigneeId?: string;
  /** `true` for tasks nobody owns. */
  readonly unassignedOnly?: boolean;
  readonly overdueOnly?: boolean;
  /** `YYYY-MM-DD`, supplied by the caller so the rule is testable. */
  readonly today?: string;
  /** Only tasks NOT on any project. */
  readonly standaloneOnly?: boolean;
  readonly all?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

const TASK_SEARCH_COLUMNS = ['title', 'description'] as const;

/**
 * The tasks of one organization.
 *
 * Ordered by the things a person actually triages with — whether it is late, when
 * it is due, how urgent — rather than by insertion. `nullsFirst` on `due_date` is
 * explicit because an undated task is not "due last"; in Postgres NULL sorts last
 * ascending BY DEFAULT, which would bury the very tasks with no deadline at the
 * bottom of the list, exactly where a triage view least wants them.
 */
export async function listTasks(
  organizationId: string,
  options: ListTaskOptions = {},
): Promise<ActionResult<readonly TaskListEntry[]>> {
  const result = await attempt(async () => {
    let query = supabase.from('tasks').select(TASK_SELECT).eq('organization_id', organizationId);

    if (options.search !== undefined) {
      const filter = anyColumnIlike(options.search, TASK_SEARCH_COLUMNS);
      if (filter !== null) query = query.or(filter);
    }

    if (options.statuses !== undefined && options.statuses.length > 0) {
      query = query.in('status', [...options.statuses]);
    }

    if (options.projectId !== undefined) {
      if (options.projectId === null) {
        query = query.is('project_id', null);
      } else {
        query = query.eq('project_id', options.projectId);
      }
    } else if (options.standaloneOnly === true) {
      query = query.is('project_id', null);
    }

    if (options.assigneeId !== undefined) {
      if (options.assigneeId === null) {
        query = query.is('assignee_id', null);
      } else {
        query = query.eq('assignee_id', options.assigneeId);
      }
    } else if (options.unassignedOnly === true) {
      query = query.is('assignee_id', null);
    }

    if (options.overdueOnly === true) {
      if (options.today === undefined) {
        throw appError('VALIDATION_FAILED', 'overdueOnly needs a reference date');
      }
      // Open statuses only, for the same reason as `listProjects`: a finished task
      // whose due date slipped is history, not a late delivery.
      query = query
        .lt('due_date', options.today)
        .in('status', [...OPEN_TASK_STATUSES]);
    }

    query = query
      .order('due_date', { ascending: true, nullsFirst: true })
      .order('priority', { ascending: false })
      .order('title', { ascending: true });

    if (options.all === false) {
      query = query.range(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50) - 1);
    }

    const { data, error } = await query;
    if (error !== null) throw error;
    return data as unknown as TaskRowWithRelations[] | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) return ok([]);
  return ok(result.value.map(toListEntry));
}

export async function countTasks(
  organizationId: string,
  statuses?: readonly TaskStatus[],
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    let query = supabase
      .from('tasks')
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
    return err(appError('DEPENDENCY_FAILED', 'Task count was not returned'));
  }
  return ok(result.value);
}

/** Late, still-open tasks. Drives the dashboard's "needs attention" figure. */
export async function countOverdueTasks(
  organizationId: string,
  today: string,
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    const { count, error } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .lt('due_date', today)
      .in('status', ['todo', 'in_progress', 'blocked', 'in_review']);
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Overdue task count was not returned'));
  }
  return ok(result.value);
}

export async function getTask(taskId: string): Promise<ActionResult<TaskRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('NOT_FOUND', 'Task not visible to the caller'));
  }
  return ok(result.value);
}

/**
 * The caller's own employee row within an organization, or `null`.
 *
 * `null` is a real and common answer: a login can exist with no employee record,
 * which is exactly the case the two-table design in `src/domain/employee.ts`
 * anticipates. Callers must treat it as "this login is not on the payroll", NOT as
 * an error and — critically — not as "no filter", because a filter that silently
 * does nothing shows one person everybody's tasks.
 *
 * The lookup is the RPC rather than a client-side read of `employees.user_id`,
 * because the client's own session is the only trustworthy source of "who is
 * asking" and the SQL defaults the argument to `auth.uid()`.
 */
export async function currentEmployeeId(
  organizationId: string,
): Promise<ActionResult<string | null>> {
  const result = await attempt(async () => {
    // `p_user` is omitted deliberately: the SQL defaults it to `auth.uid()`, so
    // passing it would mean asserting on the client's behalf who the caller is.
    const { data, error } = await supabase
      .rpc('employee_id_for_user', { p_organization: organizationId })
      .maybeSingle();
    if (error !== null) throw error;
    return data as string | null;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Employee identity lookup failed', { code: result.error.code });
    return result;
  }
  return ok(result.value);
}

/**
 * The caller's own tasks.
 *
 * A distinct call because "mine" is a question about the CALLER, and the
 * organization id alone cannot answer it. Resolved with
 * `employee_id_for_user`, so a login with no employee row gets an empty list
 * rather than every task in the business.
 */
export async function listTasksForCurrentUser(
  organizationId: string,
  options: Omit<ListTaskOptions, 'assigneeId' | 'unassignedOnly'> = {},
): Promise<ActionResult<readonly TaskListEntry[]>> {
  const mine = await currentEmployeeId(organizationId);
  if (!mine.ok) return mine;
  if (mine.value === null) return ok([]);

  return listTasks(organizationId, { ...options, assigneeId: mine.value });
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface CreateTaskParams {
  organizationId: string;
  title: string;
  description?: string | null;
  /** `null` — the default — is a task that belongs to no project. */
  projectId?: string | null;
  /**
   * Who is doing it. A member may only pass their own id or `null`; the
   * `tasks_insert_members` policy refuses anything else, and this service does not
   * pretend otherwise.
   */
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  dueDate?: string | null;
}

export async function createTask(params: CreateTaskParams): Promise<ActionResult<TaskRow>> {
  const row: TablesInsert<'tasks'> = {
    organization_id: params.organizationId,
    title: normalizeTaskTitle(params.title),
    description: params.description?.trim() || null,
    project_id: params.projectId ?? null,
    assignee_id: params.assigneeId ?? null,
    status: params.status ?? 'todo',
    priority: params.priority ?? 'medium',
    progress: clampProgress(params.progress ?? 0),
    due_date: params.dueDate ?? null,
  };

  const result = await attempt(async () => {
    const { data, error } = await supabase.from('tasks').insert(row).select('*').maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Task creation failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('UNKNOWN', 'Task insert returned no row'));
  }

  log.info('Task created', { taskId: result.value.id });
  return ok(result.value);
}

export interface UpdateTaskParams {
  title?: string;
  description?: string | null;
  projectId?: string | null;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  progress?: number;
  dueDate?: string | null;
}

/**
 * Edits a task.
 *
 * `progress` is clamped rather than validated-and-rejected. A slider is a
 * continuous control and a keyboard can put it at 137; clamping to 100 keeps the
 * value inside the CHECK constraint and the user inside the screen, which is a
 * better outcome than a failed save on a field they cannot see the error for.
 *
 * The one thing NOT done here is forcing `progress` to 100 when `status` becomes
 * `done`. It is tempting and it is wrong: a task can be delivered with the figure
 * left at whatever it was, and silently rewriting somebody's number because they
 * ticked a box makes the figure untrustworthy as history. `impliedProgressForTaskStatus`
 * exists for screens that want to SHOW 100 for a done task, and that is the right
 * place for the rule.
 */
export async function updateTask(
  taskId: string,
  params: UpdateTaskParams,
): Promise<ActionResult<TaskRow>> {
  const changes: TablesUpdate<'tasks'> = {};

  if (params.title !== undefined) changes.title = normalizeTaskTitle(params.title);
  if (params.description !== undefined) changes.description = params.description?.trim() || null;
  if (params.projectId !== undefined) changes.project_id = params.projectId;
  if (params.assigneeId !== undefined) changes.assignee_id = params.assigneeId;
  if (params.status !== undefined) changes.status = params.status;
  if (params.priority !== undefined) changes.priority = params.priority;
  if (params.progress !== undefined) changes.progress = clampProgress(params.progress);
  if (params.dueDate !== undefined) changes.due_date = params.dueDate;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No task fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .update(changes)
      .eq('id', taskId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    // A member who does not own the task and is not a manager matches no row in
    // the UPDATE policy, so Postgres reports it exactly as it reports a missing
    // row. Saying so plainly beats surfacing a permission error that reads like an
    // account problem.
    log.warn('Task update failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(
      appError(
        'PERMISSION_DENIED',
        'No visible task matched. This task may be gone, or it may belong to somebody else.',
      ),
    );
  }
  return ok(result.value);
}

/** Manager only — see `canDeleteTasks`. */
export async function deleteTask(taskId: string): Promise<ActionResult<void>> {
  const result = await attempt(async () => {
    const { error } = await supabase.from('tasks').delete().eq('id', taskId);
    if (error !== null) throw error;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Task delete failed', { code: result.error.code });
    return result;
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Dashboard roll-ups
// ---------------------------------------------------------------------------

export interface TaskStatusTally {
  readonly status: TaskStatus;
  readonly count: number;
}

/**
 * How many tasks sit in each state, with every state present.
 *
 * States with a count of zero are INCLUDED, and that is the whole reason this is
 * worth its own query rather than being derived from a list: a chart drawn from
 * the states that happen to have tasks in them silently omits "nothing is
 * blocked", which is the single most reassuring row on a delivery view. A tally
 * that omits the empty state cannot be distinguished from a tally that has not
 * been run.
 */
export async function taskStatusTally(
  organizationId: string,
): Promise<ActionResult<readonly TaskStatusTally[]>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('status')
      .eq('organization_id', organizationId);
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;

  const counts = new Map<TaskStatus, number>();
  for (const row of result.value ?? []) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }

  const STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'blocked', 'in_review', 'done'];
  return ok(STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })));
}

/** Everyone with open work, by name, for a "who is busy" view. */
export async function listTaskAssignees(
  organizationId: string,
  employees: readonly EmployeeRow[],
): Promise<ActionResult<readonly { employeeId: string; name: string; openTasks: number }[]>> {
  const listed = await listTasks(organizationId, {
    statuses: ['todo', 'in_progress', 'blocked', 'in_review'],
  });
  if (!listed.ok) return listed;

  const counts = new Map<string, number>();
  for (const { task } of listed.value) {
    if (task.assignee_id === null) continue;
    counts.set(task.assignee_id, (counts.get(task.assignee_id) ?? 0) + 1);
  }

  const rows = employees
    .filter((employee) => counts.has(employee.id))
    .map((employee) => ({
      employeeId: employee.id,
      name: employeeDisplayName(employee),
      openTasks: counts.get(employee.id) ?? 0,
    }))
    .sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name));

  return ok(rows);
}

/** Late tasks, for the dashboard list. `today` is passed in, never read here. */
export async function listOverdueTasks(
  organizationId: string,
  today: string,
): Promise<ActionResult<readonly TaskListEntry[]>> {
  return listTasks(organizationId, { overdueOnly: true, today });
}

/**
 * How many OPEN tasks each project is carrying, keyed by project id.
 *
 * ── Why this is one query and not one count per project ──────────────────────
 * A list of N projects asking "how many tasks are open on this one" is N round trips,
 * and the natural place to put that loop — the project list — is a screen that loads
 * on every organization switch. So the two small columns come back once and the tally
 * is done here. This is the same trade `listTaskAssignees` makes above, and the same
 * reason: two nullable columns for the whole business is a cheaper read than a
 * request per row, and the alternative silently degrades into a screen that is
 * unusably slow once there are enough projects to notice.
 *
 * A project with no open tasks is ABSENT from the map rather than mapped to zero, so
 * `map.get(id) ?? 0` at the call site is a decision made once, in one place, instead
 * of every screen inventing its own default. Tasks on no project are excluded: this
 * function answers "what is this project carrying", and an unprojected task is
 * carrying nothing here — see the header of `src/domain/task.ts`.
 *
 * The status list is `OPEN_TASK_STATUSES` rather than a literal, which is the point
 * worth making: this and the `overdueOnly` filter above are the only two places in
 * the client that decide which tasks are unfinished, and both now read the one array
 * in the domain. Retyping the list here would have left a query that keeps working
 * and quietly stops counting a status the day somebody adds one.
 */
export async function openTaskCountsByProject(
  organizationId: string,
): Promise<ActionResult<ReadonlyMap<string, number>>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('project_id, status')
      .eq('organization_id', organizationId)
      .in('status', [...OPEN_TASK_STATUSES]);
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;

  const counts = new Map<string, number>();
  for (const row of result.value ?? []) {
    if (row.project_id === null) continue;
    counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
  }
  return ok(counts);
}

/** Whether one of a caller's own rows is late. Client-side counterpart of the query. */
export function entryIsOverdue(entry: TaskListEntry, today: string): boolean {
  return isTaskOverdue(entry.task, today);
}
