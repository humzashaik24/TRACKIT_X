/**
 * Phase 32 domain rules.
 *
 * These are pure functions, so they are tested without a database or a renderer.
 * The cases chosen are the ones where the "obvious" implementation is wrong:
 *   · progress 0 being treated as absent (`progress || 100`);
 *   · `cancelled` being reported as 0% rather than as not-progressing;
 *   · a percentage and a ratio being confused;
 *   · date arithmetic moving a deadline by a day west of UTC.
 */
import {
  clampProgress,
  DEFAULT_PROGRESS,
  impliedProgressForProjectStatus,
  impliedProgressForTaskStatus,
  isClosedProjectStatus,
  isClosedTaskStatus,
  isValidProgress,
  PROGRESS_MAX,
  PROGRESS_MIN,
  progressToRatio,
} from '@/domain/progress';
import {
  daysBetweenDates,
  isOverdue,
  isScheduleCoherent,
  isValidAllocation,
  OVER_ALLOCATION_THRESHOLD,
  projectPriorityRank,
  totalAllocation,
  isOverAllocated,
  PROJECT_PRIORITIES,
} from '@/domain/project';
import {
  canAssignTaskTo,
  canAssignTasksToOthers,
  canCreateTasks,
  canEditTask,
  canRecordOwnProgress,
  daysUntilDue,
  isTaskOverdue,
  isTaskSortKey,
  sortTasks,
  TASK_STATUSES,
  taskPriorityWeight,
  type SortableTask,
} from '@/domain/task';
import {
  employeeDisplayName,
  isCurrentEmployee,
  isValidEmployeeEmail,
  normalizeEmployeeCode,
  normalizeEmployeeEmail,
  normalizePersonName,
  suggestEmployeeCode,
  buildDepartmentLookup,
  departmentNameFor,
} from '@/domain/employee';

describe('progress — the range', () => {
  it('keeps values already inside 0-100', () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(37)).toBe(37);
    expect(clampProgress(100)).toBe(100);
  });

  it('clamps out-of-range values instead of throwing', () => {
    // A slider a keyboard can push to 137 must not fail a save on a field the user
    // cannot see the error against.
    expect(clampProgress(137)).toBe(PROGRESS_MAX);
    expect(clampProgress(-4)).toBe(PROGRESS_MIN);
  });

  it('rounds rather than truncates, so what is stored matches what was shown', () => {
    expect(clampProgress(37.6)).toBe(38);
    expect(clampProgress(37.4)).toBe(37);
  });

  it('collapses every non-finite value to 0, including the infinities', () => {
    // `NaN` renders as the string "NaN%" and compares false against every range
    // check, so an invalid value would slip past the check meant to catch it. An
    // infinity is not a progress figure anybody means either, and it takes the same
    // branch rather than special-casing: one rule, not two.
    expect(clampProgress(Number.NaN)).toBe(PROGRESS_MIN);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(PROGRESS_MIN);
    expect(clampProgress(Number.NEGATIVE_INFINITY)).toBe(PROGRESS_MIN);
    expect(clampProgress(null)).toBe(PROGRESS_MIN);
    expect(clampProgress(undefined)).toBe(PROGRESS_MIN);
  });

  it('still clamps a finite out-of-range value to the nearest bound', () => {
    // Distinct from the non-finite rule: 137 is a real number somebody typed, and
    // the useful answer is the nearest legal progress rather than "nothing".
    expect(clampProgress(137)).toBe(PROGRESS_MAX);
    expect(clampProgress(-4)).toBe(PROGRESS_MIN);
  });

  it('defaults to 0, which is a real figure and not "unknown"', () => {
    expect(DEFAULT_PROGRESS).toBe(0);
  });

  it('accepts only whole numbers in range', () => {
    expect(isValidProgress(0)).toBe(true);
    expect(isValidProgress(100)).toBe(true);
    expect(isValidProgress(50.5)).toBe(false);
    expect(isValidProgress(-1)).toBe(false);
    expect(isValidProgress(101)).toBe(false);
    expect(isValidProgress('50')).toBe(false);
    expect(isValidProgress(null)).toBe(false);
  });
});

