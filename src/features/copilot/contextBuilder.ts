/**
 * Trackit X — Copilot business context construction.
 *
 * ── The one job of this file ───────────────────────────────────────────────────
 * Decide *which* facts a question is allowed to see, and hand back nothing else.
 *
 * It is a pure function: facts in, context out. No database, no clock, no provider,
 * no React. That is what makes the security properties below testable without a
 * running Supabase, a renderer, or a model — the reason a test can assert that a
 * member's "who is overloaded?" question produced no employee names at all, by
 * running it against a fixture.
 *
 * ── What is never recomputed here ──────────────────────────────────────────────
 * Every judgement about the business is imported, not reimplemented:
 *
 *   · overdue and due-soon  → `isTaskOverdue`, `daysUntilDue`, `DUE_SOON_DAYS`
 *   · what counts as open   → `OPEN_TASK_STATUSES`, `isOpenProject`
 *   · what counts as current → `snapshot.employees.current`
 *   · who is carrying work  → `snapshot.workload.entries`
 *   · every aggregate       → `snapshot`, built once by `buildDashboardSnapshot`
 *   · how people are named  → `employeeDisplayName`
 *   · how tasks are ordered → `sortTasks`
 *
 * If a fact is not in `DashboardSnapshot` and not derivable from these rules, this
 * file does not produce it. There is no second aggregation layer that could disagree
 * with the dashboard about the same business.
 *
 * ── The three properties this builder guarantees ────────────────────────────────
 *
 *  1. ORGANIZATION-SCOPED. The context is stamped with the organization id it was
 *     built for, and every rollup it contains came from facts read under that same
 *     id. There is no code path that mixes two tenants' facts, because there is one
 *     facts argument.
 *
 *  2. MINIMIZED AND BOUNDED. An intent picks a slice; the slices are capped by
 *     `COPILOT_CONTEXT_LIMITS`. "What is happening with Project X" sends one project
 *     and its tasks, not the whole directory. The full `DashboardSnapshot` travels
 *     with every request because it is ~40 aggregate numbers with no personal data
 *     in it, and it is what lets an answer put one overdue task in the context of
 *     four; the *identifying* data is what gets bounded.
 *
 *  3. NOTHING IS INVENTED. A question naming a project that does not exist produces
 *     no project rollup and a `no_matching_project` data gap. The gap is not
 *     decoration: it is sent in the context so the model is told the data is absent,
 *     and returned on the response so the UI can show it, which is what keeps "I
 *     could not find that project" from arriving as a confident description of one.
 */
import {
  COPILOT_FALLBACK_INTENT,
  classifyCopilotIntent,
  type CopilotClassification,
  type CopilotIntent,
  type CopilotReference,
} from '@/domain/ai/copilot';
import type {
  CopilotBusinessContext,
  CopilotEmployeeRollup,
  CopilotProjectRollup,
  CopilotTaskRollup,
} from '@/domain/ai/copilotContract';
import { DUE_SOON_DAYS } from '@/domain/dashboard';
import { employeeDisplayName } from '@/domain/employee';
import { isOpenProject } from '@/domain/project';
import {
  OPEN_TASK_STATUSES,
  daysUntilDue,
  isTaskOverdue,
  sortTasks,
  type SortableTask,
  type TaskSort,
} from '@/domain/task';
import type { OrganizationRole } from '@/domain/organization';
import type { CopilotFacts, CopilotTaskFact } from '@/services/copilotService';
import type { DashboardSnapshot } from '@/features/dashboard/metrics';

/**
 * Hard ceilings on one request's entity detail.
 *
 * These are the reason the Copilot is not a database dump. Every list is capped, and
 * the caps are small enough that a prompt built from the maximum is comfortably
 * inside `GATEWAY_LIMITS.maxBusinessContextChars` — which the server enforces
 * independently, so a mistake here becomes a visible refusal rather than a silent
 * truncation.
 */
