/**
 * Trackit X — project form schemas.
 *
 * Mirrors the constraints declared on `public.projects` and `public.project_members`:
 *
 *   · `projects_name_length`        — btrim(name) between 2 and 160
 *   · `projects_name_trimmed`       — name = btrim(name)
 *   · `projects_progress_range`     — progress between 0 and 100
 *   · `projects_target_after_start` — target_date >= start_date, or either is NULL
 *   · `project_members_allocation_range` — allocation_percent between 0 and 100
 *
 * `owner_id` is nullable in the database and optional here, deliberately. A
 * project outlives the person who started it, and forcing an owner would mean
 * blocking the creation of a job on a staffing question that has not been
 * answered yet.
 *
 * The database is the authority. Everything here exists to catch a mistake before
 * a round trip.
 */
import { z } from 'zod';

import {
  ALLOCATION_MAX,
  ALLOCATION_MIN,
  isScheduleCoherent,
  normalizeProjectName,
  PROJECT_MEMBER_ROLES,
  PROJECT_NAME_MAX,
  PROJECT_NAME_MIN,
  PROJECT_PRIORITIES,
  PROJECT_STATUSES,
} from '@/domain/project';

const dateField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use the date picker.' })
  .refine((value) => {
    const parsed = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed)) return false;
    return new Date(parsed).toISOString().slice(0, 10) === value;
  }, { message: 'That date does not exist.' });

/** Blank is a real answer here: an open-ended project is a legitimate project. */
const optionalDate = z
  .union([dateField, z.literal('')])
  .transform((value) => (value === '' ? null : value));

const nameField = z
  .string()
  .transform(normalizeProjectName)
  .pipe(
    z
      .string()
      .min(PROJECT_NAME_MIN, { message: `Use at least ${PROJECT_NAME_MIN} characters.` })
      .max(PROJECT_NAME_MAX, { message: `Keep it under ${PROJECT_NAME_MAX} characters.` }),
  );

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .refine((value) => value === null || value.length <= max, {
      message: `Keep the ${label} under ${max} characters.`,
    });

/**
 * 0-100 as an INTEGER.
 *
 * `z.number().int()` because the column is `smallint`: a slider that reports
 * 37.5 would be rounded silently by Postgres, and the number the user was looking
 * at would not be the number that was stored. Rounding in the form is visible;
 * rounding in the database is not.
 */
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

/**
 * The schedule, checked as a PAIR.
 *
 * This is the one cross-field rule in the form, and it has to be here rather than
 * on either field: `projects_target_after_start` is a constraint about the
 * relationship, and no single input can know about the other. Validating it once,
 * on the object, is also what keeps the error attached to the field the user is
 * looking at.
 */
function refineSchedule<
  T extends { startDate?: string | null; targetDate?: string | null },
>(values: T, ctx: z.RefinementCtx): void {
  const start = values.startDate ?? null;
  const target = values.targetDate ?? null;
  if (isScheduleCoherent(start, target)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['targetDate'],
    message: 'The target date cannot be before the start date.',
  });
}

export const createProjectSchema = z
  .object({
    name: nameField,
    description: optionalText(2000, 'description').optional(),
    status: z.enum(PROJECT_STATUSES, { message: 'Choose a status.' }).optional(),
    priority: z.enum(PROJECT_PRIORITIES, { message: 'Choose a priority.' }).optional(),
    startDate: optionalDate.optional(),
    targetDate: optionalDate.optional(),
    ownerId: optionalUuid.optional(),
    progress: progressField.optional(),
  })
  .superRefine(refineSchedule);

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: nameField.optional(),
    description: optionalText(2000, 'description').optional(),
    status: z.enum(PROJECT_STATUSES, { message: 'Choose a status.' }).optional(),
    priority: z.enum(PROJECT_PRIORITIES, { message: 'Choose a priority.' }).optional(),
    startDate: optionalDate.optional(),
    targetDate: optionalDate.optional(),
    ownerId: optionalUuid.optional(),
    progress: progressField.optional(),
  })
  .superRefine(refineSchedule)
  .refine(
    (values) =>
      values.name !== undefined ||
      values.description !== undefined ||
      values.status !== undefined ||
      values.priority !== undefined ||
      values.startDate !== undefined ||
      values.targetDate !== undefined ||
      values.ownerId !== undefined ||
      values.progress !== undefined,
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

const allocationField = z
  .number({ message: 'Enter a number between 0 and 100.' })
  .int('Whole numbers only.')
  .min(ALLOCATION_MIN, { message: `Between ${ALLOCATION_MIN} and ${ALLOCATION_MAX}.` })
  .max(ALLOCATION_MAX, { message: `Between ${ALLOCATION_MIN} and ${ALLOCATION_MAX}.` });

export const addProjectMemberSchema = z.object({
  employeeId: z.string().trim().min(1, { message: 'Choose somebody.' }),
  role: z.enum(PROJECT_MEMBER_ROLES, { message: 'Choose a role.' }).optional(),
  allocationPercent: allocationField.optional(),
});

export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const updateProjectMemberSchema = z
  .object({
    role: z.enum(PROJECT_MEMBER_ROLES, { message: 'Choose a role.' }).optional(),
    allocationPercent: allocationField.optional(),
  })
  .refine(
    (values) => values.role !== undefined || values.allocationPercent !== undefined,
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateProjectMemberInput = z.infer<typeof updateProjectMemberSchema>;
