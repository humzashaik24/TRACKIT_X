/**
 * Trackit X — organization domain rules.
 *
 * Pure functions and constant tables. No Supabase import, no React, no I/O — so
 * every rule below is unit-testable without a database or a renderer.
 *
 * ⚠ AUTHORITY LIVES IN THE DATABASE, NOT HERE.
 *
 * `roleRank` mirrors `public.organization_role_rank()` and the `can*` helpers
 * mirror the RLS policies, but they are UI affordances only: they decide whether
 * to render a button, never whether an action is allowed. The real decision is
 * made by Postgres on every request, and it is made again even if a client
 * bypasses this file entirely. Two consequences worth internalising:
 *
 *   · A `can*` returning true is not permission. The write can still be refused,
 *     and screens must handle that refusal.
 *   · A `can*` returning false is not security. It is courtesy — it keeps a user
 *     from walking into a wall.
 *
 * If this file and the migration ever disagree, the migration is right.
 */
import type { BusinessType, OrganizationRole } from '@/types/database';

/**
 * Re-exported so a screen that imports `businessTypeOptions` or `ROLE_LABELS` does
 * not also have to reach into `@/types/database` for the type those values are keyed
 * by. The declarations stay in the schema-mirroring module — this is an alias, not a
 * second definition, so the two cannot drift.
 */
export type { BusinessType, OrganizationRole };

/**
 * Every role, ascending by authority.
 *
 * The order is load-bearing: `roleRank` is the 1-based index, which is exactly
 * what `public.organization_role_rank()` returns. Reordering this array silently
 * changes the meaning of every comparison, so it is asserted in the unit tests.
 */
export const ORGANIZATION_ROLES = ['member', 'manager', 'admin', 'owner'] as const;

export const ROLE_LABELS: Record<OrganizationRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
};

/**
 * What each role means in practice. Shown when assigning a role, because
 * "Manager" alone does not tell an owner what they are handing over.
 */
export const ROLE_DESCRIPTIONS: Record<OrganizationRole, string> = {
  owner: 'Full control, including billing and closing the business account.',
  admin: 'Runs the whole business day to day. Cannot close the account.',
  manager: 'Runs their own area — assigns work and approves within limits.',
  member: 'Records their own work and sees what they need to do it.',
};

/**
 * Numeric authority. Mirrors `public.organization_role_rank()`.
 *
 * `null` means "not a member", which ranks below every role rather than throwing:
 * callers overwhelmingly want "can this person do X", and a non-member cannot.
 */
export function roleRank(role: OrganizationRole | null | undefined): number {
  if (role === null || role === undefined) return 0;
  return ORGANIZATION_ROLES.indexOf(role) + 1;
}

/** Whether `actual` carries at least the authority of `minimum`. */
export function hasAtLeastRole(
  actual: OrganizationRole | null | undefined,
  minimum: OrganizationRole,
): boolean {
  return roleRank(actual) >= roleRank(minimum);
}

/** Renames the organization, changes its currency, timezone or sector. */
export function canEditOrganization(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'admin');
}

/** Invites, removes and re-roles people. */
export function canManageMembers(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'admin');
}

/** Closes the business account. Owner only. */
export function canDeleteOrganization(role: OrganizationRole | null | undefined): boolean {
  return hasAtLeastRole(role, 'owner');
}

/**
 * Whether `actor` may assign `target` to somebody.
 *
 * Nobody grants authority they do not hold — the same rule the membership
 * trigger enforces in SQL.
 */
export function canGrantRole(
  actor: OrganizationRole | null | undefined,
  target: OrganizationRole,
): boolean {
  return canManageMembers(actor) && roleRank(actor) >= roleRank(target);
}

