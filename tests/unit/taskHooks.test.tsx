/**
 * Task hooks — the organization switch, and the slow request.
 *
 * Two failures this file exists to catch, both of which are invisible in a pure
 * function test because neither involves the database at all. They only appear when
 * two organizations' reads are in flight at the same time.
 *
 * ── 1. A slow response must not outlive the tenant it was asked for ──────────
 * A person opens organization A, then switches to B. A's request was already sent.
 * If it lands after B's, a hook that writes whatever arrived last will put A's tasks
 * under B's header — and because every read is `.eq('organization_id', ...)`, the
 * response is perfectly well-formed. There is no error to log and no failed request
 * to retry. The tag comparison in `useTaskList` / `useTaskDetail` is the only thing
 * standing between that and a tenant leak rendered as ordinary data.
 *
 * ── 2. The old tenant's data must disappear on the switch, not linger ─────────
 * The tag also decides what is shown DURING the switch. Holding A's rows until B's
 * arrive would mean the screen is briefly correct about B's counts and wrong about
 * everything else, which is the state a reader is most likely to act on.
 *
 * Both are asserted by holding a promise open and releasing it out of order, because
 * a mock that resolves immediately cannot reproduce them — the race window is the
 * entire subject.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useOpenTaskCounts, useTaskDetail, useTaskList } from '@/features/tasks/useTasks';
import { ok, err } from '@/utils/result';

jest.mock('@/services/taskService', () => ({
  listTasks: jest.fn(),
  getTask: jest.fn(),
  currentEmployeeId: jest.fn(),
  openTaskCountsByProject: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const taskService = require('@/services/taskService') as {
  listTasks: jest.Mock;
  getTask: jest.Mock;
  currentEmployeeId: jest.Mock;
  openTaskCountsByProject: jest.Mock;
};

const ORG_A = 'org-a';
const ORG_B = 'org-b';

const taskRow = (id: string, title: string, organizationId: string = ORG_A) => ({
  id,
  organization_id: organizationId,
  project_id: null,
  assignee_id: null,
  title,
  description: null,
  status: 'todo',
  priority: 'medium',
  progress: 0,
  due_date: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});

const listEntry = (id: string, title: string) => ({
  task: taskRow(id, title),
  projectName: null,
  assigneeName: null,
});

/**
 * A promise whose resolution the test controls.
 *
 * `deferred` rather than a timeout: a timer makes the ordering depend on how slow the
 * machine is, and a suite that passes only on a fast one is a suite that will fail in
 * CI for the wrong reason. Here the slow response is released last on purpose, every
 * time, which is exactly the ordering that breaks a naive hook.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Renders a hook and hands back its latest value plus a way to re-render. */
function renderHook<T>(useHook: (organizationId: string | null) => T) {
  const results: T[] = [];

  function Probe({ organizationId }: { organizationId: string | null }) {
    results.push(useHook(organizationId));
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe organizationId={ORG_A} />);
  });

  return {
    latest: (): T => {
      const value = results[results.length - 1];
      if (value === undefined) throw new Error('the hook never rendered');
      return value;
    },
    switchTo: (organizationId: string | null): void => {
      act(() => {
        renderer.update(<Probe organizationId={organizationId} />);
      });
    },
  };
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  taskService.currentEmployeeId.mockResolvedValue(ok(null));
});

describe('useTaskList — the organization switch', () => {
  it('shows nothing from the previous organization while the new one loads', async () => {
    // A's list arrives first and is correct. Switching to B must not leave A's rows on
    // screen under B's header while B's request is in flight.
    taskService.listTasks.mockResolvedValue(ok([listEntry('a1', 'A work')]));
    const hook = renderHook((id) => useTaskList(id));
    await flush();

    expect(hook.latest().rows).toHaveLength(1);

    const pendingB = deferred<ReturnType<typeof ok>>();
    taskService.listTasks.mockReturnValue(pendingB.promise);

    hook.switchTo(ORG_B);

    // The switch itself, before B answers: A's rows must already be gone.
    expect(hook.latest().rows).toHaveLength(0);
    expect(hook.latest().isLoading).toBe(true);

    await act(async () => {
      pendingB.resolve(ok([listEntry('b1', 'B work')]));
    });

    expect(hook.latest().rows.map((row: { task: { title: string } }) => row.task.title)).toEqual([
      'B work',
    ]);
  });

  it('ignores a slow response for the organization the user already left', async () => {
    // The race, stated directly. A's request is issued, the user switches to B, B's
    // request resolves, and only THEN does A's response arrive. The last write wins
    // in a hook that does not check which tenant it was for.
    const slowA = deferred<ReturnType<typeof ok>>();
    taskService.listTasks.mockReturnValueOnce(slowA.promise);

    const hook = renderHook((id) => useTaskList(id));

    // Switch to B before A has answered, then let B answer.
    taskService.listTasks.mockResolvedValue(ok([listEntry('b1', 'B work')]));
    hook.switchTo(ORG_B);
    await flush();

    expect(hook.latest().rows.map((row: { task: { title: string } }) => row.task.title)).toEqual([
      'B work',
    ]);

    // A's response lands late, out of order, with no error in it.
    await act(async () => {
      slowA.resolve(ok([listEntry('a1', 'A work')]));
    });

    // Still B. If this fails, the fix is the organization tag on the load, not a
    // retry — the response was fine, it was simply for somewhere else.
    expect(hook.latest().rows.map((row: { task: { title: string } }) => row.task.title)).toEqual([
      'B work',
    ]);
  });

  it('does not report an error from a response the user has already left', async () => {
    // The same race, with a failure instead of a row. A red banner over B's working
    // list, caused by a request for an organization nobody is looking at any more.
    const failingA = deferred<ReturnType<typeof err>>();
    taskService.listTasks.mockReturnValueOnce(failingA.promise);

    const hook = renderHook((id) => useTaskList(id));

    taskService.listTasks.mockResolvedValue(ok([listEntry('b1', 'B work')]));
    hook.switchTo(ORG_B);
    await flush();

    await act(async () => {
      failingA.resolve(err({ code: 'NETWORK_UNAVAILABLE' }));
    });

    expect(hook.latest().error).toBeNull();
  });
});

