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
// Authority
//
// UI affordances only. The policy is the authority: `tasks_delete_managers`.
// ---------------------------------------------------------------------------

/** Deletes a task. Manager and above. */
export function canDeleteTasks(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}