/** The roles `actor` is able to hand out, for populating a picker. */
export function grantableRoles(
  actor: OrganizationRole | null | undefined,
): readonly OrganizationRole[] {
  return ORGANIZATION_ROLES.filter((role) => canGrantRole(actor, role));
}

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return (
    typeof value === 'string' &&
    (ORGANIZATION_ROLES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Business type
// ---------------------------------------------------------------------------

/**
 * Ordered for the onboarding picker rather than alphabetically: the sectors an
 * MSME is most likely to pick come first, and `other` is last so the list never
 * dead-ends.
 */
export const BUSINESS_TYPES = [
  'manufacturing',
  'construction',
  'retail',
  'wholesale',
  'services',
  'logistics',
  'hospitality',
  'healthcare',
  'education',
  'agriculture',
  'technology',
  'other',
] as const;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  manufacturing: 'Manufacturing',
  construction: 'Construction',
  retail: 'Retail',
  wholesale: 'Wholesale & distribution',
  services: 'Services',
  logistics: 'Logistics & transport',
  hospitality: 'Hospitality & food',
  healthcare: 'Healthcare',
  education: 'Education',
  agriculture: 'Agriculture',
  technology: 'Technology',
  other: 'Something else',
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === 'string' && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/** Ready for the design system's `Select`. */
export const businessTypeOptions: readonly { value: BusinessType; label: string }[] =
  BUSINESS_TYPES.map((value) => ({ value, label: BUSINESS_TYPE_LABELS[value] }));

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

/**
 * A curated list rather than all of ISO 4217. The column accepts any three
 * uppercase letters, so this constrains the picker, not the database — a business
 * needing something absent from here is a data entry away from being supported.
 */
export const CURRENCIES = [
  { code: 'INR', label: 'Indian rupee' },
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'AED', label: 'UAE dirham' },
  { code: 'SAR', label: 'Saudi riyal' },
  { code: 'QAR', label: 'Qatari riyal' },
  { code: 'KWD', label: 'Kuwaiti dinar' },
  { code: 'OMR', label: 'Omani rial' },
  { code: 'BHD', label: 'Bahraini dinar' },
  { code: 'SGD', label: 'Singapore dollar' },
  { code: 'MYR', label: 'Malaysian ringgit' },
  { code: 'IDR', label: 'Indonesian rupiah' },
  { code: 'PHP', label: 'Philippine peso' },
  { code: 'THB', label: 'Thai baht' },
  { code: 'VND', label: 'Vietnamese dong' },
  { code: 'BDT', label: 'Bangladeshi taka' },
  { code: 'LKR', label: 'Sri Lankan rupee' },
  { code: 'NPR', label: 'Nepalese rupee' },
  { code: 'PKR', label: 'Pakistani rupee' },
  { code: 'AUD', label: 'Australian dollar' },
  { code: 'NZD', label: 'New Zealand dollar' },
  { code: 'CAD', label: 'Canadian dollar' },
  { code: 'JPY', label: 'Japanese yen' },
  { code: 'CNY', label: 'Chinese yuan' },
  { code: 'HKD', label: 'Hong Kong dollar' },
  { code: 'KRW', label: 'South Korean won' },
  { code: 'ZAR', label: 'South African rand' },
  { code: 'KES', label: 'Kenyan shilling' },
  { code: 'NGN', label: 'Nigerian naira' },
  { code: 'EGP', label: 'Egyptian pound' },
  { code: 'TRY', label: 'Turkish lira' },
  { code: 'BRL', label: 'Brazilian real' },
  { code: 'MXN', label: 'Mexican peso' },
  { code: 'CHF', label: 'Swiss franc' },
  { code: 'SEK', label: 'Swedish krona' },
  { code: 'NOK', label: 'Norwegian krone' },
  { code: 'DKK', label: 'Danish krone' },
  { code: 'PLN', label: 'Polish zloty' },
  { code: 'ILS', label: 'Israeli shekel' },
] as const;

export const DEFAULT_CURRENCY = 'INR';

/** Matches the `organizations_currency_format` CHECK constraint exactly. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

export const currencyOptions: readonly { value: string; label: string }[] = CURRENCIES.map(
  ({ code, label }) => ({ value: code, label: `${code} — ${label}` }),
);

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Fallback zone list for runtimes without `Intl.supportedValuesOf`.
 *
 * Every entry must be a real IANA name: the database validates the chosen value
 * against `pg_timezone_names` and rejects anything it does not recognise, so an
 * invented name here would surface as a confusing save failure rather than as a
 * bad option.
 */
const FALLBACK_TIMEZONES: readonly string[] = [
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Qatar',
  'Asia/Kuwait',
  'Asia/Muscat',
  'Asia/Bahrain',
  'Asia/Tehran',
  'Asia/Jerusalem',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Manila',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Africa/Cairo',
  'Africa/Nairobi',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Madrid',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Warsaw',
  'Europe/Istanbul',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'UTC',
];

/**
 * `Intl.supportedValuesOf` is not in every runtime's typings or every engine, so
 * it is probed structurally rather than assumed. The intersection keeps this
 * free of `any`.
 */
type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => string[];
};

