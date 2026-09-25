/**
 * Trackit X — status → badge mapping.
 *
 * The three business status vocabularies in this phase (employment, project, task)
 * all read the same way to a person — "is this running, is it at risk, is it done" —
 * so they are given the same visual vocabulary here rather than each screen
 * inventing its own colours.
 *
 * The mapping is a function rather than a table of JSX so the three enums cannot
 * drift apart, and so a screen only has to say what the status IS and not how it
 * looks. That matters because the alternative — a `status === 'active' ? 'success'`
 * ternary at each call site — is how two screens end up showing the same state in
 * two different colours, which is worse than no colour coding at all.
 *
 * `Record<Status, …>` rather than a switch, so adding a member to a domain union is
 * a compile error here. That is the whole safety of the file.
 */
import type { BadgeIntent, BadgeVariant } from '@/design-system';

import type { EmploymentStatus } from '@/domain/employee';
import type { ProjectStatus } from '@/domain/project';
import type { TaskStatus } from '@/domain/task';

type BadgeSpec = {
  readonly intent: BadgeIntent;
  readonly variant: BadgeVariant;
};

/**
 * Employment reads as a tone, not a risk.
 *
 * A person on leave or serving notice is NOT a warning — they are a normal state of
 * a working life, and tinting them amber makes every HR conversation a triage. The
 * only genuinely alarming employment state is `inactive`, and even that is
 * neutral, because somebody who has left is not a problem to be escalated.
 */
const EMPLOYMENT_TONE: Record<EmploymentStatus, BadgeSpec> = {
  active: { intent: 'success', variant: 'soft' },
  probation: { intent: 'info', variant: 'soft' },
  on_leave: { intent: 'neutral', variant: 'soft' },
  notice_period: { intent: 'warning', variant: 'soft' },
  inactive: { intent: 'neutral', variant: 'outline' },
};

/** Projects are read for delivery risk, so the tones are risk tones. */
const PROJECT_TONE: Record<ProjectStatus, BadgeSpec> = {
  planned: { intent: 'neutral', variant: 'outline' },
  active: { intent: 'accent', variant: 'soft' },
  on_hold: { intent: 'warning', variant: 'soft' },
  completed: { intent: 'success', variant: 'soft' },
  cancelled: { intent: 'neutral', variant: 'outline' },
};

/** Tasks are the same scale as projects, one step more urgent at the top. */
const TASK_TONE: Record<TaskStatus, BadgeSpec> = {
  todo: { intent: 'neutral', variant: 'outline' },
  in_progress: { intent: 'accent', variant: 'soft' },
  blocked: { intent: 'danger', variant: 'soft' },
  in_review: { intent: 'info', variant: 'soft' },
  done: { intent: 'success', variant: 'soft' },
};

export function employmentBadgeSpec(status: EmploymentStatus): BadgeSpec {
  return EMPLOYMENT_TONE[status];
}

export function projectBadgeSpec(status: ProjectStatus): BadgeSpec {
  return PROJECT_TONE[status];
}

export function taskBadgeSpec(status: TaskStatus): BadgeSpec {
  return TASK_TONE[status];
}
