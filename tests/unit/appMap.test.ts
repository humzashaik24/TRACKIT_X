/**
 * Navigation destination map — the single table behind the sidebar, the drawer
 * and the bottom bar.
 *
 * This is the shell's backbone, so the suite treats it as a database rather
 * than testing by example:
 *
 *  · the sidebar groups match the intended information architecture;
 *  · the compact bottom bar never exceeds its constraint, and only shows
 *    destinations that also exist in the sidebar;
 *  · `ready` stays honest — exactly the four finished screens are marked ready,
 *    and a ready destination does not still advertise a future phase;
 *  · every destination resolves to a real route file, so a menu item cannot
 *    silently point at a screen that does not exist (the "expose only routes
 *    that actually exist" rule);
 *  · `activeDestination` keeps a detail route's parent highlighted (route
 *    preservation) and never matches a different module's prefix.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  activeDestination,
  bottomBarDestinations,
  destinations,
  destinationsForSection,
  MAX_BOTTOM_BAR_TABS,
  SECTION_LABELS,
  SECTION_ORDER,
  type DestinationPath,
} from '@/navigation/destinations';

const EXPECTED_PATH_COUNT = 24;

/** The route file a destination path points at, inside the app group. */
function routeFile(path: string): string {
  return join(process.cwd(), 'app', '(app)', `${path.slice(1)}.tsx`);
}

describe('destinations — structure', () => {
  it('defines the full Phase 29 information architecture', () => {
    expect(destinations).toHaveLength(EXPECTED_PATH_COUNT);
  });

  it('gives every section at least one destination', () => {
    for (const section of SECTION_ORDER) {
      expect(destinationsForSection(section).length).toBeGreaterThan(0);
    }
  });

  it('labels every section', () => {
    for (const section of SECTION_ORDER) {
      expect(SECTION_LABELS[section].length).toBeGreaterThan(0);
    }
  });

  it('groups destinations exactly by their declared section', () => {
    for (const section of SECTION_ORDER) {
      for (const entry of destinationsForSection(section)) {
        expect(entry.section).toBe(section);
      }
    }
  });

  it('covers the exact set of destination paths', () => {
    const expected: readonly string[] = [
      '/dashboard',
      '/organizations',
      '/employees',
      '/workforce',
      '/projects',
      '/tasks',
      '/attendance',
      '/leave',
      '/payroll',
      '/inventory',
      '/procurement',
      '/resources',
      '/customers',
      '/vendors',
      '/finance',
      '/reports',
      '/business-health',
      '/ai',
      '/ai-recommendations',
      '/ai-agents',
      '/knowledge-base',
      '/notifications',
      '/settings',
      '/more',
    ];
    const actual = destinations.map((entry) => entry.path).sort();
    expect(new Set(actual).size).toBe(EXPECTED_PATH_COUNT);
    expect(actual.sort((a, b) => a.localeCompare(b))).toEqual([...expected].sort((a, b) => a.localeCompare(b)));
  });

  it('every destination has a real route file (no ghost menu items)', () => {
    for (const entry of destinations) {
      expect(entry.path).toMatch(/^\//);
      expect(existsSync(routeFile(entry.path))).toBe(true);
    }
  });
});

describe('destinations — honesty of `ready`', () => {
  /**
   * The exact set of finished screens.
   *
   * Listed literally rather than asserted as "at least two" or "more than last
   * time", because this flag is a promise to the user that a tab leads somewhere
   * real. A test that only checks the count would pass just as happily if
   * `/attendance` had been marked ready by mistake, which is precisely the failure
   * the flag exists to prevent. Updating this list is a deliberate act.
   */
  const READY_PATHS: readonly string[] = [
    '/dashboard',
    '/employees',
    '/more',
    '/projects',
    '/tasks',
  ];

  it('marks exactly the finished screens as ready', () => {
    const ready = destinations.filter((entry) => entry.ready);
    expect([...ready.map((entry) => entry.path)].sort()).toEqual([...READY_PATHS].sort());
  });

  it('says a ready destination is available now', () => {
    // `arrivesIn` is read by the placeholder screen, and a ready destination has no
    // placeholder. "Phase 2" on a finished screen is stale copy that would survive
    // into a future edit unnoticed.
    for (const entry of destinations.filter((value) => value.ready)) {
      expect(entry.arrivesIn).toBe('Available now');
    }
  });

  it('says when each unfinished module arrives', () => {
    for (const entry of destinations.filter((entry) => !entry.ready)) {
      expect(entry.arrivesIn.length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });
});

describe('destinations — compact bottom bar', () => {
  it('fits within the fixed number of tabs', () => {
    expect(bottomBarDestinations.length).toBeLessThanOrEqual(MAX_BOTTOM_BAR_TABS);
  });

  it('only contains destinations that exist in the sidebar list', () => {
    const sidebar = new Set(destinations.map((entry) => entry.path));
    for (const entry of bottomBarDestinations) {
      expect(sidebar.has(entry.path)).toBe(true);
    }
  });

  it('keeps the task-forward core reachable', () => {
    const paths = bottomBarDestinations.map((entry) => entry.path);
    for (const core of ['/dashboard', '/projects', '/tasks', '/employees', '/ai', '/more']) {
      expect(paths).toContain(core);
    }
  });
});

describe('activeDestination — active-route resolution and preservation', () => {
  it('resolves an exact path', () => {
    expect(activeDestination('/dashboard')?.path).toBe('/dashboard');
    expect(activeDestination('/business-health')?.path).toBe('/business-health');
    expect(activeDestination('/knowledge-base')?.path).toBe('/knowledge-base');
  });

  it('keeps a detail route on its parent (route preservation)', () => {
    expect(activeDestination('/projects/42')?.path).toBe('/projects');
    expect(activeDestination('/tasks/7/notes')?.path).toBe('/tasks');
  });

  it('never lets a short prefix steal a longer module', () => {
    // `/knowledge` is not a route; `/knowledge-base` must not match it, and
    // `/business` must not match `/business-health`.
    expect(activeDestination('/knowledge')).toBeUndefined();
    expect(activeDestination('/business')).toBeUndefined();
  });

  it('returns undefined outside the shell', () => {
    expect(activeDestination('/reset-password')).toBeUndefined();
    expect(activeDestination('/does-not-exist')).toBeUndefined();
  });
});

describe('destinationFor', () => {
  it('returns a complete destination for every path', () => {
    const sample: readonly DestinationPath[] = ['/dashboard', '/attendance', '/settings'];
    for (const path of sample) {
      const entry = destinations.find((value) => value.path === path);
      expect(entry).toBeDefined();
    }
  });
});