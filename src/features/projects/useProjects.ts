/**
 * Trackit X — project list and project detail.
 *
 * Two hooks over `projectService`, sharing one idea: a read that is in flight must
 * not blank a screen that already has data, and a reply for a tenant the user has
 * left must never be committed.
 *
 * `useProjectList` filters over rows already in memory rather than re-querying per
 * keystroke, for the same reason the employee directory does — see the note there.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { isOverdue, isOpenProject, type ProjectStatus } from '@/domain/project';
import * as projects from '@/services/projectService';
import type { ProjectListEntry, ProjectMemberEntry } from '@/services/projectService';
import { userMessage } from '@/utils/errors';

export type { ProjectListEntry, ProjectMemberEntry };

/** `YYYY-MM-DD` for "today" in the viewer's own timezone. */
export function todayKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface ProjectFilters {
  readonly search: string;
  readonly statuses: readonly ProjectStatus[];
  readonly ownerId: string | null | undefined;
  readonly overdueOnly: boolean;
}

export const NO_PROJECT_FILTERS: ProjectFilters = {
  search: '',
  statuses: [],
  ownerId: undefined,
  overdueOnly: false,
};

export interface ProjectSummary {
  readonly total: number;
  readonly open: number;
  /** Open and past their target date. The number people open the app to see. */
  readonly overdue: number;
  /** Open with nobody accountable. */
  readonly unowned: number;
}

export interface ProjectList {
  readonly rows: readonly ProjectListEntry[];
  readonly filteredRows: readonly ProjectListEntry[];
  readonly summary: ProjectSummary;
  /** The filters currently in force. See the note on `EmployeeDirectory.filters`. */
  readonly filters: ProjectFilters;
  readonly hasActiveFilters: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly today: string;
  refresh(): Promise<void>;
  setFilters(next: ProjectFilters): void;
}

function matchesSearch(entry: ProjectListEntry, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    entry.project.name.toLowerCase().includes(needle) ||
    (entry.project.description ?? '').toLowerCase().includes(needle) ||
    (entry.ownerName ?? '').toLowerCase().includes(needle)
  );
}

function applyFilters(
  rows: readonly ProjectListEntry[],
  filters: ProjectFilters,
  today: string,
): readonly ProjectListEntry[] {
  return rows.filter((entry) => {
    const { project } = entry;
    if (filters.statuses.length > 0 && !filters.statuses.includes(project.status)) return false;
    if (filters.ownerId !== undefined) {
      if (project.owner_id !== filters.ownerId) return false;
    }
    if (filters.overdueOnly && !isOverdue(project, today)) return false;
    return matchesSearch(entry, filters.search);
  });
}

function summarize(rows: readonly ProjectListEntry[], today: string): ProjectSummary {
  let open = 0;
  let overdue = 0;
  let unowned = 0;
  for (const { project } of rows) {
    if (!isOpenProject(project.status)) continue;
    open += 1;
    if (isOverdue(project, today)) overdue += 1;
    if (project.owner_id === null) unowned += 1;
  }
  return { total: rows.length, open, overdue, unowned };
}

/**
 * A project read, together with the organization it was read FOR.
 *
 * Tagging the data rather than resetting it in an effect is what keeps one
 * organization's projects off another organization's screen: the render asks
 * whether this data is the data in view, so there is no window in which the
 * previous tenant's rows are still on the display waiting for an effect to clear
 * them. See `DirectoryLoad` in the employee hook for the longer version.
 */
interface ProjectLoad {
  readonly organizationId: string | null;
  readonly rows: readonly ProjectListEntry[];
  readonly error: string | null;
}

const NO_PROJECTS: readonly ProjectListEntry[] = [];

const UNREAD: ProjectLoad = { organizationId: null, rows: NO_PROJECTS, error: null };

