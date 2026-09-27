/**
 * `useCopilot` — the organization switch, the role change, and the slow answer.
 *
 * A Copilot transcript is a worse place for a tenant leak than a dashboard. A dashboard
 * showing the wrong organization's four headline numbers looks entirely plausible, because
 * every figure is real and correctly derived. A Copilot answer is worse: it is prose, it
 * is assembled from many records, and it names people. "Priya Raman is carrying the
 * heaviest workload" under the wrong company header is a disclosure, and nothing about it
 * looks wrong to a reader who does not already know both companies.
 *
 * The failures are also invisible to the pure tests in `copilotData.test.ts`, because they
 * exist only while two tenants' requests are in flight together. So they are asserted here
 * by holding a promise open and releasing it out of order — a mock that resolves
 * immediately cannot reproduce a race, because the ordering *is* the subject.
 *
 * Covered here:
 *   1. The previous organization's transcript is gone on the switch, before B answers.
 *   2. An answer for A that lands after the switch to B is discarded.
 *   3. A *refusal* for A that lands after the switch is discarded too — the nastier
 *      ordering, since an error card naming the wrong workspace replaces a good answer.
 *   4. A demotion hides a turn without clearing the conversation.
 *   5. Two answers resolving out of order land in their own turns.
 *   6. `clear()` discards a pending answer.
 *   7. The send control is gated while a question is in flight.
 */
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useCopilot, type UseCopilotResult } from '@/features/copilot/useCopilot';
import type { CopilotResponse } from '@/domain/ai/copilot';
import type { OrganizationRow, OrganizationRole } from '@/types/database';
import { appError } from '@/utils/errors';
import { err, ok } from '@/utils/result';

jest.mock('@/services/copilotService', () => ({
  askCopilot: jest.fn(),
}));

