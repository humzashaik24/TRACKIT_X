/**
 * Trackit X — dashboard chart palette.
 *
 * Turns domain states into the colours the dashboard's bars are drawn in, and it is
 * the only place that mapping exists.
 *
 * ── Two different questions, two different colour scales ───────────────────────
 * STATUS gets a SEMANTIC colour. `blocked` is amber and `done` is green because those
 * are what the words already mean to a reader, and the colour reinforces the label
 * rather than inventing a second code to learn. The design system's own note on the
 * signal-green ramp applies here and is why every one of these rows also prints its
 * label and its number: colour never carries identity on its own.
 *
 * PRIORITY gets a SEQUENTIAL ramp, not a semantic one. Priority is an ordered scale
 * with no good/bad reading attached to it — an urgent task is not a failure — so
 * painting it in the same red as `blocked` would tell the reader that a choice of
 * urgency is a state of distress. A single-hue ramp that deepens with urgency says
 * "more" instead of "worse", which is the honest reading.
 *
 * PROGRESS BANDS get the chart system's `sequential` ramp for the same reason, and
 * for one more: the bands are ordered and equally spaced, which is exactly what a
 * sequential ramp encodes. Reserved for scale, and a categorical ramp would make a
 * 25-49% band look like a different kind of thing from a 50-74% one.
 *
 * Nothing here picks a brand colour. The signal green in the token ramp is the
 * interactive colour and it is used for the one metric a screen is about; spending it
 * on a chart bar would make it decoration, which is the thing the ramp's own comment
 * says it is not for.
 */
import type { Theme } from '@/design-system';
import type { ProgressBand, WorkloadBand } from '@/domain/dashboard';
import type { EmploymentStatus } from '@/domain/employee';
import type { ProjectPriority, ProjectStatus } from '@/domain/project';
import type { TaskPriority, TaskStatus } from '@/domain/task';

/** The colour of a task's state. */
export function taskStatusColor(theme: Theme, status: TaskStatus): string {
  switch (status) {
    case 'todo':
      return theme.colors.neutral.fg;
    case 'in_progress':
      return theme.colors.accent.fg;
    case 'blocked':
      return theme.colors.warning.fg;
    case 'in_review':
      return theme.colors.info.fg;
    case 'done':
      return theme.colors.success.fg;
    default: {
      // Exhaustiveness over the union. A new status with no colour is a compile error
      // rather than a bar that silently renders in the neutral it fell through to.
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** The colour of a project's state. */
export function projectStatusColor(theme: Theme, status: ProjectStatus): string {
  switch (status) {
    case 'planned':
      return theme.colors.neutral.fg;
    case 'active':
      return theme.colors.accent.fg;
    case 'on_hold':
      return theme.colors.warning.fg;
    case 'completed':
      return theme.colors.success.fg;
    case 'cancelled':
      return theme.colors.danger.fg;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * The colour of a person's employment state.
 *
 * Mirrors the badge tones on the employees screen, so a bar and a badge about the
 * same state are the same colour. `on_leave` and `inactive` are people-shaped
 * facts rather than risks — like the badge mapping, they are deliberately not
 * amber.
 */
export function employmentStatusColor(theme: Theme, status: EmploymentStatus): string {
  switch (status) {
    case 'active':
      return theme.colors.success.fg;
    case 'probation':
      return theme.colors.info.fg;
    case 'on_leave':
      return theme.colors.neutral.fg;
    case 'notice_period':
      return theme.colors.warning.fg;
    case 'inactive':
      return theme.colors.neutral.fg;
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/**
 * Task priority, low to urgent.
 *
 * Steps through the theme's own `sequential` ramp by RANK rather than by key, so
 * `urgent` is always the deepest colour whichever theme is active. Tied to
 * `TASK_PRIORITIES` order by the caller passing the rank in.
 */
export function taskPriorityColor(theme: Theme, rank: number, lastRank: number): string {
  return rampAt(theme, rank, lastRank);
}

/** Project priority, low to critical. Same ramp, same reasoning. */
export function projectPriorityColor(theme: Theme, rank: number, lastRank: number): string {
  return rampAt(theme, rank, lastRank);
}

/** The colour of a progress band, by its position in `PROGRESS_BANDS`. */
export function progressBandColor(theme: Theme, index: number, total: number): string {
  return rampAt(theme, index, total - 1);
}

/** The colour of a workload band, by its position in `WORKLOAD_BANDS`. */
export function workloadBandColor(theme: Theme, index: number, total: number): string {
  return rampAt(theme, index, total - 1);
}

/**
 * A step on the sequential ramp, clamped to its ends.
 *
 * `last` can be 0 when a scale has one step, and dividing by it would be a division by
 * zero — the fallback puts a single-step scale on the middle of the ramp rather than at
 * either extreme, because a one-row "scale" should not read as the most or the least of
 * anything.
 */
function rampAt(theme: Theme, index: number, last: number): string {
  const ramp = theme.chart.sequential;
  if (ramp.length === 0) return theme.colors.neutral.fg;
  if (last <= 0) return ramp[Math.floor(ramp.length / 2)] ?? theme.colors.neutral.fg;
  const position = Math.round((Math.min(Math.max(index, 0), last) / last) * (ramp.length - 1));
  return ramp[position] ?? theme.colors.neutral.fg;
}

/** Re-exported so the section components import their types from one place. */
export type {
  EmploymentStatus,
  ProgressBand,
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  WorkloadBand,
};