export function useProjectList(organizationId: string | null): ProjectList {
  const [load, setLoad] = useState<ProjectLoad>(UNREAD);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filterState, setFilterState] = useState<{
    readonly organizationId: string | null;
    readonly filters: ProjectFilters;
  }>({ organizationId: null, filters: NO_PROJECT_FILTERS });

  const today = useMemo(() => todayKey(), []);

  const isCurrent = load.organizationId === organizationId;
  const rows = isCurrent ? load.rows : NO_PROJECTS;
  const error = isCurrent ? load.error : null;
  const isLoading = organizationId !== null && !isCurrent;

  const filters =
    filterState.organizationId === organizationId ? filterState.filters : NO_PROJECT_FILTERS;

  const setFilters = useCallback(
    (next: ProjectFilters): void => {
      setFilterState({ organizationId, filters: next });
    },
    [organizationId],
  );

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void projects.listProjects(organizationId).then((result) => {
      if (cancelled) return;
      setLoad({
        organizationId,
        rows: result.ok ? result.value : NO_PROJECTS,
        error: result.ok ? null : userMessage(result.error),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;
    setIsRefreshing(true);
    try {
      const result = await projects.listProjects(organizationId);
      setLoad((current) => {
        if (current.organizationId !== organizationId) return current;
        return {
          organizationId,
          rows: result.ok ? result.value : current.rows,
          error: result.ok ? null : userMessage(result.error),
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  const filteredRows = useMemo(
    () => applyFilters(rows, filters, today),
    [rows, filters, today],
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
      filters.ownerId !== undefined ||
      filters.overdueOnly,
    isLoading,
    isRefreshing,
    error,
    today,
    refresh,
    setFilters,
  };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface ProjectDetail {
  readonly project: ProjectListEntry | null;
  readonly members: readonly ProjectMemberEntry[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  /** Distinguishes "not found" from "not loaded yet" from "could not load". */
  readonly notFound: boolean;
  readonly today: string;
  refresh(): Promise<void>;
}

/**
 * A detail read, tagged with the PAIR it was read for.
 *
 * The organization is half of the tag for the same reason it is in `useTaskDetail`:
 * the URL keeps the id across an organization switch, so tagging on the project id
 * alone would hold one organization's project on screen under another's header until
 * the next read landed. On top of the tag, the fetched row's own `organization_id`
 * is compared to the active organization — a row from another tenant is rendered as
 * `notFound` rather than displayed, which is the same anti-probing rule the task
 * detail follows.
 *
 * `notFound` lives inside the tag rather than beside it, because "this project is
 * not visible" and "this project has not been loaded yet" look identical from the
 * outside and must not be conflated: the first is an empty state, the second is a
 * spinner. Tagging them together is what keeps them apart.
 */
/**
 * One project, with the people on it.
 *
 * The project and its members are separate reads because they have separate
 * lifecycles: a membership change should not re-read the project, and a project
 * that cannot be read should not hide a membership list that was read fine.
 */
interface ProjectDetailLoad {
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly project: ProjectListEntry | null;
  readonly members: readonly ProjectMemberEntry[];
  readonly notFound: boolean;
  readonly error: string | null;
}

const NO_MEMBERS: readonly ProjectMemberEntry[] = [];

const UNREAD_DETAIL: ProjectDetailLoad = {
  organizationId: null,
  projectId: null,
  project: null,
  members: NO_MEMBERS,
  notFound: false,
  error: null,
};

export function useProjectDetail(
  projectId: string | null,
  organizationId: string | null,
): ProjectDetail {
  const [load, setLoad] = useState<ProjectDetailLoad>(UNREAD_DETAIL);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const today = useMemo(() => todayKey(), []);

  const isCurrent =
    load.projectId === projectId && load.organizationId === organizationId;
  const project = isCurrent ? load.project : null;
  const members = isCurrent ? load.members : NO_MEMBERS;
  const notFound = isCurrent && load.notFound;
  const error = isCurrent ? load.error : null;
  const isLoading = projectId !== null && organizationId !== null && !isCurrent;

  useEffect(() => {
    if (projectId === null || organizationId === null) return;
    let cancelled = false;

    void (async () => {
      // The project and its members are separate reads because they have separate
      // lifecycles: a membership change should not re-read the project, and a
      // project that cannot be read should not hide a membership list that was
      // read fine.
      const [projectResult, membersResult] = await Promise.all([
        projects.getProject(projectId),
        projects.listProjectMembers(projectId),
      ]);
      if (cancelled) return;

      if (projectResult.ok) {
        // A row that belongs to a different organization than the one in view is
        // not a project of this tenant's, and showing it would put org A's record
        // under org B's header. It renders as not-found — the same sentence a
        // deleted row gets — so nothing in the UI states whether the record
        // exists elsewhere.
        if (projectResult.value.project.organization_id !== organizationId) {
          setLoad({
            organizationId,
            projectId,
            project: null,
            members: NO_MEMBERS,
            notFound: true,
            error: null,
          });
          return;
        }
        setLoad({
          organizationId,
          projectId,
          project: projectResult.value,
          members: membersResult.ok ? membersResult.value : NO_MEMBERS,
          notFound: false,
          error: null,
        });
        return;
      }

      // A project that is not visible is NOT_FOUND, not an error. Saying
      // "not found" for a row the caller's RLS cannot see is the same rule
      // `getProject` follows: a refusal would confirm the row exists somewhere.
      // Rendered as an empty state, never as an error banner.
      setLoad({
        organizationId,
        projectId,
        project: null,
        members: membersResult.ok ? membersResult.value : NO_MEMBERS,
        notFound: projectResult.error.code === 'NOT_FOUND',
        error: projectResult.error.code === 'NOT_FOUND' ? null : userMessage(projectResult.error),
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, organizationId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (projectId === null || organizationId === null) return;
    setIsRefreshing(true);
    try {
      const [projectResult, membersResult] = await Promise.all([
        projects.getProject(projectId),
        projects.listProjectMembers(projectId),
      ]);
      setLoad((current) => {
        if (current.projectId !== projectId || current.organizationId !== organizationId) {
          return current;
        }
        if (projectResult.ok) {
          if (projectResult.value.project.organization_id !== organizationId) {
            return {
              ...current,
              project: null,
              members: NO_MEMBERS,
              notFound: true,
              error: null,
            };
          }
          return {
            organizationId,
            projectId,
            project: projectResult.value,
            members: membersResult.ok ? membersResult.value : current.members,
            notFound: false,
            error: null,
          };
        }
        return {
          ...current,
          error: projectResult.error.code === 'NOT_FOUND' ? null : userMessage(projectResult.error),
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [projectId, organizationId]);

  return {
    project,
    members,
    isLoading,
    isRefreshing,
    error,
    notFound,
    today,
    refresh,
  };
}