describe('useTaskDetail — the organization switch', () => {
  it('ignores a slow task response from the organization the user already left', async () => {
    // A task id is stable across an organization switch: the URL does not change and
    // the row is not re-resolved. The pair tag on the load is the only thing stopping
    // A's task from rendering under B's organization header.
    const slowA = deferred<ReturnType<typeof ok>>();
    taskService.getTask.mockReturnValueOnce(slowA.promise);

    const hook = renderHook((id) => useTaskDetail(id, 'task-1'));

    taskService.getTask.mockResolvedValue(ok(taskRow('task-1', 'B work', ORG_B)));
    hook.switchTo(ORG_B);
    await flush();

    expect(hook.latest().task?.task.title).toBe('B work');

    await act(async () => {
      slowA.resolve(ok(taskRow('task-1', 'A work')));
    });

    expect(hook.latest().task?.task.title).toBe('B work');
  });

  it('refuses to report NOT_FOUND for a task in an organization the user has left', async () => {
    // A missed task renders as an empty state, not an error — and an empty state says
    // "this does not exist", which is a much stronger claim than "this failed". A
    // refusal belonging to the previous tenant must not produce that sentence.
    const slowA = deferred<ReturnType<typeof err>>();
    taskService.getTask.mockReturnValueOnce(slowA.promise);

    const hook = renderHook((id) => useTaskDetail(id, 'task-1'));

    taskService.getTask.mockResolvedValue(ok(taskRow('task-1', 'B work', ORG_B)));
    hook.switchTo(ORG_B);
    await flush();

    await act(async () => {
      slowA.resolve(err({ code: 'NOT_FOUND' }));
    });

    expect(hook.latest().notFound).toBe(false);
    expect(hook.latest().error).toBeNull();
  });

  it('hides a task whose own organization is not the organization in view', async () => {
    // The pair tag stops another tenant's RESPONSE from rendering under the header,
    // but it cannot see what row a response holds. RLS scopes `getTask`, so a row
    // from another organization should never arrive — but if it does, showing it
    // would be the exact leak the tag exists to prevent, so it renders as not-found
    // instead of displaying data it has no right to show.
    const foreign = { ...taskRow('task-1', 'B work'), organization_id: ORG_B };
    taskService.getTask.mockResolvedValue(ok(foreign));

    const hook = renderHook((id) => useTaskDetail(id, 'task-1'));
    await flush();

    expect(hook.latest().notFound).toBe(true);
    expect(hook.latest().task).toBeNull();
    expect(hook.latest().error).toBeNull();
  });

  it('removes a task on refresh that turned out to belong to another organization', async () => {
    taskService.getTask.mockResolvedValue(ok(taskRow('task-1', 'A work')));
    const hook = renderHook((id) => useTaskDetail(id, 'task-1'));
    await flush();

    expect(hook.latest().notFound).toBe(false);

    const foreign = { ...taskRow('task-1', 'A work'), organization_id: ORG_B };
    taskService.getTask.mockResolvedValue(ok(foreign));

    await act(async () => {
      await hook.latest().refresh();
    });

    expect(hook.latest().notFound).toBe(true);
    expect(hook.latest().task).toBeNull();
    expect(hook.latest().error).toBeNull();
  });
});

describe('useOpenTaskCounts — the organization switch', () => {
  it('reports zero for every project while the new organization loads', async () => {
    // Zero is a real answer, so it is only safe here because `isLoading` says so.
    // A count that silently reads 0 mid-switch would make a busy project look idle.
    taskService.openTaskCountsByProject.mockResolvedValue(ok(new Map([['project-1', 4]])));
    const hook = renderHook((id) => useOpenTaskCounts(id));
    await flush();

    expect(hook.latest().countFor('project-1')).toBe(4);

    const pendingB = deferred<ReturnType<typeof ok>>();
    taskService.openTaskCountsByProject.mockReturnValue(pendingB.promise);
    hook.switchTo(ORG_B);

    expect(hook.latest().countFor('project-1')).toBe(0);
    expect(hook.latest().isLoading).toBe(true);

    await act(async () => {
      pendingB.resolve(ok(new Map([['project-1', 1]])));
    });

    expect(hook.latest().countFor('project-1')).toBe(1);
  });

  it('ignores a slow count from the organization the user already left', async () => {
    const slowA = deferred<ReturnType<typeof ok>>();
    taskService.openTaskCountsByProject.mockReturnValueOnce(slowA.promise);

    const hook = renderHook((id) => useOpenTaskCounts(id));

    taskService.openTaskCountsByProject.mockResolvedValue(ok(new Map([['project-1', 1]])));
    hook.switchTo(ORG_B);
    await flush();

    await act(async () => {
      slowA.resolve(ok(new Map([['project-1', 99]])));
    });

    expect(hook.latest().countFor('project-1')).toBe(1);
  });
});
