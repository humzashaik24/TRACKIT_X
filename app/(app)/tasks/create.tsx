/**
 * Trackit X — new task.
 *
 * A route rather than a modal, and the reasoning is in `TaskCreateForm`. Briefly: this
 * form is longer than a project form, and a software keyboard inside a modal on a
 * phone is a worse place to type than a screen that scrolls under it. It also makes
 * the create action linkable, so the list's "New task" button goes somewhere real
 * instead of toggling local state.
 *
 * The list's own roster and project reads are not repeated here. `useTaskList` already
 * runs for the list behind this route, and it resolves the caller's employee id —
 * duplicating that read to fill an assignee picker would be a second request for a
 * value the app has in hand, and the two could disagree. The one read this screen does
 * need on its own is that employee id, and it asks for it alone.
 */
import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { PageHeader } from '@/components/navigation/PageHeader';
import { useOrganization } from '@/contexts/OrganizationContext';
import { ScreenContainer, useResponsive, VStack } from '@/design-system';
import { useEmployeeDirectory } from '@/features/employees/useEmployeeDirectory';
import { useProjectList } from '@/features/projects/useProjects';
import { TaskCreateForm } from '@/features/tasks/TaskCreateForm';
import { useCurrentEmployeeId } from '@/features/tasks/useTasks';
import { deriveBreadcrumbs } from '@/navigation/breadcrumbs';

export default function TaskCreateScreen() {
  const router = useRouter();
  const { sectionGap } = useResponsive();
  const { organization, role } = useOrganization();
  const organizationId = organization?.id ?? null;

  const projects = useProjectList(organizationId);
  const directory = useEmployeeDirectory(organizationId);
  // The dedicated hook, not `useTaskList`: this screen needs the caller's employee id
  // and nothing else, and the list hook would drag every task in the organization along
  // behind it to answer a question about one row in `employees`.
  const currentEmployeeId = useCurrentEmployeeId(organizationId);

  const onSaved = useCallback(
    (taskId: string) => {
      // Replace rather than push: the form is not somewhere the user wants a back
      // button to return to, and the task they just made is the better destination.
      router.replace(`/tasks/${taskId}`);
    },
    [router],
  );

  return (
    <ScreenContainer edges={['bottom']} gap={sectionGap} maxWidth={640}>
      <PageHeader
        title="New task"
        description="A unit of work. It can belong to a project, or to none."
        breadcrumbs={deriveBreadcrumbs('/tasks/create')}
        secondaryAction={{
          label: 'Cancel',
          variant: 'ghost',
          onPress: () => {
            router.back();
          },
        }}
      />

      <VStack gap={4}>
        <TaskCreateForm
          organizationId={organizationId}
          role={role}
          currentEmployeeId={currentEmployeeId}
          projects={projects.rows}
          employees={directory.rows}
          onCancel={() => {
            router.back();
          }}
          onSaved={onSaved}
        />
      </VStack>
    </ScreenContainer>
  );
}