jest.mock('@/contexts/OrganizationContext', () => ({
  useOrganization: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const copilotService = require('@/services/copilotService') as { askCopilot: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const organizationContext = require('@/contexts/OrganizationContext') as {
  useOrganization: jest.Mock;
};

const ORG_A = 'org-a';
const ORG_B = 'org-b';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** An answer that is unmistakably about one organization. */
function responseFor(organizationId: string, question: string): CopilotResponse {
  return {
    organizationId,
    question,
    intent: 'attention',
    summary: `${organizationId} has two overdue tasks.`,
    keyPoints: [],
    recommendations: [],
    references: [],
    dataGaps: [],
    provider: 'openai',
    model: 'test-model',
    configId: `${organizationId}-config`,
    requestedAt: '2026-09-27T09:30:00.000Z',
    structured: true,
  };
}

function renderHook(organizationId: string | null, role: OrganizationRole = 'manager') {
  const results: UseCopilotResult[] = [];

  /*
   * The context is mocked from mutable closure variables rather than from the `Probe`
   * props, because a `mockImplementation` set once cannot see a later `renderer.update`.
   * The alternative — remocking on every switch — would rebuild the mock between the
   * update and the render it exists to drive, which is the part under test.
   */
  let currentOrganizationId = organizationId;
  let currentRole: OrganizationRole = role;

  organizationContext.useOrganization.mockImplementation(
    (): { organization: OrganizationRow | null; role: OrganizationRole | null } => ({
      organization:
        currentOrganizationId === null ? null : ({ id: currentOrganizationId } as unknown as OrganizationRow),
      role: currentRole,
    }),
  );

  function Probe() {
    results.push(useCopilot());
    return null;
  }

  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Probe />);
  });

  return {
    latest: (): UseCopilotResult => {
      const value = results[results.length - 1];
      if (value === undefined) throw new Error('the hook never rendered');
      return value;
    },
    switchTo: (id: string | null, as: OrganizationRole = role): void => {
      currentOrganizationId = id;
      currentRole = as;
      act(() => {
        renderer.update(<Probe />);
      });
    },
    ask: async (question: string): Promise<void> => {
      await act(async () => {
        await results[results.length - 1]?.ask(question);
      });
    },
    clear: (): void => {
      act(() => {
        results[results.length - 1]?.clear();
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
  jest.clearAllMocks();
  copilotService.askCopilot.mockResolvedValue(ok(responseFor(ORG_A, 'What needs my attention?')));
});

// ---------------------------------------------------------------------------
// 1. The switch
// ---------------------------------------------------------------------------

describe('useCopilot — the organization switch', () => {
  it('shows nothing from the previous organization the moment the new one is selected', async () => {
    const hook = renderHook(ORG_A);
    await hook.ask('What needs my attention?');

    expect(hook.latest().turns).toHaveLength(1);
    expect(hook.latest().turns[0]?.response?.organizationId).toBe(ORG_A);

    hook.switchTo(ORG_B);

    // Before B has answered anything. A's answer is a complete, confident paragraph
    // naming A's overdue tasks — the exact thing that must not sit under B's header.
    expect(hook.latest().turns).toHaveLength(0);
  });

  it('ignores a slow answer for the organization the user already left', async () => {
    const slowA = deferred<ReturnType<typeof ok<CopilotResponse>>>();
    copilotService.askCopilot.mockReturnValueOnce(slowA.promise);

    const hook = renderHook(ORG_A);

    // A's question is issued and left in flight. Not awaited — awaiting it is the whole
    // mistake this test exists to avoid, since the point is that it is still open.
    await act(async () => {
      void hook.latest().ask('What needs my attention?');
    });
    expect(hook.latest().turns[0]?.status).toBe('pending');

    // Switch to B, which answers immediately.
    copilotService.askCopilot.mockResolvedValue(ok(responseFor(ORG_B, 'What needs my attention?')));
    hook.switchTo(ORG_B);
    await hook.ask('What needs my attention?');

    expect(hook.latest().turns).toHaveLength(1);
    expect(hook.latest().turns[0]?.response?.organizationId).toBe(ORG_B);

    // A finally lands, perfectly well-formed, and must be discarded.
    await act(async () => {
      slowA.resolve(ok(responseFor(ORG_A, 'What needs my attention?')));
    });
    await flush();

    const after = hook.latest();
    expect(after.turns).toHaveLength(1);
    expect(after.turns[0]?.response?.organizationId).toBe(ORG_B);
  });

  it('ignores a slow refusal for the organization the user already left', async () => {
    // The nastier ordering: A's question is refused after B has a good answer. Storing
    // the last error regardless of tenant would replace a working screen with an error
    // card about a workspace the user is no longer in.
    const slowRefusalA = deferred<ReturnType<typeof err>>();
    copilotService.askCopilot.mockReturnValueOnce(slowRefusalA.promise);

    const hook = renderHook(ORG_A);
    await act(async () => {
      void hook.latest().ask('What needs my attention?');
    });

    copilotService.askCopilot.mockResolvedValue(ok(responseFor(ORG_B, 'Who is busiest?')));
    hook.switchTo(ORG_B);
    await hook.ask('Who is busiest?');

    expect(hook.latest().turns[0]?.status).toBe('answered');

    await act(async () => {
      slowRefusalA.resolve(
        err(appError('AI_PROVIDER_NOT_CONFIGURED', 'No provider for this organization.', {})),
      );
    });
    await flush();

    const after = hook.latest();
    expect(after.turns).toHaveLength(1);
    expect(after.turns[0]?.status).toBe('answered');
    expect(after.turns[0]?.error).toBeNull();
  });

  it('never sends a question for an organization the user is not in', async () => {
    const hook = renderHook(null);
    await hook.ask('What needs my attention?');

    expect(copilotService.askCopilot).not.toHaveBeenCalled();
    expect(hook.latest().turns).toHaveLength(0);
    expect(hook.latest().canAsk).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The role change
// ---------------------------------------------------------------------------

describe('useCopilot — a role change', () => {
  it('hides a turn whose answer used figures the new role may not see', async () => {
    // An answer produced with workload figures is a disclosure to somebody who has just
    // been demoted, and the rest of the product stops showing that panel for exactly that
    // reason. The conversation is not "wrong" — it is about data this viewer no longer has.
    const hook = renderHook(ORG_A, 'manager');
    await hook.ask('Who is carrying the heaviest workload?');

    expect(hook.latest().turns).toHaveLength(1);

    hook.switchTo(ORG_A, 'member');

    expect(hook.latest().turns).toHaveLength(0);
  });

  it('asks with the role the viewer holds at the time', async () => {
    const hook = renderHook(ORG_A, 'member');
    await hook.ask('Who is carrying the heaviest workload?');

    expect(copilotService.askCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A, viewerRole: 'member' }),
      expect.objectContaining({ asOf: expect.any(String), requestedAt: expect.any(String) }),
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The transcript
// ---------------------------------------------------------------------------

describe('useCopilot — the transcript', () => {
  it('lands two answers in their own turns even when they resolve out of order', async () => {
    const first = deferred<ReturnType<typeof ok<CopilotResponse>>>();
    const second = deferred<ReturnType<typeof ok<CopilotResponse>>>();
    copilotService.askCopilot.mockReturnValueOnce(first.promise);
    copilotService.askCopilot.mockReturnValueOnce(second.promise);

    const hook = renderHook(ORG_A);

    // Asked sequentially, and left pending: the second question is issued while the first
    // is still with the model.
    await act(async () => {
      void hook.latest().ask('What needs my attention?');
    });
    await act(async () => {
      void hook.latest().ask('How is progress on our projects?');
    });

    expect(hook.latest().turns.map((turn) => turn.status)).toEqual(['pending', 'pending']);

    // The second answer lands first, as it would with two requests in flight.
    await act(async () => {
      second.resolve(ok(responseFor(ORG_A, 'How is progress on our projects?')));
    });
    await act(async () => {
      first.resolve(ok(responseFor(ORG_A, 'What needs my attention?')));
    });

    const turns = hook.latest().turns;
    expect(turns).toHaveLength(2);
    // Each answer is under its own question. A message-pair model would render these in
    // resolution order and produce a transcript of a conversation nobody had.
    expect(turns[0]?.question).toBe('What needs my attention?');
    expect(turns[0]?.response?.question).toBe('What needs my attention?');
    expect(turns[1]?.question).toBe('How is progress on our projects?');
    expect(turns[1]?.response?.question).toBe('How is progress on our projects?');
  });

  it('keeps a refusal under the question that caused it', async () => {
    copilotService.askCopilot.mockResolvedValue(
      err(
        appError('AI_PROVIDER_NOT_CONFIGURED', 'No provider configured.', {
          userMessage: 'AI provider is not configured for this organization.',
        }),
      ),
    );

    const hook = renderHook(ORG_A);
    await hook.ask('What needs my attention?');

    const turn = hook.latest().turns[0];
    expect(turn?.status).toBe('refused');
    expect(turn?.question).toBe('What needs my attention?');
    expect(turn?.error).toBe('AI provider is not configured for this organization.');
    expect(turn?.response).toBeNull();
  });

  it('discards a pending answer when the transcript is cleared', async () => {
    const slow = deferred<ReturnType<typeof ok<CopilotResponse>>>();
    copilotService.askCopilot.mockReturnValueOnce(slow.promise);

    const hook = renderHook(ORG_A);
    await act(async () => {
      void hook.latest().ask('What needs my attention?');
    });

    expect(hook.latest().turns).toHaveLength(1);
    hook.clear();
    expect(hook.latest().turns).toHaveLength(0);

    await act(async () => {
      slow.resolve(ok(responseFor(ORG_A, 'What needs my attention?')));
    });

    expect(hook.latest().turns).toHaveLength(0);
  });

  it('ignores an empty question without calling the service', async () => {
    const hook = renderHook(ORG_A);
    await hook.ask('   ');

    expect(copilotService.askCopilot).not.toHaveBeenCalled();
    expect(hook.latest().turns).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. The send control
// ---------------------------------------------------------------------------

describe('useCopilot — while a question is in flight', () => {
  it('does not allow a second question, and says so', async () => {
    const slow = deferred<ReturnType<typeof ok<CopilotResponse>>>();
    copilotService.askCopilot.mockReturnValueOnce(slow.promise);

    const hook = renderHook(ORG_A);
    expect(hook.latest().canAsk).toBe(true);

    await act(async () => {
      void hook.latest().ask('What needs my attention?');
    });

    expect(hook.latest().isAsking).toBe(true);
    expect(hook.latest().canAsk).toBe(false);

    await act(async () => {
      slow.resolve(ok(responseFor(ORG_A, 'What needs my attention?')));
    });

    expect(hook.latest().isAsking).toBe(false);
    expect(hook.latest().canAsk).toBe(true);
  });

  it('offers questions that are not a context read', () => {
    const hook = renderHook(ORG_A);
    // No service call, no database read: the suggestions are fixed strings precisely so
    // that opening the screen does not spend a context build on a question nobody asked.
    expect(hook.latest().suggestedQuestions.length).toBeGreaterThan(0);
    expect(copilotService.askCopilot).not.toHaveBeenCalled();
  });
});
