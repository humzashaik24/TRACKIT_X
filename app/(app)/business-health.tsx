/**
 * Trackit X — business health placeholder.
 *
 * Phase 29 shell. See `organizations.tsx` for why a placeholder is preferable
 * to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function BusinessHealthScreen() {
  return <ComingNext destination={destinationFor('/business-health')} />;
}