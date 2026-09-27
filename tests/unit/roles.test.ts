/**
 * Role ladder — the assertions that keep two declarations of the same four roles
 * from drifting apart.
 *
 * ── Why there are two declarations at all ────────────────────────────────────
 * `src/domain/roles.ts` declares `OrganizationRole` as a literal union so that the
 * AI Gateway, which runs on Deno, can load the role ladder. `src/types/database.ts`
 * declares it because it mirrors the Postgres enum, and the database is
 * authoritative. `src/domain/organization.ts` re-exports the former, so the app
 * has one import path and no idea this exists.
 *
 * That is a deliberate trade: a duplicate declaration, fenced in by the
 * assertions below so it cannot rot. The alternative was the AI Gateway reaching
 * `@/types/database` through a type-only import, which Deno resolves and the
 * Supabase CLI's local `functions serve` does not mount — a function that cannot
 * boot at all, returning 503 for every request. A duplicate that a test checks
 * beats a single definition that prevents the server from starting.
 *
 * These assertions are compile-time. `npm run typecheck` is the check; there is
 * nothing to run here.
 */
import { hasAtLeastRole, ORGANIZATION_ROLES, roleRank, ROLE_LABELS } from '@/domain/roles';
import type { OrganizationRole as LadderOrganizationRole } from '@/domain/roles';
import type { OrganizationRole as SchemaOrganizationRole } from '@/types/database';
import { ORGANIZATION_ROLES as ROLES_FROM_ORGANIZATION } from '@/domain/organization';

// The DECLARED type on each side, not a union derived from the array. Deriving it
// would make the assertion circular and it could never fail: adding a role to
// `ORGANIZATION_ROLES` without adding it to the type declaration would widen the
// derived union and quietly satisfy a check that exists to catch exactly that.
//
// Each direction alone would tolerate a missing member — `A` assignable to `B`
// holds when A is a subset of B. Both together hold only when the unions are
// identical, so adding a role to the migration without adding it here fails
// `npm run typecheck`.
const ladderAcceptsSchema: SchemaOrganizationRole[] = [] as LadderOrganizationRole[];
const schemaAcceptsLadder: LadderOrganizationRole[] = [] as SchemaOrganizationRole[];

// The ladder is ascending by authority, and `roleRank` is that order's 1-based
// index — which is exactly what `public.organization_role_rank()` returns in SQL.
// Reordering the array would silently change every comparison in the app.
const EXPECTED_ASCENDING = ['member', 'manager', 'admin', 'owner'] as const;

describe('organization role ladder', () => {
  it('declares the same four roles the database enum declares', () => {
    expect(ladderAcceptsSchema).toEqual([]);
    expect(schemaAcceptsLadder).toEqual([]);
  });

  it('is ordered by ascending authority', () => {
    expect(ORGANIZATION_ROLES).toEqual(EXPECTED_ASCENDING);
  });

  it('ranks a non-member below every role rather than throwing', () => {
    // Callers overwhelmingly ask "can this person do X", and a non-member cannot.
    expect(roleRank(null)).toBe(0);
    expect(roleRank(undefined)).toBe(0);
    expect(roleRank('member')).toBe(1);
    expect(roleRank('owner')).toBe(4);
  });

  it('answers "at least" by rank, so owner satisfies every minimum', () => {
    expect(hasAtLeastRole('owner', 'member')).toBe(true);
    expect(hasAtLeastRole('member', 'owner')).toBe(false);
    expect(hasAtLeastRole(null, 'member')).toBe(false);
    expect(hasAtLeastRole(undefined, 'member')).toBe(false);
    expect(hasAtLeastRole('member', 'member')).toBe(true);
  });

  it('labels every role', () => {
    for (const role of ORGANIZATION_ROLES) {
      expect(ROLE_LABELS[role]).toEqual(expect.any(String));
      expect(ROLE_LABELS[role].length).toBeGreaterThan(0);
    }
  });

  it('is reachable through the organization module under its original name', () => {
    // The re-export is what keeps every existing app import working. If this ever
    // fails, the extraction changed the public API of a module the whole app uses.
    expect(ROLES_FROM_ORGANIZATION).toBe(ORGANIZATION_ROLES);
  });
});
