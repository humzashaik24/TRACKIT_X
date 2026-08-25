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
 */
import { useCallback, useEffect, useState } from 'react';

import * as organizations from '@/services/organizationService';
import type { AppError } from '@/utils/errors';

export type SnapshotStatus = 'loading' | 'ready' | 'error';

export interface WorkforceSnapshot {
  readonly status: SnapshotStatus;
  /** People with access to this organization. `null` unless `status === 'ready'`. */
  readonly memberCount: number | null;
  /** Present only while `status === 'error'`. Render `userMessage`. */
  readonly error: AppError | null;
  refresh(): Promise<void>;
}

export function useWorkforceSnapshot(organizationId: string | null): WorkforceSnapshot {
  const [status, setStatus] = useState<SnapshotStatus>('loading');
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (organizationId === null) {
      // No organization selected yet. Not an error — there is simply nothing to
      // count, and reporting a failure here would be noise during startup.
      setStatus('loading');
      setMemberCount(null);
      setError(null);
      return;
    }

    setStatus('loading');
    setError(null);

    const result = await organizations.countMembers(organizationId);
    if (!result.ok) {
      setError(result.error);
      setMemberCount(null);
      setStatus('error');
      return;
    }

    setMemberCount(result.value);
    setStatus('ready');
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { status, memberCount, error, refresh: load };
}
