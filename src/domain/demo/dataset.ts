/**
 * Trackit X — the demonstration dataset.
 *
 * ── What this is, and what it is emphatically not ──────────────────────────────
 * This is MOCK BUSINESS DATA. It is not a mock AI, not a mock provider, and not a
 * stand-in for the gateway. Everything above the data layer in Phase 38 is the real
 * thing: the real `buildDashboardSnapshot`, the real context minimizer, the real
 * `aiGatewayService`, the real Edge Function, the real Vault lookup, the real
 * provider adapter, and the real provider. Only the rows those calculations read are
 * supplied from here instead of from Postgres.
 *
 * That distinction is the whole design, and it is why this file is shaped like table
 * rows rather than like a snapshot. A mock that returned a precomputed
 * `DashboardSnapshot` would have to agree with `buildDashboardSnapshot` about every
 * aggregate, and would silently stop agreeing the first time someone changed a band
 * boundary. Supplying rows and letting the real aggregator run means the demo cannot
 * tell a different lie from production — if the numbers are wrong here, they are
 * wrong in the same way they would be wrong against a real database.
 *
 * ── Why the dates are offsets ──────────────────────────────────────────────────
 * `dueOffsetDays: -9` is stored; `2026-03-07` is not. An absolute date in a fixture
 * goes stale the moment the wall clock passes it, and the interesting properties of
 * this dataset — an overdue task stops being overdue, a due-soon task stops being due
 * soon — would quietly stop being exercised, leaving a demo that always looks healthy
 * and tests that assert on nothing.
 *
 * So the fixture is a set of offsets from a reference date and the absolute dates are
 * resolved against the same `asOf` the production path already threads through
 * (`buildDashboardSnapshot` takes `asOf` as a parameter precisely so that "today" is not
 * a hidden dependency). Determinism is therefore with respect to `asOf`, which is the
 * contract the rest of the application already has: the same `asOf` always produces the
 * same rows, the same snapshot, and the same context, and a test that pins `asOf` is
 * reproducible forever. Nothing here reads `Date.now()`, and nothing calls
 * `Math.random()`.
 *
 * ── Why the records are richer than the facts ──────────────────────────────────
 * These look like `employees`/`projects`/`tasks` table rows, and they carry columns the
 * Copilot does not read — a job title, a project description. That is deliberate and
 * faithful: the real tables have those columns, and Phase 37 established that the
 * narrow `DASHBOARD_*_COLUMNS` select lists are what the Copilot may see. The
 * projection in `demoDataService` drops them, exactly as the real `.select()` does. If
 * a title were smuggled into the context here, the Copilot would be reading a column
 * the dashboard deliberately excluded, and the "the AI sees what a person sees"
 * property would quietly stop holding.
 */
import type { EmploymentStatus } from '@/domain/employee';
import type { ProjectPriority, ProjectStatus } from '@/domain/project';
import type { TaskPriority, TaskStatus } from '@/domain/task';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * The one organization this dataset describes.
 *
 * A fixed constant, not a parameter, and that is a security property rather than a
 * convenience. Demo mode must not become a way to name an arbitrary organization: there
 * is exactly one organization here, its id is public in this file, and the records
 * behind it are invented sample data with nothing to disclose. A caller cannot pass a
 * different id and receive someone else's facts, because no other id resolves to
 * anything at all — see `readDemoFacts`, which refuses rather than substituting.
 */
export const DEMO_ORGANIZATION_ID = 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a0';

/** Shown in the UI so a user is never misled about where the figures came from. */
export const DEMO_ORGANIZATION_NAME = 'Trackit X Demo Organization';

export const DEMO_BUSINESS_TYPE = 'software';
export const DEMO_CURRENCY = 'INR';
export const DEMO_TIMEZONE = 'Asia/Kolkata';

/**
 * Headcount shown by the dashboard. A real figure rather than a count of the rows
 * above: the demo organization has two people in `organization_members` who are not
 * employees (a client and an accountant), and a headcount that always equals the
 * employee list is the kind of tidy lie that makes a demo dataset useless for
 * checking a layout that has to survive a real number.
 */
export const DEMO_ACCESS_HOLDERS = 7;

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/** An `employees` row, including the columns the Copilot's select list excludes. */
export interface DemoEmployeeRow {
  readonly id: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly employment_status: EmploymentStatus;
  /** Excluded from Copilot context by the narrow select list. Present for realism. */
  readonly job_title: string;
}

/** A `projects` row. */
export interface DemoProjectRow {
  readonly id: string;
  readonly name: string;
  readonly status: ProjectStatus;
  readonly priority: ProjectPriority;
  readonly progress: number;
  readonly owner_id: string | null;
  /** Days from `asOf`. Negative is in the past. `null` means undated. */
  readonly targetOffsetDays: number | null;
}

