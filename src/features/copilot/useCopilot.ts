/**
 * Trackit X — the Copilot conversation hook.
 *
 * Owns one in-memory transcript and nothing else. There is no conversation table, no
 * history to page through and no answer stored on the server: an AI answer is a reading
 * of the business as it was at a moment, and persisting one invites it to be quoted later
 * as though it were a record. A conversation that disappears when the screen closes is
 * the honest version of this feature.
 *
 * ── The model: turns, not messages ──────────────────────────────────────────────
 * A turn is a question and the answer beneath it, including the case where there is no
 * answer. Modelling it as a question message plus a separate answer message makes the
 * in-flight case a third thing to represent, and leaves nothing to hang a refusal on —
 * and the refusal is the state that matters, because "AI provider is not configured for
 * this organization" has to appear under the question that caused it.
 *
 * ── Every rule below is about one failure ───────────────────────────────────────
 * Organization A's business rendered under organization B's name. Nothing about a late
 * response reveals that it is wrong: it arrives perfectly well-formed, with A's projects
 * and A's people's names, and there is no error in it to notice. So the protection has
 * to be structural rather than a matter of noticing.
 *
 *  1. TURNS CARRY THE ORGANIZATION THEY WERE ASKED IN, and visibility is derived by
 *     comparison. A turn is rendered only when its organization is the one in view, so
 *     the render that shows B's header cannot show A's transcript. The reset below also
 *     discards them, but that is tidiness — the comparison is the guarantee.
 *  2. A TURN ALSO CARRIES THE ROLE IT WAS ANSWERED UNDER. A demotion happens without the
 *     tenant moving, and an answer produced with workload figures is not something to
 *     leave on screen for a viewer who no longer has the panel that shows them. Hiding
 *     the whole turn is the honest response: the question and its answer were both about
 *     data this viewer may no longer see.
 *  3. AN ANSWER IS PATCHED INTO ITS OWN TURN, BY ID. A response resolving after the
 *     organization changed finds no turn with that id and does nothing. Two answers
 *     resolving out of order land in their own turns rather than interleaving into a
 *     transcript that is not the conversation that happened.
 *
 * There is no `AbortController` and no cancellation flag, and both absences are
 * deliberate. By the time the user switches workspaces the model call has been made and
 * paid for; cancelling the fetch would only stop the response being *read*. What has to
 * be prevented is the answer being shown, and rule 1 prevents it by construction — there
 * is nothing to cancel because nothing is ever written into a turn that is not there.
 */
import { useCallback, useMemo, useState } from 'react';

import { useOrganization } from '@/contexts/OrganizationContext';
import type { CopilotResponse } from '@/domain/ai/copilot';
import { todayKey } from '@/features/projects/useProjects';
import { askCopilot } from '@/services/copilotService';
import type { OrganizationRole } from '@/types/database';
import { userMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'useCopilot' });

// ---------------------------------------------------------------------------
// The transcript
// ---------------------------------------------------------------------------

/**
 * Where a turn got to.
 *
 * `discarded` is a real state rather than an absence, and it is reachable: a question
 * asked in organization A whose answer arrives after the switch to B leaves a turn that
 * will never be rendered. The distinction matters only for the log, and it is worth
 * having there — "the answer was thrown away" and "the answer never came back" are
 * different events and only one of them is a tenant-boundary save.
 */
export type CopilotTurnStatus = 'pending' | 'answered' | 'refused' | 'discarded';

export interface CopilotTurn {
  readonly id: string;
  /** The organization this was asked in. Compared during render, never trusted blindly. */
  readonly organizationId: string;
  /** The viewer's role when it was asked. A demotion hides the turn. */
  readonly role: OrganizationRole | null;
  /** What was typed, exactly. */
  readonly question: string;
  readonly status: CopilotTurnStatus;
  /** Present only when `status === 'answered'`. */
  readonly response: CopilotResponse | null;
  /** Present only when `status === 'refused'`. Already a safe, user-facing sentence. */
  readonly error: string | null;
}

interface CopilotState {
  readonly organizationId: string | null;
  readonly turns: readonly CopilotTurn[];
}

const EMPTY: CopilotState = { organizationId: null, turns: [] };

/**
 * Questions offered before anything has been asked.
 *
 * Fixed strings rather than anything derived from the organization, for two reasons. A
 * suggestion that reads the database is a context read on a screen that has not asked a
 * question yet, and a list that changes with the data cannot be tested. These are the
 * questions a delivery workspace actually gets asked, and each names its own subject so
 * the intent it maps to is unambiguous.
 */
export const COPILOT_SUGGESTED_QUESTIONS: readonly string[] = [
  'What needs my attention?',
  'Who is carrying the heaviest workload?',
  'How is progress on our projects?',
  'What is the status of our projects?',
];

