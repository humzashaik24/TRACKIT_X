/**
 * Trackit X — AppShell compact bar.
 *
 * Regression test for the Phase 39 audit finding: the compact bottom bar rendered
 * ALL 24 destinations, because `AppShell` iterated `destinations` instead of the
 * six-entry `bottomBarDestinations`. On a phone that is two dozen tabs in a row,
 * most of them leading to "not built yet" screens.
 *
 * A render test is the only kind that catches this. The bug is not about what
 * `bottomBarDestinations` contains — `appMap.test.ts` already pins that — it is
 * about which list the shell actually draws, so the shell is rendered in compact
 * mode and the tab nodes are counted.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type * as DesignSystem from '@/design-system';
import { AppShell } from '@/components/navigation/AppShell';
import { Text, ThemeProvider, ToastProvider } from '@/design-system';
import { bottomBarDestinations } from '@/navigation/destinations';

jest.mock(
  'expo-router',
  () => ({
    usePathname: () => '/dashboard',
    router: { replace: jest.fn(), push: jest.fn() },
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
  }),
  { virtual: false },
);

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const safeAreaMock = require('react-native-safe-area-context/jest/mock').default;
  return safeAreaMock;
});

// AppHeader mounts OrganizationSwitcher and UserMenu, which read the two
// signed-in contexts. The shell itself is what this suite exercises, so the
// contexts are stubbed narrowly rather than provided for real.
jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    status: 'signedIn',
    isSignedIn: true,
    user: { id: 'user-1', email: 'owner@test.co' },
    displayName: 'Owner',
    signOut: jest.fn(async () => ({ ok: true, value: undefined })),
    signIn: jest.fn(),
    signUp: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
    awaitingEmailConfirmation: false,
    session: null,
  }),
}));

jest.mock('@/contexts/OrganizationContext', () => ({
  useOrganization: () => ({
    status: 'ready',
    error: null,
    memberships: [{ membershipId: 'm-1', organization: { id: 'org-1', name: 'Test Co' }, role: 'owner' }],
    organization: { id: 'org-1', name: 'Test Co' },
    role: 'owner',
    permissions: [],
    needsOnboarding: false,
    refresh: jest.fn(async () => undefined),
    selectOrganization: jest.fn(),
    createOrganization: jest.fn(),
  }),
}));

// Compact renders the bottom bar branch of AppShell. The mock is confined to the
// responsive hook so the rest of the design system runs genuinely.
jest.mock('@/design-system', () => {
  const actual = jest.requireActual<typeof DesignSystem>('@/design-system');
  return {
    ...actual,
    useResponsive: () => ({
      width: 390,
      height: 800,
      breakpoint: 'phone',
      density: 'compact',
      isCompact: true,
      isRegular: false,
      isWide: false,
      isPortrait: true,
      columns: 2,
      screenPaddingX: 16,
      sectionGap: 16,
      cardPadding: 12,
      gridGap: 12,
      select: (values: { compact: unknown }) => values.compact,
      selectBreakpoint: (values: Record<string, unknown>, fallback: unknown) =>
        values.phone ?? fallback,
    }),
  };
});

function renderShell(): ReactTestRenderer {
  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(
      <ThemeProvider>
        <ToastProvider>
          <AppShell organizationName="Test Co" role="owner">
            <Text>content</Text>
          </AppShell>
        </ToastProvider>
      </ThemeProvider>,
    );
  });
  if (renderer === null) throw new Error('Renderer was not created');
  return renderer;
}

describe('AppShell compact bottom bar', () => {
  it('renders exactly the six bottom-bar destinations', () => {
    const renderer = renderShell();

    // BottomTab uses accessibilityRole="tab"; the desktop rail uses "link", so
    // tabs are exactly the compact bar's children. Filtering to host nodes
    // avoids counting a Pressable's composite wrapper alongside its rendered
    // View. 24 destinations would surface here as 24 nodes — the regression
    // this test exists to catch.
    const tabs = renderer.root.findAll(
      (node) => node.props.accessibilityRole === 'tab' && typeof node.type === 'string',
    );
    expect(tabs).toHaveLength(6);

    const labels = tabs.map((tab) => tab.props.accessibilityLabel).sort();
    expect(labels).toEqual(
      bottomBarDestinations
        .map((entry) =>
          entry.ready
            ? entry.label
            : `${entry.label}, not available yet — ${entry.arrivesIn}`,
        )
        .sort(),
    );
  });

  it('does not draw tabs the compact bar is not meant to carry', () => {
    const renderer = renderShell();

    // Settings is in the full 24-destination table but not in the bottom bar. Its
    // presence as a tab is the exact shape of the regression.
    const labels = renderer.root
      .findAll(
        (node) => node.props.accessibilityRole === 'tab' && typeof node.type === 'string',
      )
      .map((tab) => String(tab.props.accessibilityLabel));

    expect(labels.some((label) => label.startsWith('Settings'))).toBe(false);
    expect(labels.some((label) => label.startsWith('Attendance'))).toBe(false);

    // And every one of the six the bar is meant to carry is present.
    for (const entry of bottomBarDestinations) {
      const label = entry.ready ? entry.label : `${entry.label}, not available yet — ${entry.arrivesIn}`;
      expect(labels).toContain(label);
    }
  });
});