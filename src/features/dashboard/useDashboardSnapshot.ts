/**
 * Trackit X — the dashboard snapshot hook.
 *
 * The React binding around `buildDashboardSnapshot` and `dashboardService`. Two rules
 * make it safe, and both are inherited from the Phase 32/33 hooks rather than invented
 * here:
 *
 *  1. THE LOAD IS STAMPED WITH ITS ORGANIZATION, and the stamp is compared during
 *     render. Switching workspaces therefore discards the previous tenant's figures
 *     on the very render that the new organization's name appears — not in an effect
 *     afterwards, which would leave one frame showing organization A's numbers under
 *     organization B's header. That single frame is the whole bug Phase 32 was written
 *     to prevent, and it is invisible in a screenshot taken after the network settles.
 *  2. A RESPONSE THAT ARRIVES FOR AN ORGANIZATION THE CALLER HAS LEFT IS DISCARDED.
 *     The `cancelled` flag is set by the effect cleanup, so a slow request for A that
 *     lands after the switch to B is dropped rather than committed. Every read is
 *     `.eq('organization_id', …)` and RLS-filtered, so a late response is perfectly
 *     well-formed — there is no error in it to notice. The tag comparison is the only
 *     thing standing between that and a tenant leak rendered as ordinary data.
 *
 * ── Why the role is an argument and not part of the load's identity ─────────────
 * `role` decides whether the per-person workload is computed at all, and a role can
 * change inside one organization: an admin promotes somebody, or the caller is demoted,
 * without the tenant moving. Storing facts and deriving per render means a role change
 * re-derives the snapshot from data already in memory, with no refetch — and, more
 * importantly, means a demotion cannot leave a previously-derived workload sitting in
 * state where the next render would show it. Tagging the load on the role instead would
 * make a privilege change look like a tenant change.
 *
 * Note the asymmetry that follows: the *facts* are org-stamped, and the *role* is a
 * live input to derivation. A stale-organization response is rejected; a stale role is
 * simply not used, because the current one is read on every render.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { OrganizationRole } from '@/types/database';
import { userMessage } from '@/utils/errors';

import { todayKey } from '@/features/projects/useProjects';
import {
  countOrganizationMembers,
  readDashboardFacts,
  type DashboardFacts,
} from '@/services/dashboardService';

import { buildDashboardSnapshot, type DashboardSnapshot } from './metrics';

export type { DashboardSnapshot };

export type DashboardStatus = 'loading' | 'ready' | 'error';

/**
 * A completed read, stamped with the organization it was read for.
 *
 * `accessHolders` is allowed to be `null` on an otherwise successful read, and that is
 * the difference between "nobody has access" — which cannot happen, since the caller
 * is a member — and "the count did not come back". Collapsing them would put a
 * confident 0 on the dashboard next to a real headcount.
 */
interface DashboardLoad {
  readonly organizationId: string;
  readonly facts: DashboardFacts;
  readonly accessHolders: number | null;
}

interface DashboardLoadState {
  /**
   * `null` only in the initial state.
   *
   * A null here is what makes the freshness comparison fail against any real
   * organization id, which is how the first render after mount reads as loading rather
   * than as a ready snapshot of nothing.
   */
  readonly organizationId: string | null;
  readonly load: DashboardLoad | null;
  readonly error: string | null;
}

const UNREAD: DashboardLoadState = { organizationId: null, load: null, error: null };

export interface DashboardSnapshotState {
  readonly status: DashboardStatus;
  /** `null` unless `status === 'ready'`. */
  readonly snapshot: DashboardSnapshot | null;
  /** Present only while `status === 'error'`. Already a safe, user-facing sentence. */
  readonly error: string | null;
  /**
   * True while a `refresh()` is in flight over a snapshot already on screen.
   *
   * Separate from `status` for the same reason `SnapshotView.isRefreshing` is: a
   * pull-to-refresh must not replace a good set of figures with a page of skeletons.
   */
  readonly isRefreshing: boolean;
  /** The reference date every relative figure was computed against. */
  readonly today: string;
  refresh(): Promise<void>;
}

