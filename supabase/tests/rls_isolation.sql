-- ---------------------------------------------------------------------------
-- Trackit X — tenant isolation test for the foundation migration.
--
-- ✓ Sections 1 to 16: EXECUTED AND PASSING as of Phase 33 (2026-09-26) against
--   the local Docker stack, 124 assertions, 0 failures. It was written in Phase 32
--   on a machine with no running Docker daemon, so it had never been run; Phase 33
--   started the daemon, applied `20260925120000_core_business_data.sql` for the
--   first time, and ran this file to completion.
--
-- ✓ Section 17 (AI provider configurations): EXECUTED AND PASSING as of Phase 35
--   verification (2026-09-27), 40 assertions, 0 failures, against the local stack
--   `trackit-x` on PostgreSQL 17.6. Whole file: 164 assertions, 0 failures, and the
--   transaction rolls back, so nothing is kept.
--
--   It did not pass on the first run. Phase 35 wrote it but could not execute it,
--   because that environment had no Docker daemon, and the first execution here
--   failed at 17.1. Every failure was in this file, not in the migration:
--     · 17.1 used a_admin for admin-only writes, but assertion 8.5 demotes a_admin
--       to manager, so `has_organization_role(org, 'admin')` is correctly false and
--       the WITH CHECK correctly refused. The roles are now pinned by 17.0.
--     · It caught the refusal with `new_row_violates_row_level_security_policy`,
--       which PostgreSQL 17 has no such condition for; a failed INSERT ... WITH
--       CHECK reports 42501, i.e. insufficient_privilege.
--     · 17.15 read organization A's row while impersonating organization B, so RLS
--       returned no row and the comparison was NULL. It is now asked as A's owner.
--     · It called `public.set_config`; set_config lives in pg_catalog.
--     · It had the service role SELECT, UPDATE and DELETE the table. The migration
--       grants the service role none of those, on purpose: its only reach is EXECUTE
--       on the two SECURITY DEFINER gateway functions. The section now alternates
--       roles, with the service role writing and the client observing the effect.
--
--   Assertions 17.33 to 17.38 also read more honestly as a result. The one-default
--   invariant is proved as the table's OWNER, which is the only way to exercise the
--   partial unique index: the service role cannot INSERT at all, so a test written
--   from that role would have proved the grant, not the index. And the delete is
--   performed as `authenticated`, which is the role that holds DELETE in the app.
--
--   The count is 40 rather than the 39 first written, because 17.0 pins both roles
--   with two assertions. That is a deliberate addition, not a correction: it makes
--   a future role change fail with an explanation instead of an opaque RLS error
--   hundreds of lines later. Nothing was removed to reach this number.
--
-- Run with:
--
--   supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
--
-- The port is the one in supabase/config.toml for this project. On Windows, if
-- piping the file through PowerShell, normalise the line endings first: CRLF in a
-- dollar-quoted body becomes a stray carriage return and fails the parse. Either
-- use a client that does not rewrite them, or write an LF copy:
--
--   $t = [IO.File]::ReadAllText('supabase/tests/rls_isolation.sql')
--   [IO.File]::WriteAllText("$env:TEMP\rls.lf.sql", ($t -replace "`r`n", "`n"))
--   Get-Content "$env:TEMP\rls.lf.sql" -Raw |
--     docker exec -i supabase_db_trackit-x psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- Sections 16 is the Phase 33 addition: the grouped open-task read the project list
-- now depends on. Sections 12 to 15 already cover task ownership, cross-organization
-- references, ranges and cascade, so Phase 33 did not duplicate them — it added the
-- one query that had no assertion behind it. Section 17 is the Phase 35 addition:
-- it runs last, reads the same fixtures, and is the only place the column-level
-- secret boundary is asserted, because that property is invisible to a client test.
--
-- Method
-- ------
-- Become the `authenticated` role and set `request.jwt.claims`, which is exactly
-- what PostgREST does per request. `auth.uid()` then resolves and RLS applies as
-- it would to a real client.
--
-- The whole script runs in one transaction that ends in ROLLBACK, so it creates
-- its own fixtures and leaves the database as it found it. Everything it creates
-- — including its helper functions — lives in `public` and is undone by that
-- rollback. Nothing is put in `pg_temp`: the temp schema belongs to the session
-- user, and the assertions run as `authenticated`, which would have neither
-- USAGE on that schema nor SELECT on its tables.
--
-- Two conventions worth knowing when reading the assertions:
--
--   · A read that is refused for tenancy reasons returns ZERO ROWS, never an
--     error. So does an UPDATE or DELETE whose row is filtered out by a policy's
--     USING clause — the evidence of refusal is `row_count = 0`.
--   · A write that violates a WITH CHECK clause, a table privilege, or one of
--     our triggers DOES raise. Those assertions match on SQLSTATE, never on
--     message text.
--
-- Fixture layout: organization A has an owner, an admin and a member;
-- organization B has a single owner; and one user belongs to neither.
--
-- Sections 1–8 cover the foundation migration (`organizations`,
-- `organization_members`). Sections 9–15 cover the Phase 32 business data
-- (`departments`, `employees`, `projects`, `project_members`, `tasks`,
-- `activity_log`), and read the state section 8 left behind rather than
-- resetting it — a suite that assumed its own starting point would go on passing
-- after a change to the sections above. Section 16 adds the Phase 33 open-task
-- count, and runs last because it reads the task table section 15 left settled.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Helpers. Created in `public` and removed by the rollback.
-- ---------------------------------------------------------------------------

-- A distinct SQLSTATE so an assertion failure is never swallowed by the
-- exception handlers that the "expect a refusal" tests rely on.
create function public.rls_test_assert(condition boolean, description text)
returns void
language plpgsql
as $$
begin
  if condition then
    raise notice 'PASS  %', description;
  else
    raise exception 'FAIL  %', description using errcode = 'TKX99';
  end if;
end;
$$;

-- Fixed identifiers rather than lookups, so the assertions need no table access
-- and read the same as the JWT claims set alongside them.
create function public.rls_test_uid(who text)
returns uuid
language sql
immutable
as $$
  select case who
    when 'a_owner'  then '11111111-1111-4111-a111-111111111101'
    when 'a_admin'  then '11111111-1111-4111-a111-111111111102'
    when 'a_member' then '11111111-1111-4111-a111-111111111103'
    when 'b_owner'  then '11111111-1111-4111-b111-111111111101'
    when 'outsider' then '11111111-1111-4111-c111-111111111101'
  end::uuid;
$$;

create function public.rls_test_org(which text)
returns uuid
language sql
immutable
as $$
  select case which
    when 'a' then '22222222-2222-4222-a222-222222222201'
    when 'b' then '22222222-2222-4222-b222-222222222201'
  end::uuid;
$$;

grant execute on function public.rls_test_assert(boolean, text) to authenticated;
grant execute on function public.rls_test_uid(text) to authenticated;
grant execute on function public.rls_test_org(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures, created as the migration owner so RLS does not stand in the way.
-- ---------------------------------------------------------------------------

-- These rows never authenticate — the test forges the JWT claims directly — so
-- the password column holds an unusable placeholder rather than a real hash.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  public.rls_test_uid(who),
  'authenticated', 'authenticated',
  who || '@rls-test.invalid',
  'no-login-possible',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from unnest(array['a_owner', 'a_admin', 'a_member', 'b_owner', 'outsider']) as who;

insert into public.organizations (id, name, business_type, timezone, currency, created_by)
values
  (public.rls_test_org('a'), 'Isolation Test A', 'manufacturing',
   'Asia/Kolkata', 'INR', public.rls_test_uid('a_owner')),
  (public.rls_test_org('b'), 'Isolation Test B', 'logistics',
   'Asia/Dubai', 'AED', public.rls_test_uid('b_owner'));

insert into public.organization_members (organization_id, user_id, role)
values
  (public.rls_test_org('a'), public.rls_test_uid('a_owner'),  'owner'),
  (public.rls_test_org('a'), public.rls_test_uid('a_admin'),  'admin'),
  (public.rls_test_org('a'), public.rls_test_uid('a_member'), 'member'),
  (public.rls_test_org('b'), public.rls_test_uid('b_owner'),  'owner');

do $$
begin
  perform public.rls_test_assert(
    (select count(*) from public.organization_members) >= 4,
    'fixtures: membership rows created');
end;
$$;

-- ===========================================================================
-- 1. Visibility — the guarantee the entire product rests on.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  org_b uuid := public.rls_test_org('b');
begin
  perform public.rls_test_assert(
    (select count(*) from public.organizations where id = org_a) = 1,
    '1.1 owner of A reads organization A');

  -- The single most important assertion in the codebase. A cross-tenant read
  -- must come back EMPTY rather than refused: a refusal would confirm the row
  -- exists, which is itself the leak.
  perform public.rls_test_assert(
    (select count(*) from public.organizations where id = org_b) = 0,
    '1.2 owner of A cannot read organization B');

  perform public.rls_test_assert(
    (select count(*) from public.organizations) = 1,
    '1.3 an unfiltered select returns only the caller''s organizations');

  perform public.rls_test_assert(
    (select count(*) from public.organization_members
      where organization_id = org_a) = 3,
    '1.4 owner of A reads all three members of A');

  perform public.rls_test_assert(
    (select count(*) from public.organization_members
      where organization_id = org_b) = 0,
    '1.5 owner of A cannot read any member of B');

  perform public.rls_test_assert(
    public.is_organization_member(org_a) and not public.is_organization_member(org_b),
    '1.6 is_organization_member agrees with the policies');

  perform public.rls_test_assert(
    public.has_organization_role(org_a, 'owner')
      and not public.has_organization_role(org_b, 'member'),
    '1.7 has_organization_role is scoped to one organization');
end;
$$;

reset role;

-- ===========================================================================
-- 2. Role gates on `organizations`.
-- ===========================================================================

-- A plain member may read the organization but not change it.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  update public.organizations set name = 'Renamed By Member'
  where id = public.rls_test_org('a');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '2.1 a member cannot rename their organization');
