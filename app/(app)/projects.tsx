/**
 * Trackit X — projects placeholder.
 *
 * Exists so the tab leads somewhere that explains itself. The real screen arrives
 * with the `projects` table in Phase 2; until then this states that plainly rather
 * than rendering an empty list, which a user cannot distinguish from having no
 * projects. All copy comes from the destination table, so the tab and the screen
 * cannot describe the feature differently.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function ProjectsScreen() {
  return <ComingNext destination={destinationFor('/projects')} />;
}
