/**
 * Trackit X — notification model.
 *
 * The CONTRACT the notification centre UI renders against. Pure: no React, no
 * Supabase, no I/O, so the state machine below is unit-testable without a
 * renderer or a database.
 *
 * ── Why the feed is a discriminated union ────────────────────────────────────
 * An empty feed, a feed that failed to load, and a feed that is still loading
 * are different UI states with different copy and different affordances.
 * Collapsing them into "an array of rows" is how a notification centre ends up
 * flashing "no notifications" over a network error.
 *
 * ── Phase 29 honesty ───────────────────────────────────────────────────────
 * There is no notification table yet, so the hook that owns a feed returns
 * `empty` unconditionally — a real state with real copy, not a mock feed.
 * When the backend arrives it swaps what the feed holds; this file does not
 * change.
 */
export type NotificationKind = 'alert' | 'mention' | 'approval' | 'system';

export interface AppNotification {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  /** One-line detail. Longer explanations belong on the detail screen. */
  readonly body?: string;
  /** ISO 8601. Serially derived from server time — never the device clock. */
  readonly createdAt: string;
  readonly read: boolean;
  /** Where "open this" goes. Absent when the item has no destination yet. */
  readonly actionPath?: string;
}

export type NotificationFeedState =
  | { readonly status: 'loading'; readonly unreadCount: number }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'empty'; readonly unreadCount: number }
  | {
      readonly status: 'ready';
      readonly unreadCount: number;
      readonly items: readonly AppNotification[];
    };

/** Every feed state has a count, so the header badge never needs a branch. */
export function unreadCountOf(feed: NotificationFeedState): number {
  return feed.status === 'error' ? 0 : feed.unreadCount;
}

/** Whether the header bell should show its dot. */
export function hasUnread(feed: NotificationFeedState): boolean {
  return unreadCountOf(feed) > 0;
}

/** The presentation a state deserves — one statement the UI can render. */
export type NotificationView =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly items: readonly AppNotification[]; readonly unreadCount: number };

/**
 * Maps a feed to the minimum a rendering component needs, so the component
 * itself never branches on `status` strings.
 */
export function viewOf(feed: NotificationFeedState): NotificationView {
  switch (feed.status) {
    case 'loading':
      return { kind: 'loading' };
    case 'error':
      return { kind: 'error', message: feed.message };
    case 'empty':
      return { kind: 'empty' };
    case 'ready':
      return { kind: 'ready', items: feed.items, unreadCount: feed.unreadCount };
  }
}

/** Presentation label for a notification, never used as a colour signal. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  alert: 'Alert',
  mention: 'Mention',
  approval: 'Approval',
  system: 'System',
};

/**
 * A notification's `actionPath` is a string that scrolls out of the server, so it
 * is NOT a Href. Before the centre navigates on it, this decides whether it is any
 * of the destinations this app actually serves. Anything else ("open this page",
 * arbitrary keys, paths with credentials) is refused: pushing an unknown string
 * into the router both crashes the happy path and creates a tiny phishing
 * surface — a malicious push could otherwise land a user on a screen they were
 * never trying to reach.
 *
 * The allowlist is deliberately small and structural: every real destination the
 * app can currently serve is one of the four route families.
 */
export type NotificationDestination =
  | { readonly ok: true; readonly raw: string; readonly path: string }
  | { readonly ok: false; readonly raw: string };

export function notificationDestination(actionPath: string): NotificationDestination {
  // Only relative paths that the router can open are accepted. Scheme-prefixed
  // strings (mailto:, https:, custom schemes) are refused outright.
  if (!actionPath.startsWith('/') || actionPath.startsWith('//')) {
    return { ok: false, raw: actionPath };
  }

  let id: string | undefined;
  const matchesId = (segment: string): boolean => {
    id = segment;
    return /^[0-9a-zA-Z][0-9a-zA-Z-_]*$/.test(segment);
  };

  const segments = actionPath.split('/').filter((part) => part.length > 0);
  const [first = '', second, third] = segments;

  if (
    (first === 'projects') &&
    second !== undefined &&
    third === undefined &&
    matchesId(second)
  ) {
    return { ok: true, raw: actionPath, path: `/projects/${id as string}` };
  }
  if (
    (first === 'tasks') &&
    second !== undefined &&
    third === undefined &&
    matchesId(second)
  ) {
    return { ok: true, raw: actionPath, path: `/tasks/${id as string}` };
  }
  if (first === 'more') {
    return { ok: true, raw: actionPath, path: '/more' };
  }
  if (first === 'reports') {
    return { ok: true, raw: actionPath, path: '/reports' };
  }

  return { ok: false, raw: actionPath };
}