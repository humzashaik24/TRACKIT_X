/**
 * Trackit X — tasks.
 *
 * Real data, read from `public.tasks` and shaped by RLS. The route only names the
 * screen; the view resolves the active organization and owns the data, for the reason
 * given in `projects.tsx`.
 *
 * `?project=<id>` pre-filters the list to one project (served by the "View tasks"
 * action on a project screen). The value only seeds the filter; the screen remains a
 * live, filterable list.
 */
import { useLocalSearchParams } from 'expo-router';

import { TaskListView } from '@/features/tasks/TaskListView';

export default function TasksScreen() {
  const params = useLocalSearchParams<{ project?: string | string[] }>();
  const seedProjectId =
    typeof params.project === 'string' && params.project.length > 0 ? params.project : null;
  return <TaskListView seedProjectId={seedProjectId} />;
}
