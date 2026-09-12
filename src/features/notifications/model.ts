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