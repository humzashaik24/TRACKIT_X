/**
 * Trackit X — global search query logic.
 *
 * The pure half of global search: term matching and result shaping, over the
 * three data sources that genuinely exist — employees, projects and tasks —
 * everything scoped to the organization the caller already rules them to.
 *
 * Nothing here fetches, ranks by invented relevance, or falls back to a fake
 * result. A term that matches no record yields an empty list, and the overlay
 * says that in words.
 */
import type { Href } from 'expo-router';

import { employeeDisplayName } from '@/domain/employee';
import type { EmployeeListEntry } from '@/services/employeeService';
import type { ProjectListEntry } from '@/services/projectService';
import type { TaskListEntry } from '@/services/taskService';

/** One row the overlay offers. `path` is where selecting it navigates. */
export interface SearchResult {
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly group: 'Employee' | 'Project' | 'Task';
  /** Route to push when the row is picked. Typed so the router accepts it. */
  readonly path: Href;
}

export const SEARCH_GROUP_ORDER: readonly SearchResult['group'][] = [
  'Employee',
  'Project',
  'Task',
];

/** How many results a group shows before it stops; more records exist. */
export const SEARCH_GROUP_LIMIT = 6;

/** A term is worth searching once it has two characters — one is noise. */
export function isWorthSearching(term: string): boolean {
  return term.trim().length >= 2;
}

function termOf(value: string | null, term: string): boolean {
  return value !== null && value.toLowerCase().includes(term);
}

export function searchEmployees(
  rows: readonly EmployeeListEntry[],
  term: string,
  limit = SEARCH_GROUP_LIMIT,
): readonly SearchResult[] {
  const needle = term.trim().toLowerCase();
  if (!isWorthSearching(needle)) return [];
  const results: SearchResult[] = [];
  for (const entry of rows) {
    const person = entry.employee;
    const haystack = [
      employeeDisplayName(person),
      person.job_title,
      entry.departmentName,
    ].join(' ').toLowerCase();
    if (!haystack.includes(needle)) continue;
    results.push({
      key: `employee:${person.id}`,
      title: employeeDisplayName(person),
      subtitle: person.job_title ?? entry.departmentName ?? 'Directory',
      group: 'Employee',
      // People have a roster but no detail page in this phase, so the pick
      // lands on the directory rather than on a route that cannot exist.
      path: '/employees',
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function searchProjects(
  rows: readonly ProjectListEntry[],
  term: string,
  limit = SEARCH_GROUP_LIMIT,
): readonly SearchResult[] {
  const needle = term.trim().toLowerCase();
  if (!isWorthSearching(needle)) return [];
  const results: SearchResult[] = [];
  for (const entry of rows) {
    const project = entry.project;
    const haystack = [project.name, project.description, entry.ownerName].join(' ').toLowerCase();
    if (!haystack.includes(needle)) continue;
    results.push({
      key: `project:${project.id}`,
      title: project.name,
      subtitle: entry.ownerName === null ? 'No owner' : `Owned by ${entry.ownerName}`,
      group: 'Project',
      path: `/projects/${project.id}`,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export function searchTasks(
  rows: readonly TaskListEntry[],
  term: string,
  limit = SEARCH_GROUP_LIMIT,
): readonly SearchResult[] {
  const needle = term.trim().toLowerCase();
  if (!isWorthSearching(needle)) return [];
  const results: SearchResult[] = [];
  for (const entry of rows) {
    const task = entry.task;
    if (!termOf(task.title, needle) && !termOf(entry.projectName, needle)) continue;
    results.push({
      key: `task:${task.id}`,
      title: task.title,
      subtitle: entry.projectName ?? 'No project',
      group: 'Task',
      path: `/tasks/${task.id}`,
    });
    if (results.length >= limit) break;
  }
  return results;
}

export interface GlobalSearchResults {
  readonly employees: readonly SearchResult[];
  readonly projects: readonly SearchResult[];
  readonly tasks: readonly SearchResult[];
  /** True when every group came back empty. */
  readonly none: boolean;
  /** Total shown. Clients use it for an accessibility label, not for math. */
  readonly total: number;
}

export function runGlobalSearch(
  term: string,
  employees: readonly EmployeeListEntry[],
  projects: readonly ProjectListEntry[],
  tasks: readonly TaskListEntry[],
): GlobalSearchResults {
  const employeeResults = searchEmployees(employees, term);
  const projectResults = searchProjects(projects, term);
  const taskResults = searchTasks(tasks, term);
  const all = [...employeeResults, ...projectResults, ...taskResults];
  return {
    employees: employeeResults,
    projects: projectResults,
    tasks: taskResults,
    none: all.length === 0,
    total: all.length,
  };
}