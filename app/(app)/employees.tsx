/**
 * Trackit X — employees placeholder.
 *
 * Worth a note specific to this tab: the dashboard already shows a member count, and
 * that number is accounts with access to the workspace — not headcount. Employee
 * records are a separate table with wage basis, skills and documents, and none of it
 * exists yet. Showing the access count here under the word "Employees" would turn a
 * true number into a false one, so this screen shows no number at all.
 */
import { ComingNext } from '@/components/navigation/ComingNext';
import { destinationFor } from '@/navigation/destinations';

export default function EmployeesScreen() {
  return <ComingNext destination={destinationFor('/employees')} />;
}