end;
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  update public.organizations set name = 'Renamed By Admin'
  where id = public.rls_test_org('a');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '2.2 an admin can rename their organization');

  -- An admin is not an owner: deleting the business is the owner's alone.
  delete from public.organizations where id = public.rls_test_org('a');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '2.3 an admin cannot delete the organization');

  -- No role reaches across the tenant boundary.
  update public.organizations set name = 'Renamed Across Tenants'
  where id = public.rls_test_org('b');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '2.4 an admin of A cannot rename organization B');
end;
$$;

reset role;

-- ===========================================================================
-- 3. A non-admin cannot administer membership at all.
--    Runs before section 5 promotes this user, so their role really is `member`.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  update public.organization_members set role = 'admin'
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '3.1 a member cannot promote themselves');

  update public.organization_members set permissions = array['payroll.approve']
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '3.2 a member cannot grant themselves a permission');

  delete from public.organization_members
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_admin');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '3.3 a member cannot remove a colleague');

  -- Least of all somebody senior to them. Refused by the policy before the write
  -- guard is ever consulted, which is why this is a silent no-op rather than an
  -- error: a member's UPDATE/DELETE simply matches no row.
  delete from public.organization_members
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_owner');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '3.4 a member cannot remove the owner');

  update public.organization_members set role = 'member'
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_owner');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '3.5 a member cannot demote the owner');
end;
$$;

reset role;

-- ===========================================================================
-- 4. The creation path. Direct insert is closed; the atomic RPC is the only way.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-c111-111111111101","role":"authenticated"}';

do $$
declare
  created public.organizations;
  granted_role public.organization_role;
begin
  begin
    insert into public.organizations (name, business_type, timezone, currency)
    values ('Smuggled In', 'retail', 'UTC', 'USD');
    perform public.rls_test_assert(false, '4.1 a direct insert into organizations is refused');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '4.1 a direct insert into organizations is refused');
  end;

  created := public.create_organization('Outsider Ltd', 'services', 'UTC', 'usd');

  perform public.rls_test_assert(
    created.created_by = public.rls_test_uid('outsider'),
    '4.2 create_organization records the caller as creator');
  perform public.rls_test_assert(
    created.currency = 'USD',
    '4.3 create_organization normalises the currency code');

  select member.role into granted_role
  from public.organization_members member
  where member.organization_id = created.id
    and member.user_id = public.rls_test_uid('outsider');

  perform public.rls_test_assert(
    granted_role = 'owner',
    '4.4 create_organization makes the caller owner in the same transaction');
  perform public.rls_test_assert(
    (select count(*) from public.organization_members
      where organization_id = created.id) = 1,
    '4.5 create_organization creates exactly one membership');

  -- Being an owner somewhere is not being a member everywhere.
  perform public.rls_test_assert(
    (select count(*) from public.organizations
      where id = public.rls_test_org('a')) = 0,
    '4.6 owning a new organization grants no sight of organization A');

  -- Joining an organization is not something you do to yourself.
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values (public.rls_test_org('a'), public.rls_test_uid('outsider'), 'owner');
    perform public.rls_test_assert(false, '4.7 an outsider cannot add themselves to A');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '4.7 an outsider cannot add themselves to A');
  end;
end;
$$;

reset role;

-- ===========================================================================
-- 5. Escalation. RLS alone would permit 5.1 and 5.2 — the admin passes the
--    admin gate. The membership trigger is what refuses them.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  begin
    update public.organization_members set role = 'owner'
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_admin');
    perform public.rls_test_assert(false, '5.1 an admin cannot promote themselves to owner');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '5.1 an admin cannot promote themselves to owner');
  end;

  begin
    update public.organization_members set permissions = array['payroll.approve']
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_admin');
    perform public.rls_test_assert(false, '5.2 an admin cannot widen their own permissions');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '5.2 an admin cannot widen their own permissions');
  end;

  -- Nor hand out authority above their own, even to somebody else.
  begin
    update public.organization_members set role = 'owner'
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_member');
    perform public.rls_test_assert(false, '5.3 an admin cannot grant the owner role');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '5.3 an admin cannot grant the owner role');
  end;

  -- What an admin legitimately may do: raise a colleague to their own level, and
  -- grant a permission to someone other than themselves.
  update public.organization_members set role = 'admin'
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '5.4 an admin can promote a member to admin');

  update public.organization_members set permissions = array['payroll.view']
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '5.5 an admin can grant a permission to a colleague');
end;
$$;

reset role;

-- ===========================================================================
-- 6. An organization always keeps an owner. Otherwise nobody can ever
--    administer or close it again.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-b111-111111111101","role":"authenticated"}';

do $$
begin
  -- Organization B has exactly one owner, and it is the caller.
  begin
    delete from public.organization_members
    where organization_id = public.rls_test_org('b')
      and user_id = public.rls_test_uid('b_owner');
    perform public.rls_test_assert(false, '6.1 the last owner cannot be deleted');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '6.1 the last owner cannot be deleted');
  end;

  begin
    update public.organization_members set role = 'admin'
    where organization_id = public.rls_test_org('b')
      and user_id = public.rls_test_uid('b_owner');
    perform public.rls_test_assert(false, '6.2 the last owner cannot be demoted');
  exception
    -- The last-owner rule (23514) is reached first; were it not, self-demotion
    -- would be refused as escalation control (42501). Either refusal satisfies
    -- the invariant, so both are accepted here rather than pinning the order.
    when check_violation or insufficient_privilege then
      perform public.rls_test_assert(true, '6.2 the last owner cannot be demoted');
  end;
end;
$$;

reset role;

-- ===========================================================================
-- 7. Immutability and validation.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
begin
  -- Moving a membership row into another organization would be a tenancy bypass
  -- wearing an update's clothes. Refused twice over: the WITH CHECK clause
  -- evaluates against organization B, and the trigger pins the column.
  begin
    update public.organization_members set organization_id = public.rls_test_org('b')
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_member');
    perform public.rls_test_assert(false, '7.1 a membership cannot be moved between organizations');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '7.1 a membership cannot be moved between organizations');
  end;

  begin
    update public.organizations set created_by = public.rls_test_uid('outsider')
    where id = public.rls_test_org('a');
    perform public.rls_test_assert(false, '7.2 organizations.created_by is immutable');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '7.2 organizations.created_by is immutable');
  end;

  -- A bad timezone here becomes a wrong shift boundary and a wrong payslip in a
  -- later phase, so it is refused at the door.
  begin
    update public.organizations set timezone = 'Mars/Olympus_Mons'
    where id = public.rls_test_org('a');
    perform public.rls_test_assert(false, '7.3 an unknown IANA timezone is rejected');
  exception
    when invalid_parameter_value then
      perform public.rls_test_assert(true, '7.3 an unknown IANA timezone is rejected');
  end;

  begin
    update public.organizations set currency = 'rupees'
    where id = public.rls_test_org('a');
    perform public.rls_test_assert(false, '7.4 a non-ISO-4217 currency code is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '7.4 a non-ISO-4217 currency code is rejected');
  end;

  begin
    update public.organization_members set permissions = array['Payroll Approve']
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_member');
    perform public.rls_test_assert(false, '7.5 a malformed permission slug is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '7.5 a malformed permission slug is rejected');
  end;
end;
$$;

reset role;

-- ===========================================================================
-- 8. Rank protection. Nobody administers a member senior to themselves.
--
--    The rule the other sections do not reach: sections 3 and 5 cover a member
--    acting at all and an admin handing OUT authority above their own, but not
--    an admin acting UPON somebody who already holds it. A demotion passes the
--    grant check by construction — the role being written is lower than the
--    actor's own — so before the write guard ranked the target's existing role,
--    an admin could demote or delete an OWNER.
--
--    8.1–8.3 assert SQLSTATE 42501 specifically, and that is the point. Organization
--    A has exactly one owner, so the last-owner invariant would also have refused
--    8.2 — with 23514, which these handlers do not catch. A regression therefore
--    surfaces as an uncaught exception that aborts the script, rather than as a
--    test passing for the wrong reason.
--
--    State on entry, after section 5: a_owner is owner, a_admin is admin, and
--    a_member was promoted to admin by 5.4.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  begin
    update public.organization_members set role = 'member'
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_owner');
    perform public.rls_test_assert(false, '8.1 an admin cannot demote an owner');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '8.1 an admin cannot demote an owner');
  end;

  begin
    delete from public.organization_members
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_owner');
    perform public.rls_test_assert(false, '8.2 an admin cannot delete an owner');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '8.2 an admin cannot delete an owner');
  end;

  -- The rule covers any modification of a senior member's row, not only a role
  -- change: rewriting an owner's permission list is also acting above your rank.
  begin
    update public.organization_members set permissions = array['payroll.view']
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_owner');
    perform public.rls_test_assert(false, '8.3 an admin cannot rewrite an owner''s permissions');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '8.3 an admin cannot rewrite an owner''s permissions');
  end;

  -- The boundary on the allowed side. The comparison is strict, so equal ranks
  -- are peers: a_member holds admin after 5.4, and one admin may still act on
  -- another. Over-tightening this to `>=` would make admins unable to administer
  -- each other, which is a different bug in the same line.
  update public.organization_members set role = 'member'
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '8.4 an admin can still demote a peer admin');
end;
$$;

