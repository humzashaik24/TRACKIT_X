/**
 * Trackit X — notifications placeholder.
 *
 * Phase 29 shell. The notification centre lives in the top bar — this screen is
 * where an expanded feed will land. No notification table exists yet, so the
 * placeholder says so rather than rendering an empty timeline.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function NotificationsScreen() {
  return <ComingNext destination={destinationFor('/notifications')} />;
}