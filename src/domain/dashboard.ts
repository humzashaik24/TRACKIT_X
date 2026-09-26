/**
 * Trackit X — dashboard domain rules.
 *
 * The vocabulary a business dashboard needs and the schema does not provide: what
 * counts as "soon", how a percentage is banded for a chart, and who is allowed to
 * see a named person's workload.
 *
 * Pure functions and constant tables. No Supabase, no React, no I/O — the same
 * contract as `src/domain/task.ts` and `src/domain/progress.ts`, and for the same
 * reason: these are the rules that decide what a number MEANS, and a rule that can
 * only be exercised by rendering a screen cannot be tested at all.
 *
 * ── Why there is no health score, a productivity index, or a "performance" band ──
 * A dashboard that ranks people is a different product from one that counts work, and
 * the two cannot be mixed. Every metric here is descriptive: how many projects, how
 * many tasks, how far along they are, who is carrying what. None of it is a judgement
 * about how well a person is doing, because the schema records no output, no hours, no
 * quality signal and no history — only the state of a row right now. A figure derived
 * from that, presented as a ranking, would be read as a judgement the database cannot
 * support, and the person at the bottom of it would have no way to contest it.
 *
 * Business Health arrives in a later phase with the inputs to justify it. So the
 * workload bands below are labelled with counts and nothing else: "6 or more" is a
 * count, "underperforming" would be a verdict.
 */
import type { OrganizationRole } from '@/types/database';
import { hasAtLeastRole } from './organization';
import { PROGRESS_MAX } from './progress';

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/**
 * How far ahead counts as "due soon".
 *
 * Seven days, because that is the span a weekly delivery rhythm actually plans in: a
 * project due in nine days has not started to be a problem, and a project due
 * yesterday is already counted as overdue. A week is also the smallest horizon that
 * matches how people run a week, which makes the number actionable rather than merely
 * true.
 *
 * Deliberately a constant and not a preference. A threshold that a screen can pass in
 * is a threshold that two screens will pass differently, and the dashboard and the
 * projects list would then disagree about the same project.
 */
export const DUE_SOON_DAYS = 7;

// ---------------------------------------------------------------------------
// Progress bands
// ---------------------------------------------------------------------------

export type ProgressBandKey = 'not_started' | 'early' | 'quarter' | 'half' | 'late' | 'complete';

export interface ProgressBand {
  readonly key: ProgressBandKey;
  readonly label: string;
  /** Inclusive lower bound, in percentage points. */
  readonly from: number;
  /**
   * Inclusive upper bound in percentage points, or `null` for the open top band.
   *
   * The top band is `null` rather than `PROGRESS_MAX` so the bands cannot drift out of
   * step with the CHECK constraint: a value above the maximum would be rejected by
   * Postgres, and a band table that quietly ended at 99 would render it as a crash.
   */
  readonly to: number | null;
}

const NOT_STARTED: ProgressBand = { key: 'not_started', label: 'Not started', from: 0, to: 0 };

/**
 * The six bands every progress chart in the product uses.
 *
 * Fifty is a band edge on its own because "half done" is a real sentence a manager
 * uses, and a coarser five-band scale would swallow it. Twenty-five and seventy-five
 * are the other two that people actually name. Everything between is 1-point wide
 * and that is deliberate — a band nobody would ever describe is a bar nobody reads.
 *
 * `to: null` on the last band, and it is last for a reason: a task at 100% is
 * complete whatever its status says, and a task at 30% is started whatever its status
 * says. Bounding on the figure rather than on the status is the same argument
 * `src/domain/progress.ts` makes about never deriving one from the other.
 */
export const PROGRESS_BANDS: readonly ProgressBand[] = [
  NOT_STARTED,
  { key: 'early', label: '1-24%', from: 1, to: 24 },
  { key: 'quarter', label: '25-49%', from: 25, to: 49 },
  { key: 'half', label: '50-74%', from: 50, to: 74 },
  { key: 'late', label: '75-99%', from: 75, to: 99 },
  { key: 'complete', label: '100%', from: PROGRESS_MAX, to: null },
];

/**
 * The band a percentage falls in.
 *
 * Values outside 0-100 are clamped by `clampProgress` before they get here, and this
 * function still returns the nearest band rather than throwing: a chart must not be
 * the thing that crashes a screen because one stored figure is odd. Non-finite input
 * lands in `not_started`, matching the clamping in `clampProgress`.
 */
