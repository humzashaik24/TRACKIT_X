# Phase 41 — Database Readiness

**Trackit X — static review of the migrations that a hosted Supabase project
must apply, with an explicit separation between what is verified statically and
what still requires execution against a hosted database. No local Supabase was
started in this phase, and no live SQL verification is claimed below.**

## 1. Migration inventory and ordering

| Order | Migration | Adds | Depends on |
|---|---|---|---|
| 1 | `20260825120000_organizations_and_members.sql` | `organizations`, `organization_members`, role enum, tenancy helpers (`is_organization_member`, `has_organization_role`, `organization_role_of`, `employee_id_for_user`), `create_organization` RPC, RLS, grants | — (foundation) |
| 2 | `20260925120000_core_business_data.sql` | `departments`, `employees`, `projects`, `project_members`, `tasks`, `activity_log`, enum types, cross-org reference guards | 1 (reuses its helpers) |
| 3 | `20260927120000_ai_provider_configs.sql` | `ai_provider_configs`, `ai_provider`/`ai_connection_status` enums, `set_default_ai_provider`, `clear_default_ai_provider`, column-level grants, RLS | 1, 2 |
| 4 | `20260927130000_ai_gateway_vault.sql` | five `ai_gateway_*` SECURITY DEFINER RPCs, `service_role`-only EXECUTE | 1, 3 |

The ordering is correct: each migration only references objects created by
earlier files, and the tenancy helpers are defined once in the foundation and
reused everywhere else instead of being redefined.

## 2. STATICALLY VERIFIED

The following hold of the migration files as they exist at HEAD:

### 2.1 RLS and organization scoping

- Every business table and `ai_provider_configs` has `enable row level security`
  and a SELECT policy gated on `is_organization_member(organization_id)` (or the
  project-derived equivalent for `project_members`).
- INSERT/UPDATE/DELETE policies use `has_organization_role(...)` with role
  minimums (member for self-service rows, manager for assignment/editing,
  admin for provider configuration).
- Cross-organization reference guards refuse a row that references a record of
  another organization at write time.
- `anon` is granted nothing; `authenticated` is granted exactly the operations
  the policies allow.

### 2.2 SECURITY DEFINER safety (`search_path`)

- Every SECURITY DEFINER function in migrations 3 and 4 declares
  `set search_path = ''`. The functions are: `set_default_ai_provider`,
  `clear_default_ai_provider`, `set_ai_provider_secret_reference`,
  `record_ai_connection_test` (migration 3), and `ai_gateway_resolve_config`,
  `ai_gateway_read_config`, `ai_gateway_role_of`, `ai_gateway_read_credential`,
  `ai_gateway_store_credential`, `ai_gateway_delete_credential` (migration 4).
- `auth.role()` is checked inside each gateway RPC (only `service_role` may
  execute) and the acting user is an explicit `p_actor_id` parameter verified
  against `organization_members` — never `auth.uid()`, which would be the
  service identity under a service-role JWT.

### 2.3 Grants / revokes / column privileges

- `ai_provider_configs` begins with `revoke all … from anon, authenticated`,
  then grants SELECT on a safe column list **that excludes `secret_reference`**,
  and INSERT/UPDATE on the writeable subset only. `connection_status`,
  `is_default`, `credential_present` and timestamps are not client-writable.
- `service_role` holds **no table privileges** on `ai_provider_configs`; its only
  reach is EXECUTE on the gateway RPCs.
- `credential_present` is an STORED GENERATED column derived from
  `secret_reference` — the only credential fact the client can read.
- `record_ai_connection_test`, `set_ai_provider_secret_reference` are granted to
  `service_role` only.

### 2.4 Indexes and constraints
## 3. REQUIRES HOSTED DATABASE VERIFICATION

These are NOT verified in Phase 41 and must be executed against a hosted
Supabase project before activation:

1. **Migration application order** — applying files 1–4 to a hosted empty
   project and confirming each succeeds and is recorded.
2. **`supabase/tests/rls_isolation.sql`** — executing the full 2,998-line file
   against the hosted database (sections 1–16, 17, 18 — 241+ assertions per the
   Phase 36 record) with zero failures.
3. **Real-role RLS behavior** — that `anon`/`authenticated`/`service_role`
   requests behave as the grants predict under the hosted Auth configuration
   (JWT signing, role claims, `is_authenticated()`).
4. **Vault availability** — that the `vault` schema is enabled and
   `vault.create_secret` / `vault.secrets` are executable by `service_role`, and
   that the five gateway RPCs return/refuse as documented.
5. **Function privilege behavior** — that the `SECURITY DEFINER` + `search_path`
   functions behave identically in the hosted Postgres version, and that the
   indistinguishable refusals (`42501` covering not-member / not-admin /
   no-such-row) hold.
6. **Partial unique index enforcement** — that two concurrent
   `set_default_ai_provider` calls cannot produce two defaults per organization.
7. **Realtime publication** — `supabase_realtime` membership (guarded in the
   foundation migration) behaves on the hosted project.
8. **Index/planner behavior** — query plans for the org-scoped SELECT paths with
   realistic data volumes.

Any of these that fails is a defect to fix with a regression assertion added to
`supabase/tests/rls_isolation.sql` or a follow-up migration — not a claim to
paper over.

## 4. Explicit non-claims

- No local Supabase was started (`supabase start`/`db reset` are prohibited this
  phase).
- No hosted database applied these migrations in Phase 41.
- RLS is attested statically by policy review, not by execution.

- `ai_provider_configs_org_idx` on `organization_id`.
- `ai_provider_configs_single_default_idx` — a **partial unique index on
  `is_default where is_default`**, which is what enforces "at most one default
  provider per organization" at the database level (the per-organization scope
  is carried by `organization_id` being part of the index key).
- The one-default invariant is asserted in `supabase/tests/rls_isolation.sql`
  section 17 (executed locally in earlier phases).

### 2.5 What Phase 41 added

No migration file was modified. Phase 41 is a readiness audit; the migrations
are already consistent with the client contract. The changes in this phase are
client-side configuration guards (`src/config/envSchema.ts`) and a pure
derivation extraction (`src/contexts/OrganizationContext.tsx`) — neither touches
the database.