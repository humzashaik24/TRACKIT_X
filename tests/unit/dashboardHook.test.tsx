/**
 * `useDashboardSnapshot` — the organization switch, and the slow request.
 *
 * The same two failures `taskHooks.test.tsx` covers, on a screen that reads three tables
 * instead of one and therefore has three times the chance to get it wrong. Neither
 * failure involves arithmetic, so `dashboardMetrics.test.ts` cannot see them at all —
 * they only exist while two tenants' requests are in flight together.
 *
 * ── 1. A slow response must not outlive the tenant it was asked for ───────────────
 * A person opens organization A, then switches to B. A's three reads were already sent.
 * If they land after B's, a hook that writes whatever arrived last renders one
 * organization's headcount, projects and tasks under another's name — and because every
 * read is `.eq('organization_id', ...)`, each response is perfectly well-formed. There
 * is no error to log and no request to retry. The organization tag is the only thing
 * standing between that and a tenant leak rendered as ordinary data.
 *
 * ── 2. The old tenant's data must disappear on the switch, not linger ──────────────
 * The dashboard is worse than a list here. A list showing A's rows under B's header is
 * visibly wrong; a dashboard showing A's four headline numbers under B's name looks
 * entirely plausible, because every figure is real, correctly derived, and simply about
 * the wrong business. It is the kind of leak that survives a skim of the UI and is only
 * caught by somebody who happens to know both companies.
 *
 * Both are asserted by holding a promise open and releasing it out of order, because a
 * mock that resolves immediately cannot reproduce them — the race window is the subject.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useDashboardSnapshot } from '@/features/dashboard/useDashboardSnapshot';
import type { OrganizationRole } from '@/types/database';
import { appError } from '@/utils/errors';
import { err, ok } from '@/utils/result';

jest.mock('@/services/dashboardService', () => ({
  readDashboardFacts: jest.fn(),
  countOrganizationMembers: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const dashboardService = require('@/services/dashboardService') as {
  readDashboardFacts: jest.Mock;
  countOrganizationMembers: jest.Mock;
};

const ORG_A = 'org-a';
const ORG_B = 'org-b';

/** A fact set recognisable by the organization it pretends to belong to. */
function factsFor(organizationId: string, employees: number, projects: number, tasks: number) {
  return ok({
    organizationId,
    employees: Array.from({ length: employees }, (_, index) => ({
      id: `${organizationId}-emp-${index}`,
      first_name: 'A',
      last_name: `Worker${index}`,
      employment_status: 'active' as const,
    })),
    projects: Array.from({ length: projects }, (_, index) => ({
      id: `${organizationId}-prj-${index}`,
      name: `${organizationId} project ${index}`,
      status: 'active' as const,
      priority: 'medium' as const,
      progress: 0,
      target_date: null,
      owner_id: null,
    })),
    tasks: Array.from({ length: tasks }, (_, index) => ({
      status: 'todo' as const,
      priority: 'medium' as const,
      progress: 0,
      due_date: null,
      assignee_id: null,
      ...{ id: `${organizationId}-tsk-${index}` },
    })),
  });
}

