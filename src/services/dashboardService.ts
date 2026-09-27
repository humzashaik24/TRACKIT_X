/**
 * Trackit X — dashboard analytics service.
 *
 * The reads behind the business dashboard. One entry point, three queries, no state.
 *
 * ── Why three queries and not one ──────────────────────────────────────────────
 * The obvious alternative is a Postgres function returning the whole snapshot as JSON
 * in a single round trip, and it is genuinely better on request count. It is still the
 * wrong choice at this point in the product, for reasons worth writing down before
 * somebody "fixes" this:
 *
 *  · PostgREST cannot return several aggregates over different tables in one call, so
 *    "one query" has to mean a new SQL function — a new object in the database, with
 *    its own RLS story, its own grant, its own place in the migration history, and its
 *    own test cases. That is a real cost to pay for latency the user does not notice:
 *    the three reads below go out in parallel, so the wall-clock difference is one
 *    round trip's tail, and they share a connection pool.
 *  · The project has already accepted this shape twice. `departmentHeadcounts` in
 *    `employeeService` and `openTaskCountsByProject` in `taskService` both read a
 *    whole visible set and aggregate it in JavaScript, and both document why. Writing
 *    a third mechanism for the dashboard would be the inconsistency, not the parity.
 *  · The arithmetic lives in `../features/dashboard/metrics.ts`, which is pure and has
 *    no database in it at all. That is what makes "every metric has a deterministic
 *    test" achievable without a running Postgres. Moving the arithmetic into SQL would
 *    move every one of those tests to a place where they cannot run in CI.
 *
 * The trigger to revisit is scale, and it is a real one: the `tasks` read returns one
 * minimal row per task in the organization. That is fine at the scale this product is
 * built for — the task list screen already reads the same set — but an organization
 * with tens of thousands of tasks would pay for it on every dashboard open. At that
 * point the right fix is a `SECURITY INVOKER` SQL function, because RLS would then
 * filter the rows inside the database instead of the client discarding them afterwards.
 *
 * ── Why the columns are named rather than `*` ───────────────────────────────────
 * Each read asks for the fields its metrics actually read, and nothing else. A
 * `select('*')` here would put employee emails and phone numbers in the response body
 * of the screen a business owner looks at most often, and would make the data layer's
 * contract silently widen every time somebody added a column. The narrow select is
 * also what makes the arithmetic's inputs auditable: every field in `DashboardSnapshot`
 * traces to one of these.
 *
 * The three lists are exported rather than kept private because a second reader of the
 * same tables — `copilotService`, for the Copilot's citations — needs the same
 * exclusions. Restating them would create a second place to forget an email column,
 * which is the failure this list exists to prevent.
 */
import { supabase } from '@/lib/supabase';
import type { EmploymentStatus } from '@/domain/employee';
import type { ProjectPriority, ProjectStatus } from '@/domain/project';
import type { TaskPriority, TaskStatus } from '@/domain/task';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'dashboardService' });

export type {
  EmploymentStatus,
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
};

// ---------------------------------------------------------------------------
// What a read returns
// ---------------------------------------------------------------------------

/**
 * One employee, reduced to the three fields a roll-up reads.
 *
 * No email, no phone, no employee code: nothing on this screen needs them, and a
 * dashboard is the worst possible place for a directory's contact details to be
 * sitting in a response body.
 */
export interface DashboardEmployeeFact {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly employment_status: EmploymentStatus;
}

/** One project, reduced to the fields the project and deadline metrics read. */
export interface DashboardProjectFact {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly progress: number;
  readonly target_date: string | null;
  readonly owner_id: string | null;
}

/**
 * One task, reduced to the fields the work, deadline and workload metrics read.
 *
 * Five columns and no title. The workload panel shows people's names, which is the
 * identifying part; a row of task titles would make this the largest read in the app
 * and buy nothing, because the dashboard never shows a task title — the tasks screen
 * exists for that and links here.
 */
export interface DashboardTaskFact {
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly progress: number;
  readonly due_date: string | null;
  readonly assignee_id: string | null;
}

/**
 * The raw material for one organization's snapshot.
 *
 * Facts, not metrics: every field here is a stored value, and nothing has been
 * counted, averaged or judged. The transformation in `../features/dashboard/metrics.ts`
 * turns these into the `DashboardSnapshot` the screens and the future AI backend read.
 */
