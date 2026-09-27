/**
 * Trackit X — the organization role ladder.
 *
 * ── Why this is a separate file from `organization.ts` ───────────────────────
 * `organization.ts` needs two unions from `@/types/database`, and it declares its
 * authority helpers alongside them. That is the right shape for the Expo app and
 * the wrong shape for the AI Gateway, which runs on Deno.
 *
 * Deno includes type-only imports when it builds a module graph, and the Supabase
 * CLI's local `functions serve` bind-mounts only the files its own scanner walks
 * — a scanner that prunes `import type`. So a module reachable from an Edge
 * Function only through a type import resolves for one and not the other, and the
 * symptom is a function that will not boot: every request returns 503, with
 * `Module not found "…/src/types/database.ts"` in the runtime log. The gateway
 * found this by being run, which is the only way it could have been found.
 *
 * The fix is to keep the ladder where the server can reach it and let
 * `organization.ts` re-export it, so no app import changed. The two remain one
 * ladder: `roles.ts` owns the behaviour, and `organization.ts` owns the alias.
 *
 * ── The type is declared here, and checked against the schema ───────────────
 * `OrganizationRole` is restated in this file because importing it would put the
 * edge graph straight back where it started. That makes drift possible in
 * principle, so it is made impossible in practice by a compile-time assertion in
 * `tests/unit/roles.test.ts`, which runs in the app typecheck:
 *
 *     const _sameUnion: OrganizationRole[] = [] as DatabaseOrganizationRole[];
 *
 * Adding a role to the migration without adding it here fails `npm run
 * typecheck`. The database remains authoritative, which is what
 * `organization.ts` has always said.
 */

/**
 * Every role, ascending by authority.
 *
 * The order is load-bearing: `roleRank` is the 1-based index, which is exactly
 * what `public.organization_role_rank()` returns. Reordering this array silently
 * changes the meaning of every comparison, so it is asserted in the unit tests.
 */
export const ORGANIZATION_ROLES = ['member', 'manager', 'admin', 'owner'] as const;

/**
 * The four roles the database knows about.
 *
 * Mirrors `organization_role` in the schema. Kept in ascending authority to match
 * `ORGANIZATION_ROLES`; the two orderings are unrelated and neither is derived
 * from the other.
 */
export type OrganizationRole = 'member' | 'manager' | 'admin' | 'owner';

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
