/**
 * Dashboard metrics — the derivation behind every figure on the screen.
 *
 * This is the highest-value test file in the phase, and the reason is structural rather
 * than incidental. `buildDashboardSnapshot` is pure: rows in, snapshot out, no clock and
 * no database. That is what makes it testable at the level the risk actually lives, which
 * is arithmetic and edge cases rather than rendering. A component test can only prove a
 * number was printed; these prove the number is right.
 *
 * The cases are chosen to attack the specific ways a dashboard goes wrong, in order of
 * how much damage they would do:
 *
 *   1. FABRICATION — a figure appearing where the schema has none. Asserted by the empty
 *      organization case: every field is a real zero, and every ratio that would need a
 *      denominator is `null` rather than `0`.
 *   2. PERMISSION LEAKS — a member receiving a per-person figure. Asserted against
 *      `role`, including the case that motivated making those fields nullable.
 *   3. THE WRONG DENOMINATOR — averages that include finished work, completion rates
 *      with no tasks, distributions built from the wrong population.
 *   4. OFF-BY-ONE AT THE DATE BOUNDARY — overdue on the due date itself, and the
 *      `DUE_SOON_DAYS` edge, since "late" and "due soon" are the two figures that drive
 *      action and the two most likely to be off by a day.
 *   5. RECONCILIATION — the off-workforce case, where two headline figures legitimately
 *      disagree and the panel has to say so rather than clamp the difference away.
 */