export const COPILOT_CONTEXT_LIMITS = {
  maxProjects: 25,
  maxTasks: 25,
  maxEmployees: 25,
  maxTitleChars: 120,
  maxProjectNameChars: 80,
  maxEmployeeNameChars: 60,
} as const;

// ---------------------------------------------------------------------------
// Data gaps
// ---------------------------------------------------------------------------

/**
 * What the supplied context could not answer.
 *
 * Machine-readable, short, and deliberately free of any name the user typed. These
 * strings travel to the provider *and* back to the UI, and a gap is a statement about
 * the absence of data, not a place to echo a question back. Every one of them is
 * derived here, before the request is sent, from facts the client already holds —
 * never from anything the model said about its own limitations.
 */
export const COPILOT_DATA_GAPS = {
  noMatchingProject: 'no_matching_project',
  noMatchingEmployee: 'no_matching_employee',
  workloadWithheld: 'workload_not_visible_to_your_role',
  noBusinessRecords: 'no_business_records',
} as const;

/** A short, safe sentence for each gap, for the UI to render under the answer. */
export const COPILOT_DATA_GAP_MESSAGES: Readonly<Record<string, string>> = {
  [COPILOT_DATA_GAPS.noMatchingProject]:
    'No project matching that name was found in this workspace, so nothing about it was included.',
  [COPILOT_DATA_GAPS.noMatchingEmployee]:
    'No employee matching that name was found in this workspace, so nothing about them was included.',
  [COPILOT_DATA_GAPS.workloadWithheld]:
    'Workload figures are not available to your role in this workspace, so no per-person numbers were included.',
  [COPILOT_DATA_GAPS.noBusinessRecords]:
    'This workspace has no employees, projects or tasks yet, so there is nothing to report.',
};

// ---------------------------------------------------------------------------
// Entity resolution
// ---------------------------------------------------------------------------

/** What the question appeared to name, when it could be matched to a real record. */
export interface CopilotSubjects {
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly taskId: string | null;
  readonly taskTitle: string | null;
}

