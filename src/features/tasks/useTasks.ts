/**
 * Trackit X — task list and task detail.
 *
 * Two hooks over `taskService`, plus the one thing a task view needs that a
 * project view does not: an answer to "is this mine?".
 *
 * That question is asked of the DATABASE, not of the client. `employee_id_for_user`
 * resolves the caller's employee row inside the tenant, and the list is then
 * filtered to it. Deriving it in the client would mean trusting a row of ids that
 * the caller could have arrived with, which is a policy written in TypeScript and
 * therefore not a policy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isTaskOverdue, type TaskPriority, type TaskStatus } from '@/domain/task';
import * as tasks from '@/services/taskService';
import type { TaskListEntry } from '@/services/taskService';
import { userMessage } from '@/utils/errors';

import { todayKey } from '@/features/projects/useProjects';

export type { TaskListEntry };

export interface TaskFilters {
  readonly search: string;
  readonly statuses: readonly TaskStatus[];
  readonly priorities: readonly TaskPriority[];
  readonly projectId: string | null | undefined;
  /** `null` means unassigned; `undefined` means anybody. */
  readonly assigneeId: string | null | undefined;
  readonly overdueOnly: boolean;
  readonly mineOnly: boolean;
}

export const NO_TASK_FILTERS: TaskFilters = {
  search: '',
  statuses: [],
  priorities: [],
  projectId: undefined,
  assigneeId: undefined,
  overdueOnly: false,
  mineOnly: false,
};

export interface TaskSummary {
  readonly total: number;
  readonly open: number;
  readonly overdue: number;
  /** Open and blocked. The other number people open the app to see. */
  readonly blocked: number;
  readonly unassigned: number;
  readonly done: number;
}

export interface TaskList {
  readonly rows: readonly TaskListEntry[];
  readonly filteredRows: readonly TaskListEntry[];
  readonly summary: TaskSummary;
  /** The filters currently in force. See the note on `EmployeeDirectory.filters`. */
  readonly filters: TaskFilters;
  readonly hasActiveFilters: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly today: string;
  /** The caller's own employee id, or `null` when the login is not on the payroll. */
  readonly currentEmployeeId: string | null;
  refresh(): Promise<void>;
  setFilters(next: TaskFilters): void;
}

function matchesSearch(entry: TaskListEntry, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    entry.task.title.toLowerCase().includes(needle) ||
    (entry.task.description ?? '').toLowerCase().includes(needle) ||
    (entry.projectName ?? '').toLowerCase().includes(needle) ||
    (entry.assigneeName ?? '').toLowerCase().includes(needle)
  );
}

function applyFilters(
  rows: readonly TaskListEntry[],
  filters: TaskFilters,
  today: string,
  currentEmployeeId: string | null,
): readonly TaskListEntry[] {
  return rows.filter((entry) => {
    const { task } = entry;
    if (filters.statuses.length > 0 && !filters.statuses.includes(task.status)) return false;
    if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
    if (filters.projectId !== undefined && task.project_id !== filters.projectId) return false;

    if (filters.mineOnly) {
      if (currentEmployeeId === null) return false;
      if (task.assignee_id !== currentEmployeeId) return false;
    } else if (filters.assigneeId !== undefined) {
      if (task.assignee_id !== filters.assigneeId) return false;
    }

    if (filters.overdueOnly && !isTaskOverdue(task, today)) return false;
    return matchesSearch(entry, filters.search);
  });
}

/**
 * `mineOnly` is resolved in the effect rather than in this function.
 *
 * A login with no employee row is not an error and not "everyone's tasks" — it is
 * an empty list, and the caller must not be shown other people's work because the
 * lookup came back NULL. Returning `[]` for that case is the safe direction: a
 * false negative here hides a task from its owner, whereas a false positive would
 * show one person another's work.
 */
function summarize(rows: readonly TaskListEntry[], today: string): TaskSummary {
  let open = 0;
  let overdue = 0;
  let blocked = 0;
  let unassigned = 0;
  let done = 0;
  for (const { task } of rows) {
    if (task.status === 'done') {
      done += 1;
      continue;
    }
    open += 1;
    if (task.status === 'blocked') blocked += 1;
    if (task.assignee_id === null) unassigned += 1;
    if (isTaskOverdue(task, today)) overdue += 1;
  }
  return { total: rows.length, open, overdue, blocked, unassigned, done };
}

/**
 * A task read, together with the organization it was read FOR and the employee the
 * caller is.
 *
 * The caller identity is tagged alongside the rows rather than held separately,
 * because a `currentEmployeeId` from one organization applied to another's rows
 * would filter by a stranger's id and silently show nothing — or, worse, show work
 * that is not the caller's. One tag for the pair means they cannot disagree.
 */
interface TaskLoad {
  readonly organizationId: string | null;
  readonly rows: readonly TaskListEntry[];
  readonly currentEmployeeId: string | null;
  readonly error: string | null;
}

const NO_TASKS: readonly TaskListEntry[] = [];

