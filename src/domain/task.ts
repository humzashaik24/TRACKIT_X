/**
 * Trackit X — task domain rules.
 *
 * Pure functions and constant tables. No Supabase import, no React, no I/O.
 *
 * ⚠ A TASK IS NOT A PROJECT ──────────────────────────────────────────────────
 * `tasks.project_id` is nullable and that is deliberate: a real business has work
 * that belongs to no job — a stock count, a licence renewal, a statutory
 * inspection, a vehicle service. Forcing every task into a project would mean
 * inventing a catch-all project called "General", and then every schedule,
 * report and progress roll-up would quietly include work that was never part of
 * a job. So the field is optional throughout, and the UI says "No project" rather
 * than leaving the field looking unfilled.
 */
import type {
  EmployeeRow,
  OrganizationRole,
  ProjectStatus,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from '@/types/database';
import { hasAtLeastRole } from './organization';
import { employeeDisplayName } from './employee';
import { isClosedTaskStatus } from './progress';

export type { TaskPriority, TaskRow, TaskStatus };

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The order work actually moves through, which is also the order a board reads in.
 *
 * `blocked` is placed before `in_review` because a blocked item is waiting on
 * something, and the next action belongs to whoever is unblocking it rather than
 * to the assignee — a distinction the single "In progress" status would lose.
 * `in_review` is separate from `done` for the same reason: the last mile of
 * delivery is somebody else's decision, and folding it into "done" would let a
 * task be marked delivered by the person who did the work.
 */
export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'in_review', 'done'] as const;

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
};

export const TASK_STATUS_DESCRIPTIONS: Record<TaskStatus, string> = {
  todo: 'Not started.',
  in_progress: 'Being worked on.',
  blocked: 'Waiting on something. Record why in the description.',
  in_review: 'Work is finished and awaiting sign-off.',
  done: 'Delivered and accepted.',
};

/** A task that is neither delivered nor abandoned. */
export const OPEN_TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'blocked',
  'in_review',
];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export function isOpenTask(status: TaskStatus): boolean {
  return !isClosedTaskStatus(status);
}

export const taskStatusOptions: readonly { value: TaskStatus; label: string }[] =
  TASK_STATUSES.map((value) => ({ value, label: TASK_STATUS_LABELS[value] }));

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Ascending urgency. The index in this array is the rank. */
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function taskPriorityRank(priority: TaskPriority): number {
  return TASK_PRIORITIES.indexOf(priority);
}

export const taskPriorityOptions: readonly { value: TaskPriority; label: string }[] =
  TASK_PRIORITIES.map((value) => ({ value, label: TASK_PRIORITY_LABELS[value] }));

/**
 * Priority ranks are 0-based, so a "+1" is what turns one into a 1-4 scale.
 *
 * A function rather than an inline `+ 1` because "why is this off by one" is the
 * single most common question about any rank field, and the answer should have
 * exactly one place to live.
 */