function normalise(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/**
 * Finds the one entry whose name the question actually contains.
 *
 * Whole-phrase containment on a normalised string, and the longest name wins. Longest
 * matters: an organization with both "Alpha" and "Alpha Phase 2" must resolve
 * "what is happening with Alpha Phase 2" to the second, and taking the first match in
 * table order would get it wrong about half the time.
 *
 * Returns `null` rather than a best guess. Every caller treats `null` as "not found,
 * say so", and nothing in this file substitutes a similar name — a Copilot that
 * answers about "Website Redesign 2024" when asked about "Website Redesign" has
 * invented a project, which is the one thing the citations are supposed to make
 * impossible.
 */
function findByName<T>(
  question: string,
  entries: readonly T[],
  nameOf: (entry: T) => string,
): T | null {
  const haystack = normalise(question);
  let best: { entry: T; length: number } | null = null;

  for (const entry of entries) {
    const name = nameOf(entry);
    if (name.length < 3) continue;
    const needle = normalise(name);
    if (needle.trim().length < 3) continue;
    if (!haystack.includes(needle)) continue;
    if (best === null || name.length > best.length) best = { entry, length: name.length };
  }

  return best === null ? null : best.entry;
}

/**
 * Resolves which project, employee and task the question names.
 *
 * All three are resolved independently and a question can name more than one — "what
 * is Priya working on for Website Redesign" resolves both. Each is optional, because
 * a question naming none of them is normal and falls back to the intent's default
 * slice.
 */
export function resolveCopilotSubjects(
  question: string,
  facts: CopilotFacts,
): CopilotSubjects {
  const project = findByName(question, facts.projects, (entry) => entry.name);
  const employee = findByName(question, facts.employees, (entry) =>
    employeeDisplayName(entry),
  );
  const task = findByName(question, facts.tasks, (entry) => entry.title);

  return {
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    employeeId: employee?.id ?? null,
    employeeName: employee === null ? null : employeeDisplayName(employee),
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? null,
  };
}

// ---------------------------------------------------------------------------
// Category questions versus named records
// ---------------------------------------------------------------------------

/**
 * Keywords that ask about a whole category rather than name a record.
 *
 * "What is the status of our projects" and "what is the status of Alpha" are both
 * `project_status`, and they need opposite handling: the first wants every open project,
 * the second wants one project or an honest "not found". The matched keyword is what
 * tells them apart, and `classifyCopilotIntent` already records it. A category noun means
 * no record was ever named, so there is nothing to be missing; a naming phrase such as
 * "status of" implies a name was expected, and failing to resolve one is a fact worth
 * reporting rather than an excuse to send the whole table instead.
 */
const GENERIC_PROJECT_KEYWORDS: ReadonlySet<string> = new Set([
  'project',
  'projects',
  'initiative',
  'initiatives',
  'delivery',
]);

const GENERIC_EMPLOYEE_KEYWORDS: ReadonlySet<string> = new Set([
  'employee',
  'employees',
  'staff',
  'person',
  'people',
  'team member',
  'individual',
  'headcount',
  'my work',
]);

function askedAboutCategory(
  classification: CopilotClassification,
  generic: ReadonlySet<string>,
): boolean {
  return classification.matches.some((match) => generic.has(match.keyword));
}

/** Escapes a record name for use in a `RegExp`. Names come from the database. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The question with the records it names removed, for the purpose of classification.
 *
 * A record's own words are not the asker's topic. "What is the status of Escalate the
 * blocked dependency" contains "blocked", "dependency" and a due-date urgency the title
 * implies — and classifying the raw string hands the attention context, the widest one,
 * to a question about a single record, purely because the record happens to be called
 * something alarming. Removing the name span first leaves "what is the status of", which
 * is what the person actually asked.
 *
 * Names are escaped before substitution: they are database values, and an unescaped
 * `(` in a project name would otherwise be a syntax error in a pattern built from
 * user-supplied text.
 */
function questionWithoutSubjects(question: string, names: readonly (string | null)[]): string {
  let cleaned = question;
  for (const name of names) {
    if (name === null || name.length < 3) continue;
    cleaned = cleaned.replace(new RegExp(escapeRegExp(name), 'gi'), ' ');
  }
  return cleaned.trim();
}

/**
 * The intent actually used, once named records have been taken into account.
 *
 * Two corrections, both in the direction of sending less:
 *
 *  1. A question can name a task while matching a project-naming phrase: "what is the
 *     status of Draft the rollout plan" contains "status of" and no project name. The
 *     record that was named is the record the question is about, so the task rules
 *     apply. It sends one task rather than the whole project table.
 *  2. A question that is only a record name — "Alpha" — carries no keyword at all, and
 *     the classifier falls back to a general overview. Naming one record *is* a specific
 *     question, so the fallback is replaced by the record's own intent.
 *
 * A plan whose `intent` disagrees with the classifier is the honest record of what
 * happened, so the UI's badge shows what was actually answered.
 */
function resolveIntent(
  classified: CopilotIntent,
  subjects: CopilotSubjects,
): CopilotIntent {
  if (subjects.taskId !== null && subjects.projectId === null && classified === 'project_status') {
    return 'task_status';
  }
  if (classified !== COPILOT_FALLBACK_INTENT) return classified;
  if (subjects.taskId !== null) return 'task_status';
  if (subjects.projectId !== null) return 'project_status';
  if (subjects.employeeId !== null) return 'employee_work';
  return classified;
}

// ---------------------------------------------------------------------------
// Rollup projection
// ---------------------------------------------------------------------------

function taskSortable(task: CopilotTaskFact): SortableTask {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    assignee_id: task.assignee_id,
  };
}

/** Overdue first, then soonest, then undated last — `sortTasks`' own ordering. */
const DEADLINE_ORDER: TaskSort = { key: 'due', direction: 'asc' };

function projectNameById(facts: CopilotFacts): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const project of facts.projects) names.set(project.id, project.name);
  return names;
}

