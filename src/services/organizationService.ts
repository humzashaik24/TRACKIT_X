/**
 * Trackit X — organization service.
 *
 * Reads and writes the tenancy root: which organizations the signed-in user
 * belongs to, with what role, and the organization record itself.
 *
 * ── Why every query here looks unguarded ────────────────────────────────────
 * None of these functions filter by user. `listMemberships()` says
 * `select('*')` with no `.eq('user_id', …)`, and that is correct rather than a
 * bug: `organization_members` has RLS enabled, and its SELECT policy already
 * restricts every row to organizations the caller belongs to. Adding a client
 * filter would be defence in depth against nothing — the client cannot widen
 * what the policy allows, and a client-side filter cannot narrow what a
 * malicious client asks for. The database is the enforcement point.
 *
 * The corollary is the important one: a cross-tenant read does not error, it
 * returns NOTHING. Code here must therefore treat "no rows" as the ordinary
 * outcome and never interpret it as a failure.
 */
import { supabase } from '@/lib/supabase';
import type {
  BusinessType,
  OrganizationMemberRow,
  OrganizationRole,
  OrganizationRow,
} from '@/types/database';
import { appError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { attempt, err, ok, type ActionResult } from '@/utils/result';

const log = logger.child({ module: 'organizationService' });

/** A membership together with the organization it grants access to. */
export interface Membership {
  readonly membershipId: string;
  readonly organization: OrganizationRow;
  readonly role: OrganizationRole;
  readonly permissions: readonly string[];
  readonly joinedAt: string;
}

export interface CreateOrganizationParams {
  name: string;
  businessType: BusinessType;
  timezone: string;
  currency: string;
}

export interface OrganizationPatch {
  name?: string;
  businessType?: BusinessType;
  timezone?: string;
  currency?: string;
}

/**
 * Every organization the signed-in user belongs to, newest membership first.
 *
 * An empty array is a legitimate answer, and the one the router keys off to send
 * a brand-new user to onboarding.
 */
export async function listMemberships(): Promise<ActionResult<readonly Membership[]>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('organization_members')
      .select(
        'id, organization_id, user_id, role, permissions, created_at, updated_at, organizations(*)',
      )
      .order('created_at', { ascending: false });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Could not list memberships', { code: result.error.code });
    return result;
  }

  const memberships: Membership[] = [];
  for (const row of result.value) {
    const organization = row.organizations;
    // A membership whose organization did not come back means the join was
    // filtered by RLS — which should be impossible, since the policy on
    // `organizations` admits exactly the rows this user is a member of. Skipped
    // rather than crashed: one inconsistent row must not blank the whole app.
    if (organization === null) {
      log.warn('Membership without a visible organization', { membershipId: row.id });
      continue;
    }
    memberships.push({
      membershipId: row.id,
      organization,
      role: row.role,
      permissions: row.permissions,
      joinedAt: row.created_at,
    });
  }

  return ok(memberships);
}

/**
 * One organization by id.
 *
 * Resolves to `NOT_FOUND` when the caller is not a member. That wording is
 * deliberate and is the same answer a genuinely missing id produces: replying
 * "permission denied" would confirm the organization exists, which is a fact the
 * caller is not entitled to.
 */
export async function getOrganization(
  organizationId: string,
): Promise<ActionResult<OrganizationRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', organizationId)
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) return result;
  if (result.value === null) {
    return err(appError('NOT_FOUND', 'Organization not visible to the caller'));
  }
  return ok(result.value);
}

/**
 * Creates an organization and makes the caller its owner.
 *
 * Goes through the `create_organization` RPC rather than an INSERT, and it has to:
 * `authenticated` holds no INSERT privilege on `organizations` and there is no
 * INSERT policy, so a direct insert fails with 42501. Two things follow from
 * routing creation through one `SECURITY DEFINER` function:
 *
 *   · The organization and its first owner membership are created in ONE
 *     transaction, so an ownerless organization cannot exist.
 *   · The role is not a parameter. The caller becomes `owner` of the thing they
 *     just created and cannot ask to be anything else — which is what stops a
 *     client assigning itself elevated permissions.
 */
export async function createOrganization(
  params: CreateOrganizationParams,
): Promise<ActionResult<OrganizationRow>> {
  const result = await attempt(async () => {
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: params.name,
      p_business_type: params.businessType,
      p_timezone: params.timezone,
      p_currency: params.currency,
    });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Organization creation failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    return err(appError('UNKNOWN', 'create_organization returned no row'));
  }

  log.info('Organization created', { organizationId: result.value.id });
  return ok(result.value);
}

/**
 * Updates organization details.
 *
 * The UPDATE policy requires at least `admin`, and a member without it matches
 * zero rows rather than erroring — so a silent no-op is the shape a refusal
 * arrives in. `.select().maybeSingle()` is what converts that silence into a
 * result the caller can act on.
 */
export async function updateOrganization(
  organizationId: string,
  patch: OrganizationPatch,
): Promise<ActionResult<OrganizationRow>> {
  const changes: Record<string, string> = {};
  if (patch.name !== undefined) changes['name'] = patch.name;
  if (patch.businessType !== undefined) changes['business_type'] = patch.businessType;
  if (patch.timezone !== undefined) changes['timezone'] = patch.timezone;
  if (patch.currency !== undefined) changes['currency'] = patch.currency;

  if (Object.keys(changes).length === 0) {
    return err(appError('VALIDATION_FAILED', 'No organization fields to update'));
  }

  const result = await attempt(async () => {
    const { data, error } = await supabase
      .from('organizations')
      .update(changes)
      .eq('id', organizationId)
      .select('*')
      .maybeSingle();
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Organization update failed', { code: result.error.code });
    return result;
  }
  if (result.value === null) {
    // Either the row is invisible or the role is too low. Both are reported the
    // same way for the reason described on `getOrganization`.
    return err(appError('PERMISSION_DENIED', 'Update matched no visible organization row'));
  }
  return ok(result.value);
}

/**
 * How many people belong to an organization.
 *
 * `head: true` asks PostgREST for the count without the rows — the dashboard
 * needs the number, not the list, and the list is personal data.
 */
export async function countMembers(organizationId: string): Promise<ActionResult<number>> {
  const result = await attempt(async () => {
    const { count, error } = await supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId);
    if (error !== null) throw error;
    return count;
  }, 'NETWORK_UNAVAILABLE');

  if (!result.ok) {
    log.warn('Member count failed', { code: result.error.code });
    return result;
  }
  // PostgREST omits the count header in some configurations; 0 would be a lie,
  // so an absent count is reported as a failure the UI can retry.
  if (result.value === null) {
    return err(appError('DEPENDENCY_FAILED', 'Member count was not returned'));
  }
  return ok(result.value);
}

/** The members of an organization. Visible only to members of that organization. */
export async function listMembers(
  organizationId: string,
): Promise<ActionResult<readonly OrganizationMemberRow[]>> {
  return attempt(async () => {
    const { data, error } = await supabase
      .from('organization_members')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');
}

/**
 * The caller's role in an organization, straight from the database helper.
 *
 * Preferred over deriving it from a membership row the client already holds when
 * the answer gates something meaningful: `organization_role_of` is the same
 * `SECURITY DEFINER` function the RLS policies consult, so its answer cannot
 * disagree with what the policies will do.
 */
export async function getRole(
  organizationId: string,
): Promise<ActionResult<OrganizationRole | null>> {
  return attempt(async () => {
    const { data, error } = await supabase.rpc('organization_role_of', {
      organization: organizationId,
    });
    if (error !== null) throw error;
    return data;
  }, 'NETWORK_UNAVAILABLE');
}
