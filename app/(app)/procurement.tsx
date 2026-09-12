/**
 * Trackit X — procurement placeholder.
 *
 * Phase 29 shell. See `organizations.tsx` for why a placeholder is preferable
 * to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function ProcurementScreen() {
  return <ComingNext destination={destinationFor('/procurement')} />;
}