reset role;

-- An owner is above both of them and keeps working normally.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  affected integer;
  owners integer;
begin
  update public.organization_members set role = 'manager'
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_admin');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '8.5 an owner can demote an admin');

  delete from public.organization_members
  where organization_id = public.rls_test_org('a')
    and user_id = public.rls_test_uid('a_member');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '8.6 an owner can remove a lower-ranked member');

  -- And the invariant the new check sits in front of is still standing: the sole
  -- remaining owner cannot remove themselves, even though rank alone permits it.
  begin
    delete from public.organization_members
    where organization_id = public.rls_test_org('a')
      and user_id = public.rls_test_uid('a_owner');
    perform public.rls_test_assert(false, '8.7 the last owner of A still cannot be deleted');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '8.7 the last owner of A still cannot be deleted');
  end;

  select count(*) into owners
  from public.organization_members member
  where member.organization_id = public.rls_test_org('a')
    and member.role = 'owner';
  perform public.rls_test_assert(owners = 1, '8.8 organization A still has its owner');
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Helpers for the Phase 32 fixtures. Separate from the helpers above because
-- they are a different set of identifiers, and one shared function with a long
-- case list reads worse than two functions with short ones.
-- ---------------------------------------------------------------------------

-- Deterministic business-row ids, so every assertion below can name a row rather
-- than searching for one, and so a failure is reproducible.
create function public.rls_test_biz(which text)
returns uuid
language sql
immutable
as $$
  select (
    '33333333-3333-4333-'
    || case when which like 'a%' then 'a' else 'b' end
    || '333-3333333333'
    || lpad(right(which, 2), 2, '0')
  )::uuid;
$$;

grant execute on function public.rls_test_biz(text) to authenticated;

-- ===========================================================================
-- 9. Phase 32 fixtures: departments, employees, projects, membership, tasks and
--    an activity log, for both organizations.
--
--    Created as the migration owner, so the write guards see no JWT and pass the
--    rows through — the same bootstrap path a migration or seed takes. The
--    fixtures are all same-organization by construction, so nothing here is
--    asserting the guards work; sections 12 and 13 do that, deliberately.
--
--    State carried in from section 8: a_owner is owner, a_admin was demoted to
--    manager, and a_member's membership was REMOVED by 8.6. That removal is
--    deliberate state, not leftover mess, so it is not quietly undone — a_member
--    is re-added below as a plain member because the Phase 32 task-ownership
--    policy needs somebody whose role is exactly `member`, and after 8.6 there is
--    no longer such a person in organization A.
-- ===========================================================================

insert into public.organization_members (organization_id, user_id, role)
values (public.rls_test_org('a'), public.rls_test_uid('a_member'), 'member');

insert into public.departments (id, organization_id, name, description)
values
  (public.rls_test_biz('a01'), public.rls_test_org('a'), 'Production', 'Isolation fixture A'),
  (public.rls_test_biz('b01'), public.rls_test_org('b'), 'Logistics',  'Isolation fixture B');

-- a_member is linked to a login; a_other deliberately is not, because "an
-- employee with no account" is the normal case and the policy has to cope with it.
insert into public.employees (
  id, organization_id, user_id, employee_code,
  first_name, last_name, email, department_id, job_title, joining_date
)
values
  (public.rls_test_biz('a02'), public.rls_test_org('a'), public.rls_test_uid('a_owner'),
   'EMP-A01', 'Aisha', 'Owner', 'aisha.owner@rls-test.invalid',
   public.rls_test_biz('a01'), 'Owner', '2020-01-06'),
  (public.rls_test_biz('a03'), public.rls_test_org('a'), public.rls_test_uid('a_member'),
   'EMP-A02', 'Ramesh', 'Member', 'ramesh.member@rls-test.invalid',
   public.rls_test_biz('a01'), 'Operator', '2021-06-01'),
  (public.rls_test_biz('a04'), public.rls_test_org('a'), null,
   'EMP-A03', 'Sunita', 'Colleague', 'sunita.colleague@rls-test.invalid',
   public.rls_test_biz('a01'), 'Operator', '2022-02-01'),
  (public.rls_test_biz('b02'), public.rls_test_org('b'), public.rls_test_uid('b_owner'),
   'EMP-B01', 'Bilal', 'Owner', 'bilal.owner@rls-test.invalid',
   public.rls_test_biz('b01'), 'Owner', '2019-05-01');

insert into public.projects (
  id, organization_id, name, status, priority, start_date, target_date, owner_id, progress
)
values
  (public.rls_test_biz('a10'), public.rls_test_org('a'), 'Isolation Project A',
   'active', 'high', '2026-01-01', '2026-12-31', public.rls_test_biz('a02'), 40),
  (public.rls_test_biz('b10'), public.rls_test_org('b'), 'Isolation Project B',
   'active', 'high', '2026-01-01', '2026-12-31', public.rls_test_biz('b02'), 10);

insert into public.project_members (project_id, employee_id, role, allocation_percent)
values
  (public.rls_test_biz('a10'), public.rls_test_biz('a03'), 'lead', 60),
  (public.rls_test_biz('b10'), public.rls_test_biz('b02'), 'lead', 100);

insert into public.tasks (
  id, organization_id, project_id, assignee_id, title, status, priority, progress, due_date
)
values
  (public.rls_test_biz('a20'), public.rls_test_org('a'), public.rls_test_biz('a10'),
   public.rls_test_biz('a03'), 'Mine', 'in_progress', 'high', 50, '2026-03-01'),
  (public.rls_test_biz('a21'), public.rls_test_org('a'), public.rls_test_biz('a10'),
   public.rls_test_biz('a04'), 'Theirs', 'todo', 'medium', 0, '2026-03-01'),
  -- Unassigned AND not on a project: work that is not tied to a job, which the
  -- schema allows on purpose and which a naive inner join would hide.
  (public.rls_test_biz('a22'), public.rls_test_org('a'), null,
   null, 'Unassigned', 'todo', 'low', 0, null),
  (public.rls_test_biz('b20'), public.rls_test_org('b'), public.rls_test_biz('b10'),
   public.rls_test_biz('b02'), 'B Task', 'todo', 'medium', 0, '2026-03-01');

insert into public.activity_log (id, organization_id, actor_id, entity, action, summary)
values
  (public.rls_test_biz('a30'), public.rls_test_org('a'), public.rls_test_biz('a03'),
   'employee', 'created', 'Ramesh was added'),
  (public.rls_test_biz('b30'), public.rls_test_org('b'), public.rls_test_biz('b02'),
   'project', 'created', 'Project B was created');

do $$
begin
  perform public.rls_test_assert(
    (select count(*) from public.employees) = 4,
    '9.1 phase 32 fixtures: employees created');
  perform public.rls_test_assert(
    (select count(*) from public.tasks) = 4,
    '9.2 phase 32 fixtures: tasks created');
end;
$$;

-- ===========================================================================
-- 10. Visibility across every Phase 32 table.
--     A plain member of A sees all of A and none of B.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  org_b uuid := public.rls_test_org('b');
begin
  perform public.rls_test_assert(
    (select count(*) from public.employees where organization_id = org_a) = 3
      and (select count(*) from public.employees where organization_id = org_b) = 0,
    '10.1 a member sees only their own organization''s employees');
  perform public.rls_test_assert(
    (select count(*) from public.departments where organization_id = org_a) = 1
      and (select count(*) from public.departments where organization_id = org_b) = 0,
    '10.2 a member sees only their own organization''s departments');
  perform public.rls_test_assert(
    (select count(*) from public.projects where organization_id = org_a) = 1
      and (select count(*) from public.projects where organization_id = org_b) = 0,
    '10.3 a member sees only their own organization''s projects');
  perform public.rls_test_assert(
    (select count(*) from public.tasks where organization_id = org_a) = 3
      and (select count(*) from public.tasks where organization_id = org_b) = 0,
    '10.4 a member sees only their own organization''s tasks');
  perform public.rls_test_assert(
    (select count(*) from public.activity_log where organization_id = org_a) = 1
      and (select count(*) from public.activity_log where organization_id = org_b) = 0,
    '10.5 a member sees only their own organization''s activity log');
  perform public.rls_test_assert(
    (select count(*) from public.projects) = 1,
    '10.6 an unfiltered select of projects returns only the caller''s organization');

  -- project_members carries no organization_id, so this assertion is the one that
  -- actually proves the derivation through `project_organization` works. If the
  -- lookup were wrong in the permissive direction, B's membership would appear.
  perform public.rls_test_assert(
    (select count(*) from public.project_members
      where project_id = public.rls_test_biz('a10')) = 1
    and (select count(*) from public.project_members
      where project_id = public.rls_test_biz('b10')) = 0,
    '10.7 project_members tenancy is derived from the project, not stored');

  -- The identity bridge, called the way a client calls it: one argument, relying
  -- on the default.
  perform public.rls_test_assert(
    public.employee_id_for_user(org_a) = public.rls_test_biz('a03'),
    '10.8 employee_id_for_user resolves the caller''s own employee row');

  -- And the check that closes the cross-tenant oracle. A member of A asking about
  -- organization B gets NULL even when naming a real B employee: the answer would
  -- otherwise confirm that this login exists on the far side of the boundary.
  perform public.rls_test_assert(
    public.employee_id_for_user(org_b, public.rls_test_uid('b_owner')) is null,
    '10.9 employee_id_for_user refuses a p_user that is not the caller');
  perform public.rls_test_assert(
    public.employee_id_for_user(org_a, public.rls_test_uid('a_owner')) is null,
    '10.10 employee_id_for_user refuses a colleague''s id inside their own organization');