describe('progress — percentage versus ratio', () => {
  it('treats 0% complete as a value, not as absent', () => {
    // The bug this guards: `progress || 100` turns an untouched project into a
    // finished one, because 0 is falsy.
    expect(progressToRatio(0)).toBe(0);
    expect(progressToRatio(0)).not.toBe(1);
  });

  it('converts 0-100 to 0-1 for the progress bar', () => {
    expect(progressToRatio(0)).toBe(0);
    expect(progressToRatio(50)).toBe(0.5);
    expect(progressToRatio(100)).toBe(1);
  });
});

describe('progress — what a status implies', () => {
  it('settles only a completed project at 100', () => {
    expect(impliedProgressForProjectStatus('completed')).toBe(100);
  });

  it('leaves every open project with no implied figure', () => {
    // Inventing a default here would put a number on the dashboard that nobody
    // entered and nobody owns.
    for (const status of ['planned', 'active', 'on_hold'] as const) {
      expect(impliedProgressForProjectStatus(status)).toBeNull();
    }
  });

  it('reports a cancelled project as having no figure, not as 0%', () => {
    // Work somebody deliberately stopped is not work that failed to progress. A
    // red 0% misrepresents why it stopped.
    expect(impliedProgressForProjectStatus('cancelled')).toBeNull();
  });

  it('settles only a done task at 100', () => {
    expect(impliedProgressForTaskStatus('done')).toBe(100);
    for (const status of ['todo', 'in_progress', 'blocked', 'in_review'] as const) {
      expect(impliedProgressForTaskStatus(status)).toBeNull();
    }
  });

  it('classifies closed states, counting cancelled work as closed', () => {
    // Counting cancelled work as outstanding forever is how an open-items count
    // stops meaning anything.
    expect(isClosedProjectStatus('completed')).toBe(true);
    expect(isClosedProjectStatus('cancelled')).toBe(true);
    expect(isClosedProjectStatus('active')).toBe(false);
    expect(isClosedTaskStatus('done')).toBe(true);
    expect(isClosedTaskStatus('in_review')).toBe(false);
  });
});

describe('project — priority rank', () => {
  it('ranks in declared urgency order, not alphabetically', () => {
    // The ordering IS the meaning. Alphabetical would be critical, high, low,
    // medium — which reads as a severity scale that is simply wrong.
    expect(PROJECT_PRIORITIES.map(projectPriorityRank)).toEqual([0, 1, 2, 3]);
    expect(projectPriorityRank('low')).toBe(0);
    expect(projectPriorityRank('critical')).toBe(3);
  });
});

describe('project — schedule', () => {
  it('accepts an open-ended project on either side', () => {
    expect(isScheduleCoherent(null, null)).toBe(true);
    expect(isScheduleCoherent('2026-01-01', null)).toBe(true);
    expect(isScheduleCoherent(null, '2026-06-01')).toBe(true);
  });

  it('accepts a target on or after the start', () => {
    expect(isScheduleCoherent('2026-01-01', '2026-06-01')).toBe(true);
    expect(isScheduleCoherent('2026-01-01', '2026-01-01')).toBe(true);
  });

  it('refuses a target before the start', () => {
    expect(isScheduleCoherent('2026-06-01', '2026-01-01')).toBe(false);
  });
});