import { buildDashboardSnapshot, type DashboardSnapshot } from '@/features/dashboard/metrics';
import type {
  DashboardEmployeeFact,
  DashboardFacts,
  DashboardProjectFact,
  DashboardTaskFact,
} from '@/services/dashboardService';
import { TASK_PRIORITIES, TASK_STATUSES } from '@/domain/task';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '@/domain/project';
import { EMPLOYMENT_STATUSES } from '@/domain/employee';
import type { OrganizationRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const TODAY = '2026-09-27';

/** Days from TODAY, as a `YYYY-MM-DD` string. Negative is in the past. */
function days(offset: number): string {
  const base = Date.parse(`${TODAY}T00:00:00Z`);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

/*
 * IDs are allocated per test, not per file. A module-level counter was the first version
 * of this fixture and it silently broke every test that referred to `emp-1` by name: by
 * the time the workload cases ran, `emp-1` had been allocated to a test that had already
 * finished, so the rows referred to nobody. `beforeEach` makes the IDs mean what the
 * test says they mean, and a failure now points at the test that caused it.
 */
let employeeSeq = 0;
let projectSeq = 0;

beforeEach(() => {
  employeeSeq = 0;
  projectSeq = 0;
});

function employee(
  employment_status: DashboardEmployeeFact['employment_status'],
  first = 'Test',
  last = 'Person',
): DashboardEmployeeFact {
  employeeSeq += 1;
  return {
    id: `emp-${employeeSeq}`,
    first_name: first,
    last_name: `${last}${employeeSeq}`,
    employment_status,
  };
}

function project(overrides: Partial<DashboardProjectFact> = {}): DashboardProjectFact {
  projectSeq += 1;
  return {
    id: `prj-${projectSeq}`,
    name: `Project ${projectSeq}`,
    status: 'active',
    priority: 'medium',
    progress: 0,
    target_date: null,
    owner_id: null,
    ...overrides,
  };
}

function task(overrides: Partial<DashboardTaskFact> = {}): DashboardTaskFact {
  return {
    status: 'todo',
    priority: 'medium',
    progress: 0,
    due_date: null,
    assignee_id: null,
    ...overrides,
  };
}

function facts(overrides: Partial<DashboardFacts> = {}): DashboardFacts {
  return { employees: [], projects: [], tasks: [], ...overrides };
}

function snapshotOf(
  input: DashboardFacts,
  role: OrganizationRole | null = 'owner',
  accessHolders: number | null = 3,
): DashboardSnapshot {
  return buildDashboardSnapshot(input, {
    organizationId: ORG,
    asOf: TODAY,
    role,
    accessHolders,
  });
}

const NOTHING = facts();

// ---------------------------------------------------------------------------
// 1. The empty organization — nothing invented
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — nothing exists', () => {
  const snapshot = snapshotOf(NOTHING);

  it('reports real zeros rather than absent figures', () => {
    expect(snapshot.employees.total).toBe(0);
    expect(snapshot.employees.current).toBe(0);
    expect(snapshot.projects.total).toBe(0);
    expect(snapshot.tasks.total).toBe(0);
    expect(snapshot.workload?.totalOpenTasks ?? 0).toBe(0);
  });

  it('gives every status and priority key a zero, so no row is missing from a chart', () => {
    for (const status of PROJECT_STATUSES) {
      expect(snapshot.projects.byStatus[status]).toBe(0);
    }
    for (const priority of PROJECT_PRIORITIES) {
      expect(snapshot.projects.byPriority[priority]).toBe(0);
    }
    for (const status of TASK_STATUSES) {
      expect(snapshot.tasks.byStatus[status]).toBe(0);
    }
    for (const priority of TASK_PRIORITIES) {
      expect(snapshot.tasks.byPriority[priority]).toBe(0);
    }
  });

  /*
   * Employment states are flat fields rather than a `byStatus` map, and the difference
   * is deliberate: `onLeave` and `noticePeriod` are named claims, while a chart key
   * `on_leave` is a database value that means nothing on its own. Asserted here because
   * the first version of this test assumed a map and failed against the real shape.
   */
  it('reports every employment state as a named zero', () => {
    expect(snapshot.employees.active).toBe(0);
    expect(snapshot.employees.probation).toBe(0);
    expect(snapshot.employees.onLeave).toBe(0);
    expect(snapshot.employees.noticePeriod).toBe(0);
    expect(snapshot.employees.inactive).toBe(0);
    expect(EMPLOYMENT_STATUSES).toHaveLength(5);
  });

  /*
   * The distinction the whole phase turns on. A ratio with no denominator is not zero —
   * it is unmeasurable, and rendering it as 0% would state "nothing is late, nothing is
   * finished, the average is zero" about a business that has not started.
   */
  it('nulls every ratio that would need a denominator', () => {
    expect(snapshot.projects.averageProgress).toBeNull();
    expect(snapshot.tasks.averageProgress).toBeNull();
    expect(snapshot.tasks.completionRate).toBeNull();
    expect(snapshot.workload?.meanOpenTasksPerPerson ?? null).toBeNull();
  });

  it('marks progress distributions as empty rather than banding nothing', () => {
    expect(snapshot.progress.projects.total).toBe(0);
    expect(snapshot.progress.tasks.total).toBe(0);
    expect(snapshot.progress.projects.bands.every((band) => band.count === 0)).toBe(true);
  });

  it('carries the as-of date and organization through unchanged', () => {
    expect(snapshot.asOf).toBe(TODAY);
    expect(snapshot.organizationId).toBe(ORG);
  });
});