end;
$$;

reset role;

-- Someone who belongs to no organization at all sees nothing anywhere.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-c111-111111111101","role":"authenticated"}';

do $$
begin
  perform public.rls_test_assert(
    (select count(*) from public.employees) = 0
    and (select count(*) from public.departments) = 0
    and (select count(*) from public.projects) = 0
    and (select count(*) from public.project_members) = 0
    and (select count(*) from public.tasks) = 0
    and (select count(*) from public.activity_log) = 0,
    '10.11 an outsider sees no business data in any organization');
end;
$$;

reset role;

-- ===========================================================================
-- 11. Role gates on the Phase 32 tables.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  affected integer;
  org_a uuid := public.rls_test_org('a');
begin
  -- Employees are admin-managed, so a plain member may not add one. The employee
  -- row is the root of payroll, attendance and project attribution.
  begin
    insert into public.employees (organization_id, employee_code, first_name, last_name, email)
    values (org_a, 'EMP-A99', 'Smuggled', 'Member', 'smuggled@rls-test.invalid');
    perform public.rls_test_assert(false, '11.1 a member cannot add an employee');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '11.1 a member cannot add an employee');
  end;

  begin
    insert into public.departments (organization_id, name)
    values (org_a, 'Smuggled Department');
    perform public.rls_test_assert(false, '11.2 a member cannot add a department');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '11.2 a member cannot add a department');
  end;

  -- Projects are manager-managed, and a member is below that.
  begin
    insert into public.projects (organization_id, name)
    values (org_a, 'Smuggled Project');
    perform public.rls_test_assert(false, '11.3 a member cannot create a project');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '11.3 a member cannot create a project');
  end;

  -- A member cannot administer a colleague's employee record either.
  update public.employees set job_title = 'Demoted By Member'
  where id = public.rls_test_biz('a04');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '11.4 a member cannot edit an employee record');

  -- And cannot remove one. Removing a colleague's row is not a member's decision
  -- even though the row is visible to them.
  delete from public.employees where id = public.rls_test_biz('a04');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '11.5 a member cannot delete an employee');
end;
$$;

reset role;

-- A manager runs projects but does not own the employee roster.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  affected integer;
  org_a uuid := public.rls_test_org('a');
begin
  insert into public.projects (organization_id, name, status, owner_id)
  values (org_a, 'Manager Created Project', 'planned', public.rls_test_biz('a02'));
  perform public.rls_test_assert(
    (select count(*) from public.projects
      where organization_id = org_a and name = 'Manager Created Project') = 1,
    '11.6 a manager can create a project');

  update public.projects set progress = 55
  where name = 'Manager Created Project';
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '11.7 a manager can update a project');

  -- Deleting a project cascades to its tasks, so it stays with an admin.
  delete from public.projects where name = 'Manager Created Project';
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '11.8 a manager cannot delete a project');

  begin
    insert into public.employees (organization_id, employee_code, first_name, last_name, email)
    values (org_a, 'EMP-A98', 'Manager', 'Made', 'manager.made@rls-test.invalid');
    perform public.rls_test_assert(false, '11.9 a manager cannot add an employee');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '11.9 a manager cannot add an employee');
  end;

  -- Membership on a project is the manager's to assign.
  insert into public.project_members (project_id, employee_id, role, allocation_percent)
  values (public.rls_test_biz('a10'), public.rls_test_biz('a04'), 'contributor', 40);
  perform public.rls_test_assert(
    (select count(*) from public.project_members
      where project_id = public.rls_test_biz('a10')) = 2,
    '11.10 a manager can add somebody to a project');
end;
$$;

reset role;

-- ===========================================================================
-- 12. Task ownership. The one place the write gate depends on WHOSE work it is.
--
--     a_member is a plain member of A, and is the assignee of a20 ("Mine").
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  affected integer;
  org_a uuid := public.rls_test_org('a');
begin
  update public.tasks set progress = 75 where id = public.rls_test_biz('a20');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '12.1 a member can record progress on their own task');

  update public.tasks set progress = 75 where id = public.rls_test_biz('a21');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '12.2 a member cannot touch a colleague''s task');

  -- An UNASSIGNED task is not updateable by a plain member, which surprises people
  -- and is worth pinning. USING compares `assignee_id = employee_id_for_user(...)`,
  -- and for a NULL assignee that comparison is NULL, not TRUE — so the row is
  -- filtered out. The WITH CHECK clause separately permits leaving a task
  -- unassigned, which is why the two halves are written differently. Anyone who
  -- wants to change this needs to decide which side of the line an unclaimed task
  -- belongs to, not to trip over it in a test.
  update public.tasks set status = 'in_review' where id = public.rls_test_biz('a22');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '12.3 a member cannot claim an unassigned task');

  -- Raising work for yourself, or leaving it unclaimed, is allowed.
  insert into public.tasks (organization_id, assignee_id, title, status)
  values (org_a, public.rls_test_biz('a03'), 'Raised By Member', 'todo');
  perform public.rls_test_assert(
    (select count(*) from public.tasks
      where organization_id = org_a and title = 'Raised By Member') = 1,
    '12.4 a member can raise a task assigned to themselves');

  insert into public.tasks (organization_id, assignee_id, title, status)
  values (org_a, null, 'Raised Unassigned', 'todo');
  perform public.rls_test_assert(
    (select count(*) from public.tasks
      where organization_id = org_a and title = 'Raised Unassigned') = 1,
    '12.5 a member can raise an unassigned task');

  -- Assigning work to somebody else is a manager's decision, not a member's.
  begin
    insert into public.tasks (organization_id, assignee_id, title, status)
    values (org_a, public.rls_test_biz('a04'), 'Assigned To Colleague', 'todo');
    perform public.rls_test_assert(false, '12.6 a member cannot assign work to a colleague');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '12.6 a member cannot assign work to a colleague');
  end;

  -- Nor can they launder an assignment through an update: WITH CHECK evaluates the
  -- row being written, so handing one's own task to somebody else is refused even
  -- though the row was theirs to touch.
  begin
    update public.tasks set assignee_id = public.rls_test_biz('a04')
    where id = public.rls_test_biz('a20');
    perform public.rls_test_assert(false, '12.7 a member cannot reassign their own task to a colleague');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '12.7 a member cannot reassign their own task to a colleague');
  end;

  -- A manager is above all of it.
  delete from public.tasks where organization_id = org_a and title = 'Raised Unassigned';
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '12.8 a member cannot delete a task');
end;
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  affected integer;
  org_a uuid := public.rls_test_org('a');
begin
  update public.tasks set progress = 90 where id = public.rls_test_biz('a21');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '12.9 a manager can update any task in their organization');

  update public.tasks set progress = 90 where id = public.rls_test_biz('b20');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 0, '12.10 a manager cannot update a task in another organization');

  delete from public.tasks where id = public.rls_test_biz('a21');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '12.11 a manager can delete a task');

  insert into public.tasks (organization_id, assignee_id, title, status)
  values (org_a, public.rls_test_biz('a04'), 'Assigned By Manager', 'todo');
  perform public.rls_test_assert(
    (select count(*) from public.tasks
      where organization_id = org_a and title = 'Assigned By Manager') = 1,
    '12.12 a manager can assign work to a colleague');
end;
$$;

reset role;

-- ===========================================================================
-- 13. Cross-organization references. The reason the write guards exist.
--
--     a_admin is a MANAGER of A, so every policy below PASSES for organization A.
--     What refuses these writes is the trigger guard comparing the referenced
--     row's organization to the referencing row's. This section is therefore
--     about the second line of defence: with the guards removed, every assertion
--     in it would report success.
--
--     The policy is checked first by making the caller a manager, so a regression
--     that closed the policy would be indistinguishable here from a working guard.
--     Section 11.3 is what rules that out.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  org_b uuid := public.rls_test_org('b');
  b_employee uuid := public.rls_test_biz('b02');
begin
  -- A's own project, with B's employee as its accountable owner. This is the
  -- precise abuse the migration header describes: the policy looks at
  -- organization_id, which is A's, and sees nothing wrong.
  begin
    update public.projects set owner_id = b_employee
    where id = public.rls_test_biz('a10');
    perform public.rls_test_assert(false, '13.1 a project owner cannot be another organization''s employee');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.1 a project owner cannot be another organization''s employee');
  end;

  begin
    insert into public.projects (organization_id, name, owner_id)
    values (org_a, 'Owned Across Tenants', b_employee);
    perform public.rls_test_assert(false, '13.2 a new project cannot be owned by another organization''s employee');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.2 a new project cannot be owned by another organization''s employee');
  end;

  begin
    insert into public.tasks (organization_id, assignee_id, title)
    values (org_a, b_employee, 'Assigned Across Tenants');
    perform public.rls_test_assert(false, '13.3 a task cannot be assigned to another organization''s employee');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.3 a task cannot be assigned to another organization''s employee');
  end;

  begin
    insert into public.tasks (organization_id, project_id, title)
    values (org_a, public.rls_test_biz('b10'), 'Task On Foreign Project');
    perform public.rls_test_assert(false, '13.4 a task cannot sit on another organization''s project');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.4 a task cannot sit on another organization''s project');
  end;

  -- The tenancy hole that has no organization_id to inspect at all.
  begin
    insert into public.project_members (project_id, employee_id, role)
    values (public.rls_test_biz('a10'), b_employee, 'contributor');
    perform public.rls_test_assert(false, '13.5 a project membership cannot pair a project and an employee from different organizations');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.5 a project membership cannot pair a project and an employee from different organizations');
  end;

  -- A forged audit trail: an entry in A's log naming a stranger as its author.
  -- Every member may insert, so the policy offers no protection here at all.
  begin
    insert into public.activity_log (organization_id, actor_id, entity, action, summary)
    values (org_a, b_employee, 'employee', 'created', 'Forged Entry');
    perform public.rls_test_assert(false, '13.6 an activity entry cannot name an outsider as its actor');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.6 an activity entry cannot name an outsider as its actor');
  end;

  -- Being a manager of A is not a licence to write into B. Same reason as every
  -- other assertion here, but stated separately because "manager" is the role most
  -- likely to be granted generously.
  begin
    insert into public.employees (organization_id, employee_code, first_name, last_name, email)
    values (org_b, 'EMP-B98', 'Wrong', 'Tenant', 'wrong.tenant@rls-test.invalid');
    perform public.rls_test_assert(false, '13.7 a manager cannot add an employee to another organization');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.7 a manager cannot add an employee to another organization');
  end;
