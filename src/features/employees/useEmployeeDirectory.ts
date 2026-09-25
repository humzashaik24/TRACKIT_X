/**
 * Trackit X — employee directory.
 *
 * The React binding around `employeeService` and `departmentService`. It owns three
 * things and nothing else:
 *
 *   · WHEN a read happens — on organization change, and on an explicit refresh. Never
 *     on every render, and never because a filter changed: filtering happens over
 *     rows already in memory, so typing in a search box does not generate a query per
 *     keystroke.
 *   · WHAT a screen shows while a read is in flight — `isLoading` with the previous
 *     rows still visible, so a refresh does not blank the directory.
 *   · WHICH rows survive an organization switch — the whole point of the tag that
 *     travels with the data, explained at `DirectoryLoad`.
 *
 * The rules about counting, bucketing and filtering are pure and live in this
 * feature's other files, so they can be tested without React.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildDepartmentLookup, isCurrentEmployee, type DepartmentRow, type EmploymentStatus } from '@/domain/employee';
import * as departments from '@/services/departmentService';
import * as employees from '@/services/employeeService';
import type { EmployeeListEntry } from '@/services/employeeService';
import { userMessage } from '@/utils/errors';

export type { EmployeeListEntry };

/** How the directory is currently being narrowed. All fields are optional. */
export interface DirectoryFilters {
  readonly search: string;
  /** Empty means every status, not "none". */
  readonly statuses: readonly EmploymentStatus[];
  /** `null` means "including unassigned"; `undefined` means no department filter. */
  readonly departmentId: string | null | undefined;
}

export const NO_DIRECTORY_FILTERS: DirectoryFilters = {
  search: '',
  statuses: [],
  departmentId: undefined,
};

export interface DirectorySummary {
  /** Everyone on the books. */
  readonly total: number;
  /** The subset still working — `active` plus probation and leave. */
  readonly current: number;
  /** Nobody accountable to a manager. A number worth surfacing, not an error. */
  readonly unmanaged: number;
  /** With no department. */
  readonly unassigned: number;
}

export interface EmployeeDirectory {
  readonly rows: readonly EmployeeListEntry[];
  readonly filteredRows: readonly EmployeeListEntry[];
  readonly departmentList: readonly DepartmentRow[];
  readonly departmentsById: ReadonlyMap<string, string>;
  readonly summary: DirectorySummary;
  /**
   * The filters currently in force.
   *
   * Exposed rather than hidden behind a `setFilter(key, value)` so a screen reads
   * and writes the same object, and so "clear everything" is one call with one
   * canonical reset value rather than N calls that each have to remember to
   * include the field they were not thinking about.
   */
  readonly filters: DirectoryFilters;
  /** A filter is doing something. Drives the "clear filters" affordance. */
  readonly hasActiveFilters: boolean;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  /** Set when the last read FAILED. Stale rows are still returned alongside it. */
  readonly error: string | null;
  refresh(): Promise<void>;
  setFilters(next: DirectoryFilters): void;
}

/**
 * Matches a row against a search term.
 *
 * Client-side even though the service can filter server-side, and that is a
 * deliberate duplication: the service's filter is for correctness across a paged
 * read, and this one is for a search box that must respond while typing. Both
 * search the same fields, so what the user sees narrowed and what arrives from the
 * database agree.
 */
function matchesSearch(entry: EmployeeListEntry, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;

  const { employee } = entry;
  const haystack = [
    employee.first_name,
    employee.last_name,
    employee.email,
    employee.employee_code,
    employee.job_title,
  ];
  return haystack.some((value) => value !== null && value.toLowerCase().includes(needle));
}

function applyFilters(
  rows: readonly EmployeeListEntry[],
  filters: DirectoryFilters,
): readonly EmployeeListEntry[] {
  return rows.filter((entry) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(entry.employee.employment_status)) {
      return false;
    }
    if (filters.departmentId !== undefined) {
      if (entry.employee.department_id !== filters.departmentId) return false;
    }
    return matchesSearch(entry, filters.search);
  });
}

function summarize(rows: readonly EmployeeListEntry[]): DirectorySummary {
  let current = 0;
  let unmanaged = 0;
  let unassigned = 0;
  for (const { employee } of rows) {
    if (isCurrentEmployee(employee.employment_status)) current += 1;
    if (employee.manager_id === null) unmanaged += 1;
    if (employee.department_id === null) unassigned += 1;
  }
  return { total: rows.length, current, unmanaged, unassigned };
}

