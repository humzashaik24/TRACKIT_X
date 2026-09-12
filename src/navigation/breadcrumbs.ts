/**
 * Trackit X — breadcrumb derivation.
 *
 * Breadcrumbs are derived from the route, never written by hand per screen: a
 * screen that hard-codes its own trail will drift from its URL the first time
 * somebody moves the route, and then the trail and the page disagree.
 *
 * The current page is the last crumb and never links back to itself. Earlier
 * crumbs link where they can; `deriveBreadcrumbs` returns them without hrefs so
 * the consumer decides what is navigable.
 */
import { activeDestination, type DestinationPath } from './destinations';

export interface BreadcrumbSegment {
  readonly label: string;
  /**
   * The route this crumb links to. Absent for the current page — a crumb that
   * points at itself is a button that does nothing. Typed as a destination so a
   * link can never point at a route that does not exist.
   */
  readonly path?: DestinationPath;
}

/**
 * A URL path segment becomes a human label: `business-health` → `Business
 * Health`. Unknown segments are their own label.
 */
export function titleCaseSegment(segment: string): string {
  return segment
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => {
      const first = part.charAt(0);
      return first === undefined ? part : first.toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/**
 * The breadcrumb trail for a pathname.
 *
 * Top-level destinations produce exactly one crumb (their own label). A nested
 * path — a future detail route like `/projects/42` — yields the parent module
 * followed by one crumb per remaining segment, so the trail always starts at a
 * destination that actually exists.
 */
export function deriveBreadcrumbs(pathname: string): readonly BreadcrumbSegment[] {
  const destination = activeDestination(pathname);
  if (destination === undefined) return [];

  const crumbs: BreadcrumbSegment[] = [];

  if (pathname === destination.path) {
    // The page itself: no link, because a crumb that points at itself is a
    // button that does nothing.
    crumbs.push({ label: destination.longLabel });
    return crumbs;
  }

  // A nested detail route — `/projects/42`. The parent module links back.
  const prefix = `${destination.path}/`;
  if (pathname.startsWith(prefix)) {
    crumbs.push({ label: destination.longLabel, path: destination.path });
    const remainder = pathname.slice(prefix.length);
    for (const part of remainder.split('/')) {
      if (part.length === 0) continue;
      let label = part;
      try {
        label = titleCaseSegment(decodeURIComponent(part));
      } catch {
        // A malformed percent-encoding should not blank the trail — the raw
        // segment is a perfectly usable label.
      }
      crumbs.push({ label });
    }
  }

  return crumbs;
}