end;
$$;

reset role;

-- The employee self-references, checked as the owner of A so the policy is not what
-- refuses them. 13.1–13.6 needed a manager because the guard only runs once the
-- policy has agreed the write; these need an owner for the same reason.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  org_b uuid := public.rls_test_org('b');
begin
  begin
    insert into public.employees (
      organization_id, employee_code, first_name, last_name, email, department_id
    )
    values (org_a, 'EMP-A90', 'Cross', 'Department', 'cross.dept@rls-test.invalid',
            public.rls_test_biz('b01'));
    perform public.rls_test_assert(false, '13.8 an employee''s department cannot be in another organization');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.8 an employee''s department cannot be in another organization');
  end;

  begin
    update public.employees set manager_id = public.rls_test_biz('b02')
    where id = public.rls_test_biz('a03');
    perform public.rls_test_assert(false, '13.9 an employee''s manager cannot be in another organization');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '13.9 an employee''s manager cannot be in another organization');
  end;

  -- Being one's own manager is a check constraint rather than a tenancy matter, so
  -- it is a different SQLSTATE and is asserted as one.
  begin
    update public.employees set manager_id = id where id = public.rls_test_biz('a03');
    perform public.rls_test_assert(false, '13.10 an employee cannot be their own manager');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '13.10 an employee cannot be their own manager');
  end;

  -- An activity entry with NO actor is normal — a service account did it — and
  -- must stay writable. The guard checks a reference when there is one, not the
  -- presence of one.
  insert into public.activity_log (organization_id, actor_id, entity, action, summary)
  values (org_a, null, 'department', 'created', 'A department was created');
  perform public.rls_test_assert(
    (select count(*) from public.activity_log
      where organization_id = org_a and actor_id is null) = 1,
    '13.11 an activity entry may have no actor');
end;
$$;

reset role;

-- ===========================================================================
-- 14. Immutability, ranges and append-only.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
begin
  begin
    update public.projects set organization_id = public.rls_test_org('b')
    where id = public.rls_test_biz('a10');
    perform public.rls_test_assert(false, '14.1 a project cannot be moved between organizations');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.1 a project cannot be moved between organizations');
  end;

  begin
    update public.employees set organization_id = public.rls_test_org('b')
    where id = public.rls_test_biz('a03');
    perform public.rls_test_assert(false, '14.2 an employee cannot be moved between organizations');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.2 an employee cannot be moved between organizations');
  end;

  -- project_members has no organization_id, so this is the only thing stopping a
  -- membership from being re-homed into another organization's project.
  begin
    update public.project_members set project_id = public.rls_test_biz('b10')
    where project_id = public.rls_test_biz('a10');
    perform public.rls_test_assert(false, '14.3 a project membership cannot be moved to another project');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.3 a project membership cannot be moved to another project');
  end;

  begin
    update public.projects set progress = 101 where id = public.rls_test_biz('a10');
    perform public.rls_test_assert(false, '14.4 a project progress above 100 is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14.4 a project progress above 100 is rejected');
  end;

  begin
    update public.tasks set progress = -1 where id = public.rls_test_biz('a20');
    perform public.rls_test_assert(false, '14.5 a negative task progress is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14.5 a negative task progress is rejected');
  end;

  -- A target before the start is silently wrong rather than visibly broken, so it
  -- is refused at the door.
  begin
    update public.projects set start_date = '2026-12-31', target_date = '2026-01-01'
    where id = public.rls_test_biz('a10');
    perform public.rls_test_assert(false, '14.6 a target date before the start date is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14.6 a target date before the start date is rejected');
  end;

  begin
    update public.departments set name = 'Production ' || ''
    where id = public.rls_test_biz('a01');
    perform public.rls_test_assert(false, '14.7 an untrimmed department name is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14.7 an untrimmed department name is rejected');
  end;

  -- Append-only, and this is enforced by the ABSENCE of a grant as much as by the
  -- absence of a policy. Both are asserted, because either one alone would leave
  -- the table editable.
  -- `activity_log` grants no UPDATE at all, so 14.8 and 14.9 are asserted as
  -- privilege failures rather than as constraint failures: the privilege is checked
  -- first, and the constraints on these columns are unreachable from a client. That
  -- is not a weaker claim, it is a stronger one — but it does mean a test that
  -- expected 23514 here would be asserting something that cannot happen, so the
  -- constraints themselves are exercised as the table owner in section 14b below.
  --
  -- An earlier draft of this section also carried 14.8 and 14.9 as `check_violation`
  -- assertions on the same two writes. Those blocks were unreachable: `authenticated`
  -- holds no UPDATE privilege on this table, so the privilege check fires first and
  -- 23514 never arrives. They were removed rather than corrected, because the
  -- constraints they meant to cover are the ones 14b exercises directly.
  begin
    update public.activity_log set summary = 'Rewritten Trail'
    where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14.8 an activity entry cannot be rewritten');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.8 an activity entry cannot be rewritten');
  end;

  begin
    delete from public.activity_log where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14.9 an activity entry cannot be deleted');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.9 an activity entry cannot be deleted');
  end;

  -- A member cannot rewrite the trail either; append-only means append-only.
  perform public.rls_test_assert(
    (select summary from public.activity_log where id = public.rls_test_biz('a30')) = 'Ramesh was added',
    '14.10 the activity entry is unchanged after the refused rewrites');
end;
$$;

reset role;

-- ===========================================================================
-- 14b. The `activity_log` constraints, exercised as the table owner.
--
--      Section 14 proved a client cannot UPDATE the table. This proves the table
--      would still refuse a bad write if a grant were ever widened by mistake —
--      the two defences are independent, and testing only the first would leave
--      the second unverified.
-- ===========================================================================

do $$
begin
  begin
    update public.activity_log set summary = '   '
    where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14b.1 a blank activity summary is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14b.1 a blank activity summary is rejected');
  end;

  begin
    update public.activity_log set action = 'Created'
    where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14b.2 an activity action must be a lower-case slug');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14b.2 an activity action must be a lower-case slug');
  end;

  begin
    update public.activity_log set summary = ' Untrimmed'
    where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14b.3 an untrimmed activity summary is rejected');
  exception
    when check_violation then
      perform public.rls_test_assert(true, '14b.3 an untrimmed activity summary is rejected');
  end;

  -- And the entry is still exactly as section 9 created it.
  perform public.rls_test_assert(
    (select action from public.activity_log where id = public.rls_test_biz('a30')) = 'created'
      and (select summary from public.activity_log where id = public.rls_test_biz('a30')) = 'Ramesh was added',
    '14b.4 the activity entry survived every refused rewrite');
end;
$$;

reset role;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
begin
  begin
    update public.activity_log set summary = 'Member Rewrote This'
    where id = public.rls_test_biz('a30');
    perform public.rls_test_assert(false, '14.11 a member cannot rewrite an activity entry');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.11 a member cannot rewrite an activity entry');
  end;

  begin
    delete from public.activity_log where organization_id = public.rls_test_org('a');
    perform public.rls_test_assert(false, '14.12 a member cannot delete activity entries');
  exception
    when insufficient_privilege then
      perform public.rls_test_assert(true, '14.12 a member cannot delete activity entries');
  end;

  -- Members may append, and the append is their own to name themselves as actor.
  insert into public.activity_log (organization_id, actor_id, entity, action, summary)
  values (public.rls_test_org('a'), public.rls_test_biz('a03'), 'task', 'updated', 'Task updated');
  perform public.rls_test_assert(
    (select count(*) from public.activity_log
      where organization_id = public.rls_test_org('a') and action = 'updated') = 1,
    '14.13 a member can append to the activity log');
end;
$$;

reset role;