function hasFilters(filters: DirectoryFilters): boolean {
  return (
    filters.search.trim().length > 0 ||
    filters.statuses.length > 0 ||
    filters.departmentId !== undefined
  );
}

/**
 * A directory read, together with the organization it was read FOR.
 *
 * The tag is the whole point. Resetting the rows in an effect when the
 * organization changes looks equivalent and is not: for one render after the
 * switch the previous tenant's staff are still on screen, and for the length of a
 * slow read they stay there. A counter compared in a closure guards the *reply*;
 * only the tag guards the *render*, because the render asks "is this data mine?"
 * rather than "did anything change while I was waiting?".
 */
interface DirectoryLoad {
  readonly organizationId: string | null;
  readonly rows: readonly EmployeeListEntry[];
  readonly departments: readonly DepartmentRow[];
  readonly error: string | null;
}

const NO_ROWS: readonly EmployeeListEntry[] = [];
const NO_DEPARTMENTS: readonly DepartmentRow[] = [];

const UNREAD: DirectoryLoad = {
  organizationId: null,
  rows: NO_ROWS,
  departments: NO_DEPARTMENTS,
  error: null,
};

export function useEmployeeDirectory(organizationId: string | null): EmployeeDirectory {
  const [load, setLoad] = useState<DirectoryLoad>(UNREAD);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Filters are tagged the same way, and for the same reason: a search term or a
   * department chosen in one organization means nothing in another, and carrying
   * it across would either hide every row or show the wrong ones.
   */
  const [filterState, setFilterState] = useState<{
    readonly organizationId: string | null;
    readonly filters: DirectoryFilters;
  }>({ organizationId: null, filters: NO_DIRECTORY_FILTERS });

  // Data for the organization in view, or nothing at all while it is still unread.
  const isCurrent = load.organizationId === organizationId;
  const rows = isCurrent ? load.rows : NO_ROWS;
  const departmentList = isCurrent ? load.departments : NO_DEPARTMENTS;
  const error = isCurrent ? load.error : null;

  /**
   * True only for a read that has not produced anything for the current
   * organization yet. A refresh of an organization already in hand does not set it,
   * which is what keeps a pull-to-refresh from blanking a populated directory.
   */
  const isLoading = organizationId !== null && !isCurrent;

  const filters =
    filterState.organizationId === organizationId ? filterState.filters : NO_DIRECTORY_FILTERS;

  const setFilters = useCallback(
    (next: DirectoryFilters): void => {
      setFilterState({ organizationId, filters: next });
    },
    [organizationId],
  );

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void (async () => {
      // Both reads are needed and neither implies the other: the roster needs the
      // department names, and a department with nobody in it must still appear in
      // the picker. Sequential rather than parallel because `Promise.all` rejects
      // on the first failure and would discard a successful department list along
      // with a failed roster.
      const departmentsResult = await departments.listDepartments(organizationId);
      if (cancelled) return;
      const usableDepartments = departmentsResult.ok ? departmentsResult.value : NO_DEPARTMENTS;

      const employeesResult = await employees.listEmployees(organizationId);
      if (cancelled) return;

      // Written under the id the read was FOR, so a reply that arrives after the
      // user has moved on lands on a tag nothing is reading from.
      setLoad({
        organizationId,
        departments: usableDepartments,
        rows: employeesResult.ok ? employeesResult.value : NO_ROWS,
        error: employeesResult.ok ? null : userMessage(employeesResult.error),
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
      const [departmentsResult, employeesResult] = await Promise.all([
        departments.listDepartments(organizationId),
        employees.listEmployees(organizationId),
      ]);
      setLoad((current) => {
        // A refresh for an organization the user has already left writes nothing,
        // rather than replacing whatever is on screen with a stranger's roster.
        if (current.organizationId !== organizationId) return current;
        return {
          organizationId,
          departments: departmentsResult.ok ? departmentsResult.value : current.departments,
          rows: employeesResult.ok ? employeesResult.value : current.rows,
          error: employeesResult.ok ? null : userMessage(employeesResult.error),
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  const departmentsById = useMemo(() => buildDepartmentLookup(departmentList), [departmentList]);
  const filteredRows = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const summary = useMemo(() => summarize(rows), [rows]);

  return {
    rows,
    filteredRows,
    departmentList,
    departmentsById,
    summary,
    filters,
    hasActiveFilters: hasFilters(filters),
    isLoading,
    isRefreshing,
    error,
    refresh,
    setFilters,
  };
}
