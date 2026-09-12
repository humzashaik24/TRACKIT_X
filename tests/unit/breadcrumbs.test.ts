/**
 * Breadcrumb derivation — the trail is a pure function of the pathname.
 *
 * The properties worth pinning: the current page is the last crumb and never
 * links to itself, a nested detail route top-and-tails its parent module, an
 * unknown path yields nothing (never a fabricated crumb), and URL segments
 * become human labels without blowing up on malformed encoding.
 */
import { deriveBreadcrumbs, titleCaseSegment } from '@/navigation/breadcrumbs';

describe('deriveBreadcrumbs', () => {
  it('renders a top-level destination as a single, self-free crumb', () => {
    expect(deriveBreadcrumbs('/dashboard')).toEqual([{ label: 'Dashboard' }]);
    expect(deriveBreadcrumbs('/projects')).toEqual([{ label: 'Projects' }]);
  });

  it('renders the full label for hyphenated destinations', () => {
    expect(deriveBreadcrumbs('/business-health')).toEqual([{ label: 'Business Health' }]);
    expect(deriveBreadcrumbs('/ai-recommendations')).toEqual([{ label: 'AI Recommendations' }]);
  });

  it('links the parent module on a nested detail route', () => {
    expect(deriveBreadcrumbs('/projects/42')).toEqual([
      { label: 'Projects', path: '/projects' },
      { label: '42' },
    ]);
  });

  it('handles multi-segment nested routes', () => {
    expect(deriveBreadcrumbs('/knowledge-base/guides/1')).toEqual([
      { label: 'Knowledge Base', path: '/knowledge-base' },
      { label: 'Guides' },
      { label: '1' },
    ]);
  });

  it('never labels the current crumb with a path (no self-link)', () => {
    const crumbs = deriveBreadcrumbs('/projects');
    expect(crumbs[crumbs.length - 1]?.path).toBeUndefined();
  });

  it('returns nothing outside the shell', () => {
    expect(deriveBreadcrumbs('/reset-password')).toEqual([]);
    expect(deriveBreadcrumbs('/nope')).toEqual([]);
  });
});

describe('titleCaseSegment', () => {
  it('title-cases hyphenated segments', () => {
    expect(titleCaseSegment('business-health')).toBe('Business Health');
  });

  it('leaves a single word uppercase-prefixed', () => {
    expect(titleCaseSegment('tasks')).toBe('Tasks');
  });

  it('tolerates empty segments', () => {
    expect(titleCaseSegment('')).toBe('');
    expect(titleCaseSegment('a--b')).toBe('A B');
  });
});