/**
 * Trackit X — task form schemas.
 *
 * Mirrors the constraints declared on `public.tasks`:
 *
 *   · `tasks_title_length`   — btrim(title) between 2 and 200
 *   · `tasks_title_trimmed`  — title = btrim(title)
 *   · `tasks_progress_range` — progress between 0 and 100
 *
 * Deliberately absent, because they are not the form's to enforce:
 *
 *   · same-organization integrity of `project_id` and `assignee_id`, which
 *     `guard_task_references` holds;
 *   · who may assign work to whom, which is `tasks_insert_members`. A form cannot
 *     ask the question without already knowing the answer, and a client-side copy
 *     of that rule would be a second thing to get wrong.
 *
 * The database is the authority. Everything here exists to catch a mistake before
 * a round trip.
 */
import { z } from 'zod';

import { normalizeTaskTitle, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, TASK_TITLE_MIN } from '@/domain/task';

const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the date picker.' })
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed)) return false;
    return new Date(parsed).toISOString().slice(0, 10) === value;
  }, { message: 'That date does not exist.' });

/** An undated task is normal, so blank is an answer rather than a missing one. */
const optionalDate = z
  .union([dateField, z.literal('')])
  .transform((value) => (value === '' ? null : value));

const titleField = z
  .string()
  .transform(normalizeTaskTitle)
  .pipe(
    z
      .string()
      .min(TASK_TITLE_MIN, { message: `Use at least ${TASK_TITLE_MIN} characters.` })
      .max(TASK_TITLE_MAX, { message: `Keep it under ${TASK_TITLE_MAX} characters.` }),
  );

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .refine((value) => value === null || value.length <= max, {
      message: `Keep the ${label} under ${max} characters.`,
    });

/** Whole numbers only — the column is `smallint`. See the note in projects/schema.ts. */
const progressField = z
  .number({ message: 'Enter a number between 0 and 100.' })
  .int('Whole numbers only.')
  .min(0, { message: 'Between 0 and 100.' })
  .max(100, { message: 'Between 0 and 100.' });

const optionalUuid = z
  .string()
  .trim()
  .refine(
    (value) =>
      value.length === 0 ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value),
    { message: 'Pick from the list.' },
  )
  .transform((value) => (value.length === 0 ? null : value));

export const createTaskSchema = z.object({
  title: titleField,
  description: optionalText(4000, 'description').optional(),
  /** Optional BY DESIGN — see the header of `src/domain/task.ts`. */
  projectId: optionalUuid.optional(),
  assigneeId: optionalUuid.optional(),
  status: z.enum(TASK_STATUSES, { message: 'Choose a status.' }).optional(),
  priority: z.enum(TASK_PRIORITIES, { message: 'Choose a priority.' }).optional(),
  progress: progressField.optional(),
  dueDate: optionalDate.optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: titleField.optional(),
    description: optionalText(4000, 'description').optional(),
    projectId: optionalUuid.optional(),
    assigneeId: optionalUuid.optional(),
    status: z.enum(TASK_STATUSES, { message: 'Choose a status.' }).optional(),
    priority: z.enum(TASK_PRIORITIES, { message: 'Choose a priority.' }).optional(),
    progress: progressField.optional(),
    dueDate: optionalDate.optional(),
  })
  .refine(
    (values) => Object.values(values).some((value) => value !== undefined),
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
