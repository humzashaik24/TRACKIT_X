/**
 * Trackit X — tasks.
 *
 * Real data, read from `public.tasks` and shaped by RLS. The route only names the
 * screen; the view resolves the active organization and owns the data, for the reason
 * given in `projects.tsx`.
 */
import { TaskListView } from '@/features/tasks/TaskListView';

export default function TasksScreen() {
  return <TaskListView />;
}