export function progressBandFor(value: number | null | undefined): ProgressBand {
  const points = typeof value === 'number' && Number.isFinite(value) ? value : 0;

  for (const band of PROGRESS_BANDS) {
    if (band.to === null) return band;
    if (points >= band.from && points <= band.to) return band;
  }
  return NOT_STARTED;
}

// ---------------------------------------------------------------------------
// Workload bands
// ---------------------------------------------------------------------------

export type WorkloadBandKey = 'none' | 'one_to_two' | 'three_to_five' | 'six_or_more';

export interface WorkloadBand {
  readonly key: WorkloadBandKey;
  /** A count and a range. Never an adjective about a person. */
  readonly label: string;
  /** Inclusive lower bound of OPEN tasks. */
  readonly from: number;
  /** Inclusive upper bound of OPEN tasks, or `null` for the open top band. */
  readonly to: number | null;
}

const NO_OPEN_WORK: WorkloadBand = { key: 'none', label: 'None', from: 0, to: 0 };

/**
 * How open work is distributed across the people carrying it.
 *
 * Four bands, and the labels are the whole argument. "None", "1-2", "3-5" and
 * "6 or more" are descriptions of a queue. The tempting alternatives — "free",
 * "balanced", "overloaded" — each assert that some amount of open work is the correct
 * amount of open work, which depends on whether the work is a two-hour job or a
 * six-week one, and the schema has no estimate column to tell those apart. A band
 * that names a person as overloaded is also a band that a manager will use in a
 * performance conversation, which is not something a row of `tasks` can support.
 *
 * The bands stop at six rather than continuing upward because a manager reading this
 * already sees the exact per-person counts in the list above it. The chart answers
 * "is the work spread out or pooled", and the list answers "how much, and whose".
 */
export const WORKLOAD_BANDS: readonly WorkloadBand[] = [
  NO_OPEN_WORK,
  { key: 'one_to_two', label: '1-2', from: 1, to: 2 },
  { key: 'three_to_five', label: '3-5', from: 3, to: 5 },
  { key: 'six_or_more', label: '6 or more', from: 6, to: null },
];

/** The band an open-task count falls in. Out-of-range counts clamp to the nearest band. */
export function workloadBandFor(openTasks: number): WorkloadBand {
  const count = Number.isFinite(openTasks) ? Math.max(0, Math.trunc(openTasks)) : 0;

  for (const band of WORKLOAD_BANDS) {
    if (band.to === null) return band;
    if (count >= band.from && count <= band.to) return band;
  }
  return NO_OPEN_WORK;
}

// ---------------------------------------------------------------------------
// Authority
//
// UI affordances only. The policies are the authority: `employees_select_members`,
// `projects_select_members` and `tasks_select_members` all scope to the caller's
// organization, and this phase adds no policy.
// ---------------------------------------------------------------------------

/**
 * Whether this caller may see the per-person workload breakdown.
 *
 * Manager and above, which is the same floor `canAssignTasksToOthers`,
 * `canDeleteTasks` and `canManageProjects` already use. Two reasons, and they are
 * different:
 *
 *  1. It is a management view. Deciding who to hand the next job to is a scheduling
 *     decision with an owner, and the person whose name is on the list should be the
 *     one making it.
 *  2. It is a judgement about other people, even when the labels are only counts. A
 *     member should not be handed a ranked list of their colleagues' open work.
 *
 * ── What this is NOT, and the reason it is safe to state plainly ────────────────
 * This is a presentation gate, not a security boundary, and it is important to be
 * honest about which is which. `tasks_select_members` lets any member read every task
 * in their organization, so a member who really wanted to count a colleague's open
 * tasks could do it with a filter on the tasks screen. Nothing here claims to stop
 * that, and a comment implying otherwise would be worse than useless — it would
 * invite somebody to rely on a promise the database does not make.
 *
 * What this gate does buy is real: the dashboard stops putting the breakdown in front
 * of a caller who has no business reading it, in the one place where it is presented
 * rather than derived. The rows behind it are org-scoped and already visible to the
 * same people by another route.
 *
 * `role === null` answers `false`. A login whose role could not be resolved is not
 * shown other people's workload — the same rule `canEditTask` applies.
 */
export function canViewTeamWorkload(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'manager');
}
