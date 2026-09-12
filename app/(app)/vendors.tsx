/**
 * Trackit X — vendors placeholder.
 *
 * Phase 29 shell. See `organizations.tsx` for why a placeholder is preferable
 * to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function VendorsScreen() {
  return <ComingNext destination={destinationFor('/vendors')} />;
}