-- ===========================================================================
-- 15. Cascade, and the end-to-end shape of an employee's disappearance.
--
--     Deleting an employee SETS NULL rather than cascading, and the reason is
--     stated in the schema: losing a login must not delete a person, a project
--     must not lose its history, and a finished task must not vanish because the
--     person who did it left. This section checks all three at once, because a
--     cascade on any of them would be found here rather than in production.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  affected integer;
begin
  -- The employee with no login, on a project and as other people's manager.
  delete from public.employees where id = public.rls_test_biz('a04');
  get diagnostics affected = row_count;
  perform public.rls_test_assert(affected = 1, '15.1 an admin can delete an employee');

  -- Counts are stated, not assumed: section 12 leaves organization A with five
  -- tasks (three fixtures plus two raised in 12.4 and 12.5, minus 'Theirs' removed
  -- by 12.11, plus 'Assigned By Manager' from 12.12) and three employees.
  perform public.rls_test_assert(
    (select owner_id from public.projects where id = public.rls_test_biz('a10'))
      is not distinct from public.rls_test_biz('a02'),
    '15.2 deleting an employee leaves a project intact');
  perform public.rls_test_assert(
    (select count(*) from public.project_members
      where employee_id = public.rls_test_biz('a04')) = 0,
    '15.3 deleting an employee removes their project memberships');
  perform public.rls_test_assert(
    (select count(*) from public.tasks where organization_id = public.rls_test_org('a')) = 5,
    '15.4 deleting an employee leaves the task history intact');
  perform public.rls_test_assert(
    (select assignee_id from public.tasks
      where organization_id = public.rls_test_org('a') and title = 'Assigned By Manager') is null,
    '15.5 a task assigned to a departing employee becomes unassigned, not deleted');
  perform public.rls_test_assert(
    (select count(*) from public.activity_log
      where organization_id = public.rls_test_org('a')) = 3,
    '15.6 deleting an employee leaves the activity trail intact');

  -- Deleting a department is a reorganisation, not a dismissal. Two of A's three
  -- employees survive 15.1, and both lose their label.
  delete from public.departments where id = public.rls_test_biz('a01');
  perform public.rls_test_assert(
    (select count(*) from public.employees
      where organization_id = public.rls_test_org('a') and department_id is null) = 2,
    '15.7 deleting a department leaves its employees in place');
end;
$$;

reset role;

-- Deleting a project DOES cascade, and deliberately: the work belongs to the job.
-- Run as B's owner so A's fixtures stay intact for any assertion added later.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-b111-111111111101","role":"authenticated"}';

do $$
begin
  delete from public.projects where id = public.rls_test_biz('b10');
  perform public.rls_test_assert(
    (select count(*) from public.tasks where organization_id = public.rls_test_org('b')) = 0,
    '15.8 deleting a project takes its tasks with it');
  perform public.rls_test_assert(
    (select count(*) from public.project_members
      where project_id = public.rls_test_biz('b10')) = 0,
    '15.9 deleting a project takes its memberships with it');

  -- B's employee row survives its project, which is the point of set null.
  perform public.rls_test_assert(
    (select count(*) from public.employees
      where organization_id = public.rls_test_org('b')) = 1,
    '15.10 deleting a project leaves the employees it referenced');
end;
$$;

reset role;

-- ===========================================================================
-- 16. The open-task count. The one Phase 33 query with no assertion behind it.
--
--     The project list shows "open tasks" per project, and that number is a grouped
--     read over `tasks` rather than a column on the project row. A count derived in
--     SQL is only as private as the SELECT policy underneath it, so this section
--     pins the three ways that read can go wrong:
--
--       · it counts another organization's tasks, which is a tenant leak in a
--         number rather than in a row;
--       · it counts CLOSED work, so a finished project still looks busy;
--       · it attributes a task with no project to some project, which is the bug a
--         naive join to `projects` introduces.
--
--     The status list is written out rather than derived from a constant, because
--     the assertion must fail if the schema grows a status the query does not know
--     about — a new `task_status` that the read silently ignores is the exact
--     regression this section exists to catch.
-- ===========================================================================

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

-- Two tasks on A's surviving project: one closed, one open, so "counts only open"
-- has something to get wrong. Created as a manager, who may assign freely.
insert into public.tasks (
  id, organization_id, project_id, assignee_id, title, status, priority, progress, due_date
)
values
  (public.rls_test_biz('a23'), public.rls_test_org('a'), public.rls_test_biz('a10'),
   null, 'Closed On A10', 'done', 'low', 100, null),
  (public.rls_test_biz('a24'), public.rls_test_org('a'), public.rls_test_biz('a10'),
   null, 'Blocked On A10', 'blocked', 'high', 0, null);

do $$
declare
  org_a uuid := public.rls_test_org('a');
  project_a uuid := public.rls_test_biz('a10');
  open_count integer;
  total_count integer;
  statuses text[];
begin
  -- Every status the schema defines, so an enum widened without widening this read
  -- shows up here as a failure rather than as a quietly understated count.
  select array_agg(e.enumlabel order by e.enumsortorder)
    into statuses
  from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'task_status';

  perform public.rls_test_assert(
    statuses = array['todo', 'in_progress', 'blocked', 'in_review', 'done'],
    '16.1 the open-task read accounts for every status the schema defines');

  -- The grouped read exactly as `openTaskCountsByProject` issues it.
  select count(*) into open_count
  from public.tasks
  where organization_id = org_a
    and project_id = project_a
    and status in ('todo', 'in_progress', 'blocked', 'in_review');

  -- On A's project: 'Mine' (in_progress, from section 9) and 'Blocked On A10'.
  -- 'Closed On A10' is excluded, and 'Theirs' was removed by 12.11.
  perform public.rls_test_assert(open_count = 2, '16.2 the count includes open work and excludes closed work');

  -- The count is not a join, so a task with no project belongs to no bucket. If
  -- this ever reads 3, somebody has inner-joined `tasks` to `projects` and is
  -- attributing unassigned work to whichever project sorted first.
  --
  -- Stated as 4 because the fixtures are: 'Unassigned' from section 9, the two a
  -- member raised in 12.4 and 12.5, and 'Assigned By Manager' from 12.12 — which
  -- 15.5 left on a project-less row when its assignee left. A number written down
  -- is a number that can be checked; "however many there are" is not an assertion.
  perform public.rls_test_assert(
    (select count(*) from public.tasks
      where organization_id = org_a and project_id is null
        and status in ('todo', 'in_progress', 'blocked', 'in_review')) = 4,
    '16.3 tasks with no project are left out of every project''s count');

  -- And they are still visible to the organization, because "not counted" must not
  -- have been achieved by making them invisible.
  perform public.rls_test_assert(
    (select count(*) from public.tasks
      where organization_id = org_a and title = 'Unassigned') = 1,
    '16.4 an unassigned task is still visible to its organization');

  -- B's project was deleted with its tasks by 15.8, so the strongest available
  -- statement is that A cannot see B's work at all — the same fact 12.10 asserts
  -- for a write, stated here for a count.
  perform public.rls_test_assert(
    (select count(*) from public.tasks where organization_id = public.rls_test_org('b')) = 0,
    '16.5 the open-task count cannot see another organization''s tasks');
end;
$$;

-- The count is a member-visible read, not a manager-only one. A member triaging
-- their own day needs the same number the manager sees, or the two disagree about
-- how busy the project is.
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  open_count integer;
begin
  select count(*) into open_count
  from public.tasks
  where organization_id = public.rls_test_org('a')
    and project_id = public.rls_test_biz('a10')
    and status in ('todo', 'in_progress', 'blocked', 'in_review');

  perform public.rls_test_assert(open_count = 2, '16.6 a member reads the same open-task count as a manager');
end;
$$;

-- ---------------------------------------------------------------------------
-- 17. Phase 35 - AI provider configurations: tenancy, RBAC and the secret
--     boundary.
--
-- Runs last, after section 16, and reads the fixture organizations the earlier
-- sections created. It asserts four separate things, and it is worth keeping them
-- apart, because each is enforced by a different mechanism and they fail in
-- different ways:
--
--   17.A  Tenancy. RLS policies. A cross-organization read returns zero rows; a
--         cross-organization write matches no rows.
--   17.B  Role gates. RLS policies plus the SECURITY DEFINER RPCs. A manager is
--         refused; an owner is not.
--   17.C  The secret boundary. COLUMN privileges, not RLS. This is the part a
--         policy cannot express: `secret_reference` is not merely hidden by a
--         `WHERE` clause, it is unreadable and unwritable by the `authenticated`
--         role. Both refusals RAISE, because a privilege failure is an error and
--         not a filtered result.
--   17.D  Database invariants. One default per organization, a disabled provider
--         cannot become the default, and the service-role-only functions refuse a
--         client caller.
--
-- Fixtures, and the roles they actually hold HERE, not as originally created:
-- section 8 demotes people, so the section 1 fixture is not the entry state.
--   a_owner  (...101)  owner    -- stable, and above the admin threshold
--   a_admin  (...102)  manager  -- demoted from admin by assertion 8.5
--   a_member (...103)  member   -- demoted from admin by 5.4, then 8.4
--   b_owner  (b..101)  owner of organization B
--
-- That demotion is load-bearing here, and it is why this section does not use
-- a_admin for anything. `has_organization_role(org, 'admin')` asks whether the
-- caller ranks at least ADMIN, and a manager does not, so an insert by
-- (...102) is correctly refused by the WITH CHECK and the section fails at its
-- first assertion. The refusal is the security property working; the assumption
-- was the bug.
--
-- The two roles used below are therefore chosen to make each assertion stronger
-- than a member-based version would be:
--   ...101 (owner)  for anything that must SUCCEED. An owner outranks admin, so
--                   a refusal here could never be blamed on insufficient rank.
--   ...102 (manager) for anything that must be REFUSED. A manager holds genuine
--                   write authority elsewhere in this schema, so being refused
--                   here proves the gate is specifically the ADMIN threshold and
--                   not merely "not the owner". A member would have been a weaker
--                   control for the same assertion.
-- 17.0 pins both roles, so a future section that moves them again fails with an
-- explanation instead of a confusing RLS error 300 lines later.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 17.A / 17.B  An owner can configure; a manager cannot; another tenant sees
--               nothing and can change nothing.
-- ---------------------------------------------------------------------------

