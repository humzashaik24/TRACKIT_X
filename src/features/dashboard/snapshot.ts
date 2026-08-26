/**
 * Trackit X — workforce snapshot logic.
 *
 * The pure half of `useWorkforceSnapshot`: what a service result means, and whether a
 * number already in state still belongs to the business currently on screen.
 *
 * Split out because the hook imports the organization service, which reaches the
 * Supabase client and the validated environment at module load. This file imports
 * nothing but types, so the rules below can be tested directly — no renderer, no
 * database, no mocks standing in for either.
 */
import type { AppError } from '@/utils/errors';
import type { ActionResult } from '@/utils/result';

export type SnapshotStatus = 'loading' | 'ready' | 'error';

/** A completed count, stamped with the organization it was counted for. */
export interface CountedFor {
  readonly organizationId: string;
  readonly memberCount: number | null;
  /** Non-null when the count failed. `memberCount` is then null and meaningless. */
  readonly error: AppError | null;
}

/** Everything the hook reports except the action — the part that is derived. */
export interface SnapshotView {
  readonly status: SnapshotStatus;
  /** People with access to this organization. `null` unless `status === 'ready'`. */
  readonly memberCount: number | null;
  /** Present only while `status === 'error'`. Render `userMessage`. */
  readonly error: AppError | null;
  /**
   * True while a `refresh()` is in flight over a count that is already on screen.
   * Separate from `status` so a pull-to-refresh does not replace a good number with
   * a skeleton — the number stays, and the platform spinner carries the progress.
   */
  readonly isRefreshing: boolean;
}

/**
 * Turns a service result into the state to commit.
 *
 * Shared by both the read-on-mount and the explicit refresh, so the two paths cannot
 * disagree about what a failed count looks like.
 */
export function toCounted(organizationId: string, result: ActionResult<number>): CountedFor {
  return result.ok
    ? { organizationId, memberCount: result.value, error: null }
    : { organizationId, memberCount: null, error: result.error };
}

/**
 * Turns a committed count into what the panel renders.
 *
 * The organization comparison is the whole point of this function. A count read for
 * one business is discarded the instant the active business changes — derived here
 * rather than cleared by an effect, because an effect runs *after* the render that
 * would already have shown the old number under the new name.
 *
 * A count that is absent and a count that failed are deliberately different: absent
 * is `loading` and shows a skeleton, failed is `error` and shows a retry. Collapsing
 * them would leave a permanently spinning panel after a refused request.
 */
export function deriveSnapshot(
  counted: CountedFor | null,
  organizationId: string | null,
  isRefreshing: boolean,
): SnapshotView {
  const fresh = counted !== null && counted.organizationId === organizationId ? counted : null;

  const status: SnapshotStatus =
    fresh === null ? 'loading' : fresh.error !== null ? 'error' : 'ready';

  return {
    status,
    memberCount: fresh?.memberCount ?? null,
    error: status === 'error' ? (fresh?.error ?? null) : null,
    isRefreshing,
  };
}
