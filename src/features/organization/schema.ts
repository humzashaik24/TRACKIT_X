/**
 * Trackit X — organization form schemas.
 *
 * Mirrors the constraints declared on `public.organizations`:
 *
 *   · `organizations_name_length`    — btrim(name) between 2 and 120 characters
 *   · `organizations_name_trimmed`   — name = btrim(name)
 *   · `organizations_currency_format`— currency ~ '^[A-Z]{3}$'
 *   · the `validate_organization_timezone` trigger — timezone ∈ pg_timezone_names
 *
 * The database is the authority. Every rule here exists to catch the mistake
 * before a round trip, not to be the last line of defence — a request that skips
 * this file is still rejected by Postgres.
 */
import { z } from 'zod';

import {
  BUSINESS_TYPES,
  isKnownTimezone,
  normalizeOrganizationName,
  ORGANIZATION_NAME_MAX,
  ORGANIZATION_NAME_MIN,
} from '@/domain/organization';

/**
 * `transform` before the length checks, because the column stores the trimmed
 * form: "  Acme  " must be measured as "Acme", and a name that is only spaces
 * must fail as empty rather than as 6 characters long.
 */
const nameField = z
  .string()
  .transform(normalizeOrganizationName)
  .refine((value) => value.length >= ORGANIZATION_NAME_MIN, {
    message: `Use at least ${ORGANIZATION_NAME_MIN} characters.`,
  })
  .refine((value) => value.length <= ORGANIZATION_NAME_MAX, {
    message: `Keep it under ${ORGANIZATION_NAME_MAX} characters.`,
  });

const businessTypeField = z.enum(BUSINESS_TYPES, {
  message: 'Choose the closest match.',
});

/**
 * Checked against the runtime's own IANA list rather than a regex.
 *
 * The trigger validates against `pg_timezone_names`, and a plausible-looking but
 * unknown zone would otherwise fail on save with a database error instead of an
 * inline one.
 */
const timezoneField = z
  .string()
  .trim()
  .refine(isKnownTimezone, { message: 'Choose a timezone from the list.' });

/**
 * Uppercased before validating, so a user typing "inr" is corrected rather than
 * refused — the same normalisation `create_organization` applies server-side.
 */
const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { message: 'Use a three-letter currency code, e.g. INR.' });

export const createOrganizationSchema = z.object({
  name: nameField,
  businessType: businessTypeField,
  timezone: timezoneField,
  currency: currencyField,
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Same fields, all optional — an edit form only sends what changed. */
export const updateOrganizationSchema = z
  .object({
    name: nameField.optional(),
    businessType: businessTypeField.optional(),
    timezone: timezoneField.optional(),
    currency: currencyField.optional(),
  })
  .refine(
    (values) =>
      values.name !== undefined ||
      values.businessType !== undefined ||
      values.timezone !== undefined ||
      values.currency !== undefined,
    { message: 'Change at least one detail before saving.' },
  );

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