-- 17.0: pin the two roles this section depends on. Read as the migration owner,
-- because it has to read organization_members directly to state what the fixtures
-- hold. If an earlier section ever changes a role again, this fails first and
-- says which one, instead of 17.1 failing with an opaque RLS error.
do $$
declare
  org_a uuid := public.rls_test_org('a');
begin
  perform public.rls_test_assert(
    (select role from public.organization_members
      where organization_id = org_a and user_id = public.rls_test_uid('a_owner')
    ) = 'owner',
    '17.0 a_owner still holds owner in organization A when section 17 runs'
  );

  perform public.rls_test_assert(
    (select role from public.organization_members
      where organization_id = org_a and user_id = public.rls_test_uid('a_admin')
    ) = 'manager',
    '17.0 a_admin is demoted to manager by 8.5, so this section must not treat it as an admin'
  );
end;
$$;

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  created_id uuid;
begin
  -- Only the columns the client role may write. `is_default`, `secret_reference`
  -- and `connection_status` are deliberately absent: attempting them is 17.C.
  insert into public.ai_provider_configs (
    organization_id, provider, display_name, enabled, selected_model
  ) values (
    org_a, 'gemini', 'Google Gemini', true, 'gemini-3.6-flash'
  ) returning id into created_id;

  perform public.rls_test_assert(
    created_id is not null,
    '17.1 An organization admin can create a provider configuration'
  );

  perform public.rls_test_assert(
    (select is_default from public.ai_provider_configs where id = created_id) = false,
    '17.2 A new configuration is never marked default by the client'
  );

  perform public.rls_test_assert(
    (select connection_status from public.ai_provider_configs where id = created_id) = 'unverified',
    '17.3 A new configuration starts unverified, so it cannot look connected'
  );

  perform public.rls_test_assert(
    (select credential_present from public.ai_provider_configs where id = created_id) = false,
    '17.4 credential_present is false until a server-side handle exists'
  );
end;
$$;

-- A member of organization A may read the configuration metadata.
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111103","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  read_provider public.ai_provider;
  visible integer;
begin
  select count(*) into visible
  from public.ai_provider_configs
  where organization_id = org_a;

  perform public.rls_test_assert(
    visible = 1,
    '17.5 A member of organization A can read its provider configuration'
  );

  select provider into read_provider
  from public.ai_provider_configs
  where organization_id = org_a;

  perform public.rls_test_assert(
    read_provider = 'gemini',
    '17.6 A member reads the provider metadata'
  );
end;
$$;

-- A manager cannot insert. This is deliberately a MANAGER and not a member.
-- A manager holds genuine write authority elsewhere in this schema, so being
-- refused here isolates the variable: the gate is the ADMIN threshold in
-- `has_organization_role(org, 'admin')`, not merely "the caller is not the owner".
-- A member would have been refused too, but would not have proved which rule did
-- it. The INSERT policy requires admin, so the WITH CHECK fails and it raises.
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111102","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  refused boolean := false;
begin
  begin
    insert into public.ai_provider_configs (
      organization_id, provider, display_name, enabled, selected_model
    ) values (
      org_a, 'openai', 'OpenAI', true, 'gpt-5.6'
    );
  exception
    -- A failed INSERT ... WITH CHECK reports SQLSTATE 42501, the same
    -- insufficient_privilege the write guards raise. It is caught by that name,
    -- not by a condition of its own: PostgreSQL 17 has no
    -- `new_row_violates_row_level_security_policy` condition, and naming one
    -- aborts the whole block with "unrecognized exception condition" before any
    -- assertion runs. `check_violation` is also caught, so a genuine CHECK
    -- failure cannot be mistaken for the RLS gate silently passing.
    when insufficient_privilege or check_violation then
      refused := true;
  end;

  perform public.rls_test_assert(refused, '17.7 A manager cannot insert a provider configuration');

  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs where organization_id = org_a) = 1,
    '17.8 The refused manager insert left no row behind'
  );
end;
$$;

-- The same manager cannot update. A policy-filtered UPDATE returns zero rows
-- rather than raising, which is why the evidence of refusal is the row count.
do $$
declare
  org_a uuid := public.rls_test_org('a');
  matched integer;
begin
  update public.ai_provider_configs
  set enabled = false
  where organization_id = org_a;

  get diagnostics matched = row_count;

  perform public.rls_test_assert(matched = 0, '17.9 A manager update is filtered by RLS');
  perform public.rls_test_assert(
    (select enabled from public.ai_provider_configs where organization_id = org_a) = true,
    '17.10 The configuration is unchanged after the refused manager update'
  );
end;
$$;

-- And the same manager cannot call the default-switching RPC. The RPC is
-- SECURITY DEFINER, so RLS does not apply to it and the refusal has to come from
-- the role check inside the function. That makes this the assertion that covers
-- the RPC's own authorization rather than the table's.
do $$
declare
  org_a uuid := public.rls_test_org('a');
  refused boolean := false;
begin
  begin
    perform public.set_default_ai_provider(org_a, 'gemini');
  exception
    when insufficient_privilege then
      refused := true;
  end;

  perform public.rls_test_assert(refused, '17.11 A manager cannot call set_default_ai_provider');
end;
$$;

-- Organization B: an owner of another tenant sees nothing and changes nothing.
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-b111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  org_b uuid := public.rls_test_org('b');
  visible integer;
  matched integer;
  created_count integer;
begin
  select count(*) into visible
  from public.ai_provider_configs
  where organization_id = org_a;

  perform public.rls_test_assert(
    visible = 0,
    '17.12 Organization B cannot read organization A provider configuration'
  );

  update public.ai_provider_configs
  set enabled = false
  where organization_id = org_a;

  get diagnostics matched = row_count;

  perform public.rls_test_assert(
    matched = 0,
    '17.13 Organization B cannot modify organization A provider configuration'
  );

  insert into public.ai_provider_configs (
    organization_id, provider, display_name, enabled, selected_model
  ) values (
    org_b, 'openai', 'OpenAI', true, 'gpt-5.6'
  );

  get diagnostics created_count = row_count;

  perform public.rls_test_assert(
    created_count = 1,
    '17.14 Organization B can still manage its own configuration'
  );

  -- 17.15 used to live here, checking organization A's row from inside this
  -- block. That cannot work and its failure was not a security signal: as
  -- organization B, RLS hides organization A's rows, so the subquery returned no
  -- row, the comparison yielded NULL rather than true, and the assertion failed
  -- having proved nothing either way. The question "did B's activity damage A?"
  -- has to be asked by someone who is allowed to see A, so it is asked below as
  -- A's owner, after switching back.
end;
$$;

-- Back to organization A's owner to confirm that organization B's insert, and its
-- refused attempt to touch organization A, left A's configuration intact. This is
-- the real cross-tenant integrity check: B is not merely blocked from A, B's
-- writes provably do not land in A.
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
begin
  -- Counted rather than read as a bare scalar. A bare `select enabled` returns
  -- NULL when RLS hides the row, and NULL = true is NULL, so it fails for the
  -- wrong reason; it would also raise on a second row. Counting a predicate
  -- gives one unambiguous answer: exactly one enabled row in A.
  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs
      where organization_id = org_a and enabled) = 1,
    '17.15 Organization A configuration survived organization B activity'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 17.C  The secret boundary.
--
-- These are column-privilege failures, so they RAISE with SQLSTATE 42501 rather
-- than returning zero rows. A `select *` cannot reach `secret_reference` because
-- the role holds no SELECT privilege on it; naming the column explicitly is the
-- only way to ask for it, and that is refused.
-- ---------------------------------------------------------------------------

do $$
declare
  can_read boolean := false;
begin
  -- Become organization A's owner, so the caller holds the highest client rank
  -- available: this refusal must come from the column grant, not from a role that
  -- happens to lack access for some unrelated reason. Using the owner rather than
  -- an admin is deliberate, and it is what makes this a control: nothing a
  -- legitimate client can be, grants access to this column.
  perform pg_catalog.set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}',
    true
  );

  -- Probed with EXECUTE so the outcome is a boolean, not a value: a plain
  -- `select secret_reference into` would assign NULL on success here and the
  -- assertion would pass whether or not the column was readable.
  begin
    execute 'select secret_reference from public.ai_provider_configs limit 1';
    can_read := true;
  exception
    when insufficient_privilege then
      can_read := false;
  end;

  perform public.rls_test_assert(
    not can_read,
    '17.16 An admin cannot SELECT secret_reference: the column is not client-readable'
  );
end;
$$;

do $$
declare
  org_a uuid := public.rls_test_org('a');
  refused boolean := false;
begin
  begin
    update public.ai_provider_configs
    set secret_reference = 'vault-handle-a1b2c3d4'
    where organization_id = org_a;
  exception
    when insufficient_privilege then
      refused := true;
  end;

  perform public.rls_test_assert(
    refused,
    '17.17 A client cannot write secret_reference, even as an admin'
  );
end;
$$;

do $$
declare
  org_a uuid := public.rls_test_org('a');
  refused_status boolean := false;
  refused_default boolean := false;