function toTaskRollup(
  task: CopilotTaskFact,
  today: string,
  projectNames: ReadonlyMap<string, string>,
): CopilotTaskRollup {
  return {
    taskId: task.id,
    title: task.title.length > COPILOT_CONTEXT_LIMITS.maxTitleChars
      ? task.title.slice(0, COPILOT_CONTEXT_LIMITS.maxTitleChars)
      : task.title,
    status: task.status,
    priority: task.priority,
    isOverdue: isTaskOverdue(task, today),
    dueDate: task.due_date,
    projectName: task.project_id === null ? null : projectNames.get(task.project_id) ?? null,
  };
}

function toProjectRollup(
  project: CopilotFacts['projects'][number],
  openTaskCount: number,
): CopilotProjectRollup {
  return {
    projectId: project.id,
    name:
      project.name.length > COPILOT_CONTEXT_LIMITS.maxProjectNameChars
        ? project.name.slice(0, COPILOT_CONTEXT_LIMITS.maxProjectNameChars)
        : project.name,
    status: project.status,
    progressPercent: project.progress,
    openTaskCount,
  };
}

/**
 * The reference set the model is allowed to cite.
 *
 * Built from exactly the rollups that were included. A record outside the context
 * cannot appear in `allowedReferences`, so `normalizeCopilotOutput` drops any citation
 * of it — which is the mechanism, rather than the intention, that stops a fabricated
 * source from being rendered.
 */
