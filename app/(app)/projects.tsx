/**
 * Trackit X — projects.
 *
 * Real data, read from `public.projects` and shaped by RLS. The route only names
 * the screen; the view resolves the active organization and owns the data, for the
 * reason given in `employees.tsx`.
 */
import { ProjectListView } from '@/features/projects/ProjectListView';

export default function ProjectsScreen() {
  return <ProjectListView />;
}
