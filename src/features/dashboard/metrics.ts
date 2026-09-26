/**
 * Trackit X — the dashboard snapshot.
 *
 * Facts in, one typed business summary out. No Supabase, no React, no I/O, no clock:
 * the reference date is passed in, which is what makes every number below a
 * deterministic function of its inputs and therefore testable without a database, a
 * renderer, or a fixture frozen in time.
 *
 * ── This module is the analytics contract ──────────────────────────────────────
 * The screens read `DashboardSnapshot`, and so will the AI backend when it exists. That
 * is the point of the shape: one definition of "what a business's numbers are", so a
 * Copilot reasons over the same figures a person is looking at rather than over a
 * second, divergent read of the same tables. If a metric is added to the dashboard and
 * not here, it is not part of the contract and should not have been added.
 *
 * Three properties the shape guarantees, and they are the reason it is a snapshot
 * rather than a bag of independent counts:
 *
 *  · EVERY GROUP IS COMPLETE. `byStatus` carries all five project statuses and all five
 *    task statuses including the ones with nothing in them. A tally that omits the
 *    empty state cannot be told apart from a tally that was never run — and "nothing
 *    is blocked" is the most reassuring row on a delivery view. Every band and every
 *    status in this file exists at zero before the first row is counted.
 *  · EVERY RATIO HAS A DENOMINATOR OR IS `null`. An average over zero projects is not
 *    zero, and a completion rate over zero tasks is not 0%. Both are `null` here, and
 *    `null` renders as "—" rather than as a confident figure.
 *  · EVERY NUMBER IS TRACABLE. Each field below is computed from a column named in
 *    `../services/dashboardService.ts`. There is no metric here that the schema cannot
 *    produce, which is also why there is no health score, no revenue, no margin and no
 *    trend: the tables hold none of those things.
 */
