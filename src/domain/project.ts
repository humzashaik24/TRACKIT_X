/**
 * Trackit X — project domain rules.
 *
 * Pure functions and constant tables. No Supabase import, no React, no I/O.
 *
 * ⚠ AUTHORITY LIVES IN THE DATABASE ──────────────────────────────────────────
 * `canManageProjects` and `canDeleteProjects` mirror the RLS policies, but they
 * are UI affordances only: they decide whether to draw a button, never whether an
 * action is allowed. Postgres makes that decision on every request, including
 * requests this file knows nothing about. A `true` here is not permission, and a
 * `false` here is courtesy rather than security. If the two ever disagree, the
 * migration is right.
 */
import type {
  OrganizationRole,
  ProjectMemberRole,
  ProjectPriority,
  ProjectRow,
  ProjectStatus,
} from '@/types/database';
import { hasAtLeastRole } from './organization';

export type { ProjectMemberRole, ProjectPriority, ProjectRow, ProjectStatus };

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle order, not alphabetical.
 *
 * `on_hold` sits after `active` because that is where it occurs — a project that
 * started and paused — and putting it next to `planned` would imply a paused
 * project is a project that never began. The two are different decisions with
 * different reasons attached, which is exactly why the database has separate
 * values for them.
 */
export const PROJECT_STATUSES = [
  'planned',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PROJECT_STATUS_DESCRIPTIONS: Record<ProjectStatus, string> = {
  planned: 'Approved but not started.',
  active: 'In progress.',
  on_hold: 'Started and paused. Work has stopped for a reason worth recording.',
  completed: 'Delivered.',
  cancelled: 'Stopped deliberately. Kept for the record, not counted as outstanding.',
};

/** A project that is neither finished nor stopped. */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ['planned', 'active', 'on_hold'];

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as readonly string[]).includes(value);
}

export function isOpenProject(status: ProjectStatus): boolean {
  return OPEN_PROJECT_STATUSES.includes(status);
}

export const projectStatusOptions: readonly { value: ProjectStatus; label: string }[] =
  PROJECT_STATUSES.map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }));

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Ascending urgency. The index in this array is the rank. */
export const PROJECT_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

export const PROJECT_PRIORITY_LABELS: Record<ProjectPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const DEFAULT_PROJECT_PRIORITY: ProjectPriority = 'medium';

export function isProjectPriority(value: unknown): value is ProjectPriority {
  return (
    typeof value === 'string' && (PROJECT_PRIORITIES as readonly string[]).includes(value)
  );
}

/**
 * 0 for `low` through 3 for `critical`.
 *
 * The numeric rank exists so a list can be ordered by urgency, and it is a
 * function rather than `.indexOf` scattered at call sites — because the ordering
 * is the meaning. Reordering `PROJECT_PRIORITIES` silently reorders every sort
 * that uses it, so the unit tests assert this mapping.
 */
export function projectPriorityRank(priority: ProjectPriority): number {
  return PROJECT_PRIORITIES.indexOf(priority);
}

export const projectPriorityOptions: readonly { value: ProjectPriority; label: string }[] =
  PROJECT_PRIORITIES.map((value) => ({ value, label: PROJECT_PRIORITY_LABELS[value] }));

// ---------------------------------------------------------------------------
// Project membership
// ---------------------------------------------------------------------------

/**
 * Ordered by authority over the project, not by the alphabet.
 *
 * `lead` is separated from the rest because it is the role that implies authority
 * to change the project's own detail. `observer` is last because it grants none.
 */
export const PROJECT_MEMBER_ROLES = ['lead', 'contributor', 'reviewer', 'observer'] as const;

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  lead: 'Lead',
  contributor: 'Contributor',
  reviewer: 'Reviewer',
  observer: 'Observer',
};

export const PROJECT_MEMBER_ROLE_DESCRIPTIONS: Record<ProjectMemberRole, string> = {
  lead: 'Accountable for the project. Can change its detail and assign work.',
  contributor: 'Does the work.',
  reviewer: 'Checks the work before it is delivered.',
  observer: 'Kept informed. Does not contribute.',
};

