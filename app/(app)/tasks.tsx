/**
 * Trackit X — tasks placeholder.
 *
 * See `projects.tsx` for why a placeholder is preferable to an empty list here.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function TasksScreen() {
  return <ComingNext destination={destinationFor('/tasks')} />;
}
