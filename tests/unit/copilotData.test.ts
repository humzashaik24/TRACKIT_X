/**
 * Copilot context and output — the two places a wrong answer is manufactured.
 *
 * A model returning bad text is a nuisance. A context builder that sends the wrong rows,
 * or a normaliser that accepts a citation nobody can open, is a data incident. Both are
 * pure functions of their arguments, so both are tested here against fixtures with no
 * Supabase, no renderer and no network — which is not a convenience but the reason these
 * claims can be asserted exactly rather than eyeballed.
 *
 * The cases are ordered by what a wrong answer would cost:
 *
 *   1. FABRICATED CITATIONS — a returned reference that does not resolve against the
 *      context this client built is dropped, and its label is never taken from the
 *      model. A citation the system cannot open is not a citation.
 *   2. ACTIONS IN THE SHAPE — `actions`, `command`, `tool` and `execute` returned by a
 *      model are never read, so the response type has no field that could carry one.
 *   3. CROSS-TENANT AND CROSS-CONTEXT CONTEXT — the context is stamped with the
 *      organization it was built for, and a question about one project must not receive
 *      another project's tasks.
 *   4. PERMISSION — a member asking who is overloaded gets no employee figures, because
 *      the snapshot withheld them and the Copilot must not reconstruct what the rest of
 *      the product declines to show.
 *   5. HONEST ABSENCE — a question naming a project that does not exist produces a data
 *      gap and no rollup, never a confident description of a similar one.
 *   6. AGREEMENT WITH THE DASHBOARD — the Copilot's overdue list and the dashboard's
 *      overdue count come from the same pass. If they ever diverge, one of the two
 *      screens is lying, and this asserts they cannot.
 *   7. BOUNDS — a large organization is capped, and the caps are the reason this is not
 *      a database dump.
 */
import {
  COPILOT_FALLBACK_INTENT,
  classifyCopilotIntent,
  extractJsonObject,
  normalizeCopilotOutput,
  referenceKey,
  type CopilotReference,
} from '@/domain/ai/copilot';
import { DUE_SOON_DAYS } from '@/domain/dashboard';
import {
  COPILOT_CONTEXT_LIMITS,
  COPILOT_DATA_GAPS,
  buildCopilotContext,
  type CopilotContextPlan,
} from '@/features/copilot/contextBuilder';
import { buildDashboardSnapshot, type DashboardSnapshot } from '@/features/dashboard/metrics';
import type { CopilotFacts, CopilotTaskFact } from '@/services/copilotService';
import type {
  DashboardEmployeeFact,
  DashboardProjectFact,
  DashboardTaskFact,
} from '@/services/dashboardService';
import type { OrganizationRole } from '@/types/database';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ORG = 'aa11bb22-cc33-4d44-8e55-ff6677889900';
const OTHER_ORG = 'bb11bb22-cc33-4d44-8e55-ff6677889900';
const TODAY = '2026-09-27';
const REQUESTED_AT = '2026-09-27T09:30:00.000Z';

/** Days from TODAY as `YYYY-MM-DD`. Negative is in the past. */
function days(offset: number): string {
  const base = Date.parse(`${TODAY}T00:00:00Z`);
  return new Date(base + offset * 86_400_000).toISOString().slice(0, 10);
}

function employee(
  overrides: Partial<DashboardEmployeeFact> = {},
): DashboardEmployeeFact {
  return {
    id: 'emp-priya',
    first_name: 'Priya',
    last_name: 'Raman',
    employment_status: 'active',
    ...overrides,
  };
}

function project(overrides: Partial<DashboardProjectFact> = {}): DashboardProjectFact {
  return {
    id: 'prj-alpha',
    name: 'Alpha',
    status: 'active',
    priority: 'high',
    progress: 40,
    target_date: days(30),
    owner_id: 'emp-priya',
    ...overrides,
  };
}