export function isProjectMemberRole(value: unknown): value is ProjectMemberRole {
  return (
    typeof value === 'string' && (PROJECT_MEMBER_ROLES as readonly string[]).includes(value)
  );
}

export const projectMemberRoleOptions: readonly { value: ProjectMemberRole; label: string }[] =
  PROJECT_MEMBER_ROLES.map((value) => ({ value, label: PROJECT_MEMBER_ROLE_LABELS[value] }));

export const ALLOCATION_MIN = 0;
export const ALLOCATION_MAX = 100;
export const DEFAULT_ALLOCATION_PERCENT = 100;

export function isValidAllocation(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= ALLOCATION_MIN &&
    value <= ALLOCATION_MAX
  );
}

/**
 * How many projects a person is meaningfully committed to at full allocation.
 *
 * Reported as a WARNING on the directory rather than enforced. Over-allocation is
 * a scheduling problem the business owns — people really are stretched — so
 * making it a database error would mean the only way to record reality is to
 * record a fiction.
 */
export const OVER_ALLOCATION_THRESHOLD = 100;

export function totalAllocation(percents: readonly number[]): number {
  return percents.reduce((sum, value) => sum + (isValidAllocation(value) ? value : 0), 0);
}

export function isOverAllocated(percents: readonly number[]): boolean {
  return totalAllocation(percents) > OVER_ALLOCATION_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Names and dates
// ---------------------------------------------------------------------------

/** Mirrors the `projects_name_length` CHECK constraint. */
export const PROJECT_NAME_MIN = 2;
export const PROJECT_NAME_MAX = 160;

export function normalizeProjectName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Whether a schedule is coherent: a target that lands before the start.
 *
 * The database refuses it (`projects_target_after_start`), so this is the same
 * rule stated for the form. An open end is `null` on either side, never a
 * sentinel date — a project with no deadline is a real and common thing, and
 * inventing `9999-12-31` to represent it corrupts every date comparison that
 * later reads the column.
 */
export function isScheduleCoherent(
  startDate: string | null | undefined,
  targetDate: string | null | undefined,
): boolean {
  if (startDate === null || startDate === undefined) return true;
  if (targetDate === null || targetDate === undefined) return true;
  return targetDate >= startDate;
}

/**
 * A calendar-day difference, or `null` when either end is open.
 *
 * `YYYY-MM-DD` strings compare correctly with `<` and `>`, but SUBTRACTING them
 * gives NaN, and passing them to `new Date()` invites a timezone shift that moves
 * a deadline to the previous day for anyone west of UTC. The `Date.UTC` parse
 * below is deliberate: both ends are read as UTC midnight purely so the
 * subtraction is a plain day count, which is the only thing being asked for.
 */
export function daysBetweenDates(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) return null;
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return null;
  return Math.round((toMs - fromMs) / 86_400_000);
}

/**
 * Whether a project is past its target date and not finished.
 *
 * `null` when there is no target or the project is closed, because "overdue" is
 * not a property of a cancelled project — it was stopped, not left behind.
 */
export function isOverdue(
  project: {
    readonly status: ProjectStatus;
    readonly target_date: string | null;
  },
  today: string,
): boolean {
  if (project.target_date === null) return false;
  if (project.status === 'completed' || project.status === 'cancelled') return false;
  return project.target_date < today;
}

// ---------------------------------------------------------------------------
// Authority
//
// UI affordances only — see the header. The policies are the authority:
// `projects_insert_managers`, `projects_update_managers`, `projects_delete_admins`.
// ---------------------------------------------------------------------------

/** Creates a project, and edits one. Manager and above. */
export function canManageProjects(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}

/** Deletes a project, which cascades to its tasks. Admin and above. */
export function canDeleteProjects(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'admin');
}

/** Adds or removes people on a project. Manager and above. */
export function canManageProjectMembers(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}
