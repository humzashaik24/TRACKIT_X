/**
 * Trackit X — workforce snapshot.
 *
 * Reads the ONE genuine business number that exists in Phase 1: how many people
 * have access to this organization, counted in the database.
 *
 * It is deliberately narrow. Every other figure a workforce panel would like to show
 * — who is on shift, hours this week, wage cost — depends on tables that do not
 * exist yet, and inventing any of them would make the dashboard a liar on the very
 * screen a business owner would trust most. So this hook returns a count and a
 * loading/error state, and the panel says plainly that the rest is not built.
 *
 * The count is `head: true` — no rows travel, only the number, which also means RLS
 * filters it to this organization before Postgres counts.
 *
 * The rules live in `./snapshot`; this file is the React binding around them.
 */
import { useCallback, useEffect, useState } from 'react';

import * as organizations from '@/services/organizationService';

import {
  deriveSnapshot,
  toCounted,
  type CountedFor,
  type SnapshotStatus,
  type SnapshotView,
} from './snapshot';

export { deriveSnapshot, toCounted };
export type { CountedFor, SnapshotStatus, SnapshotView };

export interface WorkforceSnapshot extends SnapshotView {
  refresh(): Promise<void>;
}

export function useWorkforceSnapshot(organizationId: string | null): WorkforceSnapshot {
  const [counted, setCounted] = useState<CountedFor | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * Reads the count when the organization changes.
   *
   * The state is committed from the promise callback rather than by awaiting a
   * function that sets it: the database is an external system answering later, and
   * setting state when it answers is the one shape that does not cascade a second
   * render pass out of the effect itself. `cancelled` covers the case where the
   * organization changes, or the screen unmounts, before the answer arrives — a count
   * for a business the user has navigated away from must never be committed.
   */
  useEffect(() => {
    if (organizationId === null) return;

    let cancelled = false;
    void organizations.countMembers(organizationId).then((result) => {
      if (cancelled) return;
      setCounted(toCounted(organizationId, result));
    });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  /**
   * Explicit refresh. Safe to set state synchronously here — this is an event
   * handler, not an effect — and the flag is what drives the pull-to-refresh
   * spinner while the existing number stays visible.
   */
  const refresh = useCallback(async (): Promise<void> => {
    if (organizationId === null) return;

    setIsRefreshing(true);
    try {
      const result = await organizations.countMembers(organizationId);
      setCounted(toCounted(organizationId, result));
    } finally {
      setIsRefreshing(false);
    }
  }, [organizationId]);

  return { ...deriveSnapshot(counted, organizationId, isRefreshing), refresh };
}
