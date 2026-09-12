/**
 * Trackit X — AI recommendations placeholder.
 *
 * Phase 29 shell. No list is rendered here — recommendations must be derived
 * from the business's own records, and nothing that would ground them exists
 * yet. A screen full of invented suggestions would be worse than none.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function AIRecommendationsScreen() {
  return <ComingNext destination={destinationFor('/ai-recommendations')} />;
}