/**
 * The caller's own employee row in one organization.
 *
 * Split out of `useTaskList` because "who am I" is needed by screens that are not
 * showing the list — the detail screen, the create form — and folding it into the list
 * hook would mean those screens fetch every task in the business to learn a single id.
 * One read, one consumer, and the tag is the same pair the list uses.
 *
 * `null` is the ordinary answer for a login with no employee record. It is never
 * `undefined` and never "everybody": callers must be able to tell the difference
 * between "not on the payroll" and "not asked yet", because the first disables a
 * control and the second should show a spinner.
 */
export function useCurrentEmployeeId(organizationId: string | null): string | null {
  const [load, setLoad] = useState<{ organizationId: string | null; employeeId: string | null }>({
    organizationId: null,
    employeeId: null,
  });

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void (async () => {
      const identity = await tasks.currentEmployeeId(organizationId);
      if (cancelled) return;
      setLoad({
        organizationId,
        employeeId: identity.ok ? identity.value : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return load.organizationId === organizationId ? load.employeeId : null;
}

const UNREAD: TaskLoad = {
  organizationId: null,
  rows: NO_TASKS,
  currentEmployeeId: null,
  error: null,
};

export function useTaskList(organizationId: string | null): TaskList {
  const [load, setLoad] = useState<TaskLoad>(UNREAD);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterState, setFilterState] = useState<{
    readonly organizationId: string | null;
    readonly filters: TaskFilters;
  }>({ organizationId: null, filters: NO_TASK_FILTERS });

  const today = useMemo(() => todayKey(), []);

  const isCurrent = load.organizationId === organizationId;
  const rows = isCurrent ? load.rows : NO_TASKS;
  const currentEmployeeId = isCurrent ? load.currentEmployeeId : null;
  const error = isCurrent ? load.error : null;
  const isLoading = organizationId !== null && !isCurrent;

  const filters =
    filterState.organizationId === organizationId ? filterState.filters : NO_TASK_FILTERS;

  const setFilters = useCallback(
    (next: TaskFilters): void => {
      setFilterState({ organizationId, filters: next });
    },
    [organizationId],
  );

  /**
   * The list and the identity are read together, and written under one tag, because a
   * list filtered by one organization's employee id beside another organization's rows
   * is worse than no list at all — it would either hide everything or show work that
   * is not the caller's. The identity is only adopted once BOTH reads have landed for
   * the organization in view; a login with no employee row records `null` so the UI can
   * disable "Mine" rather than leave the filter silently inert and showing everybody's
   * work.
   */
  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void (async () => {
      const [identity, result] = await Promise.all([
        tasks.currentEmployeeId(organizationId),
        tasks.listTasks(organizationId),
      ]);
      if (cancelled) return;

      setLoad({
        organizationId,
        currentEmployeeId: identity.ok ? identity.value : null,
        rows: result.ok ? result.value : NO_TASKS,
        error: result.ok ? null : userMessage(result.error),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;
    setIsRefreshing(true);
    try {
      const result = await tasks.listTasks(organizationId);
      setLoad((current) => {
        if (current.organizationId !== organizationId) return current;
        return {
          ...current,
          rows: result.ok ? result.value : current.rows,
          error: result.ok ? null : userMessage(result.error),
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  const filteredRows = useMemo(
    () => applyFilters(rows, filters, today, currentEmployeeId),
    [rows, filters, today, currentEmployeeId],
  );
  const summary = useMemo(() => summarize(rows, today), [rows, today]);

  return {
    rows,
    filteredRows,
    summary,
    filters,
    hasActiveFilters:
      filters.search.trim().length > 0 ||
      filters.statuses.length > 0 ||
      filters.priorities.length > 0 ||
      filters.projectId !== undefined ||
      filters.assigneeId !== undefined ||
      filters.overdueOnly ||
      filters.mineOnly,
    isLoading,
    isRefreshing,
    error,
    today,
    currentEmployeeId,
    refresh,
    setFilters,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface TaskDetail {
  readonly task: TaskListEntry | null;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly notFound: boolean;
  readonly today: string;
  refresh(): Promise<void>;
}

/**
 * A detail read, tagged with the PAIR it was read for.
 *
 * The organization is part of the tag, not a separate check, and that is the whole
 * change from a task-only tag. A user opens a task in one organization, switches
 * organizations without leaving the screen, and the id in the URL still resolves —
 * `activeDestination` keeps `/tasks` highlighted, so nothing on screen has moved, but
 * the organization behind the read has. Tagging on the id alone renders a stranger's
 * task under the new organization's header until the next read lands.
 *
 * Both halves are one value so they cannot disagree: there is no way to hold a task
 * from organization A alongside a tenant tag of B, because they are stored together
 * and compared together.
 */
interface TaskDetailLoad {
  readonly organizationId: string | null;
  readonly taskId: string | null;
  readonly task: TaskListEntry | null;
  readonly notFound: boolean;
  readonly error: string | null;
}

const UNREAD_DETAIL: TaskDetailLoad = {
  organizationId: null,
  taskId: null,
  task: null,
  notFound: false,
  error: null,
};

export function useTaskDetail(organizationId: string | null, taskId: string | null): TaskDetail {
  const [load, setLoad] = useState<TaskDetailLoad>(UNREAD_DETAIL);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = useMemo(() => todayKey(), []);

  const isCurrent = load.organizationId === organizationId && load.taskId === taskId;
  const task = isCurrent ? load.task : null;
  const notFound = isCurrent && load.notFound;
  const error = isCurrent ? load.error : null;
  const isLoading = organizationId !== null && taskId !== null && !isCurrent;

  useEffect(() => {
    if (organizationId === null || taskId === null) return;
    let cancelled = false;

    void tasks.getTask(taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        // The pair tag keeps an org-A response from landing under org B's header,
        // but it cannot know what row the response holds. A task whose own
        // `organization_id` is not the organization in view is rendered as
        // not-found, not displayed: it declares that the record belongs to another
        // tenant, and showing it would be the same leak the tag prevents.
        if (result.value.organization_id !== organizationId) {
          setLoad({
            organizationId,
            taskId,
            task: null,
            notFound: true,
            error: null,
          });
          return;
        }
        setLoad({
          organizationId,
          taskId,
          task: { task: result.value, projectName: null, assigneeName: null },
          notFound: false,
          error: null,
        });
        return;
      }
      // A task that is not visible is NOT_FOUND, not a failure. Rendered as an
      // empty state, never as an error banner — a refusal would confirm that the
      // row exists in an organization this caller cannot see.
      setLoad({
        organizationId,
        taskId,
        task: null,
        notFound: result.error.code === 'NOT_FOUND',
        error: result.error.code === 'NOT_FOUND' ? null : userMessage(result.error),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId, taskId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null || taskId === null) return;
    setIsRefreshing(true);
    try {
      const result = await tasks.getTask(taskId);
      setLoad((current) => {
        if (current.organizationId !== organizationId || current.taskId !== taskId) return current;
        if (result.ok) {
          if (result.value.organization_id !== organizationId) {
            // Same rule as the initial read: a task belonging to the organization
            // the user has left is removed from view, not refreshed into it.
            return {
              ...current,
              task: null,
              notFound: true,
              error: null,
            };
          }
          return {
            ...current,
            task: {
              ...(current.task ?? { projectName: null, assigneeName: null }),
              task: result.value,
            },
            notFound: false,
            error: null,
          };
        }
        return {
          ...current,
          error: result.error.code === 'NOT_FOUND' ? null : userMessage(result.error),
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId, taskId]);

  return { task, isLoading, isRefreshing, error, notFound, today, refresh };
}

// ---------------------------------------------------------------------------
// Counts by project
// ---------------------------------------------------------------------------

/**
 * Open tasks per project, for the project list.
 *
 * ── Why this is a separate read and not a column on the project row ──────────
 * A count is not a property of a project, it is a fact about the tasks pointing at
 * it, and it changes when a task is created, reassigned or closed. Storing it would
 * mean three more statements to keep it true and a denormalized number quietly wrong
 * the first time one of them was forgotten. One grouped read is cheaper and cannot
 * drift.
 *
 * ── Why it lands as "0" for a project rather than being absent ────────────────
 * `openTaskCountsByProject` returns a row per project that HAS open tasks. A lookup
 * that returned `undefined` for the rest would make "no open tasks" and "not loaded
 * yet" the same value, and a project list would show a blank cell during loading and
 * a confident 0 afterwards with nothing having said so. `countFor` answering 0 keeps
 * the difference in the caller's own `isLoading`, where it belongs.
 *
 * ── Why a failed read reports zero counts instead of an error ────────────────
 * The count is an annotation on a list that is already usable without it. Failing the
 * whole project screen because a supplementary number did not arrive would be a worse
 * outcome than showing a number that is quietly understated, and the alternative — a
 * red banner over twelve working rows — invites the reader to distrust the rows.
 */
export interface OpenTaskCounts {
  /** Open task count for one project. Unlisted projects have none. */
  countFor(projectId: string): number;
  readonly isLoading: boolean;
  refresh(): Promise<void>;
}

const NO_COUNTS: ReadonlyMap<string, number> = new Map();

export function useOpenTaskCounts(organizationId: string | null): OpenTaskCounts {
  const [load, setLoad] = useState<{
    readonly organizationId: string | null;
    readonly counts: ReadonlyMap<string, number>;
  }>({ organizationId: null, counts: NO_COUNTS });

  const isCurrent = load.organizationId === organizationId;

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void tasks.openTaskCountsByProject(organizationId).then((result) => {
      if (cancelled) return;
      setLoad({
        organizationId,
        counts: result.ok ? result.value : NO_COUNTS,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const counts = isCurrent ? load.counts : NO_COUNTS;

  // `useCallback` rather than a plain object literal so the project rows do not
  // rebuild on every render of the list for the sake of a function that never
  // changes its answer.
  const countFor = useCallback((projectId: string): number => counts.get(projectId) ?? 0, [counts]);

  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;
    const result = await tasks.openTaskCountsByProject(organizationId);
    if (result.ok) {
      setLoad((current) =>
        current.organizationId === organizationId ? { organizationId, counts: result.value } : current,
      );
    }
  }, [organizationId]);

  return {
    countFor,
    isLoading: organizationId !== null && !isCurrent,
    refresh,
  };
}

