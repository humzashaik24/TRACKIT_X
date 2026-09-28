/**
 * Trackit X — navigation destinations.
 *
 * One table, read by both the compact bottom bar and the wide sidebar, so the two
 * chrome variants cannot drift apart.
 *
 * ── `ready` is a promise about honesty, not a feature flag ───────────────────
 * Only the destinations that are finished carry `ready: true`. The rest are present
 * because the information architecture is decided, and hiding them would misrepresent
 * the product's shape — but each one says plainly that it is not built yet. A tab that
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
  | '/organizations'
  | '/employees'
  | '/workforce'
  | '/projects'
  | '/tasks'
  | '/attendance'
  | '/leave'
  | '/payroll'
  | '/inventory'
  | '/procurement'
  | '/resources'
  | '/customers'
  | '/vendors'
  | '/finance'
  | '/reports'
  | '/business-health'
  | '/ai'
  | '/ai-recommendations'
  | '/ai-agents'
  | '/knowledge-base'
  | '/notifications'
  | '/settings'
  | '/more';

/**
 * The information-architecture groups the sidebar is organised by. Display order
 * is `SECTION_ORDER`, not declaration order — see below.
 */
export type DestinationSection =
  | 'main'
  | 'work'
  | 'operations'
  | 'business'
  | 'intelligence'
  | 'system';

/** Section group header labels, as shown in the sidebar. */
export const SECTION_LABELS: Record<DestinationSection, string> = {
  main: 'Main',
  work: 'Work',
  operations: 'Operations',
  business: 'Business',
  intelligence: 'Intelligence',
  system: 'System',
};

