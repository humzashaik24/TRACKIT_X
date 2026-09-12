/**
 * Trackit X — customers placeholder.
 *
 * Phase 29 shell. See `organizations.tsx` for why a placeholder is preferable
 * to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function CustomersScreen() {
  return <ComingNext destination={destinationFor('/customers')} />;
}