/**
 * Trackit X — navigation destinations.
 *
 * One table, read by both the compact bottom bar and the wide sidebar, so the two
 * chrome variants cannot drift apart.
 *
 * ── `ready` is a promise about honesty, not a feature flag ───────────────────
 * Phase 1 ships two working destinations. The other four are present because the
 * information architecture is decided, and hiding them would misrepresent the
 * product's shape — but each one says plainly that it is not built yet. A tab that
 * looks finished and shows an empty list is indistinguishable, to a user, from a
 * business with no projects. That is the failure mode this flag exists to prevent.
 */
import type { IconName } from '@/design-system';

/**
 * The routes the chrome can navigate to, as literal strings.
 *
 * A union rather than `string`, so `router.replace(destination.path)` is checked
 * against Expo Router's generated route union: a destination pointing at a file that
 * does not exist becomes a compile error rather than a tab that silently does nothing
 * when tapped. This is the one place that guarantee can be installed, because every
 * navigation the shell performs comes from this table.
 */
export type DestinationPath =
  | '/dashboard'
  | '/projects'
  | '/tasks'
  | '/employees'
  | '/ai'
  | '/more';

/** Everything about a destination except where it lives. */
export interface DestinationMeta {
  /** Bottom-bar label. Kept to one short word — it sits under a 24px icon. */
  readonly label: string;
  /** Sidebar label, where there is room for the full name. */
  readonly longLabel: string;
  readonly icon: IconName;
  /** False while the destination is a "coming next" placeholder. */
  readonly ready: boolean;
  /** What this destination will do. Shown on the placeholder screen. */
  readonly summary: string;
  /** Which phase builds it, so the placeholder can say when. */
  readonly arrivesIn: string;
}

export interface Destination extends DestinationMeta {
  /** Route path. Groups are transparent in Expo Router, so no `(app)` prefix. */
  readonly path: DestinationPath;
}

/**
 * Keyed by path rather than an array of `{ path, ... }` for one reason: `Record` over
 * a literal union is exhaustive, so adding a member to `DestinationPath` without
 * describing it here is a compile error, and `destinationFor()` can return a
 * `Destination` instead of `Destination | undefined`. Five placeholder screens would
 * otherwise each carry a branch for a case that cannot happen.
 */
const META: Record<DestinationPath, DestinationMeta> = {
  '/dashboard': {
    label: 'Home',
    longLabel: 'Dashboard',
    icon: 'dashboard',
    ready: true,
    summary: 'Business health, today’s focus and live signals across the business.',
    arrivesIn: 'Available now',
  },
  '/projects': {
    label: 'Projects',
    longLabel: 'Projects',
    icon: 'projects',
    ready: false,
    summary:
      'Jobs, sites and orders with budgets, milestones and the people assigned to each.',
    arrivesIn: 'Phase 2',
  },
  '/tasks': {
    label: 'Tasks',
    longLabel: 'Tasks',
    icon: 'tasks',
    ready: false,
    summary: 'Work assigned to a person or a team, with due dates and dependencies.',
    arrivesIn: 'Phase 2',
  },
  '/employees': {
    label: 'People',
    longLabel: 'Employees',
    icon: 'employees',
    ready: false,
    summary: 'Your workforce: roles, skills, wage basis, attendance and documents.',
    arrivesIn: 'Phase 2',
  },
  '/ai': {
    label: 'AI',
    longLabel: 'AI assistant',
    icon: 'ai',
    ready: false,
    summary:
      'Ask questions about your own data and get answers grounded in it — never invented.',
    arrivesIn: 'A later phase',
  },
  '/more': {
    label: 'More',
    longLabel: 'More',
    icon: 'more',
    ready: true,
    summary: 'Organization details, appearance and account.',
    arrivesIn: 'Available now',
  },
};

/**
 * Display order, left to right in the bottom bar and top to bottom in the sidebar.
 *
 * Separate from `META` because a `Record` has no guaranteed iteration order worth
 * relying on for a user-visible layout.
 */
const ORDER: readonly DestinationPath[] = [
  '/dashboard',
  '/projects',
  '/tasks',
  '/employees',
  '/ai',
  '/more',
];

/** Every destination, in display order. */
export const destinations: readonly Destination[] = ORDER.map((path) => ({
  path,
  ...META[path],
}));

/** One destination by path. Total — `DestinationPath` is exhaustive over `META`. */
export function destinationFor(path: DestinationPath): Destination {
  return { path, ...META[path] };
}

/**
 * Which destination a pathname belongs to.
 *
 * Prefix matching, not equality, so a future detail route (`/projects/42`) still
 * highlights its parent tab. Ordered longest-first so `/projects` cannot win a
 * match that `/projects-archive` should have had.
 *
 * Returns `undefined` for a pathname outside the shell — `/reset-password`, or a
 * route that does not exist — in which case no tab is highlighted, which is correct.
 */
export function activeDestination(pathname: string): Destination | undefined {
  return [...destinations]
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`));
}