import {
  DUE_SOON_DAYS,
  PROGRESS_BANDS,
  WORKLOAD_BANDS,
  canViewTeamWorkload,
  progressBandFor,
  workloadBandFor,
  type ProgressBand,
  type WorkloadBand,
} from '@/domain/dashboard';
import { employeeDisplayName } from '@/domain/employee';
import { isOpenProject, PROJECT_PRIORITIES, PROJECT_STATUSES } from '@/domain/project';
import { isTaskOverdue, daysUntilDue, OPEN_TASK_STATUSES, TASK_PRIORITIES, TASK_STATUSES } from '@/domain/task';
import type { DashboardFacts, DashboardTaskFact } from '@/services/dashboardService';
import type {
  EmploymentStatus,
  OrganizationRole,
  ProjectPriority,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from '@/types/database';

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

/**
 * One count in a group that always contains every key.
 *
 * A `Record<Enum, number>` rather than an array: the compiler then requires a key for
 * every member of the enum, so adding a status to the database without deciding where
 * it appears on the dashboard is a type error rather than a silently missing bar.
 */
export type StatusCounts<Status extends string> = Readonly<Record<Status, number>>;

/** How many of a population sit in each band. Every band is present. */
export interface BandCounts<Band> {
  readonly band: Band;
  readonly count: number;
}

export interface EmployeeMetrics {
  /** Everyone on the directory, whatever their employment state. */
  readonly total: number;
  readonly active: number;
  readonly probation: number;
  readonly onLeave: number;
  readonly noticePeriod: number;
  readonly inactive: number;
  /**
   * The headcount a manager actually staffs from: active, on probation and on leave.
   * Identical to `employeeService.countCurrentEmployees`, and identical on purpose —
   * two screens that answered "how many people work here" differently would be a bug
   * report nobody could reproduce.
   */
  readonly current: number;
  /**
   * People carrying at least one OPEN task.
   *
   * `null` — not zero — when the viewer is not permitted the workload pass. The two are
   * different claims, and a reader cannot tell them apart: `0` asserts that nobody is
   * carrying anything, which for a member is a falsehood produced by a permission check
   * rather than a fact about the business.
   *
   * This matters more here than in a view. `DashboardSnapshot` is the contract a future AI
   * provider would consume, so a `0` in this field would be quoted back as "nobody has
   * open work" by a model reasoning over a viewer who was never allowed to be told.
   * A `null` is legible to both a person and a prompt: the answer is withheld, not
   * absent. See `canViewTeamWorkload`.
   */
  readonly withOpenWork: number | null;
  /**
   * Current headcount with nobody carrying open work. Never negative, and `null`
   * under the same rule as `withOpenWork`.
   */
  readonly withoutOpenWork: number | null;
  /**
   * Logins with access to this organization, from `organization_members`.
   *
   * A different number from `total` and deliberately kept beside it. A login with no
   * employee record, or an employee who has never been issued a sign-in, is the gap
   * this product is built on, and the Phase 1 dashboard could only ever show one side
   * of it. `null` when the count was not returned — which is not the same as nobody.
   */
  readonly accessHolders: number | null;
}

export interface ProjectMetrics {
  readonly total: number;
  /** `planned`, `active` and `on_hold` — neither delivered nor stopped. */
  readonly open: number;
  /** Strictly the `active` status. Not a synonym for `open`. */
  readonly active: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly byStatus: StatusCounts<ProjectStatus>;
  readonly byPriority: StatusCounts<ProjectPriority>;
  /** Projects with nobody accountable. */
  readonly unowned: number;
  /**
   * Mean `progress` across OPEN projects, or `null` when there are none.
   *
   * Open only, and that is a substantive choice rather than a convenience. A completed
   * project is 100% by definition, so including them drags the mean toward 100 and the
   * figure stops describing the work actually in flight — the one number a manager
   * opens this screen to see. Cancelled projects are excluded too, for the reason
   * `impliedProgressForProjectStatus` gives: work somebody deliberately stopped is not
   * work that failed to progress, and averaging it in would read as failure.
   */
  readonly averageProgress: number | null;
}

export interface TaskMetrics {
  readonly total: number;
  /** `todo`, `in_progress`, `blocked`, `in_review`. */
  readonly open: number;
  readonly toDo: number;
  readonly inProgress: number;
  readonly blocked: number;
  readonly inReview: number;
  readonly done: number;
  /**
   * Open and past their due date. Never counted from a `done` task: a delivered task
   * whose date slipped is history, and listing it as late would overstate the backlog.
   * Same rule as `taskService.countOverdueTasks` and `isTaskOverdue`.
   */
  readonly overdue: number;
  /** Open tasks with no assignee — work nobody owns. */
  readonly unassigned: number;
  readonly byStatus: StatusCounts<TaskStatus>;
  readonly byPriority: StatusCounts<TaskPriority>;
  /**
   * Mean `progress` across OPEN tasks, or `null` when there are none.
   *
   * Open only, for the same reason as projects: a done task is 100% by definition.
   */
  readonly averageProgress: number | null;
  /** `done / total`, or `null` when the organization has no tasks at all. */
  readonly completionRate: number | null;
}

/** One person and the open work they are carrying. A count, never a verdict. */
export interface WorkloadEntry {
  readonly employeeId: string;
  readonly name: string;
  readonly openTasks: number;
  readonly overdueTasks: number;
  /** Delivered tasks. Shown for context, never divided by anything. */
  readonly doneTasks: number;
  readonly band: WorkloadBand;
}

export interface WorkloadDistributionBand {
  readonly band: WorkloadBand;
  /** How many people sit in this band. */
  readonly people: number;
  /** Of the people carrying open work, the fraction in this band. 0-1. */
  readonly share: number;
}

export interface WorkloadMetrics {
  /** One per person holding at least one open task, busiest first, then by name. */
  readonly entries: readonly WorkloadEntry[];
  readonly peopleWithOpenWork: number;
  /** Current headcount with no open work. Never negative — see the note below. */
  readonly withoutOpenWork: number;
  /**
   * People who are NOT on the current workforce but still hold open tasks.
   *
   * They exist because `updateEmployee` deliberately does not unassign a person's work
   * when their status changes — reassigning is a scheduling decision with an owner, and
   * doing it silently would move work to a colleague because somebody changed a
   * status. The consequence is that `peopleWithOpenWork` can exceed
   * `withoutOpenWork + peopleWithOpenWork`'s implied headcount, so this figure exists
   * to make the difference visible instead of leaving a reader to wonder why the two
   * numbers do not reconcile.
   */
  readonly offWorkforceWithOpenWork: number;
  /** Open tasks with an assignee. Excludes unassigned work by definition. */
  readonly totalOpenTasks: number;
  /** Mean open tasks per person carrying work, or `null` when nobody is. */
  readonly meanOpenTasksPerPerson: number | null;
  /** Every band present, in band order, whether or not anybody is in it. */
  readonly distribution: readonly WorkloadDistributionBand[];
  /** The single largest entry, or `null` when nobody has any. */
  readonly busiest: WorkloadEntry | null;
}

export interface DeadlineEntry {
  readonly projectId: string;
  readonly name: string;
  readonly targetDate: string;
  /** Negative once the date has passed. */
  readonly daysUntil: number;
  readonly status: ProjectStatus;
  readonly progress: number;
  readonly isOverdue: boolean;
}

export interface DeadlineMetrics {
  /** Open projects past their target date. */
  readonly overdueProjects: number;
  /** Open projects due within `DUE_SOON_DAYS`. */
  readonly dueSoonProjects: number;
  /**
   * Open projects with no target date at all.
   *
   * Reported as a metric rather than quietly ignored, because an undated project is
   * the most common way a schedule stops being a schedule. It is a count of missing
   * information, not a count of lateness.
   */
  readonly undatedProjects: number;
  readonly overdueTasks: number;
  readonly dueSoonTasks: number;
  readonly undatedTasks: number;
  /** The soonest open dated projects, capped for display. */
  readonly approaching: readonly DeadlineEntry[];
}

/** How many tasks sit in each progress band. Every band present. */
export interface ProgressDistribution {
  readonly bands: readonly BandCounts<ProgressBand>[];
  /** The number that went in. Equals the sum of every band. */
  readonly total: number;
}

export interface ProgressAnalytics {
  readonly projects: ProgressDistribution;
  readonly tasks: ProgressDistribution;
  readonly averageProjectProgress: number | null;
  readonly averageTaskProgress: number | null;
  /** `completed / total` projects, or `null` when there are none. */
  readonly projectCompletionRate: number | null;
  /** `done / total` tasks, or `null` when there are none. */
  readonly taskCompletionRate: number | null;
}

/**
 * Everything the dashboard knows about one organization at one moment.
 *
 * The AI-ready contract. `workload` is `null` for a caller below manager — which is
 * meaningfully different from an organization where nobody has any work, and the
 * difference is the whole point of modelling it as nullable.
 */
export interface DashboardSnapshot {
  readonly organizationId: string;
  /** The reference date every relative figure was computed against. `YYYY-MM-DD`. */
  readonly asOf: string;
  readonly employees: EmployeeMetrics;
  readonly projects: ProjectMetrics;
  readonly tasks: TaskMetrics;
  readonly workload: WorkloadMetrics | null;
  readonly deadlines: DeadlineMetrics;
  readonly progress: ProgressAnalytics;
}

/**
 * Everything `buildDashboardSnapshot` needs that is not in the facts.
 *
 * The organization id is passed in rather than read from a fact on purpose: the
 * snapshot is TAGGED with the tenant it describes, and a caller that got this wrong
 * would produce a snapshot stamped with the wrong id — which the hook's freshness check
 * would then reject, rather than show. The stamp is set from the argument the switch
 * test controls.
 */
export interface DashboardSnapshotContext {
  readonly organizationId: string;
  /** `YYYY-MM-DD`. Passed in so "today" is a parameter and not a hidden dependency. */
  readonly asOf: string;
  readonly role: OrganizationRole | null;
  /** `organization_members` count, or `null` when it was not returned. */
  readonly accessHolders: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Every key of a status enum, present at zero. */
function emptyCounts<Status extends string>(keys: readonly Status[]): StatusCounts<Status> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as StatusCounts<Status>;
}

function tally<Status extends string, Row>(
  rows: readonly Row[],
  keys: readonly Status[],
  select: (row: Row) => Status,
): StatusCounts<Status> {
  // Accumulated into a mutable record and frozen on the way out. The public type is
  // `Readonly` so a metric can never be adjusted after it is counted, but the tally
  // itself has to mutate something to count anything.
  const counts: Record<string, number> = emptyCounts<Status>(keys);

  for (const row of rows) {
    const key = select(row);
    // A value the enum does not contain cannot be counted, and is dropped rather than
    // added to a key that does not exist. A CHECK-constrained enum column makes this
    // unreachable; the guard is so that a future status added to the database without
    // adding it to the array shows up as a wrong total rather than a crash.
    if (key in counts) counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts as StatusCounts<Status>;
}

/** Sum of the named keys, for "total that is a subset of the groups". */
function sumOf<Status extends string>(counts: StatusCounts<Status>, keys: readonly Status[]): number {
  return keys.reduce((sum, key) => sum + counts[key], 0);
}

/**
 * The mean, or `null` over nothing.
 *
 * `null` rather than 0 because "the average progress of no open projects" is not a
 * quantity. Rendering it as 0% would put a number on the dashboard that nobody entered
 * and that means nothing — the exact failure `progress.ts` refuses to commit elsewhere.
 */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/** A ratio, or `null` when there is nothing to divide by. 0-1, unrounded. */
function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

/** Whether a date is past the reference date. `null` is never past. */
function isPast(date: string | null, asOf: string): boolean {
  return date !== null && date < asOf;
}

/** Whether a date falls inside the "due soon" window, inclusive of today. */
function isDueSoon(date: string | null, asOf: string, windowDays: number): boolean {
  const remaining = daysUntilDue(date, asOf);
  return remaining !== null && remaining >= 0 && remaining <= windowDays;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

/**
 * Headcount, from the employment-state distribution.
 *
 * `withOpenWork` comes from the task read rather than from this function, because the
 * two facts arrive together and splitting the derivation across two places is how the
 * two halves end up describing different populations. It is filled in by
 * `buildDashboardSnapshot` once the workload pass has the answer.
 */
function buildEmployeeMetrics(
  facts: DashboardFacts,
  accessHolders: number | null,
): Omit<EmployeeMetrics, 'withOpenWork' | 'withoutOpenWork'> {
  const byStatus = tally(facts.employees, EMPLOYMENT_STATUSES, (row) => row.employment_status);

  return {
    total: facts.employees.length,
    active: byStatus.active,
    probation: byStatus.probation,
    onLeave: byStatus.on_leave,
    noticePeriod: byStatus.notice_period,
    inactive: byStatus.inactive,
    current: sumOf(byStatus, CURRENT_EMPLOYMENT_STATUSES),
    accessHolders,
  };
}

const EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  'active',
  'probation',
  'on_leave',
  'notice_period',
  'inactive',
];

/**
 * The states a business is currently employing somebody in.
 *
 * Typed as `readonly EmploymentStatus[]` rather than a narrow tuple on purpose: a tuple
 * would make `.includes(employee.employment_status)` a type error, and the fix for that
 * error would be a cast at the call site — which is how a widened status list quietly
 * stops matching the states that count as current.
 */
const CURRENT_EMPLOYMENT_STATUSES: readonly EmploymentStatus[] = [
  'active',
  'probation',
  'on_leave',
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function buildProjectMetrics(facts: DashboardFacts): ProjectMetrics {
  const byStatus = tally(facts.projects, PROJECT_STATUSES, (row) => row.status);
  const byPriority = tally(facts.projects, PROJECT_PRIORITIES, (row) => row.priority);

  const openProjects = facts.projects.filter((row) => isOpenProject(row.status));

  return {
    total: facts.projects.length,
    open: openProjects.length,
    active: byStatus.active,
    completed: byStatus.completed,
    cancelled: byStatus.cancelled,
    byStatus,
    byPriority,
    unowned: facts.projects.filter((row) => row.owner_id === null).length,
    averageProgress: mean(openProjects.map((row) => row.progress)),
  };
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

interface TaskPass {
  readonly byStatus: StatusCounts<TaskStatus>;
  readonly byPriority: StatusCounts<TaskPriority>;
  readonly open: number;
  readonly overdue: number;
  readonly unassigned: number;
  readonly averageProgress: number | null;
  readonly openRows: readonly DashboardTaskFact[];
}

/**
 * One pass over the tasks, for every task metric.
 *
 * A single traversal rather than one `filter` per metric. It is the same set of rows
 * counted several times, and `status === 'done'` is the one branch that matters: a
 * delivered task is excluded from open, overdue, unassigned and the progress mean at
 * once, which is the behaviour `useTasks.summarize` already relies on. Deriving those
 * four figures from separate filters is how one of them ends up disagreeing with the
 * others.
 */
function passTasks(tasks: readonly DashboardTaskFact[], asOf: string): TaskPass {
  const byStatus = tally(tasks, TASK_STATUSES, (row) => row.status);
  const byPriority = tally(tasks, TASK_PRIORITIES, (row) => row.priority);

  const openRows = tasks.filter((row) => OPEN_TASK_STATUSES.includes(row.status));

  let overdue = 0;
  let unassigned = 0;
  for (const row of openRows) {
    if (isTaskOverdue(row, asOf)) overdue += 1;
    if (row.assignee_id === null) unassigned += 1;
  }

  return {
    byStatus,
    byPriority,
    open: openRows.length,
    overdue,
    unassigned,
    averageProgress: mean(openRows.map((row) => row.progress)),
    openRows,
  };
}

function buildTaskMetrics(pass: TaskPass, totalTasks: number): TaskMetrics {
  return {
    total: totalTasks,
    open: pass.open,
    toDo: pass.byStatus.todo,
    inProgress: pass.byStatus.in_progress,
    blocked: pass.byStatus.blocked,
    inReview: pass.byStatus.in_review,
    done: pass.byStatus.done,
    overdue: pass.overdue,
    unassigned: pass.unassigned,
    byStatus: pass.byStatus,
    byPriority: pass.byPriority,
    averageProgress: pass.averageProgress,
    completionRate: ratio(pass.byStatus.done, totalTasks),
  };
}

// ---------------------------------------------------------------------------
// Workload
// ---------------------------------------------------------------------------

/**
 * Who is carrying open work.
 *
 * DESCRIPTIVE ONLY, and the comments here are the enforcement. Nothing below ranks
 * people by quality, divides their work by a time estimate the schema does not have,
 * or calls a count a problem. The bands in `domain/dashboard.ts` are labelled with
 * numbers for the same reason.
 *
 * Three decisions that are easy to get wrong:
 *
 *  · Entries cover EVERY employee holding open work, not only current ones. An
 *    employee who went to `inactive` still has their tasks — deliberately, see
 *    `WorkloadMetrics.offWorkforceWithOpenWork` — and hiding them from this panel would
 *    make the busiest person in the business invisible to the one screen that is meant
 *    to show where the work is.
 *  · `withoutOpenWork` is floored at zero rather than allowed to go negative. It is
 *    measured against CURRENT headcount while `peopleWithOpenWork` counts everyone, so
 *    the two can genuinely disagree when somebody off the workforce is still carrying
 *    work. A negative "people without work" is nonsense on a screen, and clamping is
 *    better than the alternative — but the clamp is also a lie in that state, which is
 *    why `offWorkforceWithOpenWork` is reported beside it so the reader can see the
 *    difference rather than infer it.
 *  · `meanOpenTasksPerPerson` divides by the people carrying work, NOT by headcount.
 *    The other mean answers "what is the load per employee across the business",
 *    which is a staffing question, and answering it with a divisor that includes people
 *    who were never given any work would understate it for reasons that have nothing to
 *    do with the people who have it.
 */
function buildWorkload(
  facts: DashboardFacts,
  openTasks: readonly DashboardTaskFact[],
  asOf: string,
  currentHeadcount: number,
): WorkloadMetrics {
  interface Accumulator {
    open: number;
    overdue: number;
    done: number;
  }

  const zero = (): Accumulator => ({ open: 0, overdue: 0, done: 0 });
  const held = new Map<string, Accumulator>();

  // Open work, and how much of it is late. `isTaskOverdue` is the same rule the tasks
  // screen and `taskService.countOverdueTasks` use, called with the same reference
  // date, so a person's overdue count always equals the overdue count on their tasks.
  for (const row of openTasks) {
    if (row.assignee_id === null) continue;
    const counts = held.get(row.assignee_id) ?? zero();
    counts.open += 1;
    if (isTaskOverdue(row, asOf)) counts.overdue += 1;
    held.set(row.assignee_id, counts);
  }

  // Delivered work is a second pass, because it is a different population: a person
  // whose only tasks are done appears in neither list above, and the panel would then
  // report that they did no work at all rather than that they finished some.
  for (const row of facts.tasks) {
    if (row.assignee_id === null || row.status !== 'done') continue;
    const counts = held.get(row.assignee_id) ?? zero();
    counts.done += 1;
    held.set(row.assignee_id, counts);
  }

  const entries: WorkloadEntry[] = [];
  let offWorkforce = 0;
  let totalOpenTasks = 0;

  for (const employee of facts.employees) {
    const counts = held.get(employee.id);
    if (counts === undefined) continue;

    totalOpenTasks += counts.open;
    if (!CURRENT_EMPLOYMENT_STATUSES.includes(employee.employment_status)) offWorkforce += 1;

    entries.push({
      employeeId: employee.id,
      name: employeeDisplayName(employee),
      openTasks: counts.open,
      overdueTasks: counts.overdue,
      doneTasks: counts.done,
      band: workloadBandFor(counts.open),
    });
  }

  // Busiest first, then by name. The name tiebreak is what keeps two rows with equal
  // counts in the same order between renders — without it the panel reshuffles
  // arbitrarily every time an unrelated figure changes, which reads as the data moving.
  entries.sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name));

  const peopleWithOpenWork = entries.length;
  const withoutOpenWork = Math.max(0, currentHeadcount - peopleWithOpenWork);

  return {
    entries,
    peopleWithOpenWork,
    withoutOpenWork,
    offWorkforceWithOpenWork: offWorkforce,
    totalOpenTasks,
    meanOpenTasksPerPerson: mean(entries.map((entry) => entry.openTasks)),
    distribution: buildDistribution(entries, withoutOpenWork),
    busiest: entries[0] ?? null,
  };
}

/**
 * The distribution of people by open-task count.
 *
 * `withoutOpenWork` is a separate argument rather than being derived here, and that is
 * the whole point of the function. An entry is one person holding at least one open
 * task, so the idle are structurally absent from `entries` — tallying `entries` alone
 * made the `none` band unreachable, which put a permanent `0` on screen reading "no one
 * is idle" while people with empty queues sat right there in `withoutOpenWork`. A
 * distribution with a row that can never move is worse than no row, because it looks
 * measured.
 *
 * The count is threaded in from the same subtraction that produces
 * `withoutOpenWork`, so the band and the field cannot drift apart.
 */
function buildDistribution(
  entries: readonly WorkloadEntry[],
  withoutOpenWork: number,
): readonly WorkloadDistributionBand[] {
  const counts = new Map<WorkloadBand['key'], number>();
  for (const entry of entries) {
    counts.set(entry.band.key, (counts.get(entry.band.key) ?? 0) + 1);
  }
  counts.set('none', withoutOpenWork);

  /*
   * The denominator is everyone the bands account for — carriers plus the idle — not
   * headcount. Those two differ when somebody off the workforce still holds tasks, and
   * using headcount here would make the shares sum to less than one for reasons the
   * reader cannot see. `offWorkforceWithOpenWork` is reported beside this so the
   * arithmetic is visible rather than implied.
   */
  const total = entries.length + withoutOpenWork;

  // Every band, in order, at zero when empty. Same reason as the status tallies.
  return WORKLOAD_BANDS.map((band) => {
    const people = counts.get(band.key) ?? 0;
    return { band, people, share: total === 0 ? 0 : people / total };
  });
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** How many approaching projects the deadline panel lists before it stops. */
const APPROACHING_LIMIT = 6;

function buildDeadlines(
  facts: DashboardFacts,
  pass: TaskPass,
  asOf: string,
): DeadlineMetrics {
  const openProjects = facts.projects.filter((row) => isOpenProject(row.status));

  let overdueProjects = 0;
  let dueSoonProjects = 0;
  let undatedProjects = 0;
  const dated: DeadlineEntry[] = [];

  for (const project of openProjects) {
    if (project.target_date === null) {
      undatedProjects += 1;
      continue;
    }
    const remaining = daysUntilDue(project.target_date, asOf);
    // An unparseable date cannot be ranked, so it is counted as undated rather than
    // guessed at. The column is a Postgres `date`, so this is defensive only.
    if (remaining === null) {
      undatedProjects += 1;
      continue;
    }
    const overdue = isPast(project.target_date, asOf);
    if (overdue) overdueProjects += 1;
    else if (remaining <= DUE_SOON_DAYS) dueSoonProjects += 1;

    dated.push({
      projectId: project.id,
      name: project.name,
      targetDate: project.target_date,
      daysUntil: remaining,
      status: project.status,
      progress: project.progress,
      isOverdue: overdue,
    });
  }

  // Soonest first, and overdue work leads: `daysUntil` is negative for anything past,
  // so a single ascending sort puts the late work at the top without a second rule.
  dated.sort((a, b) => a.daysUntil - b.daysUntil || a.name.localeCompare(b.name));

  let overdueTasks = 0;
  let dueSoonTasks = 0;
  let undatedTasks = 0;
  for (const row of pass.openRows) {
    if (row.due_date === null) {
      undatedTasks += 1;
      continue;
    }
    if (isPast(row.due_date, asOf)) overdueTasks += 1;
    else if (isDueSoon(row.due_date, asOf, DUE_SOON_DAYS)) dueSoonTasks += 1;
  }

  return {
    overdueProjects,
    dueSoonProjects,
    undatedProjects,
    overdueTasks,
    dueSoonTasks,
    undatedTasks,
    approaching: dated.slice(0, APPROACHING_LIMIT),
  };
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

function buildProgressDistribution(values: readonly number[]): ProgressDistribution {
  const counts = new Map<ProgressBand['key'], number>();
  for (const value of values) {
    const band = progressBandFor(value);
    counts.set(band.key, (counts.get(band.key) ?? 0) + 1);
  }
  return {
    bands: PROGRESS_BANDS.map((band) => ({ band, count: counts.get(band.key) ?? 0 })),
    total: values.length,
  };
}

function buildProgress(
  facts: DashboardFacts,
  pass: TaskPass,
  projects: ProjectMetrics,
): ProgressAnalytics {
  const openProjects = facts.projects.filter((row) => isOpenProject(row.status));

  return {
    // Project progress is distributed over the OPEN projects, matching
    // `ProjectMetrics.averageProgress`. A chart of every project would be mostly a
    // wall of 100% bars for the finished ones, which is a worse chart than a
    // distribution of the work still in flight.
    projects: buildProgressDistribution(openProjects.map((row) => row.progress)),
    tasks: buildProgressDistribution(pass.openRows.map((row) => row.progress)),
    averageProjectProgress: projects.averageProgress,
    averageTaskProgress: pass.averageProgress,
    // `completed`, not "closed": a cancelled project was stopped on purpose and
    // counting it as delivered would overstate the figure, which is the same reason
    // `impliedProgressForProjectStatus` gives it no progress value at all.
    projectCompletionRate: ratio(projects.byStatus.completed, projects.total),
    taskCompletionRate: ratio(pass.byStatus.done, facts.tasks.length),
  };
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/**
 * Facts plus context become one snapshot.
 *
 * The single place a metric is assembled, which is what lets the tests assert things
 * that are otherwise unassertable — that the group sums match the totals, that no ratio
 * is `null` where there was something to divide by, and that `workload` is `null` for a
 * member and fully populated for a manager, from one function call.
 *
 * The employee and workload figures are stitched together here rather than inside
 * either builder, because the person-counting lives in the workload pass and the
 * headcount in the employee pass, and both are needed to state "N of M people have
 * work". A metric that needs two passes to produce is computed where the two passes
 * are both in scope.
 */
export function buildDashboardSnapshot(
  facts: DashboardFacts,
  context: DashboardSnapshotContext,
): DashboardSnapshot {
  const { organizationId, asOf, role, accessHolders } = context;

  const employees = buildEmployeeMetrics(facts, accessHolders);
  const pass = passTasks(facts.tasks, asOf);
  const projects = buildProjectMetrics(facts);
  const tasks = buildTaskMetrics(pass, facts.tasks.length);

  /*
   * The workload pass is the only gated one, and it is not merely hidden for a caller
   * below manager — it is not run. A member's snapshot therefore does not contain the
   * per-person counts at all, rather than containing them behind a boolean the screen
   * could forget to check.
   *
   * It takes the current headcount as an argument instead of re-deriving it: the
   * employee tally above is the only place that figure is computed, and a second tally
   * would be a second chance for the two to disagree.
   */
  const workload = canViewTeamWorkload(role)
    ? buildWorkload(facts, pass.openRows, asOf, employees.current)
    : null;

  /*
   * The one place in this file where a field is deliberately left `null` rather than
   * defaulted, and the `?? 0` that used to sit here was a real bug in the contract.
   *
   * `workload === null` means the viewer may not see per-person workload. Writing `0`
   * into `withOpenWork` in that case would not be a harmless placeholder: the field
   * would assert that nobody is carrying work, and every consumer of this snapshot
   * would believe it. A future AI provider reading this contract over a member's token
   * would answer "nobody has open work" — a confident, false, permission-derived claim,
   * which is the exact failure this codebase's AI screens are written to avoid.
   *
   * The clamp stays for the permitted case, where it does the job it was written for:
   * somebody off the workforce can still hold tasks, so `current - peopleWithOpenWork`
   * can genuinely go negative, and `offWorkforceWithOpenWork` is reported beside it so
   * the difference is visible rather than inferred.
   */
  const withOpenWork = workload?.peopleWithOpenWork ?? null;

  return {
    organizationId,
    asOf,
    employees: {
      ...employees,
      withOpenWork,
      withoutOpenWork:
        withOpenWork === null ? null : Math.max(0, employees.current - withOpenWork),
    },
    projects,
    tasks,
    workload,
    deadlines: buildDeadlines(facts, pass, asOf),
    progress: buildProgress(facts, pass, projects),
  };
}
