/**
 * Trackit X — employees.
 *
 * Now a real screen, not a placeholder. The header note this file used to carry —
 * that a member count is not a headcount — has become the rule the directory is
 * built around rather than a warning about what is missing, so it now lives in
 * `EmployeeDirectoryView` where the numbers actually are.
 *
 * The route stays thin — it names the screen and nothing else. The view reads the
 * active organization from `OrganizationContext` itself, so a route that also
 * resolved it would add a second path by which the same screen gets its tenant,
 * and the two could disagree.
 */
import { EmployeeDirectoryView } from '@/features/employees/EmployeeDirectoryView';

export default function EmployeesScreen() {
  return <EmployeeDirectoryView />;
}
