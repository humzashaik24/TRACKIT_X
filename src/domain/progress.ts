/**
 * Trackit X — completion progress.
 *
 * Both `projects` and `tasks` carry a `progress` column constrained to 0-100 in
 * the database, and both read it the same way in the UI. It lives in its own
 * module because that shared reading has three real decisions in it, and getting
 * any of them wrong misreports a business's delivery position:
 *
 *   · the range is 0-100, not 0-1. The column is a percentage; `ProgressBar`
 *     wants a ratio. The conversion lives here so no screen does it by hand and
 *     one of them does it wrong.
 *   · a percentage and a ratio are not interchangeable in a comparison. Zero
 *     percent complete is NOT falsy, so `progress || 100` — an easy slip — turns
 *     an untouched project into a finished one.
 *   · a progress figure is a JUDGEMENT, not a measurement. Nothing here derives
 *     one from another figure; a project's progress is set by its owner and is
 *     deliberately not the average of its tasks. A task with no estimate and no
 *     due date cannot be averaged into anything meaningful, and a derived number
 *     that looks computed is trusted more than an owned number that does not.
 *
 * Pure functions only — no Supabase, no React, no I/O.
 */
import type { ProjectStatus, TaskStatus } from '@/types/database';

/** Mirrors the `progress between 0 and 100` CHECK constraints. */
export const PROGRESS_MIN = 0;
export const PROGRESS_MAX = 100;

export const DEFAULT_PROGRESS = PROGRESS_MIN;

/**
 * Constrains a value to 0-100 and rounds it.
 *
 * Rounding rather than truncating because a half-percent is a display artifact,
 * not a fact: `37.6` is a number somebody typed, and storing `37` while showing
 * `38` would be the inconsistency.
 *
 * Non-finite input collapses to `PROGRESS_MIN` instead of propagating `NaN`,
 * which would render as the string "NaN%" in a table cell and, worse, compare
 * false against every range check — so an out-of-range progress would slip past
 * the screen that exists to flag it.
 */
export function clampProgress(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return PROGRESS_MIN;
  return Math.min(PROGRESS_MAX, Math.max(PROGRESS_MIN, Math.round(value)));
}

/** Whether a value is already a valid stored percentage. */
export function isValidProgress(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= PROGRESS_MIN &&
    value <= PROGRESS_MAX
  );
}

/** 0-100 → 0-1, which is what `ProgressBar` takes. */
export function progressToRatio(value: number | null | undefined): number {
  return clampProgress(value) / PROGRESS_MAX;
}

/**
 * The implied progress for a terminal state, and `null` for everything else.
 *
 * Returning `null` is the point. A project that is merely `active` is not 50% —
 * inventing a default for it would put a figure on the dashboard that nobody
 * entered and nobody owns. Only the two states whose completion is not in doubt
 * get a number.
 *
 * `cancelled` yields `null` rather than 0: a cancelled project is not a project
 * that failed to progress, and showing a red 0% for work somebody deliberately
 * stopped misrepresents why.
 */
export function impliedProgressForProjectStatus(
  status: ProjectStatus,
): number | null {
  switch (status) {
    case 'completed':
      return PROGRESS_MAX;
    case 'planned':
    case 'active':
    case 'on_hold':
    case 'cancelled':
      return null;
    default: {
      // Exhaustiveness over the union. Adding a status without deciding what it
      // implies is a compile error here rather than a silent `null` in the UI.
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** As above, for a work item. `done` is the only state that settles progress. */
export function impliedProgressForTaskStatus(status: TaskStatus): number | null {
  switch (status) {
    case 'done':
      return PROGRESS_MAX;
    case 'todo':
    case 'in_progress':
    case 'blocked':
    case 'in_review':
      return null;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * Statuses that mean the work is finished or stopped, for "what is still
 * outstanding?" questions.
 *
 * `cancelled` is included on purpose: cancelled work is not going to happen, and
 * counting it as outstanding forever is how an open-items count stops meaning
 * anything.
 */
export const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = ['completed', 'cancelled'];
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = ['done'];

export function isClosedProjectStatus(status: ProjectStatus): boolean {
  return CLOSED_PROJECT_STATUSES.includes(status);
}

export function isClosedTaskStatus(status: TaskStatus): boolean {
  return CLOSED_TASK_STATUSES.includes(status);
}