// ---------------------------------------------------------------------------
// 2. Headcount semantics
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — headcount', () => {
  it('separates everyone on the books from the current workforce', () => {
    const snapshot = snapshotOf(
      facts({
        employees: [
          employee('active'),
          employee('active'),
          employee('probation'),
          employee('on_leave'),
          employee('notice_period'),
          employee('inactive'),
        ],
      }),
    );

    expect(snapshot.employees.total).toBe(6);
    // `current` excludes notice period and inactive, matching
    // `employeeService.countCurrentEmployees`. Someone on leave is still employed.
    expect(snapshot.employees.current).toBe(4);
    expect(snapshot.employees.noticePeriod).toBe(1);
    expect(snapshot.employees.inactive).toBe(1);
    expect(snapshot.employees.onLeave).toBe(1);
  });

  it('surfaces a null member count as null, not as zero access holders', () => {
    const snapshot = snapshotOf(
      facts({ employees: [employee('active')] }),
      'owner',
      null,
    );
    expect(snapshot.employees.accessHolders).toBeNull();
  });

  it('carries a real member count through', () => {
    const snapshot = snapshotOf(
      facts({ employees: [employee('active')] }),
      'owner',
      7,
    );
    expect(snapshot.employees.accessHolders).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// 3. Projects
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — projects', () => {
  it('counts open as planned, active and on_hold, and keeps the rest separate', () => {
    const snapshot = snapshotOf(
      facts({
        projects: [
          project({ status: 'planned' }),
          project({ status: 'active' }),
          project({ status: 'on_hold' }),
          project({ status: 'completed' }),
          project({ status: 'cancelled' }),
        ],
      }),
    );

    expect(snapshot.projects.total).toBe(5);
    expect(snapshot.projects.open).toBe(3);
    expect(snapshot.projects.active).toBe(1);
    expect(snapshot.projects.completed).toBe(1);
    expect(snapshot.projects.cancelled).toBe(1);
  });

  it('averages progress over OPEN projects only', () => {
    // Including a finished project at 100 would drag the figure toward 100 and stop it
    // describing the work actually in flight.
    const snapshot = snapshotOf(
      facts({
        projects: [
          project({ status: 'active', progress: 20 }),
          project({ status: 'planned', progress: 60 }),
          project({ status: 'completed', progress: 100 }),
        ],
      }),
    );

    expect(snapshot.projects.averageProgress).toBe(40);
    expect(snapshot.progress.projects.total).toBe(2);
  });

  it('counts projects with no owner, which every other tally counts normally', () => {
    const snapshot = snapshotOf(
      facts({
        projects: [
          project({ owner_id: 'emp-1' }),
          project({ owner_id: null }),
          project({ owner_id: null }),
        ],
      }),
    );

    expect(snapshot.projects.unowned).toBe(2);
    expect(snapshot.projects.total).toBe(3);
  });

  it('treats a zero-progress project as not started', () => {
    const snapshot = snapshotOf(facts({ projects: [project({ progress: 0 })] }));
    expect(snapshot.progress.projects.bands[0]?.band.key).toBe('not_started');
    expect(snapshot.progress.projects.bands[0]?.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Tasks
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — tasks', () => {
  it('counts open as everything not done', () => {
    const snapshot = snapshotOf(
      facts({
        tasks: [
          task({ status: 'todo' }),
          task({ status: 'in_progress' }),
          task({ status: 'blocked' }),
          task({ status: 'in_review' }),
          task({ status: 'done' }),
        ],
      }),
    );

    expect(snapshot.tasks.total).toBe(5);
    expect(snapshot.tasks.open).toBe(4);
    expect(snapshot.tasks.done).toBe(1);
    expect(snapshot.tasks.blocked).toBe(1);
    expect(snapshot.tasks.inReview).toBe(1);
  });

  it('computes completion rate against all tasks, not just open ones', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'done' }), task({ status: 'todo' })] }),
    );
    expect(snapshot.tasks.completionRate).toBe(0.5);
  });

  it('counts unassigned work across every open status', () => {
    const snapshot = snapshotOf(
      facts({
        tasks: [
          task({ status: 'todo', assignee_id: null }),
          task({ status: 'in_progress', assignee_id: null }),
          task({ status: 'done', assignee_id: null }),
        ],
      }),
    );

    // A delivered task having no assignee is not work in the queue.
    expect(snapshot.tasks.unassigned).toBe(2);
  });

  it('tallies priorities across all tasks, delivered included', () => {
    const snapshot = snapshotOf(
      facts({
        tasks: [
          task({ priority: 'urgent', status: 'todo' }),
          task({ priority: 'urgent', status: 'done' }),
          task({ priority: 'low', status: 'todo' }),
        ],
      }),
    );

    // `urgent`, not `critical`: the task enum and the project enum disagree at the top
    // end, which is precisely why the panels read the enums rather than a copied array.
    expect(snapshot.tasks.byPriority.urgent).toBe(2);
    expect(snapshot.tasks.byPriority.low).toBe(1);
    expect(snapshot.tasks.byPriority.medium).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. The date boundary — the two figures that drive action
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — dates', () => {
  /*
   * `isTaskOverdue` is `due_date < today`, so a task due *today* is not yet late — the
   * day has not finished. This test originally asserted the opposite, on the reasonable
   * reading that a task due today is at risk. It is pinned here because the dashboard
   * and the tasks screen must agree: if either used `<=`, the same task would be listed
   * as overdue on one screen and not the other, and neither report would be
   * reproducible. `countOverdueTasks` and this derivation both defer to
   * `isTaskOverdue`, so changing the rule belongs in the domain, not in either caller.
   */
  it('does not count a task due today as overdue, because the day is not over', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'in_progress', due_date: TODAY })] }),
    );
    expect(snapshot.tasks.overdue).toBe(0);
    expect(snapshot.tasks.open).toBe(1);
  });

  it('counts a task one day past its date as overdue', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'in_progress', due_date: days(-1) })] }),
    );
    expect(snapshot.tasks.overdue).toBe(1);
  });

  it('does not count a future due date as overdue', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'in_progress', due_date: days(1) })] }),
    );
    expect(snapshot.tasks.overdue).toBe(0);
  });

  it('does not count a delivered task as overdue however late it was', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'done', due_date: days(-30) })] }),
    );
    expect(snapshot.tasks.overdue).toBe(0);
    expect(snapshot.tasks.open).toBe(0);
  });

  it('treats an undated task as neither overdue nor due soon', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'todo', due_date: null })] }),
    );
    expect(snapshot.tasks.overdue).toBe(0);
    expect(snapshot.deadlines.dueSoonTasks).toBe(0);
    expect(snapshot.deadlines.undatedTasks).toBe(1);
  });

  it('counts a task as due soon inside the seven-day window and not beyond it', () => {
    const inside = snapshotOf(
      facts({ tasks: [task({ status: 'todo', due_date: days(7) })] }),
    );
    const beyond = snapshotOf(
      facts({ tasks: [task({ status: 'todo', due_date: days(8) })] }),
    );

    expect(inside.deadlines.dueSoonTasks).toBe(1);
    expect(beyond.deadlines.dueSoonTasks).toBe(0);
  });

  it('separates project deadlines from task deadlines', () => {
    const snapshot = snapshotOf(
      facts({
        projects: [
          project({ status: 'active', target_date: days(-3) }),
          project({ status: 'active', target_date: days(30) }),
          project({ status: 'completed', target_date: days(-10) }),
          project({ status: 'active', target_date: null }),
        ],
        tasks: [task({ status: 'todo', due_date: days(-1) })],
      }),
    );

    // Only the open project past its date counts; the completed one did not miss it.
    expect(snapshot.deadlines.overdueProjects).toBe(1);
    expect(snapshot.deadlines.undatedProjects).toBe(1);
    expect(snapshot.deadlines.overdueTasks).toBe(1);
  });

  it('orders the approaching list soonest first and caps it', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      project({ status: 'active', target_date: days(index + 1), progress: index * 10 }),
    );
    const snapshot = snapshotOf(facts({ projects: many }));

    const approaching = snapshot.deadlines.approaching;
    expect(approaching.length).toBeLessThanOrEqual(6);

    // Strictly ascending by days remaining: the panel lists these as a countdown.
    const order = approaching.map((entry) => entry.daysUntil);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(approaching[0]?.daysUntil).toBe(1);
  });

  it('excludes a dated project with no open work from the deadline list', () => {
    const snapshot = snapshotOf(
      facts({ projects: [project({ status: 'completed', target_date: days(1) })] }),
    );
    expect(snapshot.deadlines.approaching).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. The permission boundary
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — the workload gate', () => {
  const busy = facts({
    employees: [employee('active', 'Ada', 'Busy'), employee('active', 'Bo', 'Idle')],
    tasks: [
      task({ status: 'in_progress', assignee_id: 'emp-1' }),
      task({ status: 'todo', assignee_id: 'emp-1' }),
      task({ status: 'todo', assignee_id: 'emp-1' }),
    ],
  });

  it.each<OrganizationRole>(['owner', 'admin', 'manager'])(
    'computes workload for %s',
    (role) => {
      const snapshot = snapshotOf(busy, role);
      expect(snapshot.workload).not.toBeNull();
      expect(snapshot.workload?.peopleWithOpenWork).toBe(1);
      expect(snapshot.employees.withOpenWork).toBe(1);
      expect(snapshot.employees.withoutOpenWork).toBe(1);
    },
  );

  /*
   * `member` is the only role below `manager` in the enum, so this is a plain `it` and
   * not a table. An earlier version of this file iterated `['employee', 'viewer']`,
   * which are not in `OrganizationRole` at all — the assertions passed only because
   * `roleRank` returns 0 for an unrecognised value, so an invented role happened to
   * behave like a low one. Typing the roles is the point: a name the enum does not
   * contain is a name nobody is ever given.
   */
  it('withholds workload from a member, the only role below manager', () => {
    const snapshot = snapshotOf(busy, 'member');
    expect(snapshot.workload).toBeNull();
  });

  /*
   * The regression this file exists for. These were `0`, which read as "nobody is
   * carrying work" — a claim manufactured by a permission check. The snapshot is the
   * contract a future AI provider reads, so `0` here would have been quoted back as a
   * fact by a model that was never allowed to see the real answer.
   */
  it('nulls the workload-derived headcount figures for a member rather than zeroing them', () => {
    const snapshot = snapshotOf(busy, 'member');
    expect(snapshot.employees.withOpenWork).toBeNull();
    expect(snapshot.employees.withoutOpenWork).toBeNull();
  });

  it('still reports the figures a member is entitled to', () => {
    const snapshot = snapshotOf(busy, 'member');
    expect(snapshot.employees.current).toBe(2);
    expect(snapshot.employees.accessHolders).toBe(3);
    expect(snapshot.tasks.total).toBe(3);
    expect(snapshot.tasks.overdue).toBe(0);
  });

  it('withholds workload from a null role, which is not the same as a low role', () => {
    const snapshot = snapshotOf(busy, null);
    expect(snapshot.workload).toBeNull();
    expect(snapshot.employees.withOpenWork).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Workload, and the case two headline figures cannot reconcile
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — workload', () => {
  it('lists people busiest first, then by name', () => {
    const snapshot = snapshotOf(
      facts({
        employees: [
          employee('active', 'Zoe', 'Light'),
          employee('active', 'Amy', 'Heavy'),
          employee('active', 'Mia', 'Heavy'),
        ],
        tasks: [
          task({ status: 'todo', assignee_id: 'emp-1' }),
          task({ status: 'todo', assignee_id: 'emp-1' }),
          task({ status: 'todo', assignee_id: 'emp-2' }),
          task({ status: 'todo', assignee_id: 'emp-3' }),
        ],
      }),
    );

    // emp-1 carries two and leads. emp-2 and emp-3 tie on one each, so the tie breaks on
    // name — Amy before Mia — which makes the order stable across renders rather than
    // depending on the row order Postgres happened to return.
    expect(snapshot.workload?.entries.map((entry) => entry.name)).toEqual([
      'Zoe Light1',
      'Amy Heavy2',
      'Mia Heavy3',
    ]);
  });

  it('breaks a tie on open-task count by name, not by row order', () => {
    const same = [
      employee('active', 'Cara', 'Last'),
      employee('active', 'Bea', 'First'),
    ];
    const tasks = [
      task({ status: 'todo', assignee_id: 'emp-1' }),
      task({ status: 'todo', assignee_id: 'emp-2' }),
    ];

    // The same two people in the opposite order must produce the same output.
    const forward = snapshotOf(facts({ employees: same, tasks })).workload?.entries.map(
      (entry) => entry.name,
    );
    const reversed = snapshotOf(
      facts({ employees: [...same].reverse(), tasks }),
    ).workload?.entries.map((entry) => entry.name);

    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['Bea First2', 'Cara Last1']);
  });

  it('excludes a delivered task from a person’s open count', () => {
    const snapshot = snapshotOf(
      facts({
        employees: [employee('active')],
        tasks: [
          task({ status: 'todo', assignee_id: 'emp-1' }),
          task({ status: 'done', assignee_id: 'emp-1' }),
          task({ status: 'done', assignee_id: 'emp-1' }),
        ],
      }),
    );

    const entry = snapshot.workload?.entries[0];
    expect(entry?.openTasks).toBe(1);
    expect(entry?.doneTasks).toBe(2);
  });

  it('ignores an assignee who is not on the employee read', () => {
    // A dangling `assignee_id` is possible while a delete is propagating; the panel
    // should not grow a row for somebody with no name.
    const snapshot = snapshotOf(
      facts({
        employees: [employee('active')],
        tasks: [task({ status: 'todo', assignee_id: 'emp-does-not-exist' })],
      }),
    );

    expect(snapshot.workload?.entries).toHaveLength(0);
    expect(snapshot.tasks.unassigned).toBe(0);
  });

  /*
   * `updateEmployee` does not unassign a person's tasks when their employment ends, so
   * somebody off the workforce can still be the busiest name in the list. Clamping
   * `withoutOpenWork` at zero hides that; `offWorkforceWithOpenWork` is what makes the
   * disagreement visible.
   */
  it('flags work held by someone no longer on the books', () => {
    const snapshot = snapshotOf(
      facts({
        employees: [employee('active', 'Stay', 'Current'), employee('inactive', 'Left', 'Behind')],
        tasks: [
          task({ status: 'todo', assignee_id: 'emp-2' }),
          task({ status: 'todo', assignee_id: 'emp-2' }),
        ],
      }),
    );

    const workload = snapshot.workload;
    expect(workload?.offWorkforceWithOpenWork).toBe(1);
    // Current headcount is 1 and one person is carrying, so the naive subtraction gives
    // 0 — the clamp is doing real work here, and the flag explains the difference.
    expect(workload?.withoutOpenWork).toBe(0);
  });

  it('bands people by open-task count', () => {
    const employees = [
      employee('active'),
      employee('active'),
      employee('active'),
      employee('active'),
      employee('active'),
      employee('active'),
    ];
    const tasks = [
      ...Array.from({ length: 6 }, () => task({ status: 'todo', assignee_id: 'emp-1' })),
      ...Array.from({ length: 5 }, () => task({ status: 'todo', assignee_id: 'emp-2' })),
      ...Array.from({ length: 2 }, () => task({ status: 'todo', assignee_id: 'emp-3' })),
      task({ status: 'todo', assignee_id: 'emp-4' }),
    ];

    const workload = snapshotOf(facts({ employees, tasks })).workload;
    const band = (key: string) =>
      workload?.distribution.find((entry) => entry.band.key === key)?.people;

    // The `none` band is the regression this case exists for. People with an empty queue
    // are not in `entries` at all, so tallying entries alone left this row permanently
    // zero and the chart asserted "nobody is idle" while two people were.
    expect(band('none')).toBe(2); // emp-5 and emp-6
    expect(band('one_to_two')).toBe(2); // emp-3 and emp-4
    expect(band('three_to_five')).toBe(1); // emp-2
    expect(band('six_or_more')).toBe(1); // emp-1
  });

  it('reports distribution shares summing to one', () => {
    const employees = [employee('active'), employee('active')];
    const tasks = [
      task({ status: 'todo', assignee_id: 'emp-1' }),
      task({ status: 'todo', assignee_id: 'emp-2' }),
    ];

    const workload = snapshotOf(facts({ employees, tasks })).workload;
    const total = workload?.distribution.reduce((sum, entry) => sum + entry.share, 0);

    // Carriers plus the idle, so the shares account for the whole population the chart
    // claims to cover rather than leaving a silent remainder.
    expect(total).toBeCloseTo(1, 6);
  });

  it('puts the idle into the distribution rather than leaving the shares short', () => {
    const employees = [employee('active'), employee('active'), employee('active')];
    const tasks = [task({ status: 'todo', assignee_id: 'emp-1' })];

    const workload = snapshotOf(facts({ employees, tasks })).workload;
    const share = (key: string) =>
      workload?.distribution.find((entry) => entry.band.key === key)?.share;

    expect(share('one_to_two')).toBeCloseTo(1 / 3, 6);
    expect(share('none')).toBeCloseTo(2 / 3, 6);
  });

  it('averages over the people carrying work, not over headcount', () => {
    const snapshot = snapshotOf(
      facts({
        employees: [employee('active'), employee('active'), employee('active'), employee('active')],
        tasks: [
          task({ status: 'todo', assignee_id: 'emp-1' }),
          task({ status: 'todo', assignee_id: 'emp-1' }),
          task({ status: 'todo', assignee_id: 'emp-2' }),
        ],
      }),
    );

    // 3 open tasks over 2 people carrying them is 1.5. Dividing by 4 would answer a
    // different question — load per employee across the business — and would read as
    // nobody being busy.
    expect(snapshot.workload?.meanOpenTasksPerPerson).toBe(1.5);
    expect(snapshot.workload?.withoutOpenWork).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 8. Progress bands
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — progress bands', () => {
  it('bands open tasks by progress, so a half-done task is distinguishable', () => {
    const snapshot = snapshotOf(
      facts({
        tasks: [
          task({ status: 'todo', progress: 0 }),
          task({ status: 'in_progress', progress: 50 }),
          task({ status: 'in_review', progress: 90 }),
        ],
      }),
    );

    const count = (key: string) =>
      snapshot.progress.tasks.bands.find((band) => band.band.key === key)?.count;

    expect(count('not_started')).toBe(1);
    expect(count('half')).toBe(1);
    expect(count('late')).toBe(1);
    expect(snapshot.progress.tasks.total).toBe(3);
  });

  it('keeps delivered tasks out of the open progress distribution', () => {
    const snapshot = snapshotOf(
      facts({ tasks: [task({ status: 'done', progress: 100 })] }),
    );
    expect(snapshot.progress.tasks.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Purity
// ---------------------------------------------------------------------------

describe('buildDashboardSnapshot — purity', () => {
  it('produces byte-identical output for identical input', () => {
    const input = facts({
      employees: [employee('active', 'Ada', 'One'), employee('probation', 'Bo', 'Two')],
      projects: [project({ status: 'active', progress: 30, target_date: days(4) })],
      tasks: [
        task({ status: 'in_progress', assignee_id: 'emp-1', due_date: days(-1) }),
        task({ status: 'todo', assignee_id: null }),
      ],
    });

    // The sort in the workload pass mutates its array, so calling twice is the cheapest
    // way to catch an in-place sort leaking state into the next call.
    expect(JSON.stringify(snapshotOf(input))).toBe(JSON.stringify(snapshotOf(input)));
  });

  it('does not mutate the facts it is given', () => {
    const input = facts({
      employees: [employee('active', 'Ada', 'One'), employee('active', 'Bo', 'Two')],
      tasks: [task({ status: 'todo', assignee_id: 'emp-1' })],
    });
    const before = JSON.stringify(input);

    snapshotOf(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it('depends on role alone for the gate, not on the rows it is handed', () => {
    // Same facts, two roles. If workload were derived from the data rather than the
    // permission, these would be identical.
    const input = facts({
      employees: [employee('active')],
      tasks: [task({ status: 'todo', assignee_id: 'emp-1' })],
    });

    expect(snapshotOf(input, 'manager').workload).not.toBeNull();
    expect(snapshotOf(input, 'member').workload).toBeNull();
  });
});