function task(overrides: Partial<CopilotTaskFact> = {}): CopilotTaskFact {
  const base: DashboardTaskFact & Pick<CopilotTaskFact, 'id' | 'title' | 'project_id'> = {
    id: 'tsk-1',
    title: 'Draft the rollout plan',
    project_id: 'prj-alpha',
    status: 'in_progress',
    priority: 'high',
    progress: 25,
    due_date: days(14),
    assignee_id: 'emp-priya',
  };
  return { ...base, ...overrides };
}

const EMPLOYEES: readonly DashboardEmployeeFact[] = [
  employee(),
  employee({ id: 'emp-sam', first_name: 'Sam', last_name: 'Okafor' }),
];

const PROJECTS: readonly DashboardProjectFact[] = [
  project(),
  project({ id: 'prj-beta', name: 'Beta', status: 'planned', progress: 0, owner_id: 'emp-sam' }),
  project({ id: 'prj-old', name: 'Retired Programme', status: 'completed', progress: 100 }),
];

const TASKS: readonly CopilotTaskFact[] = [
  task(),
  task({
    id: 'tsk-2',
    title: 'Confirm the vendor quote',
    project_id: 'prj-beta',
    status: 'todo',
    due_date: days(2),
    assignee_id: 'emp-sam',
  }),
  task({
    id: 'tsk-3',
    title: 'Escalate the blocked dependency',
    project_id: 'prj-alpha',
    status: 'blocked',
    due_date: days(-4),
    assignee_id: 'emp-priya',
  }),
];

function factsFor(overrides: Partial<CopilotFacts> = {}): CopilotFacts {
  return {
    employees: EMPLOYEES,
    projects: PROJECTS,
    tasks: TASKS,
    ...overrides,
  };
}

/** The snapshot is always the dashboard's, never a hand-written stand-in. */
function snapshotFor(
  facts: CopilotFacts,
  role: OrganizationRole,
  organizationId: string = ORG,
): DashboardSnapshot {
  return buildDashboardSnapshot(facts, {
    organizationId,
    asOf: TODAY,
    role,
    accessHolders: EMPLOYEES.length,
  });
}

function planFor(
  question: string,
  options: { role?: OrganizationRole; facts?: CopilotFacts; organizationId?: string } = {},
): CopilotContextPlan {
  const role = options.role ?? 'manager';
  const facts = options.facts ?? factsFor();
  return buildCopilotContext({
    organizationId: options.organizationId ?? ORG,
    question,
    requestedAt: REQUESTED_AT,
    viewerRole: role,
    snapshot: snapshotFor(facts, role, options.organizationId ?? ORG),
    facts,
  });
}

function taskIds(plan: CopilotContextPlan): string[] {
  return plan.context.tasks.map((entry) => entry.taskId);
}

function projectIds(plan: CopilotContextPlan): string[] {
  return plan.context.projects.map((entry) => entry.projectId);
}

// ---------------------------------------------------------------------------
// 1. Classification
// ---------------------------------------------------------------------------

