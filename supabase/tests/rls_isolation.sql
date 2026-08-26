-- ---------------------------------------------------------------------------
-- Trackit X — tenant isolation test for the foundation migration.
--
-- ⚠ NOT YET EXECUTED. Docker is unavailable on the machine this was written on,
--   so there is no local Postgres to run it against. Every assertion below is a
--   claim about intended behaviour, not an observed result. It becomes evidence
--   only once it has actually run and printed PASS lines.
--
-- Run with:
--
--   supabase db reset
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--        -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
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

do $$
begin
  raise notice '-----------------------------------------------------------';
  raise notice 'All isolation assertions passed. Rolling back — nothing kept.';
  raise notice '-----------------------------------------------------------';
end;
$$;

rollback;