export interface DashboardFacts {
  readonly employees: readonly DashboardEmployeeFact[];
  readonly projects: readonly DashboardProjectFact[];
  readonly tasks: readonly DashboardTaskFact[];
}

/**
 * Column lists, exported so a second reader of the same tables cannot drift.
 *
 * `copilotService` reads the same three tables for the same organization and needs
 * `id`, `title` and `project_id` on tasks so a Copilot answer can cite the record it
 * is talking about. Rather than restate the employee and project lists — and with
 * them the decision to exclude email, phone and employee code — it composes its own
 * task list from `DASHBOARD_TASK_COLUMNS` below. A column added to one of these is
 * then added to both readers or to neither, instead of one of them quietly keeping
 * a narrower view of the business and nobody noticing until an answer was wrong.
 */
export const DASHBOARD_EMPLOYEE_COLUMNS = 'id, first_name, last_name, employment_status' as const;
export const DASHBOARD_PROJECT_COLUMNS =
  'id, name, status, priority, progress, target_date, owner_id' as const;
export const DASHBOARD_TASK_COLUMNS = 'status, priority, progress, due_date, assignee_id' as const;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The visible facts for one organization.
 *
 * Every read is `.eq('organization_id', organizationId)`, and that is belt and braces
 * rather than the primary defence: `employees_select_members`, `projects_select_members`
 * and `tasks_select_members` already restrict all three tables to the caller's
 * organization, so a request for another tenant's id returns its rows filtered to
 * zero rather than their actual contents. The explicit filter is kept because a
 * dashboard that quietly relied on the policy alone would be one careless edit away
 * from a cross-tenant read, and the two together mean either one being wrong is not
 * sufficient to leak.
 *
 * ── Why one failure fails the whole snapshot ───────────────────────────────────
 * A partial dashboard is a trap. If the task read failed and the project read
 * succeeded, the screen would show a real project count beside an open-task count of
 * zero, and nothing on it would say which of the two was a measurement and which was
 * a failure. `useTasks` can get away with keeping stale rows on a failed refresh
 * because it has one number per screen; here there are a dozen that have to agree with
 * each other, so the honest failure mode is to show none of them and offer a retry.
 *
 * `Promise.all` is deliberate: the three reads are independent, and awaiting them
 * together is one event loop turn rather than three chained round trips. The first
 * failure rejects the wait, but the other requests are already in flight and are
 * simply not awaited — they carry no side effects, so letting them finish is safe.
 */
export async function readDashboardFacts(
  organizationId: string,
): Promise<ActionResult<DashboardFacts>> {
  const result = await attempt(async () => {
    const [employees, projects, tasks] = await Promise.all([
      supabase
        .from('employees')
        .select(DASHBOARD_EMPLOYEE_COLUMNS)
        .eq('organization_id', organizationId),
      supabase
        .from('projects')
        .select(DASHBOARD_PROJECT_COLUMNS)
        .eq('organization_id', organizationId),
      supabase.from('tasks').select(DASHBOARD_TASK_COLUMNS).eq('organization_id', organizationId),
    ]);

    // Checked in a fixed order rather than by "which failed first", so the reported
    // error names the same table for the same set of failures on every run.
    if (employees.error !== null) throw employees.error;
    if (projects.error !== null) throw projects.error;
    if (tasks.error !== null) throw tasks.error;

    return {
      employees: (employees.data ?? []) as unknown as readonly DashboardEmployeeFact[],
      projects: (projects.data ?? []) as unknown as readonly DashboardProjectFact[],
      tasks: (tasks.data ?? []) as unknown as readonly DashboardTaskFact[],
    };
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not read dashboard facts', { code: result.error.code });
    return result;
  }

  return ok(result.value);
}

/**
 * The single headline figure the dashboard has always shown: how many people have
 * access to this workspace.
 *
 * Kept as its own read rather than folded into the employee read, for the same reason
 * it is a separate metric in the UI. `organization_members` counts LOGINS and
 * `employees` counts PEOPLE, and the two are genuinely different numbers — a login
 * with no employee record, or an employee who has never been issued a sign-in, is
 * exactly the gap this dashboard is supposed to make visible rather than hide. The
 * Phase 1 dashboard showed the login count because that was the only figure the
 * two-table schema supported; now both exist, and reporting only the one that looks
 * bigger would be the easy mistake.
 */
export async function countOrganizationMembers(
  organizationId: string,
): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    const { count, error } = await supabase
      .from('organization_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not count organization members', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Member count was not returned'));
  }
  return ok(result.value);
}