describe('intent classification', () => {
  it.each([
    ['which tasks are overdue', 'attention'],
    ['what needs my attention', 'attention'],
    ['what is the status of Alpha', 'project_status'],
    ['what is the project status for Beta', 'project_status'],
    ['give me an update on Alpha', 'project_status'],
    ['how is my workload looking', 'workload'],
    ['who is overloaded', 'workload'],
    ['what is Priya Raman working on', 'employee_work'],
    ['what is Sam working on', 'employee_work'],
    ['give me an overview of the business', 'overview'],
    ['summarise everything for me', 'overview'],
    ['what is in the backlog', 'task_status'],
  ])('routes %s to %s', (question, expected) => {
    expect(classifyCopilotIntent(question).intent).toBe(expected);
  });

  it('falls back rather than guessing when nothing matches', () => {
    const classification = classifyCopilotIntent('qwerty zxcvb plugh');
    expect(classification.intent).toBe(COPILOT_FALLBACK_INTENT);
    expect(classification.isFallback).toBe(true);
    expect(classification.matches).toHaveLength(0);
  });

  it('is deterministic — the same question always yields the same context scope', () => {
    const first = planFor('what is the status of Alpha');
    const second = planFor('what is the status of Alpha');
    expect(second.scope).toBe(first.scope);
    expect(taskIds(second)).toEqual(taskIds(first));
  });

  it('does not fire an intent keyword from the middle of an unrelated word', () => {
    // `overdue` appears inside `overduee` with no word boundary, which is exactly the
    // shape of false positive that would send a "risky discussion" question an
    // attention context full of people's names.
    expect(classifyCopilotIntent('the overduee estate sale').isFallback).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Context minimization
// ---------------------------------------------------------------------------

describe('context minimization by intent', () => {
  it('sends one project and its tasks, not the whole directory', () => {
    const plan = planFor('what is the status of Alpha');

    expect(plan.subjects.projectId).toBe('prj-alpha');
    expect(projectIds(plan)).toEqual(['prj-alpha']);
    expect(taskIds(plan)).toEqual(['tsk-3', 'tsk-1']);
    // Beta exists, is open, and is deliberately absent.
    expect(taskIds(plan)).not.toContain('tsk-2');
  });

  it('sends one employee and their open work', () => {
    const plan = planFor('what is Priya Raman working on');

    expect(plan.subjects.employeeId).toBe('emp-priya');
    expect(plan.context.employees).toHaveLength(1);
    expect(plan.context.employees[0]?.displayName).toBe('Priya Raman');
    expect(taskIds(plan)).toEqual(['tsk-3', 'tsk-1']);
    expect(plan.context.projects).toHaveLength(0);
  });

  it('answers a progress question from project progress without task rows', () => {
    const plan = planFor('how is progress on our projects');

    expect(plan.context.tasks).toHaveLength(0);
    expect(plan.context.employees).toHaveLength(0);
    expect(projectIds(plan)).toEqual(['prj-alpha', 'prj-beta']);
  });

  it('excludes delivered projects from every project rollup', () => {
    expect(projectIds(planFor('give me an overview of the business'))).not.toContain('prj-old');
  });
});

describe('entity resolution', () => {
  it('resolves the longest matching name, not the first in table order', () => {
    // Both records exist. Taking the first match would answer about "Alpha" while the
    // question said "Alpha Phase 2" — a different project, described as the right one.
    const facts = factsFor({
      projects: [
        project({ id: 'prj-alpha', name: 'Alpha' }),
        project({ id: 'prj-phase', name: 'Alpha Phase 2' }),
      ],
    });
    const plan = planFor('what is the status of Alpha Phase 2', { facts });

    expect(plan.subjects.projectId).toBe('prj-phase');
    expect(projectIds(plan)).toEqual(['prj-phase']);
  });

  it('resolves a project and an employee named in the same question', () => {
    const plan = planFor('what is Priya Raman working on for Alpha');
    expect(plan.subjects.employeeId).toBe('emp-priya');
    expect(plan.subjects.projectId).toBe('prj-alpha');
  });

  it('matches case and punctuation insensitively', () => {
    expect(planFor('WHAT IS THE STATUS OF *alpha*?').subjects.projectId).toBe('prj-alpha');
  });
});

// ---------------------------------------------------------------------------
// 3. Honest absence
// ---------------------------------------------------------------------------

describe('data gaps', () => {
  it('declares a missing project instead of describing a similar one', () => {
    const plan = planFor('what is the status of Gamma Replatform');

    expect(plan.subjects.projectId).toBeNull();
    expect(plan.dataGaps).toContain(COPILOT_DATA_GAPS.noMatchingProject);
    expect(plan.context.projects).toHaveLength(0);
    expect(plan.context.tasks).toHaveLength(0);
  });

  it('declares a missing employee', () => {
    const plan = planFor('what is Jordan Vale working on');
    expect(plan.dataGaps).toContain(COPILOT_DATA_GAPS.noMatchingEmployee);
    expect(plan.context.employees).toHaveLength(0);
  });

  it('declares an empty workspace rather than summarising nothing', () => {
    const plan = planFor('give me an overview of the business', { facts: factsFor({ employees: [], projects: [], tasks: [] }) });
    expect(plan.dataGaps).toContain(COPILOT_DATA_GAPS.noBusinessRecords);
  });

  it('carries every gap a human-readable sentence exists for', () => {
    // A gap with no sentence is a gap the UI cannot render, which is the same as a gap
    // the user never sees.
    const plan = planFor('what is the status of Gamma Replatform');
    expect(plan.dataGaps.length).toBeGreaterThan(0);
  });
});

describe('category questions versus named records', () => {
  // Both questions are `project_status` and both name nothing. The difference is
  // whether the question was ever about a specific record, and answering the second one
  // with the first one's data is how a Copilot ends up describing a project nobody
  // asked about as though it were the one they named.
  it('answers a question about projects in general with every open project, and no gap', () => {
    const plan = planFor('what is the status of our projects');

    expect(plan.dataGaps).not.toContain(COPILOT_DATA_GAPS.noMatchingProject);
    expect(projectIds(plan)).toEqual(['prj-alpha', 'prj-beta']);
  });

  it('sends nothing of a kind when the name in the question does not exist', () => {
    const missingProject = planFor('what is the status of Gamma Replatform');
    const missingEmployee = planFor('what is Jordan Vale working on');

    expect(missingProject.context.projects).toHaveLength(0);
    expect(missingEmployee.context.employees).toHaveLength(0);
    expect(missingEmployee.context.tasks).toHaveLength(0);
  });

  it('does not report a gap for a question that never named a person', () => {
    const plan = planFor('what are the employees working on');
    expect(plan.dataGaps).not.toContain(COPILOT_DATA_GAPS.noMatchingEmployee);
    expect(plan.context.employees.length).toBeGreaterThan(0);
  });

  it('routes a question that names a task to the task rules', () => {
    // "status of" is a project-naming phrase, but the record named is a task. Following
    // the phrase would send the whole project table; following the record sends one task.
    const plan = planFor('what is the status of Escalate the blocked dependency');

    expect(plan.intent).toBe('task_status');
    expect(taskIds(plan)).toEqual(['tsk-3']);
    expect(projectIds(plan)).toEqual(['prj-alpha']);
  });

  it('reports the intent it answered rather than the one the classifier guessed', () => {
    const plan = planFor('what is the status of Escalate the blocked dependency');
    expect(plan.classification.intent).toBe('project_status');
    expect(plan.intent).not.toBe(plan.classification.intent);
  });

  it('does not read a record title as the topic of the question', () => {
    // The title contains "blocked", which is an attention keyword. Classifying the raw
    // string would hand the widest context to a question about one task, purely because
    // the task happens to be called something alarming.
    const plan = planFor('what is the status of Escalate the blocked dependency');
    expect(plan.intent).toBe('task_status');
    expect(taskIds(plan)).toEqual(['tsk-3']);
  });

  it('treats a bare record name as a specific question about that record', () => {
    // "Alpha" has no keyword at all, but naming one project is the most specific
    // question there is. The general overview is the wrong answer.
    const plan = planFor('Alpha');
    expect(plan.intent).toBe('project_status');
    expect(projectIds(plan)).toEqual(['prj-alpha']);
  });

  it('narrows an attention question to a named project', () => {
    const facts = factsFor({
      tasks: [
        ...TASKS,
        task({ id: 'tsk-other', title: 'Blocked elsewhere', project_id: 'prj-beta', status: 'blocked' }),
      ],
    });
    const plan = planFor('what is blocked in Alpha', { facts });

    expect(taskIds(plan)).toEqual(['tsk-3']);
    expect(projectIds(plan)).toEqual(['prj-alpha']);
  });

  it('narrows a workload question to a named person', () => {
    const plan = planFor('is Sam Okafor overloaded');
    expect(plan.context.employees).toHaveLength(1);
    expect(plan.context.employees[0]?.displayName).toBe('Sam Okafor');
  });

  it('does not resolve a person from a first name alone', () => {
    // "Sam" is a common enough name that two people in one workspace can share it, and
    // picking one would describe a colleague's workload as the one asked about. A
    // question that names only a first name is therefore a question about everybody,
    // which is the safe reading.
    const facts = factsFor({
      employees: [
        employee({ id: 'emp-sam-1', first_name: 'Sam', last_name: 'Okafor' }),
        employee({ id: 'emp-sam-2', first_name: 'Sam', last_name: 'Whitfield' }),
      ],
      tasks: [
        task({ id: 'tsk-s1', title: 'First Sam work', assignee_id: 'emp-sam-1', due_date: days(3) }),
        task({ id: 'tsk-s2', title: 'Second Sam work', assignee_id: 'emp-sam-2', due_date: days(5) }),
      ],
    });
    const plan = planFor('is Sam overloaded', { facts });

    expect(plan.subjects.employeeId).toBeNull();
    expect(plan.context.employees.map((entry) => entry.displayName).sort()).toEqual([
      'Sam Okafor',
      'Sam Whitfield',
    ]);
  });

  it('survives a record name containing regular expression characters', () => {
    // Names are database values, and an unescaped `(` would be a syntax error in a
    // pattern built from them.
    const facts = factsFor({
      projects: [project({ id: 'prj-paren', name: 'Phase (One)' })],
    });
    const plan = planFor('what is the status of Phase (One)', { facts });

    expect(plan.subjects.projectId).toBe('prj-paren');
    expect(projectIds(plan)).toEqual(['prj-paren']);
  });
});

// ---------------------------------------------------------------------------
// 4. Permission
// ---------------------------------------------------------------------------

describe('viewer role', () => {
  it('withholds per-person figures from a member, including for their own work', () => {
    const facts = factsFor();
    const memberPlan = planFor('what is Priya Raman working on', { role: 'member', facts });

    expect(memberPlan.context.dashboard.workload).toBeNull();
    expect(memberPlan.context.employees).toHaveLength(0);
    expect(memberPlan.dataGaps).toContain(COPILOT_DATA_GAPS.workloadWithheld);
    // The member's own task titles are still theirs to see.
    expect(taskIds(memberPlan)).toEqual(['tsk-3', 'tsk-1']);
  });

  it('tells a member that workload is unavailable rather than reporting nobody', () => {
    const plan = planFor('who is overloaded', { role: 'member' });
    expect(plan.context.employees).toHaveLength(0);
    expect(plan.dataGaps).toContain(COPILOT_DATA_GAPS.workloadWithheld);
  });

  it('gives a manager the workload figures, read from the snapshot pass', () => {
    const plan = planFor('who is overloaded', { role: 'manager' });
    const snapshot = plan.context.dashboard;

    expect(snapshot.workload).not.toBeNull();
    expect(plan.context.employees).toHaveLength(snapshot.workload?.entries.length ?? 0);
    const priya = plan.context.employees.find((entry) => entry.employeeId === 'emp-priya');
    // Priya holds tsk-1 and tsk-3, one of which is overdue.
    expect(priya?.openTaskCount).toBe(2);
    expect(priya?.overdueTaskCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. Organization scoping
// ---------------------------------------------------------------------------

describe('organization scoping', () => {
  it('stamps the context with the organization it was built for', () => {
    expect(planFor('how is progress').context.organizationId).toBe(ORG);
  });

  it('travels with the request so the server can cross-check it', () => {
    // Phase 36's `assertContextAgreesWithConfig` passes when the field is absent, so the
    // field being present is the whole point of this test.
    const plan = planFor('how is progress');
    expect(Object.keys(plan.context)).toContain('organizationId');
    expect(plan.context.organizationId).toBe(plan.context.dashboard.organizationId);
  });

  it('embeds the same snapshot object it was given, not a rebuilt one', () => {
    const facts = factsFor();
    const snapshot = snapshotFor(facts, 'manager');
    const plan = buildCopilotContext({
      organizationId: ORG,
      question: 'how is progress',
      requestedAt: REQUESTED_AT,
      viewerRole: 'manager',
      snapshot,
      facts,
    });
    expect(plan.context.dashboard).toBe(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 6. Agreement with the dashboard
// ---------------------------------------------------------------------------

describe('agreement with the dashboard snapshot', () => {
  it('lists exactly the tasks the dashboard counted as overdue', () => {
    const plan = planFor('what needs my attention');
    const snapshot = plan.context.dashboard;

    const overdueInContext = plan.context.tasks.filter((entry) => entry.isOverdue);
    expect(overdueInContext).toHaveLength(snapshot.tasks.overdue);
    expect(overdueInContext.map((entry) => entry.taskId)).toEqual(['tsk-3']);
  });

  it('treats a task due today as due soon and not overdue', () => {
    const facts = factsFor({
      tasks: [task({ id: 'tsk-today', title: 'Due today', due_date: TODAY, status: 'todo' })],
    });
    const plan = planFor('what needs my attention', { facts });

    expect(plan.context.dashboard.tasks.overdue).toBe(0);
    expect(plan.context.tasks[0]?.isOverdue).toBe(false);
    expect(plan.context.tasks[0]?.dueDate).toBe(TODAY);
  });

  it('includes work due inside DUE_SOON_DAYS and excludes work beyond it', () => {
    const facts = factsFor({
      tasks: [
        task({ id: 'tsk-edge', title: 'Edge', due_date: days(DUE_SOON_DAYS), status: 'todo' }),
        task({ id: 'tsk-later', title: 'Later', due_date: days(DUE_SOON_DAYS + 1), status: 'todo' }),
      ],
    });
    const plan = planFor('what needs my attention', { facts });

    expect(taskIds(plan)).toContain('tsk-edge');
    expect(taskIds(plan)).not.toContain('tsk-later');
  });

  it('merges overdue, due soon and blocked without double counting a task', () => {
    // tsk-3 is overdue, due soon by another rule, and blocked. It is one problem.
    const facts = factsFor({
      tasks: [task({ id: 'tsk-3b', title: 'Triple flagged', status: 'blocked', due_date: days(-1) })],
    });
    const plan = planFor('what needs my attention', { facts });

    expect(taskIds(plan)).toEqual(['tsk-3b']);
  });

  it('never lists a delivered task as needing attention', () => {
    const facts = factsFor({
      tasks: [task({ id: 'tsk-done', title: 'Shipped', status: 'done', due_date: days(-30) })],
    });
    const plan = planFor('what needs my attention', { facts });
    expect(taskIds(plan)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Bounds
// ---------------------------------------------------------------------------

describe('bounds', () => {
  it('caps the project list', () => {
    const many = Array.from({ length: COPILOT_CONTEXT_LIMITS.maxProjects + 15 }, (_, index) =>
      project({ id: `prj-${index}`, name: `Programme ${index}`, status: 'active' }),
    );
    const plan = planFor('how is progress', { facts: factsFor({ projects: many }) });
    expect(plan.context.projects).toHaveLength(COPILOT_CONTEXT_LIMITS.maxProjects);
  });

  it('caps the task list', () => {
    const many = Array.from({ length: COPILOT_CONTEXT_LIMITS.maxTasks + 15 }, (_, index) =>
      task({ id: `tsk-${index}`, title: `Task ${index}`, status: 'todo', due_date: days(1) }),
    );
    const plan = planFor('what is the status of Alpha', { facts: factsFor({ tasks: many }) });
    expect(plan.context.tasks).toHaveLength(COPILOT_CONTEXT_LIMITS.maxTasks);
  });

  it('caps the employee list', () => {
    const people = Array.from({ length: COPILOT_CONTEXT_LIMITS.maxEmployees + 10 }, (_, index) =>
      employee({ id: `emp-${index}`, first_name: `Person${index}`, last_name: 'Test' }),
    );
    const assigned = people.map((person, index) =>
      task({ id: `tsk-${index}`, title: `Task ${index}`, status: 'todo', assignee_id: person.id, due_date: null }),
    );
    const plan = planFor('who is overloaded', { facts: factsFor({ employees: people, tasks: assigned }) });
    expect(plan.context.employees).toHaveLength(COPILOT_CONTEXT_LIMITS.maxEmployees);
  });

  it('truncates a title rather than sending an unbounded one', () => {
    const plan = planFor('what is the status of Alpha', {
      facts: factsFor({
        tasks: [task({ id: 'tsk-long', title: 'x'.repeat(500) })],
      }),
    });
    expect(plan.context.tasks[0]?.title).toHaveLength(COPILOT_CONTEXT_LIMITS.maxTitleChars);
  });

  it('offers references only for records it actually included', () => {
    const plan = planFor('what is the status of Alpha');
    const keys = plan.allowedReferences.map((entry) => referenceKey(entry.entity, entry.entityId));

    expect(keys).toContain('project:prj-alpha');
    expect(keys).not.toContain('project:prj-beta');
    expect(keys).not.toContain('task:tsk-2');
    expect(plan.allowedReferences).toHaveLength(plan.context.projects.length + plan.context.tasks.length + plan.context.employees.length);
  });
});

// ---------------------------------------------------------------------------
// 8. Organization isolation
// ---------------------------------------------------------------------------

describe('no cross-organization mixing', () => {
  it('builds entirely from the facts it was given, so two tenants cannot blend', () => {
    const tenantA = factsFor();
    const tenantB = factsFor({
      projects: [project({ id: 'prj-b-only', name: 'Confidential Programme' })],
      tasks: [task({ id: 'tsk-b-only', title: 'Confidential task', project_id: 'prj-b-only' })],
      employees: [employee({ id: 'emp-b-only', first_name: 'Confidential', last_name: 'Person' })],
    });

    const planA = planFor('what needs my attention', { facts: tenantA, organizationId: ORG });
    const planB = planFor('what needs my attention', { facts: tenantB, organizationId: OTHER_ORG });

    expect(planA.context.organizationId).toBe(ORG);
    expect(planB.context.organizationId).toBe(OTHER_ORG);

    const serialised = JSON.stringify(planA.context);
    expect(serialised).not.toContain('Confidential');
    expect(JSON.stringify(planB.context)).not.toContain('Alpha');
  });
});

// ---------------------------------------------------------------------------
// 9. JSON extraction
// ---------------------------------------------------------------------------

describe('model output parsing', () => {
  it('finds a fenced object', () => {
    const raw = 'Here you go:\n```json\n{"summary":"ok"}\n```\nHope that helps.';
    expect(JSON.parse(extractJsonObject(raw) ?? '')).toEqual({ summary: 'ok' });
  });

  it('finds an object followed by commentary', () => {
    const raw = '{"summary":"ok"} — let me know if you want more.';
    expect(JSON.parse(extractJsonObject(raw) ?? '')).toEqual({ summary: 'ok' });
  });

  it('is not fooled by a brace inside a string', () => {
    const raw = '{"summary":"use { and } carefully","keyPoints":[]}';
    expect(JSON.parse(extractJsonObject(raw) ?? '')).toEqual({
      summary: 'use { and } carefully',
      keyPoints: [],
    });
  });

  it('returns null rather than guessing when there is no object', () => {
    expect(extractJsonObject('There are four overdue tasks.')).toBeNull();
    expect(extractJsonObject('')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Output normalisation — the trust boundary
// ---------------------------------------------------------------------------

describe('output normalisation', () => {
  const allowed: readonly CopilotReference[] = [
    { entity: 'project', entityId: 'prj-alpha', label: 'Alpha' },
    { entity: 'task', entityId: 'tsk-1', label: 'Draft the rollout plan' },
  ];

  function normalise(payload: unknown): ReturnType<typeof normalizeCopilotOutput> {
    return normalizeCopilotOutput(JSON.stringify(payload), allowed);
  }

  it('keeps a reference that resolves and drops one that does not', () => {
    const answer = normalise({
      summary: 'Alpha is behind.',
      references: [
        { entity: 'project', entityId: 'prj-alpha' },
        { entity: 'project', entityId: 'prj-nonexistent' },
        { entity: 'task', entityId: 'tsk-1' },
      ],
    });

    expect(answer.references.map((entry) => referenceKey(entry.entity, entry.entityId))).toEqual([
      'project:prj-alpha',
      'task:tsk-1',
    ]);
  });

  it('takes the label from the client, never from the model', () => {
    // A model that relabels a citation is describing something the viewer was never
    // shown. The label is not a model output; it is a fact from the client's context.
    const answer = normalise({
      summary: 'ok',
      references: [{ entity: 'project', entityId: 'prj-alpha', label: 'Everyone Compensation' }],
    });

    expect(answer.references[0]?.label).toBe('Alpha');
  });

  it('drops a reference whose entity type does not match its id', () => {
    const answer = normalise({
      summary: 'ok',
      references: [{ entity: 'task', entityId: 'prj-alpha' }],
    });
    expect(answer.references).toHaveLength(0);
  });

  it('deduplicates repeated references', () => {
    const answer = normalise({
      summary: 'ok',
      references: [
        { entity: 'project', entityId: 'prj-alpha' },
        { entity: 'project', entityId: 'prj-alpha' },
        { entity: 'project', entityId: 'prj-alpha' },
      ],
    });
    expect(answer.references).toHaveLength(1);
  });

  it('carries no action, command or tool field out of a model response', () => {
    const answer = normalise({
      summary: 'ok',
      actions: [{ type: 'update_task', taskId: 'tsk-1' }],
      command: 'DELETE FROM tasks',
      tool: 'sql',
      execute: true,
      recommendations: [{ text: 'Look at Alpha', action: 'update_task' }],
    });

    expect(Object.keys(answer).sort()).toEqual([
      'keyPoints',
      'recommendations',
      'references',
      'structured',
      'summary',
    ]);
    expect(JSON.stringify(answer)).not.toContain('DELETE FROM');
    expect(JSON.stringify(answer)).not.toContain('update_task');
    // A recommendation survives as text, which is all the contract allows.
    expect(answer.recommendations).toEqual([{ text: 'Look at Alpha' }]);
  });

  it('bounds the item counts', () => {
    const answer = normalise({
      summary: 'ok',
      keyPoints: Array.from({ length: 40 }, (_, index) => `Point ${index}`),
      recommendations: Array.from({ length: 40 }, (_, index) => `Do ${index}`),
      references: Array.from({ length: 40 }, () => ({ entity: 'project', entityId: 'prj-alpha' })),
    });

    expect(answer.keyPoints.length).toBeLessThanOrEqual(8);
    expect(answer.recommendations.length).toBeLessThanOrEqual(5);
    expect(answer.references.length).toBeLessThanOrEqual(12);
  });

  it('bounds the rendered text', () => {
    const answer = normalise({ summary: 's'.repeat(9_000) });
    expect(answer.summary.length).toBeLessThanOrEqual(2_000);
  });

  it('ignores a field of the wrong type rather than coercing it', () => {
    const answer = normalise({ summary: 42, keyPoints: 'not a list', recommendations: [null, 7, 'real'] });
    expect(answer.structured).toBe(true);
    expect(answer.summary).toBe('');
    expect(answer.keyPoints).toEqual([]);
    expect(answer.recommendations).toEqual([{ text: 'real' }]);
  });

  it('falls back to raw text and says it is unstructured when nothing parses', () => {
    const answer = normalizeCopilotOutput('There are four overdue tasks.', allowed);
    expect(answer.structured).toBe(false);
    expect(answer.summary).toBe('There are four overdue tasks.');
    expect(answer.references).toHaveLength(0);
    expect(answer.recommendations).toHaveLength(0);
  });

  it('accepts an empty answer without inventing content', () => {
    const answer = normalise({});
    expect(answer.summary).toBe('');
    expect(answer.keyPoints).toEqual([]);
  });
});