function referencesFor(
  employees: readonly CopilotEmployeeRollup[],
  projects: readonly CopilotProjectRollup[],
  tasks: readonly CopilotTaskRollup[],
): CopilotReference[] {
  return [
    ...employees.map((entry) => ({
      entity: 'employee' as const,
      entityId: entry.employeeId,
      label: entry.displayName,
    })),
    ...projects.map((entry) => ({
      entity: 'project' as const,
      entityId: entry.projectId,
      label: entry.name,
    })),
    ...tasks.map((entry) => ({
      entity: 'task' as const,
      entityId: entry.taskId,
      label: entry.title,
    })),
  ];
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** What the builder decided, including why. Everything the UI and log need. */
export interface CopilotContextPlan {
  readonly intent: CopilotIntent;
  readonly classification: CopilotClassification;
  readonly subjects: CopilotSubjects;
  /** One line naming what was included. Shown to the user so the scope is not a secret. */
  readonly scope: string;
  readonly context: CopilotBusinessContext;
  readonly allowedReferences: readonly CopilotReference[];
  readonly dataGaps: readonly string[];
}

export interface BuildCopilotContextParams {
  readonly organizationId: string;
  readonly question: string;
  /** ISO timestamp. Carried into the context so "as of" is data. */
  readonly requestedAt: string;
  readonly viewerRole: OrganizationRole | null;
  readonly snapshot: DashboardSnapshot;
  readonly facts: CopilotFacts;
}

/**
 * Builds the context for one question.
 *
 * The reference date is `snapshot.asOf`, not `new Date()`. The snapshot was computed
 * against that day, so a task's overdue status here is the same verdict the dashboard
 * reached; reading the clock again could produce a context that disagrees with the
 * figures displayed beside it, and the two would be right about different days.
 */
export function buildCopilotContext(params: BuildCopilotContextParams): CopilotContextPlan {
  const { organizationId, question, requestedAt, viewerRole, snapshot, facts } = params;
  const today = snapshot.asOf;
  // Subjects are resolved before the intent is classified, because a record's own name
  // has to be removed from the question before its words can be read as a topic.
  const subjects = resolveCopilotSubjects(question, facts);
  const classification = classifyCopilotIntent(
    questionWithoutSubjects(question, [
      subjects.projectName,
      subjects.employeeName,
      subjects.taskTitle,
    ]),
  );
  const intent = resolveIntent(classification.intent, subjects);
  const projectNames = projectNameById(facts);

  const openTasks = facts.tasks.filter((task) => OPEN_TASK_STATUSES.includes(task.status));
  const gaps = new Set<string>();

  // Per-project open task counts, assembled from the rows already in memory. This is
  // the same rule as `taskService.openTaskCountsByProject` — `OPEN_TASK_STATUSES`,
  // imported above — reached without a second query, because the facts were needed
  // anyway and a per-project count query would be a round trip to compute something
  // the rows in hand already answer.
  const openTaskCountByProject = new Map<string, number>();
  for (const task of openTasks) {
    if (task.project_id === null) continue;
    openTaskCountByProject.set(
      task.project_id,
      (openTaskCountByProject.get(task.project_id) ?? 0) + 1,
    );
  }

  /*
   * Per-person counts are read from the snapshot's workload pass, never recomputed.
   *
   * When `snapshot.workload` is `null` the viewer is below manager and the dashboard
   * withheld that figure. The Copilot withholds it identically: a workload question
   * from a member gets aggregates and an explicit gap, never a list of colleagues'
   * names with counts beside them. `canViewTeamWorkload` is a presentation gate rather
   * than a security boundary — a member can count open tasks per person on the Tasks
   * screen — but a Copilot that quotes a ranking nobody else is shown is making a
   * product decision the rest of the product has not made.
   */
  const workload = snapshot.workload;
  const employeeRollupFor = (employeeId: string): CopilotEmployeeRollup | null => {
    if (workload === null) return null;
    const entry = workload.entries.find((candidate) => candidate.employeeId === employeeId);
    if (entry === undefined) return null;
    const employee = facts.employees.find((candidate) => candidate.id === employeeId);
    const displayName = employee === undefined ? entry.name : employeeDisplayName(employee);
    return {
      employeeId,
      displayName:
        displayName.length > COPILOT_CONTEXT_LIMITS.maxEmployeeNameChars
          ? displayName.slice(0, COPILOT_CONTEXT_LIMITS.maxEmployeeNameChars)
          : displayName,
      status: employee?.employment_status ?? 'unknown',
      openTaskCount: entry.openTasks,
      overdueTaskCount: entry.overdueTasks,
    };
  };

  const employeeRollupsFor = (ids: readonly string[]): CopilotEmployeeRollup[] => {
    if (workload === null) return [];
    const seen = new Set<string>();
    const rollups: CopilotEmployeeRollup[] = [];
    for (const id of ids) {
      if (rollups.length >= COPILOT_CONTEXT_LIMITS.maxEmployees) break;
      if (seen.has(id)) continue;
      const rollup = employeeRollupFor(id);
      if (rollup === null) continue;
      seen.add(id);
      rollups.push(rollup);
    }
    return rollups;
  };

  const taskRollupsFor = (tasks: readonly CopilotTaskFact[]): CopilotTaskRollup[] =>
    sortTasks(tasks, DEADLINE_ORDER, taskSortable)
      .slice(0, COPILOT_CONTEXT_LIMITS.maxTasks)
      .map((task) => toTaskRollup(task, today, projectNames));

  const projectRollupsFor = (
    projects: readonly (CopilotFacts['projects'])[number][],
  ): CopilotProjectRollup[] =>
    projects
      .slice(0, COPILOT_CONTEXT_LIMITS.maxProjects)
      .map((project) => toProjectRollup(project, openTaskCountByProject.get(project.id) ?? 0));

  // Aggregates that describe "no records" are worth saying out loud: a Copilot asked
  // for an overview of an empty workspace should say it is empty, not produce a
  // confident summary of nothing.
  if (
    snapshot.employees.total === 0 &&
    snapshot.projects.total === 0 &&
    snapshot.tasks.total === 0
  ) {
    gaps.add(COPILOT_DATA_GAPS.noBusinessRecords);
  }

  const openProjects = facts.projects.filter((project) => isOpenProject(project.status));

  let employees: CopilotEmployeeRollup[] = [];
  let projects: CopilotProjectRollup[] = [];
  let tasks: CopilotTaskRollup[] = [];
  let scope = '';

  switch (intent) {
    case 'attention': {
      // A named project narrows the search. "What is blocked in Alpha" is a question
      // about one project, and answering it with the whole workspace's blocked work is
      // the same mistake as a task question answered with the whole task table.
      const named = facts.projects.find((project) => project.id === subjects.projectId);
      const inScope = named === undefined ? openTasks : openTasks.filter((task) => task.project_id === named.id);
      const inScopeProjects = named === undefined ? openProjects : [named];

      const overdue = inScope.filter((task) => isTaskOverdue(task, today));
      const dueSoon = inScope.filter((task) => {
        const days = daysUntilDue(task.due_date, today);
        return days !== null && days >= 0 && days <= DUE_SOON_DAYS;
      });
      const blocked = inScope.filter((task) => task.status === 'blocked');

      // Overdue first, then due soon, then blocked. A task that is both overdue and
      // due soon is not two problems, so the lists are merged by id before the cap is
      // applied — otherwise a backlog of overdue items could push a due-soon task out
      // of the context that is about to become urgent.
      const merged = new Map<string, CopilotTaskFact>();
      for (const task of [...overdue, ...dueSoon, ...blocked]) {
        if (!merged.has(task.id)) merged.set(task.id, task);
      }

      tasks = taskRollupsFor([...merged.values()]);
      projects = projectRollupsFor(inScopeProjects);
      employees =
        workload === null
          ? []
          : employeeRollupsFor(workload.entries.slice(0, 5).map((entry) => entry.employeeId));
      if (workload === null) gaps.add(COPILOT_DATA_GAPS.workloadWithheld);
      scope =
        named === undefined
          ? 'Overdue work, work due soon, blocked work, and the health of open projects.'
          : `Only work needing attention in "${named.name}".`;
      break;
    }

    case 'project_status': {
      const matched = facts.projects.find((project) => project.id === subjects.projectId);
      if (matched !== undefined) {
        tasks = taskRollupsFor(openTasks.filter((task) => task.project_id === matched.id));
        projects = projectRollupsFor([matched]);
        scope = `Only "${matched.name}" and its open tasks.`;
      } else if (askedAboutCategory(classification, GENERIC_PROJECT_KEYWORDS)) {
        // The question asked about projects as a category, so the answer is about all of
        // them. Nothing is missing and no gap is reported.
        tasks = [];
        projects = projectRollupsFor(openProjects);
        scope = 'Every open project, because the question asked about projects in general.';
      } else {
        // A name was expected and none matched. Sending the open projects instead would
        // answer a question about "Gamma Replatform" with Alpha and Beta — three
        // records the user never asked about, described as though they were the one
        // they named. So nothing of that kind is sent, and the gap says why.
        gaps.add(COPILOT_DATA_GAPS.noMatchingProject);
        tasks = [];
        projects = [];
        scope = 'No project matched the name in the question, so no project was included.';
      }
      if (workload === null) gaps.add(COPILOT_DATA_GAPS.workloadWithheld);
      break;
    }

    case 'workload': {
      if (workload === null) {
        // The honest answer is the gap. A member asking who is busiest gets told the
        // figures are not available to their role, which is true, rather than a list
        // of names the rest of the product declines to rank.
        gaps.add(COPILOT_DATA_GAPS.workloadWithheld);
        employees = [];
        projects = [];
        tasks = [];
        scope = 'No per-person figures: workload is not available to your role here.';
      } else {
        // A named person narrows the ranking to them, so "is Sam overloaded" produces
        // Sam's figures rather than a table of colleagues to compare them against.
        const named = subjects.employeeId;
        employees =
          named === null
            ? employeeRollupsFor(workload.entries.map((entry) => entry.employeeId))
            : employeeRollupsFor([named]);
        projects = [];
        tasks = [];
        scope =
          named === null
            ? 'Open and overdue task counts per person, and the workload distribution.'
            : `Only the workload figures for the person named in the question.`;
      }
      break;
    }

    case 'employee_work': {
      const matched = facts.employees.find((employee) => employee.id === subjects.employeeId);
      if (matched !== undefined) {
        const name = employeeDisplayName(matched);
        const rollup = employeeRollupFor(matched.id);
        employees = rollup === null ? [] : [rollup];
        tasks = taskRollupsFor(openTasks.filter((task) => task.assignee_id === matched.id));
        scope = `Only ${name}'s open work and task counts.`;
      } else if (askedAboutCategory(classification, GENERIC_EMPLOYEE_KEYWORDS)) {
        employees =
          workload === null
            ? []
            : employeeRollupsFor(workload.entries.slice(0, 5).map((entry) => entry.employeeId));
        tasks = [];
        scope = 'A short workload summary, because the question asked about people in general.';
      } else {
        // Same rule as a missing project: a person was named and not found, so no other
        // person's figures are sent in their place.
        gaps.add(COPILOT_DATA_GAPS.noMatchingEmployee);
        employees = [];
        tasks = [];
        scope = 'No employee matched the name in the question, so no employee was included.';
      }
      if (workload === null) gaps.add(COPILOT_DATA_GAPS.workloadWithheld);
      break;
    }

    case 'task_status': {
      const matched = facts.tasks.find((task) => task.id === subjects.taskId);
      if (matched !== undefined) {
        const owner = facts.projects.find((project) => project.id === matched.project_id);
        tasks = [toTaskRollup(matched, today, projectNames)];
        projects = owner === undefined ? [] : projectRollupsFor([owner]);
        scope = `Only the task "${matched.title}" and its project.`;
      } else {
        // Every `task_status` keyword is a category noun — a task is named by its
        // title, and a title is not a keyword — so an unresolved subject here always
        // means the question was about tasks generally. There is no missing-task gap to
        // report, and inventing one would be a false statement about the workspace.
        tasks = taskRollupsFor(openTasks);
        projects = projectRollupsFor(openProjects);
        scope = 'Open tasks across every project.';
      }
      break;
    }

    case 'progress': {
      // A named project narrows this too. "How is progress on Alpha" is a question about
      // one project, and answering it with every open project's rollup is the same
      // mistake as answering a task question with the whole task table.
      const named = facts.projects.find((project) => project.id === subjects.projectId);
      const targets = named === undefined ? openProjects : [named];
      projects = projectRollupsFor(targets);
        // Task rollups are omitted on purpose: a progress question is answered from
        // project progress, and thirty task rows would crowd out the numbers it needs.
      tasks = [];
      employees = [];
      scope =
        named === undefined
          ? 'Progress and open task counts for open projects.'
          : `Only the progress of "${named.name}".`;
      break;
    }

    case 'overview':
    case 'general_business':
    default: {
      /*
       * Aggregates only.
       *
       * `DashboardSnapshot` already carries headcount, project and task status
       * counts, deadlines, progress and the workload distribution, so an overview
       * question needs nothing else. The two bounded lists are here so a general
       * question can still be concrete: the projects that are live, and the work
       * nearest its date. Anything beyond that is context the question did not ask
       * for, and context the model does not have is context it cannot get wrong.
       */
      projects = projectRollupsFor(openProjects.slice(0, 10));
      const soonest = sortTasks(openTasks, DEADLINE_ORDER, taskSortable)
        .filter((task) => task.due_date !== null)
        .slice(0, 10);
      tasks = taskRollupsFor(soonest);
      employees =
        workload === null
          ? []
          : employeeRollupsFor(workload.entries.slice(0, 5).map((entry) => entry.employeeId));
      if (workload === null) gaps.add(COPILOT_DATA_GAPS.workloadWithheld);
      scope =
        intent === COPILOT_FALLBACK_INTENT
          ? 'Business aggregates only: the question did not match a specific topic.'
          : 'Business aggregates, live projects, and the work nearest its date.';
      break;
    }
  }

  const context: CopilotBusinessContext = {
    organizationId,
    requestedAt,
    viewerRole,
    dashboard: snapshot,
    employees,
    projects,
    tasks,
  };

  return {
    intent,
    classification,
    subjects,
    scope,
    context,
    allowedReferences: referencesFor(employees, projects, tasks),
    dataGaps: [...gaps],
  };
}