begin
  begin
    update public.ai_provider_configs
    set connection_status = 'connected'
    where organization_id = org_a;
  exception
    when insufficient_privilege then
      refused_status := true;
  end;

  perform public.rls_test_assert(
    refused_status,
    '17.18 A client cannot set connection_status, so Connected cannot be fabricated'
  );

  begin
    update public.ai_provider_configs
    set is_default = true
    where organization_id = org_a;
  exception
    when insufficient_privilege then
      refused_default := true;
  end;

  perform public.rls_test_assert(
    refused_default,
    '17.19 A client cannot set is_default directly; the RPC is the only path'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 17.D  Invariants: one default, no disabled default, and server-only writers.
-- ---------------------------------------------------------------------------

set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

-- The owner adds a second provider, then moves the default between them.
do $$
declare
  org_a uuid := public.rls_test_org('a');
  first_default record;
  second_default record;
begin
  insert into public.ai_provider_configs (
    organization_id, provider, display_name, enabled, selected_model
  ) values (
    org_a, 'anthropic', 'Anthropic', true, 'claude-sonnet-5'
  );

  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs where organization_id = org_a) = 2,
    '17.20 An organization may hold several provider configurations'
  );

  first_default := public.set_default_ai_provider(org_a, 'anthropic');

  perform public.rls_test_assert(
    first_default.is_default and first_default.provider = 'anthropic',
    '17.21 set_default_ai_provider marks the target default'
  );

  perform public.rls_test_assert(
    first_default.credential_present = false,
    '17.22 The RPC returns safe metadata only, with no secret reference'
  );

  second_default := public.set_default_ai_provider(org_a, 'gemini');

  perform public.rls_test_assert(
    second_default.is_default and second_default.provider = 'gemini',
    '17.23 The default can be moved to another enabled provider'
  );

  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs
      where organization_id = org_a and is_default) = 1,
    '17.24 Exactly one default exists after switching, never zero and never two'
  );

  perform public.rls_test_assert(
    (select is_default from public.ai_provider_configs
      where organization_id = org_a and provider = 'anthropic') = false,
    '17.25 The previous default was unset by the same call'
  );
end;
$$;

-- A client cannot set is_default on INSERT, because the column has no INSERT
-- grant for the authenticated role. This is a column-privilege refusal, so only
-- insufficient_privilege counts here: accepting unique_violation would let the
-- test pass even if the column grant were removed, and the partial unique index
-- is asserted separately, as the service role, in 17.34.
do $$
declare
  refused boolean := false;
begin
  begin
    insert into public.ai_provider_configs (
      organization_id, provider, display_name, enabled, is_default, selected_model
    ) values (
      public.rls_test_org('a'), 'openai', 'OpenAI', true, true, 'gpt-5.6'
    );
  exception
    when insufficient_privilege then
      refused := true;
  end;

  perform public.rls_test_assert(
    refused,
    '17.26 A client cannot set is_default on INSERT; the column has no INSERT grant'
  );

  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs
      where organization_id = public.rls_test_org('a') and is_default) = 1,
    '17.27 The refused insert left the single default intact'
  );
end;
$$;

-- A disabled provider cannot be made the default.
do $$
declare
  org_a uuid := public.rls_test_org('a');
  refused boolean := false;
begin
  update public.ai_provider_configs
  set enabled = false
  where organization_id = org_a and provider = 'anthropic';

  begin
    perform public.set_default_ai_provider(org_a, 'anthropic');
  exception
    when no_data_found then
      refused := true;
  end;

  perform public.rls_test_assert(
    refused,
    '17.28 A disabled provider cannot become the default'
  );
end;
$$;

-- The server-side writers refuse a client caller. `auth.role()` is
-- 'authenticated' here, so both functions must raise before touching a row.
do $$
declare
  org_a uuid := public.rls_test_org('a');
  target uuid;
  refused_reference boolean := false;
  refused_test boolean := false;
begin
  select id into target
  from public.ai_provider_configs
  where organization_id = org_a and provider = 'gemini';

  begin
    perform public.set_ai_provider_secret_reference(target, 'vault-handle-a1b2c3d4');
  exception
    when insufficient_privilege then
      refused_reference := true;
  end;

  perform public.rls_test_assert(
    refused_reference,
    '17.29 Only the AI Gateway may set a secret reference'
  );

  begin
    perform public.record_ai_connection_test(target, 'connected');
  exception
    when insufficient_privilege then
      refused_test := true;
  end;

  perform public.rls_test_assert(
    refused_test,
    '17.30 Only the AI Gateway may record a connection test'
  );

  perform public.rls_test_assert(
    (select credential_present from public.ai_provider_configs where id = target) = false,
    '17.31 The refused writers left credential_present false'
  );

  perform public.rls_test_assert(
    (select connection_status from public.ai_provider_configs where id = target) = 'unverified',
    '17.32 The refused connection test left the status unverified'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 17.E  The gateway path, and who is allowed to observe it.
--
-- The service role is NOT granted SELECT, INSERT, UPDATE or DELETE on
-- ai_provider_configs. Its only reach into this table is EXECUTE on the two
-- SECURITY DEFINER gateway functions. That is the stronger arrangement, and it is
-- why the blocks below alternate roles instead of staying in one: the service
-- role can call the functions but cannot read the result, so the *effect* of
-- those calls is observed as the client. Splitting it this way is the property
-- being tested, not a workaround for a missing grant.
--
-- An earlier version of this section ran the calls and the reads both as the
-- service role and died with "permission denied for table ai_provider_configs".
-- That failure was correct: the migration withholds table privileges from the
-- service role on purpose.
-- ---------------------------------------------------------------------------

-- Capture the id the gateway is about to write to, as the client, because the
-- service role is not permitted to look it up. Handed across role changes in a
-- session GUC, which survives `set local role` because the variable belongs to
-- the session, not to the role.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  target uuid;
begin
  select id into target
  from public.ai_provider_configs
  where organization_id = public.rls_test_org('a') and provider = 'gemini';

  perform pg_catalog.set_config('rls_test.target', coalesce(target::text, ''), false);
end;
$$;

-- The gateway writes. Reaching these two functions at all is the permission
-- being tested; 17.29 and 17.30 already proved a client cannot.
set local role service_role;
set local "request.jwt.claims" =
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role"}';

do $$
declare
  target uuid := nullif(current_setting('rls_test.target'), '')::uuid;
begin
  perform public.set_ai_provider_secret_reference(target, 'vault-handle-a1b2c3d4');
  perform public.record_ai_connection_test(target, 'connected');
end;
$$;

-- The client observes what the gateway wrote. credential_present and
-- connection_status are client-readable derived/summary columns, which is exactly
-- the intended split: the client learns that a credential exists, never what it
-- is.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  target uuid := nullif(current_setting('rls_test.target'), '')::uuid;
  can_read boolean := false;
begin
  perform public.rls_test_assert(
    (select credential_present from public.ai_provider_configs where id = target),
    '17.33 The service role can store a vault handle, and credential_present follows'
  );

  perform public.rls_test_assert(
    (select connection_status from public.ai_provider_configs where id = target) = 'connected'
      and (select last_tested_at from public.ai_provider_configs where id = target) is not null,
    '17.34 The service role can record a verified connection test'
  );

  begin
    execute 'select secret_reference from public.ai_provider_configs limit 1';
    can_read := true;
  exception
    when insufficient_privilege then
      can_read := false;
  end;

  -- Same actor as 17.16, so the pair is a clean before/after: the owner could not
  -- read `secret_reference` when it was NULL, and still cannot now that a real
  -- handle exists. Were the grant ever widened, this would catch it with a value
  -- in hand rather than an empty column.
  perform public.rls_test_assert(
    not can_read,
    '17.35 The vault handle written by the gateway is still unreadable by a client'
  );
end;
$$;

-- The one-default invariant, proved as the table's OWNER.
--
-- `service_role` cannot be used here: it has no INSERT privilege, so an attempt
-- would be refused by the GRANT (17.29/17.30's subject) and would say nothing
-- about the index. Running as the owner is deliberate. The owner is more
-- privileged than any role the application holds and bypasses RLS entirely, so
-- this is the strongest writer that exists, short of disabling the index. If the
-- partial unique index does not hold here, it certainly does not hold for a
-- client. The privilege boundary itself is covered by 17.26 and 17.29.
reset role;

do $$
declare
  org_a uuid := public.rls_test_org('a');
  second_default_refused boolean := false;
begin
  begin
    insert into public.ai_provider_configs (
      organization_id, provider, display_name, enabled, is_default, selected_model
    ) values (
      org_a, 'openai', 'OpenAI', true, true, 'gpt-5.6'
    );
  exception
    when unique_violation then
      second_default_refused := true;
  end;

  perform public.rls_test_assert(
    second_default_refused,
    '17.36 Not even the table owner can create a second default for one organization'
  );
end;
$$;

-- Deleting the configuration drops the handle reference with the row. Done as the
-- owner, since `authenticated` holds the DELETE grant and is the role that would
-- actually remove a configuration in the app.
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"11111111-1111-4111-a111-111111111101","role":"authenticated"}';

do $$
declare
  org_a uuid := public.rls_test_org('a');
  removed integer;
begin
  delete from public.ai_provider_configs
  where organization_id = org_a and provider = 'gemini';

  get diagnostics removed = row_count;

  perform public.rls_test_assert(removed = 1, '17.37 A configuration row can be deleted');

  perform public.rls_test_assert(
    (select count(*) from public.ai_provider_configs
      where organization_id = org_a and provider = 'gemini') = 0,
    '17.38 Deleting a configuration removes its credential state'
  );
end;
$$;

reset role;

do $$
begin
  raise notice '-----------------------------------------------------------';
  raise notice 'All isolation assertions passed. Rolling back — nothing kept.';
  raise notice '-----------------------------------------------------------';
end;
$$;

rollback;
