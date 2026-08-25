/**
 * Trackit X — navigation destinations.
 *
 * One table, read by both the compact bottom bar and the wide sidebar, so the two
 * chrome variants cannot drift apart.
 *
 * ── `ready` is a promise about honesty, not a feature flag ───────────────────
 * Phase 1 ships one working destination. The other five are present because the
 * information architecture is decided, and hiding them would misrepresent the
 * product's shape — but each one says plainly that it is not built yet. A tab that
 * looks finished and shows an empty list is indistinguishable, to a user, from a
 * business with no projects. That is the failure mode this flag exists to prevent.
 */
import type { IconName } from '@/design-system';

export interface Destination {
  /** Route path. Groups are transparent in Expo Router, so no `(app)` prefix. */
  readonly path: string;
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

export const destinations: readonly Destination[] = [
  {
    path: '/dashboard',
    label: 'Home',
    longLabel: 'Dashboard',
    icon: 'dashboard',
    ready: true,
    summary: 'Business health, today’s focus and live signals across the business.',
    arrivesIn: 'Available now',
  },
  {
    path: '/projects',
    label: 'Projects',
    longLabel: 'Projects',
    icon: 'projects',
    ready: false,
    summary:
      'Jobs, sites and orders with budgets, milestones and the people assigned to each.',
    arrivesIn: 'Phase 2',
  },
  {
    path: '/tasks',
    label: 'Tasks',
    longLabel: 'Tasks',
    icon: 'tasks',
    ready: false,
    summary: 'Work assigned to a person or a team, with due dates and dependencies.',
    arrivesIn: 'Phase 2',
  },
  {
    path: '/employees',
    label: 'People',
    longLabel: 'Employees',
    icon: 'employees',
    ready: false,
    summary: 'Your workforce: roles, skills, wage basis, attendance and documents.',
    arrivesIn: 'Phase 2',
  },
  {
    path: '/ai',
    label: 'AI',
    longLabel: 'AI assistant',
    icon: 'ai',
    ready: false,
    summary:
      'Ask questions about your own data and get answers grounded in it — never invented.',
    arrivesIn: 'A later phase',
  },
  {
    path: '/more',
    label: 'More',
    longLabel: 'More',
    icon: 'more',
    ready: true,
    summary: 'Organization details, appearance and account.',
    arrivesIn: 'Available now',
  },
];

/**
 * Which destination a pathname belongs to.
 *
 * Prefix matching, not equality, so a future detail route (`/projects/42`) still
 * highlights its parent tab. Ordered longest-first so `/projects` cannot win a
 * match that `/projects-archive` should have had.
 */
export function activeDestination(pathname: string): Destination | undefined {
  return [...destinations]
    .sort((a, b) => b.path.length - a.path.length)
    .find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`));
}

export function destinationFor(path: string): Destination | undefined {
  return destinations.find((entry) => entry.path === path);
}
