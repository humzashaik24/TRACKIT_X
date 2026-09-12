/**
 * Trackit X — AI agents placeholder.
 *
 * Phase 29 shell. No agent registry exists yet, and a list of fake agents would
 * imply automation the product does not have. See `organizations.tsx`.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function AIAgentsScreen() {
  return <ComingNext destination={destinationFor('/ai-agents')} />;
}