/** Sidebar display order, top to bottom. */
export const SECTION_ORDER: readonly DestinationSection[] = [
  'main',
  'work',
  'operations',
  'business',
  'intelligence',
  'system',
];

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
  /** Which sidebar group this destination belongs to. */
  readonly section: DestinationSection;
  /**
   * True when the destination also appears in the compact bottom tab bar.
   * The bar can hold only a handful — the full IA lives in the drawer there.
   */
  readonly bottomBar: boolean;
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
  // ── Main ──────────────────────────────────────────────────────────────────
  '/dashboard': {
    label: 'Home',
    longLabel: 'Dashboard',
    icon: 'dashboard',
    ready: true,
    summary: 'Business health, today’s focus and live signals across the business.',
    arrivesIn: 'Available now',
    section: 'main',
    bottomBar: true,
  },

  // ── Work ──────────────────────────────────────────────────────────────────
  '/organizations': {
    label: 'Orgs',
    longLabel: 'Workspaces',
    icon: 'organization',
    ready: true,
    summary:
      'The workspaces this account belongs to, the one it is working in, and who has access to each.',
    arrivesIn: 'Available now',
    section: 'work',
    bottomBar: false,
  },
  '/employees': {
    label: 'People',
    longLabel: 'Employees',
    icon: 'employees',
    ready: true,
    summary:
      'Your workforce: who is employed, what they do, which department they are in and who they report to.',
    arrivesIn: 'Available now',
    section: 'work',
    bottomBar: true,
  },
  '/workforce': {
    label: 'Workforce',
    longLabel: 'Workforce',
    icon: 'team',
    ready: true,
    summary:
      'Who works here and in which state: the people on the books, who has access, and how they split by employment state and department.',
    arrivesIn: 'Available now',
    section: 'work',
    bottomBar: false,
  },
  '/projects': {
    label: 'Projects',
    longLabel: 'Projects',
    icon: 'projects',
    ready: true,
    summary:
      'Jobs with a schedule, an owner and a progress figure, and the people assigned to each.',
    arrivesIn: 'Available now',
    section: 'work',
    bottomBar: true,
  },
  '/tasks': {
    label: 'Tasks',
    longLabel: 'Tasks',
    icon: 'tasks',
    ready: true,
    summary:
      'A unit of work with a status, a priority and a due date, assignable to a person or to nobody.',
    arrivesIn: 'Available now',
    section: 'work',
    bottomBar: true,
  },
  // ── Operations ────────────────────────────────────────────────────────────
  '/attendance': {
    label: 'Attendance',
    longLabel: 'Attendance',
    icon: 'attendance',
    ready: false,
    summary: 'Who was in, who was late, and what was scheduled.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },
  '/leave': {
    label: 'Leave',
    longLabel: 'Leave',
    icon: 'calendar',
    ready: false,
    summary: 'Planned time off, approvals and cover for every role.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },
  '/payroll': {
    label: 'Payroll',
    longLabel: 'Payroll',
    icon: 'payroll',
    ready: false,
    summary: 'Wages computed from real attendance and leave, ready to pay out.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },
  '/inventory': {
    label: 'Inventory',
    longLabel: 'Inventory',
    icon: 'inventory',
    ready: false,
    summary: 'Stock on hand, reorder levels, batches and committed quantities.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },
  '/procurement': {
    label: 'Procurement',
    longLabel: 'Procurement',
    icon: 'procurement',
    ready: false,
    summary: 'Purchase orders, supplier commitments and receipts against them.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },
  '/resources': {
    label: 'Resources',
    longLabel: 'Resources',
    icon: 'assets',
    ready: false,
    summary: 'Equipment, vehicles and tools — what is usable and what needs work.',
    arrivesIn: 'A later phase',
    section: 'operations',
    bottomBar: false,
  },

  // ── Business ──────────────────────────────────────────────────────────────
  '/customers': {
    label: 'Customers',
    longLabel: 'Customers',
    icon: 'customers',
    ready: false,
    summary: 'The organizations and people this business serves, and their history.',
    arrivesIn: 'A later phase',
    section: 'business',
    bottomBar: false,
  },
  '/vendors': {
    label: 'Vendors',
    longLabel: 'Vendors',
    icon: 'suppliers',
    ready: false,
    summary: 'Suppliers, terms and how reliably they deliver.',
    arrivesIn: 'A later phase',
    section: 'business',
    bottomBar: false,
  },
  '/finance': {
    label: 'Finance',
    longLabel: 'Finance',
    icon: 'finance',
    ready: false,
    summary: 'Money in, money out, and what it means for the business.',
    arrivesIn: 'A later phase',
    section: 'business',
    bottomBar: false,
  },
  '/reports': {
    label: 'Reports',
    longLabel: 'Reports',
    icon: 'reports',
    ready: true,
    summary:
      'The workspace’s figures, computed from its own records as of today: headcount, projects, the task queue, and workload for managers.',
    arrivesIn: 'Available now',
    section: 'business',
    bottomBar: false,
  },
  '/business-health': {
    label: 'Health',
    longLabel: 'Business Health',
    icon: 'health',
    ready: false,
    summary: 'A single view of whether the business is doing well — from real data.',
    arrivesIn: 'A later phase',
    section: 'business',
    bottomBar: false,
  },

  // ── Intelligence ──────────────────────────────────────────────────────────
  '/ai': {
    label: 'AI',
    longLabel: 'AI Copilot',
    icon: 'aiCopilot',
    ready: true,
    summary:
      'Ask questions about your own data and get answers grounded in it — never invented.',
    arrivesIn: 'Available now',
    section: 'intelligence',
    bottomBar: true,
  },
  '/ai-recommendations': {
    label: 'Recommendations',
    longLabel: 'AI Recommendations',
    icon: 'aiInsight',
    ready: false,
    summary: 'Suggested next actions derived from this business’s own records.',
    arrivesIn: 'A later phase',
    section: 'intelligence',
    bottomBar: false,
  },
  '/ai-agents': {
    label: 'Agents',
    longLabel: 'AI Agents',
    icon: 'aiAgent',
    ready: false,
    summary: 'Automated workers that carry out approved, bounded tasks.',
    arrivesIn: 'A later phase',
    section: 'intelligence',
    bottomBar: false,
  },
  '/knowledge-base': {
    label: 'Knowledge',
    longLabel: 'Knowledge Base',
    icon: 'knowledge',
    ready: false,
    summary: 'The business’s own documents and know-how, searchable in one place.',
    arrivesIn: 'A later phase',
    section: 'intelligence',
    bottomBar: false,
  },

  // ── System ────────────────────────────────────────────────────────────────
  '/notifications': {
    label: 'Notifications',
    longLabel: 'Notifications',
    icon: 'notifications',
    ready: true,
    summary:
      'Alerts about your business as they happen. The inbox reports the real state of the feed until a notification source exists.',
    arrivesIn: 'Available now',
    section: 'system',
    bottomBar: false,
  },
  '/settings': {
    label: 'Settings',
    longLabel: 'Settings',
    icon: 'settings',
    ready: true,
    summary:
      'Manage organization settings, AI providers, and system preferences.',
    arrivesIn: 'Available now',
    section: 'system',
    bottomBar: false,
  },
  '/more': {
    label: 'More',
    longLabel: 'More',
    icon: 'more',
    ready: true,
    summary: 'Organization details, appearance and account.',
    arrivesIn: 'Available now',
    section: 'system',
    bottomBar: true,
  },
};

/**
 * Display order, top to bottom in the sidebar. Grouped by section; the section
 * header labels come from `SECTION_LABELS` in `SECTION_ORDER`.
 *
 * Separate from `META` because a `Record` has no guaranteed iteration order worth
 * relying on for a user-visible layout.
 */
const ORDER: readonly DestinationPath[] = [
  // Main
  '/dashboard',
  // Work
  '/organizations',
  '/employees',
  '/workforce',
  '/projects',
  '/tasks',
  // Operations
  '/attendance',
  '/leave',
  '/payroll',
  '/inventory',
  '/procurement',
  '/resources',
  // Business
  '/customers',
  '/vendors',
  '/finance',
  '/reports',
  '/business-health',
  // Intelligence
  '/ai',
  '/ai-recommendations',
  '/ai-agents',
  '/knowledge-base',
  // System
  '/notifications',
  '/settings',
  '/more',
];

/**
 * How many destinations the compact bottom bar can carry. Once it exceeds this,
 * the test suite fails rather than letting the bar overflow on a phone.
 */
export const MAX_BOTTOM_BAR_TABS = 6;

/**
 * Display order in the compact bottom bar. Deliberately a short, task-forward
 * subset of the IA: the full navigation lives in the sidebar / drawer.
 */
const BOTTOM_BAR_ORDER: readonly DestinationPath[] = [
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

/** The subset of destinations that fits the compact bottom tab bar. */
export const bottomBarDestinations: readonly Destination[] = BOTTOM_BAR_ORDER.map((path) => ({
  path,
  ...META[path],
}));

/** One destination by path. Total — `DestinationPath` is exhaustive over `META`. */
export function destinationFor(path: DestinationPath): Destination {
  return { path, ...META[path] };
}

/**
 * Every destination in one sidebar group, in sidebar display order.
 *
 * The section field on a destination is guaranteed to equal the requested
 * section by construction: `destinations` is grouped by `section`, so slicing
 * by it cannot return a member of another group.
 */
export function destinationsForSection(section: DestinationSection): readonly Destination[] {
  return destinations.filter((entry) => entry.section === section);
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
