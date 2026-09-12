/**
 * Trackit X — notification feed hook.
 *
 * Owns the ONE feed that the header bell and the notification centre both read.
 * In Phase 29 there is no notification table in the database, so the feed is
 * the honest `empty` state — never a fabricated list. The hard part of this
 * hook is not its body; it is that future backend work happens here and does
 * not touch the UI or the model above.
 */
import { useCallback, useMemo, useState } from 'react';

import {
  type NotificationFeedState,
  type NotificationView,
  unreadCountOf,
  viewOf,
} from './model';

const EMPTY_FEED: NotificationFeedState = { status: 'empty', unreadCount: 0 };

export interface NotificationFeed {
  /** What the UI renders from. */
  readonly feed: NotificationFeedState;
  /** Convenience view, pre-derived. */
  readonly view: NotificationView;
  readonly unreadCount: number;
  /** Re-reads the feed. A no-op until a backend exists. */
  refresh(): Promise<void>;
}

export function useNotifications(): NotificationFeed {
  // Until a source exists the feed stays `empty`. A future backend writes its
  // loading / error / ready states into this same state slot.
  const [feed] = useState<NotificationFeedState>(EMPTY_FEED);

  const refresh = useCallback(async (): Promise<void> => {
    // The re-read will query the notification table when one exists. Nothing
    // to do in Phase 29 — returning is the honest answer.
  }, []);

  return useMemo(
    () => ({ feed, view: viewOf(feed), unreadCount: unreadCountOf(feed), refresh }),
    [feed, refresh],
  );
}