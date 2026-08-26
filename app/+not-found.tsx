/**
 * Trackit X — unmatched route.
 *
 * Reachable two ways: a deep link to a path that does not exist, and a web user
 * editing the URL. Both deserve a way out rather than a blank screen.
 *
 * It sends the user to `/` rather than to `/dashboard`, and that difference matters.
 * `/dashboard` is inside the app group, so a signed-out visitor who lands here would
 * be bounced to the dashboard, refused by its gate, and redirected again to sign-in —
 * two redirects and a flash of the wrong screen. `/` is the entry gate: it resolves
 * the session first and then sends the user to the one zone they belong in.
 *
 * It lives at the app root, not inside a group, so it also catches paths that match
 * no group at all.
 */
import { router } from 'expo-router';

import { EmptyState, ScreenContainer } from '@/design-system';

export default function NotFoundScreen() {
  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <EmptyState
        variant="noResults"
        icon="help"
        title="This page does not exist"
        description="The link may be out of date, or the address may have a typo in it."
        action={{
          label: 'Take me back',
          onPress: () => router.replace('/'),
          icon: 'arrowLeft',
        }}
      />
    </ScreenContainer>
  );
}