/**
 * A promise whose resolution the test controls.
 *
 * `deferred` rather than a timeout, for the reason given in `taskHooks.test.tsx`: a
 * timer makes the ordering depend on machine speed.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function renderHook(organizationId: string | null, role: OrganizationRole = 'owner') {
  const results: ReturnType<typeof useDashboardSnapshot>[] = [];

  function Probe({
    id,
    as,
  }: {
    id: string | null;
    as: OrganizationRole;
  }) {
    results.push(useDashboardSnapshot(id, as));
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe id={organizationId} as={role} />);
  });

  return {
    latest: (): ReturnType<typeof useDashboardSnapshot> => {
      const value = results[results.length - 1];
      if (value === undefined) throw new Error('the hook never rendered');
      return value;
    },
    switchTo: (id: string | null, as: OrganizationRole = role): void => {
      act(() => {
        renderer.update(<Probe id={id} as={as} />);
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
  dashboardService.countOrganizationMembers.mockResolvedValue(ok(3));
});

describe('useDashboardSnapshot — the organization switch', () => {
  it('shows nothing from the previous organization while the new one loads', async () => {
    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_A, 5, 2, 8));
    const hook = renderHook(ORG_A);
    await flush();

    expect(hook.latest().snapshot?.employees.total).toBe(5);

    const pendingB = deferred<ReturnType<typeof ok>>();
    dashboardService.readDashboardFacts.mockReturnValue(pendingB.promise);

    hook.switchTo(ORG_B);

    // The switch itself, before B answers. A's figures must already be gone — a
    // dashboard showing real numbers for the wrong business is the dangerous case.
    expect(hook.latest().snapshot).toBeNull();
    expect(hook.latest().status).toBe('loading');

    await act(async () => {
      pendingB.resolve(factsFor(ORG_B, 1, 9, 3));
    });

    expect(hook.latest().snapshot?.organizationId).toBe(ORG_B);
    expect(hook.latest().snapshot?.employees.total).toBe(1);
    expect(hook.latest().snapshot?.projects.total).toBe(9);
  });

  it('ignores a slow response for the organization the user already left', async () => {
    // The race, stated directly: A's read is issued, the user switches to B, B resolves,
    // and only THEN does A arrive. A hook without a tag writes A last and wins.
    const slowA = deferred<ReturnType<typeof ok>>();
    dashboardService.readDashboardFacts.mockReturnValueOnce(slowA.promise);

    const hook = renderHook(ORG_A);
    await flush();

    // A is still in flight. Switch to B, which answers immediately.
    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_B, 1, 9, 3));
    hook.switchTo(ORG_B);
    await flush();

    expect(hook.latest().snapshot?.organizationId).toBe(ORG_B);

    // A finally lands. It must be discarded.
    await act(async () => {
      slowA.resolve(factsFor(ORG_A, 5, 2, 8));
    });

    const after = hook.latest();
    expect(after.snapshot?.organizationId).toBe(ORG_B);
    expect(after.snapshot?.employees.total).toBe(1);
    expect(after.snapshot?.projects.total).toBe(9);
  });

  it('discards a slow FAILURE for the organization the user already left', async () => {
    // The nastier ordering: A's read errors after B has already succeeded. A hook that
    // stores the last error regardless of tenant would replace a good dashboard with an
    // error card about a workspace the user is no longer looking at.
    const slowErrorA = deferred<ReturnType<typeof err>>();
    dashboardService.readDashboardFacts.mockReturnValueOnce(slowErrorA.promise);

    const hook = renderHook(ORG_A);
    await flush();

    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_B, 2, 2, 2));
    hook.switchTo(ORG_B);
    await flush();

    expect(hook.latest().status).toBe('ready');

    await act(async () => {
      slowErrorA.resolve(err(appError('NETWORK_UNAVAILABLE', 'a exploded')));
    });

    const after = hook.latest();
    expect(after.status).toBe('ready');
    expect(after.error).toBeNull();
    expect(after.snapshot?.organizationId).toBe(ORG_B);
  });

  it('re-derives the gate when the role changes without changing the organization', async () => {
    dashboardService.readDashboardFacts.mockResolvedValue(
      factsFor(ORG_A, 3, 1, 4),
    );
    const hook = renderHook(ORG_A, 'owner');
    await flush();

    expect(hook.latest().snapshot?.workload).not.toBeNull();

    // The facts are cached, so this is a pure re-derivation rather than a refetch — the
    // gate depends on the role, not on the rows.
    hook.switchTo(ORG_A, 'member');

    expect(hook.latest().snapshot?.workload).toBeNull();
    expect(hook.latest().snapshot?.employees.withOpenWork).toBeNull();
  });

  it('does not read at all without an organization', async () => {
    const hook = renderHook(null);
    await flush();

    expect(dashboardService.readDashboardFacts).not.toHaveBeenCalled();
    expect(hook.latest().snapshot).toBeNull();
    expect(hook.latest().status).toBe('loading');
  });
});

describe('useDashboardSnapshot — failure handling', () => {
  it('surfaces a read failure as a user-facing sentence, not a raw code', async () => {
    dashboardService.readDashboardFacts.mockResolvedValue(
      err(appError('NETWORK_UNAVAILABLE', 'connection reset')),
    );

    const hook = renderHook(ORG_A);
    await flush();

    expect(hook.latest().status).toBe('error');
    expect(hook.latest().snapshot).toBeNull();
    expect(hook.latest().error).toBeTruthy();
    // Whatever it is, it must not be the machine code — this string is rendered.
    expect(hook.latest().error).not.toContain('NETWORK_UNAVAILABLE');
  });

  it('keeps the snapshot when only the member count fails', async () => {
    // The member count is a secondary figure — "people with access" beside the headcount
    // — so failing it must not cost the user the entire dashboard. The count degrades to
    // `null`, which renders as an em dash.
    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_A, 4, 3, 12));
    dashboardService.countOrganizationMembers.mockResolvedValue(
      err(appError('NETWORK_UNAVAILABLE', 'count failed')),
    );

    const hook = renderHook(ORG_A);
    await flush();

    expect(hook.latest().status).toBe('ready');
    expect(hook.latest().snapshot?.employees.total).toBe(4);
    expect(hook.latest().snapshot?.employees.accessHolders).toBeNull();
  });

  it('sends both reads together rather than in sequence', async () => {
    // Three table reads and a count, serialised, is four round trips before the first
    // pixel of a dashboard. They are independent, so they go out together.
    //
    // The proof is ordering, not a spy count: the facts read is held open, and the
    // member count is asserted to have been *called* while it is still unresolved. A
    // hook that awaited one before starting the other could not satisfy that.
    const pending = deferred<ReturnType<typeof ok>>();
    dashboardService.readDashboardFacts.mockReturnValue(pending.promise);

    const hook = renderHook(ORG_A);
    await flush();

    expect(dashboardService.readDashboardFacts).toHaveBeenCalledWith(ORG_A);
    expect(dashboardService.countOrganizationMembers).toHaveBeenCalledWith(ORG_A);
    expect(hook.latest().status).toBe('loading');

    await act(async () => {
      pending.resolve(factsFor(ORG_A, 1, 1, 1));
    });

    expect(hook.latest().status).toBe('ready');
  });
});

describe('useDashboardSnapshot — refresh', () => {
  it('keeps the previous snapshot visible while recounting', async () => {
    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_A, 2, 2, 2));
    const hook = renderHook(ORG_A);
    await flush();

    expect(hook.latest().status).toBe('ready');

    const pending = deferred<ReturnType<typeof ok>>();
    dashboardService.readDashboardFacts.mockReturnValue(pending.promise);

    act(() => {
      void hook.latest().refresh();
    });

    // A pull-to-refresh that blanks the screen is worse than one that does not: the
    // numbers a reader is checking are the numbers they are refreshing to confirm.
    expect(hook.latest().isRefreshing).toBe(true);
    expect(hook.latest().snapshot).not.toBeNull();

    await act(async () => {
      pending.resolve(factsFor(ORG_A, 7, 7, 7));
    });

    expect(hook.latest().isRefreshing).toBe(false);
    expect(hook.latest().snapshot?.employees.total).toBe(7);
  });

  it('keeps the old snapshot visible when a refresh fails', async () => {
    dashboardService.readDashboardFacts.mockResolvedValue(factsFor(ORG_A, 2, 2, 2));
    const hook = renderHook(ORG_A);
    await flush();

    dashboardService.readDashboardFacts.mockResolvedValue(
      err(appError('NETWORK_UNAVAILABLE', 'offline')),
    );

    await act(async () => {
      await hook.latest().refresh();
    });

    // Stale data plus a visible error beats an empty screen. Throwing the good data away
    // would mean one dropped connection erases the dashboard until the next load.
    expect(hook.latest().snapshot?.employees.total).toBe(2);
  });
});