export function useDashboardSnapshot(
  organizationId: string | null,
  role: OrganizationRole | null,
): DashboardSnapshotState {
  const [state, setState] = useState<DashboardLoadState>(UNREAD);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Resolved once per mount rather than per render. `todayKey` reads the clock, and a
  // value that changes on every render would recompute every relative figure on every
  // render and make the snapshot's `asOf` a moving target. A user who leaves the app
  // open past midnight sees yesterday's basis until they refresh, which is the same
  // trade every other screen in the product makes.
  const today = useMemo(() => todayKey(), []);

  /*
   * The freshness check, derived during render and not cleared in an effect.
   *
   * `isCurrent` is the only thing standing between the previous organization's numbers
   * and the new organization's name. Written this way — read the tag, compare, derive
   * the answer from what matched — so there is no window in which a stale value is the
   * value being rendered.
   */
  const isCurrent = state.organizationId === organizationId;
  const load = isCurrent ? state.load : null;
  const error = isCurrent ? state.error : null;

  /*
   * The snapshot is derived from the facts, not stored. That is what makes the role
   * argument safe (see the header) and it is why the work is memoised: the derivation
   * is O(rows) and would otherwise run on every render of the screen for figures that
   * cannot have changed. `role` is a dependency for the reason above — it changes the
   * answer without changing the facts.
   */
  const snapshot = useMemo(() => {
    if (load === null) return null;
    return buildDashboardSnapshot(load.facts, {
      organizationId: load.organizationId,
      asOf: today,
      role,
      accessHolders: load.accessHolders,
    });
  }, [load, role, today]);

  useEffect(() => {
    if (organizationId === null) return;
    let cancelled = false;

    void (async () => {
      // Both reads go out together. The member count is allowed to fail on its own —
      // it annotates the headcount rather than producing it — so it is not awaited
      // with the rest in a way that would discard good facts over a missing footnote.
      const [facts, members] = await Promise.all([
        readDashboardFacts(organizationId),
        countOrganizationMembers(organizationId),
      ]);

      if (cancelled) return;

      setState(
        facts.ok
          ? { organizationId, load: { organizationId, facts: facts.value, accessHolders: members.ok ? members.value : null }, error: null }
          : { organizationId, load: null, error: userMessage(facts.error) },
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  /**
   * Re-reads the current organization without clearing what is on screen.
   *
   * The org check inside the state updater is the same protection the read effect
   * relies on, for the same reason: a refresh issued on A and settled on B must not
   * write A's figures into B's state. It is checked again here rather than assumed,
   * because `refresh` is called from a gesture handler and has no effect cleanup to
   * do it.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;
    setIsRefreshing(true);
    try {
      const [facts, members] = await Promise.all([
        readDashboardFacts(organizationId),
        countOrganizationMembers(organizationId),
      ]);
      setState((current) => {
        if (current.organizationId !== organizationId) return current;
        if (!facts.ok) return { ...current, error: userMessage(facts.error) };
        return {
          organizationId,
          load: {
            organizationId,
            facts: facts.value,
            accessHolders: members.ok ? members.value : null,
          },
          error: null,
        };
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  /*
   * Three states, never two. A failed read is `error` and a missing one is `loading`,
   * and collapsing them is what leaves a panel spinning forever after a refused
   * request with no retry offered. A snapshot is only ever derived from facts tagged
   * with the organization in view, so `snapshot !== null` is sufficient proof that the
   * data belongs to the header it is rendered under.
   */
  const status: DashboardStatus = snapshot !== null ? 'ready' : error !== null ? 'error' : 'loading';

  return {
    status,
    snapshot,
    error: status === 'error' ? error : null,
    isRefreshing,
    today,
    refresh,
  };
}