/** A `tasks` row. */
export interface DemoTaskRow {
  readonly id: string;
  readonly title: string;
  readonly project_id: string | null;
  readonly assignee_id: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly progress: number;
  /** Days from `asOf`. Negative is in the past. `null` means undated. */
  readonly dueOffsetDays: number | null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const DEMO_EMPLOYEES: readonly DemoEmployeeRow[] = [
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a1',
    first_name: 'Arjun',
    last_name: 'Mehta',
    employment_status: 'active',
    job_title: 'Project Manager',
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a2',
    first_name: 'Rahul',
    last_name: 'Verma',
    employment_status: 'active',
    job_title: 'Frontend Developer',
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a3',
    first_name: 'Priya',
    last_name: 'Nair',
    employment_status: 'active',
    job_title: 'Backend Developer',
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a4',
    first_name: 'Neha',
    last_name: 'Iyer',
    employment_status: 'active',
    job_title: 'Data Analyst',
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a5',
    first_name: 'Karthik',
    last_name: 'Reddy',
    // The one non-active employee, so the headcount rules are exercised rather than
    // assumed: `CURRENT_EMPLOYMENT_STATUSES` excludes `inactive`, and a demo where
    // everyone is `active` never proves that.
    employment_status: 'probation',
    job_title: 'UI/UX Designer',
  },
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const DEMO_PROJECTS: readonly DemoProjectRow[] = [
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    name: 'Mobile App Development',
    status: 'active',
    priority: 'high',
    // Moving, but not finished, with a target comfortably ahead. The healthy one.
    progress: 62,
    owner_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a1',
    targetOffsetDays: 34,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b2',
    name: 'Business Analytics Platform',
    status: 'on_hold',
    priority: 'critical',
    // The dataset's deliberate problem. On hold, critical, a third done, and its
    // target date five days out — inside `DUE_SOON_DAYS`, so it is the only project
    // the deadline pass flags, and "which projects are falling behind" has a real
    // answer rather than a rhetorical one. The Copilot has to notice that the reason
    // is the hold rather than the velocity: reporting "35% complete" without the hold
    // would be a true number attached to a false impression.
    progress: 35,
    owner_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a1',
    targetOffsetDays: 5,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b3',
    name: 'Website Revamp',
    status: 'planned',
    priority: 'medium',
    progress: 10,
    owner_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a5',
    targetOffsetDays: 75,
  },
];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const DEMO_TASKS: readonly DemoTaskRow[] = [
  // ── Mobile App Development ───────────────────────────────────────────────
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c1',
    title: 'Set up CI pipeline for the mobile repository',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a2',
    status: 'done',
    priority: 'high',
    progress: 100,
    dueOffsetDays: -40,
  },
  {
    // Overdue and urgent. The single most obviously overdue item in the dataset.
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c2',
    title: 'Implement push notification service',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a3',
    status: 'in_progress',
    priority: 'urgent',
    progress: 45,
    dueOffsetDays: -9,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c3',
    title: 'Design onboarding screens',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a5',
    status: 'in_progress',
    priority: 'medium',
    progress: 70,
    dueOffsetDays: 3,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c4',
    title: 'Offline data sync conflict handling',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a3',
    status: 'in_progress',
    priority: 'high',
    progress: 30,
    dueOffsetDays: 6,
  },
  {
    // Blocked by the same hold that stops its project. The dataset's one genuine
    // dependency chain, so "what are the risks" can name a cause rather than a mood.
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3cb',
    title: 'Beta feedback triage',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b1',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a1',
    status: 'blocked',
    priority: 'medium',
    progress: 15,
    dueOffsetDays: 5,
  },

  // ── Business Analytics Platform ──────────────────────────────────────────
  {
    // Overdue, urgent, and blocked — the worst item in the dataset by every measure
    // the snapshot computes.
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c5',
    title: 'Reconcile billing invoices for March',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b2',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a4',
    status: 'blocked',
    priority: 'urgent',
    progress: 20,
    dueOffsetDays: -14,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c6',
    title: 'Wire sales dashboard to the warehouse',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b2',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a4',
    status: 'todo',
    priority: 'urgent',
    progress: 0,
    dueOffsetDays: 2,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c7',
    title: 'Model retention cohorts',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b2',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a4',
    status: 'in_review',
    priority: 'medium',
    progress: 85,
    dueOffsetDays: 9,
  },

  // ── Website Revamp ───────────────────────────────────────────────────────
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c8',
    title: 'Migrate legacy CMS content',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b3',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a5',
    status: 'done',
    priority: 'medium',
    progress: 100,
    dueOffsetDays: -21,
  },
  {
    // Overdue on a `planned` project, which is the awkward case: the work is barely
    // started and the date has already passed.
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3ca',
    title: 'Accessibility audit of key pages',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b3',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a2',
    status: 'in_progress',
    priority: 'high',
    progress: 25,
    dueOffsetDays: -2,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3c9',
    title: 'Set up staging environment',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b3',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a2',
    status: 'todo',
    priority: 'low',
    progress: 0,
    dueOffsetDays: 21,
  },
  {
    id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3c0d3cc',
    title: 'Quarterly roadmap review',
    project_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3b0d3b3',
    assignee_id: 'd3a0d3a0-d3a0-4d3a-8d3a-d3a0d3a0d3a1',
    status: 'todo',
    priority: 'low',
    progress: 0,
    dueOffsetDays: 30,
  },
];

/**
 * One `YYYY-MM-DD` date used as the origin for every offset in this file.
 *
 * Published rather than computed so a test can assert the resolved dates exactly
 * instead of merely asserting that they are in the past. Nothing reads the clock to
 * produce it.
 */
export const DEMO_REFERENCE_DATE = '2026-03-16';