export interface UseCopilotResult {
  /** Only turns belonging to the organization and role currently in view. */
  readonly turns: readonly CopilotTurn[];
  readonly isAsking: boolean;
  /** False with no organization, or while a question is in flight. */
  readonly canAsk: boolean;
  ask(question: string): Promise<void>;
  clear(): void;
  readonly suggestedQuestions: readonly string[];
}

export function useCopilot(): UseCopilotResult {
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const [state, setState] = useState<CopilotState>(EMPTY);

  /*
   * The organization switch, handled during render.
   *
   * An effect would run one commit too late: the render that shows B's header would
   * still hold A's transcript, and that single frame is the whole bug. Adjusting state
   * during render is the documented alternative for a value that changed — React re-runs
   * the component immediately with the new state and discards the in-progress output, so
   * no child ever sees the old array. The visibility filter below is the guarantee; this
   * is what stops A's answers sitting in memory for the life of the component.
   *
   * `role` is deliberately not stamped here. A demotion must hide a turn, not re-key the
   * transcript, so it is compared when rendering rather than when storing.
   */
  if (state.organizationId !== organizationId) {
    setState({ organizationId, turns: [] });
  }

  /*
   * Visibility, derived rather than stored.
   *
   * `state.organizationId` and `state.role`-stamped turns are the raw material; what is
   * rendered is what still belongs to this viewer in this workspace. Deriving means a
   * switch needs no cleanup to be correct — the answer to "can a stale turn be painted?"
   * is decided by a comparison on every render, not by whether a cleanup happened to run
   * first.
   */
  const turns = useMemo(
    () => state.turns.filter((turn) => turn.organizationId === organizationId && turn.role === role),
    [organizationId, role, state.turns],
  );

  const isAsking = turns.some((turn) => turn.status === 'pending');

  const ask = useCallback(
    async (question: string): Promise<void> => {
      if (organizationId === null) return;
      const trimmed = question.trim();
      if (trimmed.length === 0) return;

      const requestedOrganizationId = organizationId;
      const requestedRole = role;
      // Unique without a ref: the organization, the millisecond, and the turn's position.
      // A ref would have to be written during render for the reset above, which the React
      // compiler's rules rightly forbid, and a turn that is never rendered does not need
      // a counter to be identifiable.
      const turnId = `${requestedOrganizationId}-${requestedRole ?? 'none'}-${Date.now()}-${state.turns.length}`;

      setState((current) =>
        current.organizationId === requestedOrganizationId
          ? {
              organizationId: current.organizationId,
              turns: [
                ...current.turns,
                {
                  id: turnId,
                  organizationId: requestedOrganizationId,
                  role: requestedRole,
                  question: trimmed,
                  status: 'pending',
                  response: null,
                  error: null,
                },
              ],
            }
          : current,
      );

      const result = await askCopilot(
        { organizationId: requestedOrganizationId, question: trimmed, viewerRole: requestedRole },
        // `todayKey` is the same reference date the dashboard uses, so a Copilot's "four
        // overdue" and the dashboard's "4" are one statement about one day rather than
        // two calculations that could disagree.
        { asOf: todayKey(), requestedAt: new Date().toISOString() },
      );

      setState((current) => {
        // The organization moved, or this turn was cleared, while the model was thinking.
        // There is no turn with this id to patch, so the answer is dropped — and it is
        // well-formed, so nothing else would have flagged it.
        const index = current.turns.findIndex((turn) => turn.id === turnId);
        if (index === -1) {
          log.info('Discarded a Copilot answer for a turn that is no longer held', {
            organizationId: requestedOrganizationId,
          });
          return current;
        }

        const turn = current.turns[index];
        if (turn === undefined) return current;

        const settled: CopilotTurn = result.ok
          ? { ...turn, status: 'answered', response: result.value, error: null }
          : { ...turn, status: 'refused', response: null, error: userMessage(result.error) };

        if (!result.ok) {
          log.warn('Copilot question refused', {
            organizationId: requestedOrganizationId,
            code: result.error.code,
          });
        }

        const turns = [...current.turns];
        turns[index] = settled;
        return { ...current, turns };
      });
    },
    [organizationId, role, state.turns.length],
  );

  const clear = useCallback((): void => {
    // Every in-flight answer finds no turn to patch, which is the cancellation. No flag
    // and no abort: the work has already been paid for, and the turn is what it would
    // have been written into.
    setState((current) => ({ ...current, turns: [] }));
  }, []);

  const canAsk = useMemo(() => organizationId !== null && !isAsking, [organizationId, isAsking]);

  return {
    turns,
    isAsking,
    canAsk,
    ask,
    clear,
    suggestedQuestions: COPILOT_SUGGESTED_QUESTIONS,
  };
}
