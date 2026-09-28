/**
 * Global search — the query logic behind the overlay.
 *
 * Pure functions over rows already scoped to the organization, so the cases that
 * matter are pure too: what a term matches, how a group caps itself, and that an
 * unmatched term yields an empty — never an invented — result.
 */
import {
  isWorthSearching,
  runGlobalSearch,
  searchEmployees,
  searchProjects,
  searchTasks,
  SEARCH_GROUP_LIMIT,
  SEARCH_GROUP_ORDER,
} from '@/features/search/searchQuery';
import type { EmployeeListEntry } from '@/services/employeeService';
import type { ProjectListEntry } from '@/services/projectService';
import type { TaskListEntry } from '@/services/taskService';

// Minimal, typed-as-shape fixtures. The functions read only these fields; the
// cast keeps the test about the matching and not about row-shape boilerplate.
function person(id: string, first: string, last: string, job?: string | null): EmployeeListEntry {
  return {
    employee: {
      id,
      first_name: first,
      last_name: last,
      job_title: job ?? null,
    },
    departmentName: 'Engineering',
    managerName: null,
  } as unknown as EmployeeListEntry;
}

function projectEntry(id: string, name: string, owner?: string | null, description?: string): ProjectListEntry {
  return {
    project: {
      id,
      name,
      description: description ?? null,
      owner_id: owner === null ? null : 'o-1',
    },
    ownerName: owner ?? null,
    memberCount: 0,
  } as unknown as ProjectListEntry;
}

function taskEntry(id: string, title: string, project?: string | null): TaskListEntry {
  return {
    task: { id, title, project_id: project === null ? null : 'p-1' },
    projectName: project ?? null,
    assigneeName: null,
  } as unknown as TaskListEntry;
}

const EMPLOYEES = [
  person('e-1', 'Aarav', 'Shah', 'Engineer'),
  person('e-2', 'Farah', 'Hassan', 'Designer'),
  person('e-3', 'Nadia', 'Ali', null),
];

const PROJECTS = [
  projectEntry('p-1', 'Alpha wave', 'Aarav Shah', 'Launch the platform'),
  projectEntry('p-2', 'Beta build', null),
];

const TASKS = [
  taskEntry('t-1', 'Invoice the alpha client', 'Alpha wave'),
  taskEntry('t-2', 'Seed the database', null),
];

describe('isWorthSearching', () => {
  it('ignores terms shorter than two characters', () => {
    expect(isWorthSearching('')).toBe(false);
    expect(isWorthSearching('a')).toBe(false);
    expect(isWorthSearching('  a ')).toBe(false);
  });

  it('accepts two characters and up', () => {
    expect(isWorthSearching('aa')).toBe(true);
    expect(isWorthSearching('invoice')).toBe(true);
    expect(isWorthSearching('  alpha  ')).toBe(true);
  });
});

describe('searchEmployees', () => {
  it('matches full names case-insensitively', () => {
    const hits = searchEmployees(EMPLOYEES, 'FARAH HASSAN');
    expect(hits.map((hit) => hit.title)).toEqual(['Farah Hassan']);
  });

  it('matches any word and the job title and department', () => {
    expect(searchEmployees(EMPLOYEES, 'engineer')[0]?.title).toBe('Aarav Shah');
    expect(searchEmployees(EMPLOYEES, 'engineering').map((hit) => hit.title)).toEqual([
      'Aarav Shah',
      'Farah Hassan',
      'Nadia Ali',
    ]);
  });

  it('defaults the subtitle and points at the directory', () => {
    const hit = searchEmployees(EMPLOYEES, 'nadia')[0];
    expect(hit?.subtitle).toBe('Engineering');
    expect(hit?.path).toBe('/employees');
  });

  it('caps the group at the shared limit', () => {
    const many = Array.from({ length: SEARCH_GROUP_LIMIT + 3 }, (_, index) =>
      person(`e-m${index}`, 'Common', `Name${index}`),
    );
    expect(searchEmployees(many, 'Common')).toHaveLength(SEARCH_GROUP_LIMIT);
  });
});

describe('searchProjects', () => {
  it('matches the name, the description and the owner', () => {
    expect(searchProjects(PROJECTS, 'alpha').map((hit) => hit.title)).toEqual(['Alpha wave']);
    expect(searchProjects(PROJECTS, 'platform').map((hit) => hit.title)).toEqual(['Alpha wave']);
    expect(searchProjects(PROJECTS, 'aarav').map((hit) => hit.title)).toEqual(['Alpha wave']);
  });

  it('names the owner or states the absence honestly', () => {
    expect(searchProjects(PROJECTS, 'beta')[0]?.subtitle).toBe('No owner');
    expect(searchProjects(PROJECTS, 'alpha')[0]?.subtitle).toBe('Owned by Aarav Shah');
  });

  it('deep-links to the project detail route', () => {
    expect(searchProjects(PROJECTS, 'alpha')[0]?.path).toBe('/projects/p-1');
  });
});

describe('searchTasks', () => {
  it('matches the title and the project name', () => {
    expect(searchTasks(TASKS, 'invoice').map((hit) => hit.title)).toEqual([
      'Invoice the alpha client',
    ]);
    expect(searchTasks(TASKS, 'alpha wave').map((hit) => hit.title)).toEqual([
      'Invoice the alpha client',
    ]);
  });

  it('subtitle is the project, or No project', () => {
    expect(searchTasks(TASKS, 'seed')[0]?.subtitle).toBe('No project');
    expect(searchTasks(TASKS, 'invoice')[0]?.subtitle).toBe('Alpha wave');
  });

  it('deep-links to the task detail route', () => {
    expect(searchTasks(TASKS, 'seed')[0]?.path).toBe('/tasks/t-2');
  });
});

describe('runGlobalSearch', () => {
  it('groups the hits and reports the totals', () => {
    const results = runGlobalSearch('alpha', EMPLOYEES, PROJECTS, TASKS);
    expect(results.projects.map((hit) => hit.title)).toEqual(['Alpha wave']);
    expect(results.tasks.map((hit) => hit.title)).toEqual(['Invoice the alpha client']);
    expect(results.employees).toHaveLength(0);
    expect(results.none).toBe(false);
    expect(results.total).toBe(2);
  });

  it('returns an empty — not truthful-looking — result for a miss', () => {
    const results = runGlobalSearch('zebra', EMPLOYEES, PROJECTS, TASKS);
    expect(results.none).toBe(true);
    expect(results.total).toBe(0);
  });

  it('every result carries a unique key', () => {
    const results = runGlobalSearch('al', EMPLOYEES, PROJECTS, TASKS);
    const keys = results.employees
      .concat(results.projects, results.tasks)
      .map((result) => result.key);
    expect(keys.length).toBeGreaterThan(1);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('exposes the group order for stable rendering', () => {
    expect(SEARCH_GROUP_ORDER).toContain('Employee');
    expect(SEARCH_GROUP_ORDER).toContain('Project');
    expect(SEARCH_GROUP_ORDER).toContain('Task');
  });
});