/**
 * Every IANA zone this runtime knows, unioned with the curated list.
 *
 * The union is not belt-and-braces — it fixes a real defect. `supportedValuesOf`
 * returns the names the runtime's ICU build considers CANONICAL, and builds disagree:
 * an older CLDR reports `Asia/Calcutta` and `Europe/Kiev`, a newer one reports
 * `Asia/Kolkata` and `Europe/Kyiv`. On an older build `Asia/Kolkata` — the value
 * `DEFAULT_TIMEZONE` pre-fills onboarding with — is absent from the list, so it fails
 * `isKnownTimezone`, never appears in the picker, and an Indian business cannot
 * submit the onboarding form without first changing a field that was already correct.
 *
 * Postgres has no such problem: `pg_timezone_names` carries the backward-compatibility
 * links alongside the modern names, so both spellings are accepted by the trigger.
 * Unioning brings the client into line with the database rather than the other way
 * round. On a build with older canonical names the picker offers both spellings of a
 * handful of zones; both are real, both save, and that is a far smaller cost than a
 * default value the form refuses.
 */
export const availableTimezones: readonly string[] = (() => {
  const supportedValuesOf = (Intl as IntlWithSupportedValues).supportedValuesOf;

  const fromRuntime = ((): readonly string[] => {
    if (typeof supportedValuesOf !== 'function') return [];
    try {
      return supportedValuesOf('timeZone');
    } catch {
      // A partial ICU build can throw rather than return an empty list.
      return [];
    }
  })();

  // Sorted so the picker reads predictably whichever half a name came from.
  return [...new Set([...fromRuntime, ...FALLBACK_TIMEZONES])].sort((a, b) => a.localeCompare(b));
})();

/**
 * The device's zone, used to pre-fill onboarding.
 *
 * A guess, and labelled as one in the UI: the business's operating timezone is
 * not necessarily where the person signing up happens to be standing.
 */
export function guessTimezone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Exact, case-sensitive membership — deliberately not a "can the runtime use it"
 * probe. `new Intl.DateTimeFormat('en', { timeZone: value })` accepts `IST`, `utc`
 * and `asia/kolkata`, none of which appear in `pg_timezone_names`; the trigger
 * compares `tz.name = new.timezone`, so a looser client check would hand the user a
 * database error in place of an inline one.
 */
export function isKnownTimezone(value: unknown): value is string {
  return typeof value === 'string' && availableTimezones.includes(value);
}

export const timezoneOptions: readonly { value: string; label: string }[] =
  availableTimezones.map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export const ORGANIZATION_NAME_MIN = 2;
export const ORGANIZATION_NAME_MAX = 120;

/**
 * Brings a typed name into the shape the column accepts.
 *
 * The table has both a length constraint and `name = btrim(name)`, so an
 * untrimmed name is rejected outright. Normalising here means a trailing space
 * never becomes a validation error the user cannot see.
 */
export function normalizeOrganizationName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
