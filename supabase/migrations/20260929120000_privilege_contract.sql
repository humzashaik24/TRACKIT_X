-- ---------------------------------------------------------------------------
-- Trackit X -- Privilege contract (Phase 42 hosted remediation).
--
-- FORWARD ONLY. This migration corrects a privilege drift that was discovered
-- against the hosted Supabase project. It is additive in effect and destructive
-- in no way: it contains REVOKE statements only. It creates, alters and drops
-- nothing.
--
-- The four migrations before it are left untouched. They have already been
-- applied to the hosted project, and editing them would change nothing there
-- while making a fresh reset disagree with production.
--
-- ---------------------------------------------------------------------------
-- ROOT CAUSE
-- ---------------------------------------------------------------------------
--
-- Every earlier migration in this repository writes its privileges as an
-- ABSENCE: "I did not grant it, therefore the role does not hold it." Phase 34
-- states the premise outright:
--
--   -- Supabase no longer auto-exposes new objects to the Data API roles, so
--   -- every grant below is deliberate.
--
-- That premise does not hold on a hosted project. The hosted `public` schema
-- carries default privileges for the role that runs migrations:
--
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--   alter default privileges in schema public
--     grant all on functions to postgres, anon, authenticated, service_role;
--   alter default privileges in schema public
--     grant all on sequences to postgres, anon, authenticated, service_role;
--
-- These are ordinary ACL entries held by the NAMED roles `anon`,
-- `authenticated` and `service_role`. They are applied at CREATE time, so
-- `departments`, `activity_log`, `ai_provider_configs` and every function in
-- this schema were already fully granted to all three roles before any
-- `GRANT` in these migrations ran.
--
-- A later `GRANT` can only ADD. Nothing an earlier migration does can subtract
-- a privilege it never named. So "I granted SELECT and INSERT" left UPDATE and
-- DELETE in place, and "I granted nothing to service_role" left ALL in place.
--
-- This is the difference between a locally-provisioned database, where the
-- `anon` and `authenticated` roles may carry no ambient grants, and a hosted
-- one, where they always do. A privilege contract asserted only against a local
-- database is a claim about the local database.
--
-- ---------------------------------------------------------------------------
-- WHY `REVOKE ... FROM public` WAS NOT ENOUGH
-- ---------------------------------------------------------------------------
--
-- All four migrations close functions with `revoke execute ... from public`, and
-- the Phase 36 header explains why at length: PostgreSQL grants EXECUTE to the
-- PUBLIC pseudo-role on every new function, so an unrevoked SECURITY DEFINER
-- function is callable by anyone.
--
-- That reasoning is correct and the statement is necessary. It is also not
-- sufficient here, because PUBLIC is not where the hosted grant lives.
--
-- `REVOKE ... FROM public` removes the grant held by grantee 0. The hosted
-- default privileges create three further, independent grants held by real role
-- OIDs. Removing grantee 0 leaves those three untouched, and a function
-- privileges-aggregates across every applicable ACL entry -- so `anon` and
-- `authenticated` keep EXECUTE on every `ai_gateway_*` function.
--
-- The two mechanisms are not alternatives. Both are required: revoke from
-- PUBLIC for the implicit grant, and revoke from each named role for the
-- hosted one.
--
-- This is also why the repository's own test missed it. The PUBLIC-grant
-- assertion in `supabase/tests/rls_isolation.sql` inspects
-- `aclexplode(proacl) ... grantee = 0` and passed. The per-function assertions
-- that name `authenticated` and `anon` explicitly are the ones that failed.
-- A check that reads the pseudo-role cannot see a named role.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS FILE CHANGES, AND WHY EACH IS SAFE
-- ---------------------------------------------------------------------------
--
-- 1. `activity_log` becomes genuinely append-only. Phase 35 granted
--    SELECT and INSERT to `authenticated` and deliberately omitted UPDATE and
--    DELETE, so the omission was the intent. RLS carries no UPDATE or DELETE
--    policy either, so a client write is refused today -- but as a POLICY
--    refusal, not a PRIVILEGE refusal, which leaves the table one careless
--    `GRANT` away from being mutable. This restores the two independent
--    defences the design comment already claims.
--
-- 2. `ai_provider_configs` loses table access from `service_role`. The gateway
--    reads and writes credential state exclusively through `SECURITY DEFINER`
--    functions that re-check membership against an explicit actor parameter
--    inside the same transaction. `service_role` is a BYPASSRLS role but not a
--    superuser, and without a column privilege it cannot read a row at all --
--    which is precisely the property that makes the function funnel the only
--    possible path. Every gateway caller uses a service-role key, and none of
--    them use a table read.
--
-- 3. The `ai_gateway_*` functions and the two Phase 35 server-side writers lose
--    EXECUTE from `anon` and `authenticated`. This changes no reachable code
--    path: every caller in `supabase/functions/ai-gateway/` authenticates with
--    the service-role key, and each of these functions additionally refuses any
--    caller whose `auth.role()` is not `service_role`. The privilege is being
--    brought into line with the architecture that already exists.
--
-- 4. Default privileges are revoked for the migration runner's future objects,
--    so the drift cannot recur on a table added next month. This is scoped to
--    objects created by the executing role and is not retroactive; it
--    complements statements 1 to 3 rather than replacing them.
--
-- Preserved deliberately and unchanged: every `SECURITY DEFINER` function, every
-- `set search_path = ''`, every RLS policy, the existing RPC access model, and
-- the Phase 35 column-level grant set. This file adds no `GRANT` of any kind.
-- All statements are idempotent, so re-running them is a no-op.
-- ---------------------------------------------------------------------------

-- 1. activity_log is append-only
revoke update, delete
on table public.activity_log
from anon, authenticated, service_role;

-- 2. ai_provider_configs is accessed through controlled functions
revoke all
on table public.ai_provider_configs
from service_role;

-- 3. AI Gateway and Phase 35 writer functions are not directly executable
-- by client roles.

revoke execute
on function public.ai_gateway_resolve_config(uuid, uuid, public.organization_role)
from anon, authenticated;

revoke execute
on function public.ai_gateway_read_config(uuid, uuid)
from anon, authenticated;

revoke execute
on function public.ai_gateway_read_credential(uuid, uuid)
from anon, authenticated;

revoke execute
on function public.ai_gateway_role_of(uuid, uuid)
from anon, authenticated;

revoke execute
on function public.ai_gateway_store_credential(uuid, uuid, text)
from anon, authenticated;

revoke execute
on function public.ai_gateway_delete_credential(uuid, uuid)
from anon, authenticated;

revoke execute
on function public.set_ai_provider_secret_reference(uuid, text)
from anon, authenticated;

revoke execute
on function public.record_ai_connection_test(uuid, public.ai_connection_status)
from anon, authenticated;

-- 4. Prevent the same privilege drift for future objects created by the
-- postgres migration runner in public schema.

alter default privileges in schema public
revoke all on tables
from anon, authenticated, service_role;

alter default privileges in schema public
revoke all on functions
from anon, authenticated, service_role;

alter default privileges in schema public
revoke all on sequences
from anon, authenticated, service_role;
