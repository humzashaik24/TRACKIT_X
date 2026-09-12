/**
 * Notification model — the state machine the notification centre renders.
 *
 * The interesting guarantees: an error feed contributes ZERO to the unread
 * badge (an unread count over a failed read would be a number nobody can
 * trust), and every feed state maps to exactly one presentation.
 */
import {
  hasUnread,
  NOTIFICATION_KIND_LABELS,
  unreadCountOf,
  viewOf,
  type AppNotification,
  type NotificationFeedState,
} from '@/features/notifications/model';

const sampleItem: AppNotification = {
  id: 'n1',
  kind: 'alert',
  title: 'Stock is low',
  body: 'Reorder before Friday.',
  createdAt: '2026-09-12T10:00:00Z',
  read: false,
};

describe('unreadCountOf', () => {
  it('reads the count off ready and empty feeds', () => {
    expect(unreadCountOf({ status: 'empty', unreadCount: 0 })).toBe(0);
    expect(unreadCountOf({ status: 'ready', unreadCount: 3, items: [sampleItem] })).toBe(3);
  });

  it('never reports unread over a failed read', () => {
    expect(unreadCountOf({ status: 'error', message: 'x' })).toBe(0);
  });

  it('treats loading as zero so no dot flashes during a refresh', () => {
    expect(unreadCountOf({ status: 'loading', unreadCount: 0 })).toBe(0);
  });
});

describe('hasUnread', () => {
  it('is true only when the badge should show', () => {
    expect(hasUnread({ status: 'ready', unreadCount: 1, items: [] })).toBe(true);
    expect(hasUnread({ status: 'empty', unreadCount: 0 })).toBe(false);
    expect(hasUnread({ status: 'error', message: 'x' })).toBe(false);
  });
});

describe('viewOf', () => {
  it('renders each state as exactly one presentation', () => {
    const states: readonly NotificationFeedState[] = [
      { status: 'loading', unreadCount: 0 },
      { status: 'error', message: 'We could not load notifications.' },
      { status: 'empty', unreadCount: 0 },
      { status: 'ready', unreadCount: 1, items: [sampleItem] },
    ];
    expect(states.map(viewOf).map((view) => view.kind)).toEqual([
      'loading',
      'error',
      'empty',
      'ready',
    ]);
  });

  it('keeps the error copy the UI is allowed to render', () => {
    const view = viewOf({ status: 'error', message: 'safe copy' });
    expect(view.kind === 'error' && view.message).toBe('safe copy');
  });

  it('exposes items only for a ready feed', () => {
    const view = viewOf({ status: 'ready', unreadCount: 1, items: [sampleItem] });
    expect(view.kind === 'ready' && view.items).toEqual([sampleItem]);
  });
});

describe('NOTIFICATION_KIND_LABELS', () => {
  it('labels every notification kind', () => {
    for (const kind of ['alert', 'mention', 'approval', 'system'] as const) {
      expect(NOTIFICATION_KIND_LABELS[kind].length).toBeGreaterThan(0);
    }
  });
});