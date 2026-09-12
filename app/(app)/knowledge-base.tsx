/**
 * Trackit X — knowledge base placeholder.
 *
 * Phase 29 shell. See `organizations.tsx` for why a placeholder is preferable
 * to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function KnowledgeBaseScreen() {
  return <ComingNext destination={destinationFor('/knowledge-base')} />;
}