describe('project — date arithmetic', () => {
  it('counts calendar days across a month boundary', () => {
    expect(daysBetweenDates('2026-01-28', '2026-02-04')).toBe(7);
  });

  it('counts a whole year', () => {
    expect(daysBetweenDates('2025-03-01', '2026-03-01')).toBe(365);
  });

  it('is negative when the end precedes the start', () => {
    expect(daysBetweenDates('2026-06-01', '2026-01-01')).toBe(-151);
  });

  it('returns null when either end is open or unparseable', () => {
    expect(daysBetweenDates(null, '2026-01-01')).toBeNull();
    expect(daysBetweenDates('2026-01-01', undefined)).toBeNull();
    expect(daysBetweenDates('not-a-date', '2026-01-01')).toBeNull();
  });

  it('does not shift a deadline across a timezone boundary', () => {
    // Both ends are read as UTC midnight precisely so the subtraction is a plain
    // day count. Constructing local Dates would move a deadline by a day for
    // anyone west of UTC.
    expect(daysBetweenDates('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('project — overdue', () => {
  it('is false with no target date', () => {
    expect(isOverdue({ status: 'active', target_date: null }, '2026-06-01')).toBe(false);
  });

  it('is true for an open project past its target', () => {
    expect(isOverdue({ status: 'active', target_date: '2026-01-01' }, '2026-06-01')).toBe(true);
    expect(isOverdue({ status: 'planned', target_date: '2026-01-01' }, '2026-06-01')).toBe(true);
    expect(isOverdue({ status: 'on_hold', target_date: '2026-01-01' }, '2026-06-01')).toBe(true);
  });

  it('is not overdue on the target date itself', () => {
    expect(isOverdue({ status: 'active', target_date: '2026-06-01' }, '2026-06-01')).toBe(false);
  });

  it('is false for a closed project whose target slipped', () => {
    // A completed project's late target is history, not a late delivery.
    expect(isOverdue({ status: 'completed', target_date: '2026-01-01' }, '2026-06-01')).toBe(false);
    expect(isOverdue({ status: 'cancelled', target_date: '2026-01-01' }, '2026-06-01')).toBe(false);
  });
});

describe('project — allocation', () => {
  it('accepts only whole percentages in range', () => {
    expect(isValidAllocation(0)).toBe(true);
    expect(isValidAllocation(100)).toBe(true);
    expect(isValidAllocation(50.5)).toBe(false);
    expect(isValidAllocation(101)).toBe(false);
    expect(isValidAllocation(-1)).toBe(false);
  });

  it('sums several commitments', () => {
    expect(totalAllocation([50, 50])).toBe(100);
    expect(totalAllocation([100, 100, 100])).toBe(300);
    expect(totalAllocation([])).toBe(0);
  });

  it('flags over-allocation as a warning, above the threshold only', () => {
    // Reported, never enforced: people really are stretched, and making it a
    // database error would mean the only way to record reality is a fiction.
    expect(isOverAllocated([100])).toBe(false);
    expect(isOverAllocated([100, 100])).toBe(true);
    expect(OVER_ALLOCATION_THRESHOLD).toBe(100);
  });

  it('ignores an invalid entry rather than poisoning the sum with NaN', () => {
    expect(totalAllocation([50, Number.NaN])).toBe(50);
  });
});

describe('task — status and priority', () => {
  it('keeps the declared lifecycle order', () => {
    expect(TASK_STATUSES).toEqual(['todo', 'in_progress', 'blocked', 'in_review', 'done']);
  });

  it('weights priority 1-4 rather than 0-3', () => {
    // The "+1" is what turns a zero-based rank into a usable scale. It lives in
    // one function so "why is this off by one" has one answer.
    expect(taskPriorityWeight('low')).toBe(1);
    expect(taskPriorityWeight('medium')).toBe(2);
    expect(taskPriorityWeight('high')).toBe(3);
    expect(taskPriorityWeight('urgent')).toBe(4);
  });

  it('lets a member record their own effort but not hand work on for review', () => {
    expect(canRecordOwnProgress('todo', 'in_progress')).toBe(true);
    expect(canRecordOwnProgress('in_progress', 'blocked')).toBe(true);
    expect(canRecordOwnProgress('in_progress', 'in_review')).toBe(false);
  });

  it('refuses to reopen work that is already closed', () => {
    expect(canRecordOwnProgress('done', 'in_progress')).toBe(false);
  });
});

describe('task — overdue', () => {
  it('is false with no due date', () => {
    // An undated task is not "on time"; it is undated, and folding an unknown
    // into a reassuring answer is the thing to avoid.
    expect(isTaskOverdue({ status: 'todo', due_date: null }, '2026-06-01')).toBe(false);
  });

  it('is true for open work past its due date', () => {
    expect(isTaskOverdue({ status: 'in_progress', due_date: '2026-01-01' }, '2026-06-01')).toBe(true);
    expect(isTaskOverdue({ status: 'blocked', due_date: '2026-01-01' }, '2026-06-01')).toBe(true);
  });

  it('is false for delivered work, however late it was', () => {
    expect(isTaskOverdue({ status: 'done', due_date: '2026-01-01' }, '2026-06-01')).toBe(false);
  });

  it('counts days to a due date, negative once it has passed', () => {
    expect(daysUntilDue('2026-06-11', '2026-06-01')).toBe(10);
    expect(daysUntilDue('2026-05-22', '2026-06-01')).toBe(-10);
    expect(daysUntilDue('2026-06-01', '2026-06-01')).toBe(0);
    expect(daysUntilDue(null, '2026-06-01')).toBeNull();
  });
});

/**
 * Rows for the sort cases. Ids are deliberately the tiebreak alphabet, so any case
 * that relies on the id tiebreak says so in its own name.
 */
function sortable(
  id: string,
  overrides: Partial<SortableTask> = {},
): SortableTask {
  return {
    id,
    title: 'Task',
    status: 'todo',
    priority: 'medium',
    due_date: null,
    assignee_id: null,
    ...overrides,
  };
}

describe('task — sorting', () => {
  it('leaves the rows alone when no sort is asked for', () => {
    const rows = [sortable('b'), sortable('a')];
    expect(sortTasks(rows, undefined, (row) => row)).toBe(rows);
  });

  it('puts undated tasks last going up', () => {
    // The bug this guards: ranking a missing date as `''` sorts it BELOW every
    // `YYYY-MM-DD`, so ascending put the undated task at the TOP of the list.
    const rows = [
      sortable('undated'),
      sortable('late', { due_date: '2026-06-20' }),
      sortable('early', { due_date: '2026-06-10' }),
    ];

    expect(
      sortTasks(rows, { key: 'due', direction: 'asc' }, (row) => row).map((row) => row.id),
    ).toEqual(['early', 'late', 'undated']);
  });

  it('puts undated tasks last going down too', () => {
    const rows = [
      sortable('undated'),
      sortable('late', { due_date: '2026-06-20' }),
      sortable('early', { due_date: '2026-06-10' }),
    ];

    expect(
      sortTasks(rows, { key: 'due', direction: 'desc' }, (row) => row).map((row) => row.id),
    ).toEqual(['late', 'early', 'undated']);
  });

  it('keeps undated tasks last when every row is undated', () => {
    const rows = [sortable('b'), sortable('a'), sortable('c')];
    // All null means the id tiebreak decides, and it must decide the same way in
    // both directions — otherwise the toggle appears to reorder a list of nothing.
    expect(
      sortTasks(rows, { key: 'due', direction: 'asc' }, (row) => row).map((row) => row.id),
    ).toEqual(['a', 'b', 'c']);
    expect(
      sortTasks(rows, { key: 'due', direction: 'desc' }, (row) => row).map((row) => row.id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('orders status by the lifecycle, not alphabetically', () => {
    const rows = [
      sortable('a', { status: 'done' }),
      sortable('b', { status: 'todo' }),
      sortable('c', { status: 'in_review' }),
    ];

    expect(
      sortTasks(rows, { key: 'status', direction: 'asc' }, (row) => row).map((row) => row.status),
    ).toEqual(['todo', 'in_review', 'done']);
  });

  it('orders priority by urgency, not alphabetically', () => {
    const rows = [
      sortable('a', { priority: 'urgent' }),
      sortable('b', { priority: 'low' }),
      sortable('c', { priority: 'high' }),
    ];

    expect(
      sortTasks(rows, { key: 'priority', direction: 'asc' }, (row) => row).map((row) => row.priority),
    ).toEqual(['low', 'high', 'urgent']);
  });

  it('breaks ties on the id, so equal rows do not depend on engine order', () => {
    const rows = [sortable('c', { priority: 'high' }), sortable('a', { priority: 'high' })];

    expect(
      sortTasks(rows, { key: 'priority', direction: 'asc' }, (row) => row).map((row) => row.id),
    ).toEqual(['a', 'c']);
  });

  it('returns a new array rather than sorting the caller\'s', () => {
    const rows = [sortable('b', { title: 'B' }), sortable('a', { title: 'A' })];
    const sorted = sortTasks(rows, { key: 'title', direction: 'asc' }, (row) => row);

    expect(sorted).not.toBe(rows);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });

  it('rejects a sort key it does not know rather than falling through to title', () => {
    // Falling through would render a "sorted by due date" header over a title sort.
    expect(isTaskSortKey('due')).toBe(true);
    expect(isTaskSortKey('nonsense')).toBe(false);
    expect(isTaskSortKey(undefined)).toBe(false);
  });
});

describe('task — who may do what', () => {
  it('lets every role raise a task, including a plain member', () => {
    // The policy gates where the work GOES, not whether somebody may notice it needs
    // doing. A member who cannot raise a ticket writes it on paper instead.
    expect(canCreateTasks('member')).toBe(true);
    expect(canCreateTasks('manager')).toBe(true);
    expect(canCreateTasks('admin')).toBe(true);
    expect(canCreateTasks('owner')).toBe(true);
  });

  it('raises nothing for a caller with no role in the organization', () => {
    // `member` is the floor of the hierarchy, so an absent role is the only way to be
    // below it. While the role is still loading this must be false, or the "New task"
    // button appears before the app knows the caller is allowed to press it.
    expect(canCreateTasks(null)).toBe(false);
    expect(canCreateTasks(undefined)).toBe(false);
  });

  it('reserves handing work to somebody else for managers and up', () => {
    expect(canAssignTasksToOthers('member')).toBe(false);
    expect(canAssignTasksToOthers('manager')).toBe(true);
    expect(canAssignTasksToOthers('owner')).toBe(true);
  });

  it('offers a member exactly two assignee targets: themselves and nobody', () => {
    expect(canAssignTaskTo('member', 'employee-1', 'employee-1')).toBe(true);
    expect(canAssignTaskTo('member', 'employee-1', null)).toBe(true);
    expect(canAssignTaskTo('member', 'employee-1', 'employee-2')).toBe(false);
  });

  it('lets a manager assign to anybody, or to nobody', () => {
    expect(canAssignTaskTo('manager', 'employee-1', 'employee-2')).toBe(true);
    expect(canAssignTaskTo('manager', 'employee-1', null)).toBe(true);
  });

  it('refuses a member with no employee row every target, unassigning included', () => {
    // A login with no employee row cannot be shown to be assigning to itself, and
    // "unassign" is not a choice it can be shown to be making either.
    expect(canAssignTaskTo('member', null, null)).toBe(false);
    expect(canAssignTaskTo('member', null, 'employee-1')).toBe(false);
  });

  it('still lets a manager assign with no employee row of their own', () => {
    // The manager grant comes from the role, not from being an employee, so the
    // missing-row case above must not leak into it.
    expect(canAssignTaskTo('manager', null, 'employee-1')).toBe(true);
    expect(canAssignTaskTo('manager', null, null)).toBe(true);
  });

  it('lets a member edit a task assigned to them', () => {
    expect(
      canEditTask(
        { assignee_id: 'employee-1' },
        { role: 'member', currentEmployeeId: 'employee-1' },
      ),
    ).toBe(true);
  });

  it('refuses a member somebody else\'s task', () => {
    expect(
      canEditTask(
        { assignee_id: 'employee-2' },
        { role: 'member', currentEmployeeId: 'employee-1' },
      ),
    ).toBe(false);
  });

  it('refuses the assignee\'s own task while the role is still unknown', () => {
    // `tasks_update_own_or_managers` opens with `is_organization_member`, and an absent
    // role is not a member of anything. Without the member floor this returns true and
    // draws an edit form whose every save is refused.
    expect(
      canEditTask(
        { assignee_id: 'employee-1' },
        { role: null, currentEmployeeId: 'employee-1' },
      ),
    ).toBe(false);
  });

  it('refuses editing a task with no assignee to a member, and allows it to a manager', () => {
    // Unassigned means unowned, so there is no "own" for the member rule to match.
    expect(
      canEditTask({ assignee_id: null }, { role: 'member', currentEmployeeId: 'employee-1' }),
    ).toBe(false);
    expect(
      canEditTask({ assignee_id: null }, { role: 'manager', currentEmployeeId: 'employee-1' }),
    ).toBe(true);
  });
});

describe('employee — names, codes and email', () => {
  it('collapses runs of whitespace, because the columns are btrim-checked', () => {
    expect(normalizePersonName('  Ramesh   Kumar ')).toBe('Ramesh Kumar');
  });

  it('joins a display name without a stray space', () => {
    expect(employeeDisplayName({ first_name: ' Asha ', last_name: 'Menon ' })).toBe('Asha Menon');
    expect(employeeDisplayName({ first_name: '', last_name: 'Menon' })).toBe('Menon');
  });

  it('uppercases an employee code so a typed scheme is consistent', () => {
    expect(normalizeEmployeeCode(' emp-014 ')).toBe('EMP-014');
  });

  it('suggests a code derived from the headcount', () => {
    expect(suggestEmployeeCode(0)).toBe('EMP-001');
    expect(suggestEmployeeCode(13)).toBe('EMP-014');
    expect(suggestEmployeeCode(999)).toBe('EMP-1000');
  });

  it('suggests a code for a negative count rather than producing "EMP--1"', () => {
    expect(suggestEmployeeCode(-5)).toBe('EMP-001');
  });

  it('lowercases an email, because the unique index is on lower(email)', () => {
    expect(normalizeEmployeeEmail('  Ramesh@Example.COM ')).toBe('ramesh@example.com');
  });

  it('accepts a deliberately permissive address, matching the CHECK', () => {
    // The client rule must not be stricter than the column, or the form and the
    // schema disagree and the user is told their address is invalid for no reason.
    expect(isValidEmployeeEmail('a@b.c')).toBe(true);
    expect(isValidEmployeeEmail('ramesh.kumar+payroll@sub.example.co.in')).toBe(true);
    expect(isValidEmployeeEmail('ramesh@localhost')).toBe(false);
    expect(isValidEmployeeEmail('not-an-email')).toBe(false);
    expect(isValidEmployeeEmail('a b@example.com')).toBe(false);
    expect(isValidEmployeeEmail('')).toBe(false);
  });
});

describe('employee — who counts as current', () => {
  it('counts active, probation and leave as currently on the books', () => {
    expect(isCurrentEmployee('active')).toBe(true);
    expect(isCurrentEmployee('probation')).toBe(true);
    expect(isCurrentEmployee('on_leave')).toBe(true);
  });

  it('excludes inactive, and excludes notice period as a stated decision', () => {
    // Someone serving notice is still being paid, so whether they are "current" is
    // the business's call — and it is not made silently here.
    expect(isCurrentEmployee('inactive')).toBe(false);
    expect(isCurrentEmployee('notice_period')).toBe(false);
  });
});

describe('employee — department lookup', () => {
  const departments = [
    { id: 'd1', organization_id: 'o1', name: 'Production', description: null, created_at: '', updated_at: '' },
    { id: 'd2', organization_id: 'o1', name: 'Accounts', description: null, created_at: '', updated_at: '' },
  ] as never;

  it('resolves a department id to its name', () => {
    const lookup = buildDepartmentLookup(departments);
    expect(departmentNameFor(lookup, 'd1')).toBe('Production');
  });

  it('returns null for an unresolvable id rather than the raw UUID', () => {
    // Showing a user a UUID because a join missed is a bug that looks like data.
    const lookup = buildDepartmentLookup(departments);
    expect(departmentNameFor(lookup, 'nope')).toBeNull();
  });

  it('returns null for an absent department, and for a missing lookup', () => {
    expect(departmentNameFor(buildDepartmentLookup(departments), null)).toBeNull();
    expect(departmentNameFor(null, 'd1')).toBeNull();
    expect(departmentNameFor(null, null)).toBeNull();
  });

  it('builds an empty lookup from no departments', () => {
    expect(buildDepartmentLookup(null).size).toBe(0);
    expect(buildDepartmentLookup(undefined).size).toBe(0);
  });
});
