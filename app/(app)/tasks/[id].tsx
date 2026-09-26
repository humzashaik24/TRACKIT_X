/**
 * Trackit X — one task.
 *
 * A real detail route, so a task can be linked to and the back button returns to the
 * list the user was triaging. The route only resolves the id and hands it on; the view
 * resolves the active organization and owns the data, for the reason given in
 * `projects.tsx`.
 */
import { TaskDetailView } from '@/features/tasks/TaskDetailView';

export default function TaskDetailScreen() {
  return <TaskDetailView />;
}