export function taskPriorityWeight(priority: TaskPriority): number {
  return taskPriorityRank(priority) + 1;
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

/** Mirrors the `tasks_title_length` CHECK constraint. */
export const TASK_TITLE_MIN = 2;
export const TASK_TITLE_MAX = 200;

export function normalizeTaskTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Derived state
// ---------------------------------------------------------------------------

/**
 * Whether a task is late: a due date in the past, and not delivered.
 *
 * `null` in, `null` out when there is no due date. An undated task is not on
 * time — it is undated, and reporting it as "not late" would fold an unknown into
 * a reassuring answer.
 */
export function isTaskOverdue(
  task: { readonly status: TaskStatus; readonly due_date: string | null },
  today: string,
): boolean {
  if (task.due_date === null) return false;
  if (isClosedTaskStatus(task.status)) return false;
  return task.due_date < today;
}

/** Days until a due date. Negative when it has passed, `null` when undated. */
export function daysUntilDue(
  dueDate: string | null | undefined,
  today: string,
): number | null {
  if (!dueDate) return null;
  const dueMs = Date.parse(`${dueDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(dueMs) || Number.isNaN(todayMs)) return null;
  return Math.round((dueMs - todayMs) / 86_400_000);
}

/**
 * Whether a task can move to a new status without anyone else's involvement.
 *
 * The rule this encodes: a member records their own work, so they may move it
 * through the states that describe their own effort — `todo`, `in_progress`,
 * `blocked`. `in_review` hands the work to somebody else, so it is a manager's
 * call, exactly as the `tasks_insert_members` policy treats assigning work.
 *
 * Returning `false` for `in_review` is a UI hint, not a lock. The database's
 * UPDATE policy gates on the ASSIGNEE, not on the status being written, so a
 * member can in fact move their own task into review; this function keeps them
 * from being blocked by a control they were never offered.
 */
export function canRecordOwnProgress(from: TaskStatus, to: TaskStatus): boolean {
  if (isClosedTaskStatus(from)) return false;
  if (to === 'in_review') return false;
  return OPEN_TASK_STATUSES.includes(from);
}

/**
 * Whether a project being finished should force its tasks to `done`.
 *
 * Exposed as a question rather than applied, because the answer is a business
 * decision: a project delivered at 80% with three tasks outstanding is a
 * legitimate state, and auto-closing them would destroy the record of what was
 * left. Callers ask; the user decides.
 */
export function wouldClosingProjectAffectTasks(
  projectStatus: ProjectStatus,
  openTaskCount: number,
): boolean {
  const isClosing = projectStatus === 'completed' || projectStatus === 'cancelled';
  return isClosing && openTaskCount > 0;
}

// ---------------------------------------------------------------------------
// Assignees
// ---------------------------------------------------------------------------

/**
 * Resolves a person id to a display name.
 *
 * A lookup rather than a join so a task list renders N tasks with one map, and so
 * an unassigned task is a first-class state — `null` in, `null` out, rendered as
 * "Unassigned" by the screen — instead of a UUID or a crash.
 */
export type EmployeeNameLookup = ReadonlyMap<string, string> | null;

export function buildEmployeeNameLookup(
  employees: readonly EmployeeRow[] | null | undefined,
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const employee of employees ?? []) {
    lookup.set(employee.id, employeeDisplayName(employee));
  }
  return lookup;
}

export function assigneeNameFor(
  lookup: EmployeeNameLookup,
  assigneeId: string | null | undefined,
): string | null {
  if (assigneeId === null || assigneeId === undefined) return null;
  if (lookup === null) return null;
  return lookup.get(assigneeId) ?? null;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/**
 * The columns a task list can be ordered by.
 *
 * A union rather than `string` so a `DataTable` column key cannot be typed at the
 * screen and then silently fall through `sortTasks`' switch to the title branch —
 * which would render a header that claims to sort by due date while sorting by name.
 */
export type TaskSortKey = 'title' | 'status' | 'priority' | 'due' | 'assignee';

export const TASK_SORT_KEYS: readonly TaskSortKey[] = [
  'title',
  'status',
  'priority',
  'due',
  'assignee',
];

export function isTaskSortKey(value: unknown): value is TaskSortKey {
  return typeof value === 'string' && (TASK_SORT_KEYS as readonly string[]).includes(value);
}

export interface TaskSort {
  readonly key: TaskSortKey;
  readonly direction: 'asc' | 'desc';
}

/**
 * The minimum a row must carry to be ordered.
 *
 * A structural type rather than `TaskRow` or a service entry, so this module does not
 * need to know which layer built the thing it is sorting. The caller projects whatever
 * it holds onto these six fields with the `select` argument — a bare `TaskRow` is
 * already one, and a list entry is one unwrapping away.
 */
export interface SortableTask {
  readonly id: string;
  readonly title: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly due_date: string | null;
  readonly assignee_id: string | null;
}

/**
 * Orders tasks, returning a new array.
 *
 * ── Why undated tasks sort last in BOTH directions ───────────────────────────
 * Postgres sorts NULL last when ascending and first when descending, which for a due
 * date means flipping the toggle moves every undated task from the bottom of the list
 * to the top of it. Both orderings are the wrong answer: there is no date to order
 * them by, so they are placed after the dated rows and stay there. A task appearing
 * first under "due descending" would read as the most urgent thing on the screen.
 *
 * The same reasoning drives `status` and `priority` to rank against
 * `TASK_STATUSES` / `TASK_PRIORITIES` rather than being compared as text: those
 * arrays are the order work moves through, and alphabetical order breaks the reading
 * in both directions.
 */
export function sortTasks<Row>(
  rows: readonly Row[],
  sort: TaskSort | undefined,
  select: (row: Row) => SortableTask,
): readonly Row[] {
  if (sort === undefined) return rows;
  const sign = sort.direction === 'asc' ? 1 : -1;

  const rank = (task: SortableTask): number | string => {
    switch (sort.key) {
      case 'status':
        return TASK_STATUSES.indexOf(task.status);
      case 'priority':
        return taskPriorityRank(task.priority);
      case 'assignee':
        return task.assignee_id ?? '';
      case 'due':
        return task.due_date ?? '';
      case 'title':
      default:
        return task.title;
    }
  };

  return [...rows].sort((a, b) => {
    const leftTask = select(a);
    const rightTask = select(b);

    /*
     * Undated tasks are pulled out of the comparison entirely rather than ranked as
     * an empty string, and that is the whole fix.
     *
     * Ranking a missing date as `''` looks like it would work and does not: `''` sorts
     * below every `YYYY-MM-DD`, so it lands LAST going down but FIRST going up. The
     * toggle would move the undated tasks from the top of the list to the bottom on
     * every click. Deciding the direction here instead, and only after both sides are
     * known to have a date, is what makes "last in both directions" true.
     *
     * A single `null` argument is not enough to report "these are equal" — an
     * undated task is not equal to a dated one, it is ranked below all of them.
     */
    if (sort.key === 'due') {
      const leftDue = leftTask.due_date;
      const rightDue = rightTask.due_date;
      if (leftDue === null || rightDue === null) {
        if (leftDue !== rightDue) return leftDue === null ? 1 : -1;
        return leftTask.id.localeCompare(rightTask.id);
      }
    }

    const left = rank(leftTask);
    const right = rank(rightTask);
    // Id as the tiebreak, not the array position: rows reorder when the sort changes,
    // and a comparator that returns 0 for equals makes the resulting order depend on
    // the engine rather than on the data.
    if (left === right) return leftTask.id.localeCompare(rightTask.id);
    return left < right ? -sign : sign;
  });
}

// ---------------------------------------------------------------------------
// Authority
//
// UI affordances only. The policy is the authority: `tasks_insert_members`,
// `tasks_update_own_or_managers`, `tasks_delete_managers`.
// ---------------------------------------------------------------------------

/**
 * Raises a new task.
 *
 * Every role can, including `member` — `tasks_insert_members` gates only WHERE THE
 * WORK GOES, not whether a person may notice something needs doing. A member who
 * cannot raise their own ticket is a member who writes it on paper instead.
 */
export function canCreateTasks(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'member');
}

/**
 * Hands work to somebody else. Manager and above.
 *
 * The one role check the task policies share, and the reason a member's task picker
 * offers exactly two options: themselves, and nobody.
 */
export function canAssignTasksToOthers(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}

/**
 * Whether this caller may leave a task with this person on it.
 *
 * A member may choose `null` or their own id, and nothing else — which is
 * `tasks_insert_members`'s `with check` and `tasks_update_own_or_managers`'s, clause
 * for clause. A manager is checked first and answered `true` for every target,
 * including with no employee row, because their grant does not depend on being an
 * employee.
 *
 * The `currentEmployeeId === null` case therefore answers `false` for every target
 * *on the member path*, including `null`: a login with no employee row cannot be shown
 * to be assigning to itself, so returning `true` would offer a control whose only
 * correct value is the one already selected.
 */
export function canAssignTaskTo(
  role: OrganizationRole | null | undefined,
  currentEmployeeId: string | null,
  targetEmployeeId: string | null,
): boolean {
  if (canAssignTasksToOthers(role)) return true;
  // Tested before the `null` case on purpose. "Unassigned" is a legitimate target for
  // a member WITH an employee row; for a login WITHOUT one it is not, because there
  // is nothing to show the control would have been assigning away from. Answering
  // `true` there offers a picker whose only selectable value is the one already set.
  if (currentEmployeeId === null) return false;
  if (targetEmployeeId === null) return true;
  return targetEmployeeId === currentEmployeeId;
}

/**
 * Whether this caller may edit this task.
 *
 * ── Why an UNASSIGNED task is manager-only, and that is not a bug ────────────
 * `tasks_update_own_or_managers` is written as
 * `assignee_id = employee_id_for_user(...)`, and an `assignee_id` of NULL never
 * equals an employee id — so a member cannot edit a task nobody owns. It could be
 * written as `assignee_id is null or ...`, and it deliberately is not: a task with no
 * owner is unowned because nobody has had the authority to give it one, and letting
 * any member claim it would make "unassigned" a queue anybody could silently drain.
 * Reporting it as an edit restriction is more honest than working around it.
 */
export function canEditTask(
  task: { readonly assignee_id: string | null },
  context: {
    readonly role: OrganizationRole | null | undefined;
    readonly currentEmployeeId: string | null;
  },
): boolean {
  if (canAssignTasksToOthers(context.role)) return true;
  // The member floor is not decorative. `tasks_update_own_or_managers` opens with
  // `is_organization_member(organization_id)`, and a viewer is below member in the
  // hierarchy - so a viewer who happened to be the assignee still fails the policy.
  // Without this check the screen would draw an edit form that every save refuses.
  if (!hasAtLeastRole(context.role, 'member')) return false;
  if (context.currentEmployeeId === null) return false;
  return task.assignee_id === context.currentEmployeeId;
}

/** Deletes a task. Manager and above. */
export function canDeleteTasks(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}
