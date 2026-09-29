# Phase 42 — Hosted privilege contract

**Status: CORRECTION RECORDED — Phase 42 is not complete.** This document records a security-contract defect found against the hosted Supabase project and the forward migration that corrects it. The migration has **not** been applied to the hosted project. See [remaining work](#remaining-phase-42-verification-work).

---

## Summary

Hosted RLS and security verification exposed a privilege contract that the repository did not enforce. Three separate guarantees were true in the migration source and false in the hosted database:

| # | Guarantee | Hosted reality |
| --- | --- | --- |
| 1 | `authenticated` cannot `UPDATE` or `DELETE` `public.activity_log` | it held both |
| 2 | `service_role` has no table privilege on `public.ai_provider_configs` | it held `SELECT`/`INSERT`/`UPDATE`/`DELETE` |
| 3 | `anon` and `authenticated` cannot `EXECUTE` any `public.ai_gateway_*` function | both held `EXECUTE` on all six |

All three have one cause. The corrections are recorded in `supabase/migrations/20260929120000_privilege_contract.sql`, which is forward-only and adds no grant of any kind.

---

## Root cause: default privileges, and an absence written as a contract

Every migration in this repository states its privileges as an **absence**: the role is not named in a `GRANT`, therefore the role does not hold the privilege. `20260825120000_organizations_and_members.sql` states the premise in a comment:

```sql
-- Supabase no longer auto-exposes new objects to the Data API roles, so every
-- grant below is deliberate.
```

That premise does not hold on a hosted project. The hosted `public` schema carries default privileges for the role that runs migrations:

```sql
alter default privileges in schema public
  grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to postgres, anon, authenticated, service_role;
```

These apply at `CREATE` time. Every table and every function in this schema was therefore already fully granted to `anon`, `authenticated` and `service_role` before a single `GRANT` in these migrations ran.

**A later `GRANT` can only add.** No statement in the earlier migrations subtracts a privilege it never names. So `grant select, insert on public.activity_log` produced a table on which `authenticated` held `SELECT`, `INSERT`, *and* the `UPDATE`/`DELETE` it inherited from the default — and no statement anywhere could remove them.

This is not a hosted-only quirk in the sense of being unpredictable. It is a difference between what a locally-provisioned database happens to do and what a hosted one always does. A privilege contract asserted only against a local database is a claim about the local database.

---

## Why `REVOKE ... FROM public` was not enough

All four migrations close every function with `revoke execute ... from public`, and `20260927130000_ai_gateway_vault.sql` explains why at length: PostgreSQL grants `EXECUTE` to the `PUBLIC` pseudo-role on every new function, so an unrevoked `SECURITY DEFINER` function is callable by anyone.

That reasoning is correct and the statement is necessary. It was not sufficient, because the hosted grant does not live on `PUBLIC`.

- `REVOKE ... FROM public` removes the ACL entry whose grantee is `0`.
- The hosted default privileges create three further, independent ACL entries, held by the real role OIDs of `anon`, `authenticated` and `service_role`.
- Function privileges aggregate across every applicable ACL entry. Removing grantee `0` leaves the other three in force, so `anon` and `authenticated` retain `EXECUTE`.

The two mechanisms are not alternatives and neither subsumes the other. Both are required: revoke from `PUBLIC` for the implicit grant, and revoke from each named role for the hosted one.

### Why the repository's own test did not catch it

`supabase/tests/rls_isolation.sql` asserts the `PUBLIC` grant is gone by reading the catalog directly:

```sql
select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
cross join lateral aclexplode(f.proacl) acl
where n.nspname = 'public' and f.proname like 'ai\_gateway\_%'
  and acl.grantee = 0
```

That assertion passed. The assertions that name `authenticated` and `anon` explicitly — `has_function_privilege('authenticated', fn, 'EXECUTE')` — are the ones that failed. **A check that reads the pseudo-role cannot see a named role.** The test was correct as written and the migration was wrong; the gap was that the test suite verified one of the two mechanisms and the project depended on both.

---

## The three hosted failures

### 1. `activity_log` was not append-only

`20260925120000_core_business_data.sql` grants `select, insert` to `authenticated` and deliberately omits `update` and `delete`. The omission **was** the intent, and the migration comment says so: *"append-only for every role that can reach it at all."*

Hosted, the schema default supplied both omitted privileges, so the grant half of the contract did not exist. RLS carries no `UPDATE` or `DELETE` policy on the table, so a client write was still refused — but as a **policy** refusal, not a **privilege** refusal. The table was one careless `GRANT` away from being mutable, because only one of the two independent defences was actually in place.

There is a second-order effect on the test suite. `rls_isolation.sql` sections 14.8 and 14.9 assert that a client `UPDATE` and `DELETE` raise `insufficient_privilege`. RLS policy denial and privilege denial both raise SQLSTATE `42501`, so those assertions **pass whether or not the grant is correct**. They cannot distinguish the two causes. That is why this defect reached a hosted project undetected despite an existing test.

### 2. `service_role` could read `ai_provider_configs` directly

The intended architecture is stated verbatim in the Phase 36 header:

> Phase 35 deliberately granted `service_role` no table privileges on `ai_provider_configs` — it granted `EXECUTE` on two functions and nothing else.

`service_role` is a `BYPASSRLS` role but not a superuser, and `BYPASSRLS` only bypasses row policies — without a column privilege it cannot read a row at all. That property is what makes the function funnel the only possible path to credential state.

Phase 35 granted `service_role` nothing, and never revoked the default-privilege grant either. The intent was documented; the enforcement was never written. Hosted, `service_role` held all four table privileges, which meant the Edge Function had an RLS-bypassing read of every organization's `secret_reference` with membership checked only in TypeScript — precisely the outcome the Phase 36 comment set out to prevent.

The in-database `auth.role()` checks were never at risk, so this was not an exploitable path on its own. It was an unenforced boundary that the rest of the design was relying on.

### 3. `anon` and `authenticated` could `EXECUTE` the gateway functions

`revoke execute ... from public` on all six `ai_gateway_*` functions removed the `PUBLIC` grant and left the two named-role grants intact, as described above. Most consequentially, `ai_gateway_read_credential` — the only function in the schema that returns plaintext — was reachable by both client roles at the privilege layer.

The practical exposure was neutralised: every one of these functions opens with `coalesce((select auth.role()), '') <> 'service_role'` and raises `42501`, so no browser path reached the plaintext. The defect is at the privilege layer, and it mattered because a privilege contract is what survives a future edit to a function body.

Every caller of these functions authenticates with the service-role key (`supabase/functions/ai-gateway/vault.ts`, `configReader.ts`, `index.ts` — all via `createClient(url, serviceRoleKey, …)`). Revoking `EXECUTE` from `anon` and `authenticated` therefore removes no reachable code path.

---

## The corrective migration

`supabase/migrations/20260929120000_privilege_contract.sql`. Forward-only, `REVOKE`-only. It creates, alters and drops nothing, and grants nothing. Every statement is idempotent, so re-running it is a no-op.

```sql
-- 1. activity_log is append-only
revoke update, delete
on table public.activity_log
from anon, authenticated, service_role;

-- 2. ai_provider_configs is accessed through controlled functions
revoke all
on table public.ai_provider_configs
from service_role;

-- 3. eight functions, revoked from anon and authenticated
revoke execute on function public.ai_gateway_resolve_config(uuid, uuid, public.organization_role) from anon, authenticated;
revoke execute on function public.ai_gateway_read_config(uuid, uuid) from anon, authenticated;
revoke execute on function public.ai_gateway_read_credential(uuid, uuid) from anon, authenticated;
revoke execute on function public.ai_gateway_role_of(uuid, uuid) from anon, authenticated;
revoke execute on function public.ai_gateway_store_credential(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.ai_gateway_delete_credential(uuid, uuid) from anon, authenticated;
revoke execute on function public.set_ai_provider_secret_reference(uuid, text) from anon, authenticated;
revoke execute on function public.record_ai_connection_test(uuid, public.ai_connection_status) from anon, authenticated;

-- 4. default-privilege prevention
alter default privileges in schema public revoke all on tables    from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
```

### Scope deliberately preserved

| Preserved | Why it is not in this file |
| --- | --- |
| All `SECURITY DEFINER` functions | The migration contains no `CREATE` and no `ALTER FUNCTION`; not one function is redefined. |
| `set search_path = ''` on every function | Same reason. A redefine would be the risk, so the file does not redefine anything. |
| RLS policies | The file contains no `CREATE POLICY` and no `ALTER TABLE`. Enabling, forcing or dropping RLS is out of scope. |
| The RPC access model | `set_default_ai_provider` and `clear_default_ai_provider` keep their `authenticated` grant. The two Phase 35 server-side writers and all six gateway functions keep their `service_role` grant. |
| The Phase 35 column-level grant set | `ai_provider_configs` column grants for `authenticated` are untouched; only `service_role` loses table access. |

All eight function signatures were verified character-for-character against the `CREATE OR REPLACE FUNCTION` declarations in the earlier migrations before the file was written. All statements are `REVOKE`, which is order-independent and safe to apply to a database where the objects already exist.

### Why statement 4 is necessary but not sufficient

The three `ALTER DEFAULT PRIVILEGES` statements stop the drift from recurring on a table added next month. They are **not retroactive**: they change what future objects created by the executing role will be granted, and they change nothing about objects that already exist. Statements 1 to 3 are what correct the current database; statement 4 is what keeps the correction from being needed again.

They are also scoped to the role that executes them — on the hosted project, the `postgres` migration runner. A migration applied as a different role would not alter the `postgres` defaults. This is why the file is written as part of the migration chain rather than as a one-off manual fix.

---

## Hosted remediation versus repository reproducibility

These are two different states, and conflating them is how this defect survived in the first place.

**The hosted database was manually corrected during verification.** The three hosted failures had to be resolved in the live project for verification to proceed. That work was applied directly to the hosted database and left no trace in the migration chain.

**The repository now describes that same state.** `20260929120000_privilege_contract.sql` encodes the corrections as a forward migration, so a fresh environment — a local reset, a new project, a teammate's machine, a CI database — produces the privilege contract the hosted project was verified to have.

Until this migration is applied to the hosted project:

- hosted and repository **differ**. The hosted database has the manual corrections; the migration history does not contain them.
- A `supabase db reset`, a shadow database, or any fresh project would reproduce the **un**corrected schema. The hosted database's current correctness is not reproducible from Git.
- Recording the remediation as a migration is what makes the hosted state the output of the repository rather than a manual divergence from it.

**The migration has deliberately not been applied to the hosted project.** Applying it is the next step, and it should happen through the supported hosted workflow after the project reference is re-confirmed. It is `REVOKE`-only and idempotent, so the manual corrections already present make it a no-op rather than a conflict.

### The durable lesson

The repository's privilege contract was written entirely in terms of grants, and verified entirely against a database where the ambient defaults happened to be absent. The contract was therefore never actually tested — only its local instance was.

Two changes follow, and only the first is done:

1. The contract is now stated in the migration chain and will be enforced wherever migrations run. *(This file.)*
2. The test suite should assert `has_table_privilege` / `has_function_privilege` against the **named** roles for the objects in this contract, not only the `grantee = 0` catalog check, and should distinguish a privilege refusal from a policy refusal when it means something. *(Not done. `supabase/tests/rls_isolation.sql` is unchanged by design, and sections 14.8 / 14.9 remain unable to distinguish the two causes.)*

---

## Remaining Phase 42 verification work

Phase 42 is **not complete**. Outstanding:

1. **Apply** `20260929120000_privilege_contract.sql` to the hosted project through the supported hosted workflow, after re-confirming the intended project reference. Not done in this task.
2. **Re-verify the three corrected contracts on hosted** after application: `activity_log` `UPDATE`/`DELETE` for `authenticated`; `service_role` table privileges on `ai_provider_configs`; `anon`/`authenticated` `EXECUTE` on all six `ai_gateway_*` functions plus the two Phase 35 writers.
3. **Confirm hosted and repository now agree**, so the manual remediation is reproducible from the migration chain.
4. **Audit the objects this migration does not cover.** The same default-privilege mechanism also granted `anon` and `service_role` `ALL` on `organizations`, `organization_members`, `departments`, `employees`, `projects`, `project_members` and `tasks`, and granted `EXECUTE` to the client roles on the 25 functions declared in the first three migrations. Those statements were outside the scope of this correction and remain unreconciled.
5. **Complete the rest of Phase 42** — hosted Auth flows, organization isolation, live CRUD, Vault, Edge Function deployment and authorization, and disposable-data/secret cleanup — per [hosted status](PHASE_42_HOSTED_SUPABASE.md) and [RLS verification status](PHASE_42_RLS_LIVE_VERIFICATION.md).
6. **Strengthen the test suite** as described above, so the contract is asserted against named roles and a local run can no longer pass while a hosted run fails.

No hosted change was made in producing this document beyond the manual remediation described above, and no credential, token, project reference, or provider secret appears in this file or in Git.
