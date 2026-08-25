-- ---------------------------------------------------------------------------
-- Trackit X — foundation migration: organizations and organization_members.
--
-- This is the tenancy root of the whole product. Every table added in later
-- phases (projects, employees, attendance, payroll, inventory, ...) will carry
-- an `organization_id` and will delegate its visibility decision to the two
-- helper functions defined here. Getting this file right is therefore worth
-- more than getting any single feature right.
--
-- The isolation guarantee is enforced at the DATABASE level, by Row Level
-- Security, and never by the client. A user holding a valid publishable key
-- and a valid session still cannot read a row belonging to an organization
-- they are not a member of, because Postgres removes it from the result set
-- before PostgREST ever sees it.
--
-- Two deliberate omissions, both security decisions rather than oversights:
--
--   1. There is NO insert policy on `organizations`, and `authenticated` is not
--      granted INSERT on it. An organization can only come into existence
--      through `public.create_organization()`, which creates the row and its
--      owner membership in one transaction. A client cannot produce an
--      organization with no members, and cannot pick who owns it.
--
--   2. There is NO policy that lets a member write their own `role` or
--      `permissions`. Privilege is granted downward by someone who already
--      holds it, checked by RLS and again by a trigger. This is what makes
--      "the client cannot elevate itself" a property of the database rather
--      than a property of the UI.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- The sector an MSME operates in. Trackit X uses this to choose defaults and,
-- later, to pick the right benchmarks — so the list is intentionally coarse and
-- economy-wide rather than a taxonomy. `other` exists so onboarding never dead
-- ends; new values are appended in a later migration when they earn their place.
create type public.business_type as enum (
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
  'other'
);

comment on type public.business_type is
  'Sector of an organization. Drives defaults and, later, peer benchmarking.';

-- Membership role. Ordered by authority; see public.organization_role_rank.
--   owner   — full control, including deleting the organization and billing.
--   admin   — full operational control, cannot delete the organization.
--   manager — runs their area: assigns work, approves within limits.
--   member  — records their own work.
create type public.organization_role as enum ('owner', 'admin', 'manager', 'member');

comment on type public.organization_role is
  'Membership role within one organization. Authority order: owner > admin > manager > member.';

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

-- `updated_at` is maintained by the database, not by callers. A timestamp the
-- client is trusted to set is a timestamp that disagrees with reality the first
-- time a clock is wrong or an update path forgets it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at from the server clock.';

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),

  name text not null,
  business_type public.business_type not null default 'other',

  -- An IANA zone name, e.g. 'Asia/Kolkata'. Every attendance punch, shift
  -- boundary and payroll cut-off in later phases is interpreted in this zone,
  -- so a nonsense value here becomes a wrong payslip later. Validated by
  -- trigger against pg_timezone_names, because a CHECK constraint may not
  -- read a catalogue.
  timezone text not null default 'UTC',

  -- ISO 4217 alphabetic code. Money is stored as integer minor units
  -- throughout Trackit X; this is the code that says how many minor units make
  -- a major one.
  currency text not null default 'INR',

  -- The user who called create_organization(). Retained for audit and for the
  -- membership bootstrap check in guard_organization_member_write().
  created_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organizations_name_length
    check (char_length(btrim(name)) between 2 and 120),
  constraint organizations_name_trimmed
    check (name = btrim(name)),
  constraint organizations_currency_format
    check (currency ~ '^[A-Z]{3}$'),
  constraint organizations_timezone_present
    check (char_length(btrim(timezone)) > 0)
);

comment on table public.organizations is
  'A tenant. Every business record in Trackit X belongs to exactly one of these.';
comment on column public.organizations.timezone is
  'IANA zone name. Authoritative for attendance, shifts and payroll periods.';
comment on column public.organizations.currency is
  'ISO 4217 code. Amounts are stored as integer minor units of this currency.';

create index organizations_created_by_idx on public.organizations (created_by);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- Rejects a timezone Postgres does not recognise. A CHECK constraint cannot do
-- this: pg_timezone_names is a function-backed catalogue and subqueries are not
-- permitted in CHECK expressions.
create or replace function public.validate_organization_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = new.timezone
  ) then
    raise exception 'Unknown IANA timezone: %', new.timezone
      using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function public.validate_organization_timezone() is
  'BEFORE INSERT/UPDATE trigger: rejects a timezone absent from pg_timezone_names.';

create trigger organizations_validate_timezone
  before insert or update of timezone on public.organizations
  for each row execute function public.validate_organization_timezone();

-- `id`, `created_by` and `created_at` are history. An admin may rename the
-- organization or change its currency; nobody may rewrite who created it.
create or replace function public.guard_organization_immutable_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id then
    raise exception 'organizations.id is immutable' using errcode = '42501';
  end if;
  if new.created_at <> old.created_at then
    raise exception 'organizations.created_at is immutable' using errcode = '42501';
  end if;
  if coalesce(new.created_by::text, '') <> coalesce(old.created_by::text, '') then
    raise exception 'organizations.created_by is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

comment on function public.guard_organization_immutable_columns() is
  'BEFORE UPDATE trigger: pins id, created_at and created_by.';

create trigger organizations_guard_immutable_columns
  before update on public.organizations
  for each row execute function public.guard_organization_immutable_columns();

-- ---------------------------------------------------------------------------
-- organization_members
-- ---------------------------------------------------------------------------

-- Permission slugs are `module.action`, e.g. 'payroll.approve'. Shape is
-- enforced here; the catalogue of legal slugs arrives with the modules that
-- define them, so that this migration does not have to predict them.
create or replace function public.is_permission_slug_array(slugs text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    bool_and(slug ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
    true
  )
  from unnest(slugs) as slug;
$$;

comment on function public.is_permission_slug_array(text[]) is
  'True when every element looks like a module.action permission slug.';

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,
  user_id uuid not null
    references auth.users (id) on delete cascade,

  role public.organization_role not null default 'member',

  -- Grants layered ON TOP of the role — never a replacement for it. The role
  -- is the coarse decision; this array is the exception list. Writable only by
  -- an admin or owner, enforced by policy and by trigger.
  permissions text[] not null default '{}'::text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint organization_members_unique_user
    unique (organization_id, user_id),
  constraint organization_members_permissions_not_null
    check (array_position(permissions, null) is null),
  constraint organization_members_permissions_bounded
    check (coalesce(array_length(permissions, 1), 0) <= 64),
  constraint organization_members_permissions_shape
    check (public.is_permission_slug_array(permissions))
);

comment on table public.organization_members is
  'Which users belong to which organization, and with what authority.';
comment on column public.organization_members.permissions is
  'Extra module.action grants on top of the role. Admin/owner writable only.';

-- Every RLS check in the product resolves "is this user in this organization?",
-- which is a lookup by user_id. Without this index that lookup is a sequential
-- scan on every single query the application makes.
create index organization_members_user_id_idx
  on public.organization_members (user_id);

-- Supports the role checks and the last-owner count in the write guard.
create index organization_members_org_role_idx
  on public.organization_members (organization_id, role);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tenancy helpers
--
-- These are SECURITY DEFINER on purpose. A policy on organization_members that
-- queried organization_members directly would recurse: evaluating the policy
-- requires reading the table, which requires evaluating the policy. Running the
-- lookup as the function owner steps outside RLS and breaks the cycle.
--
-- `set search_path = ''` is mandatory on a SECURITY DEFINER function. Without
-- it a caller can prepend a schema of their own and have the elevated function
-- call their table or their operator instead of ours.
--
-- `(select auth.uid())` rather than a bare `auth.uid()` so the planner treats it
-- as a one-time InitPlan instead of re-evaluating it per row.
-- ---------------------------------------------------------------------------

create or replace function public.is_organization_member(organization uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = organization
      and member.user_id = (select auth.uid())
  );
$$;

comment on function public.is_organization_member(uuid) is
  'True when the calling user holds any membership in the organization.';

-- Numeric authority, so "at least an admin" is a comparison rather than a list
-- of enum values repeated in every policy.
create or replace function public.organization_role_rank(member_role public.organization_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case member_role
    when 'owner' then 4
    when 'admin' then 3
    when 'manager' then 2
    when 'member' then 1
  end;
$$;

comment on function public.organization_role_rank(public.organization_role) is
  'Authority as an integer: owner 4, admin 3, manager 2, member 1.';

create or replace function public.organization_role_of(organization uuid)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.organization_members member
  where member.organization_id = organization
    and member.user_id = (select auth.uid());
$$;

comment on function public.organization_role_of(uuid) is
  'The calling user''s role in the organization, or NULL if not a member.';

create or replace function public.has_organization_role(
  organization uuid,
  minimum public.organization_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.organization_role_rank(public.organization_role_of(organization))
      >= public.organization_role_rank(minimum),
    false
  );
$$;

comment on function public.has_organization_role(uuid, public.organization_role) is
  'True when the calling user is a member with at least the given authority.';

-- ---------------------------------------------------------------------------
-- Membership write guard
--
-- RLS already refuses a non-admin's write. This trigger covers the cases RLS
-- cannot see: it runs inside SECURITY DEFINER code as well (where RLS is
-- bypassed), it can compare the new row against the actor's own authority, and
-- it can enforce invariants that span rows.
-- ---------------------------------------------------------------------------

-- Extracted so the delete path and the demote path share one definition of the
-- rule. Counts owners as they stand BEFORE the row change, so a count of one
-- means the row being removed or demoted is the last one.
create or replace function public.assert_organization_keeps_an_owner(organization uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owners integer;
begin
  select count(*) into owners
  from public.organization_members member
  where member.organization_id = organization
    and member.role = 'owner';

  if owners <= 1 then
    raise exception 'An organization must always have at least one owner'
      using errcode = '23514';
  end if;
end;
$$;

comment on function public.assert_organization_keeps_an_owner(uuid) is
  'Raises when removing or demoting an owner would leave the organization without one.';

create or replace function public.guard_organization_member_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  actor_role public.organization_role;
  target_organization uuid;
begin
  -- NEW is NULL on DELETE, so the organization is resolved per operation instead
  -- of with coalesce(new..., old...): reading a field off the NULL record is not
  -- a portable thing to do, and a DECLARE initialiser would do it on every
  -- delete before the body ever runs.
  if tg_op = 'DELETE' then
    target_organization := old.organization_id;
  else
    target_organization := new.organization_id;
  end if;

  -- No JWT: a migration, a seed, or trusted server-side code holding the
  -- service role. Those paths are already privileged; this trigger is here to
  -- constrain end users.
  if actor is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  select member.role into actor_role
  from public.organization_members member
  where member.organization_id = target_organization
    and member.user_id = actor;

  if actor_role is null then
    -- Bootstrap: the creator of a brand-new organization becomes its owner.
    -- All four conditions must hold, so this can fire at most once per
    -- organization and only for the user create_organization() ran for. There
    -- is no client path to an organizations row without a member, because
    -- `authenticated` holds no INSERT privilege on organizations.
    if tg_op = 'INSERT'
      and new.user_id = actor
      and new.role = 'owner'
      and exists (
        select 1 from public.organizations org
        where org.id = new.organization_id and org.created_by = actor
      )
      and not exists (
        select 1 from public.organization_members member
        where member.organization_id = new.organization_id
      )
    then
      return new;
    end if;

    raise exception 'Not a member of organization %', target_organization
      using errcode = '42501';
  end if;

  -- Managers and members never administer membership at all.
  if public.organization_role_rank(actor_role)
     < public.organization_role_rank('admin') then
    raise exception 'Role % may not change organization membership', actor_role
      using errcode = '42501';
  end if;

  -- The last owner may not be demoted or removed: an organization with no owner
  -- cannot be administered or deleted by anyone, ever.
  --
  -- Branched per operation rather than written as one condition mentioning both
  -- `tg_op` and `new.role`. Postgres does not promise to short-circuit a boolean
  -- expression, so `tg_op = 'DELETE' or new.role <> 'owner'` may evaluate the
  -- NEW reference during a delete, where NEW does not exist.
  if tg_op = 'DELETE' then
    if old.role = 'owner' then
      perform public.assert_organization_keeps_an_owner(old.organization_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.role = 'owner' and new.role <> 'owner' then
      perform public.assert_organization_keeps_an_owner(old.organization_id);
    end if;

    if new.organization_id <> old.organization_id then
      raise exception 'organization_members.organization_id is immutable'
        using errcode = '42501';
    end if;
    if new.user_id <> old.user_id then
      raise exception 'organization_members.user_id is immutable'
        using errcode = '42501';
    end if;

    -- Self-escalation, stated plainly. An admin may promote a colleague to
    -- admin; an admin may not promote themselves to owner, and may not widen
    -- their own permission list.
    if old.user_id = actor
      and (new.role <> old.role or new.permissions <> old.permissions) then
      raise exception 'A member may not change their own role or permissions'
        using errcode = '42501';
    end if;
  end if;

  -- Nobody grants authority they do not hold.
  if public.organization_role_rank(new.role)
     > public.organization_role_rank(actor_role) then
    raise exception 'Role % may not grant role %', actor_role, new.role
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_organization_member_write() is
  'Blocks privilege escalation, orphaned organizations and key mutation on membership writes.';

create trigger organization_members_guard_write
  before insert or update or delete on public.organization_members
  for each row execute function public.guard_organization_member_write();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

-- --- organizations ---------------------------------------------------------

-- Read: membership, and nothing else. This single policy is what makes
-- "User A cannot see Organization B" true.
create policy organizations_select_members
  on public.organizations
  for select
  to authenticated
  using (public.is_organization_member(id));

-- Write: admin and above. Non-editable columns are pinned by trigger.
create policy organizations_update_admins
  on public.organizations
  for update
  to authenticated
  using (public.has_organization_role(id, 'admin'))
  with check (public.has_organization_role(id, 'admin'));

create policy organizations_delete_owners
  on public.organizations
  for delete
  to authenticated
  using (public.has_organization_role(id, 'owner'));

-- No INSERT policy, by design. See the header: creation goes through
-- public.create_organization() so that an organization and its owner are
-- created together or not at all.

-- --- organization_members --------------------------------------------------

-- Read: co-members are visible to each other. Membership of an organization
-- the caller is not in is invisible, which is what keeps a directory of another
-- tenant's staff out of reach.
create policy organization_members_select_members
  on public.organization_members
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

create policy organization_members_insert_admins
  on public.organization_members
  for insert
  to authenticated
  with check (public.has_organization_role(organization_id, 'admin'));

create policy organization_members_update_admins
  on public.organization_members
  for update
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'))
  with check (public.has_organization_role(organization_id, 'admin'));

create policy organization_members_delete_admins
  on public.organization_members
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Onboarding entry point
--
-- The only way a client creates an organization. Atomic, so a failure cannot
-- leave an ownerless organization behind, and SECURITY DEFINER so it can insert
-- the first membership row before any membership exists to authorise it.
-- ---------------------------------------------------------------------------

-- Parameters carry a `p_` prefix because three of them would otherwise share a
-- name with a column of the table being inserted into. PL/pgSQL substitutes
-- variables into the VALUES expressions, so a bare `business_type` there reads
-- as the parameter while the identical word in the column list reads as the
-- column — legal, but a trap for whoever edits this next.
create or replace function public.create_organization(
  p_name text,
  p_business_type public.business_type,
  p_timezone text,
  p_currency text
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  created public.organizations;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- The role is NOT a parameter. A client cannot ask to be created as anything
  -- other than the owner of the organization it just created, and cannot pass
  -- a permission list. That is the whole point of routing creation through here.
  insert into public.organizations as org (
    name, business_type, timezone, currency, created_by
  )
  values (
    btrim(p_name),
    p_business_type,
    btrim(p_timezone),
    upper(btrim(p_currency)),
    actor
  )
  returning org.* into created;

  insert into public.organization_members (organization_id, user_id, role)
  values (created.id, actor, 'owner');

  return created;
end;
$$;

comment on function public.create_organization(text, public.business_type, text, text) is
  'Creates an organization and its owner membership atomically for the calling user.';

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Supabase no longer auto-exposes new objects to the Data API roles, so every
-- grant below is deliberate. RLS decides which ROWS; these grants decide which
-- OPERATIONS are available at all. Both have to agree for a request to succeed.
--
-- `anon` is granted nothing: there is no unauthenticated view of a business.
-- ---------------------------------------------------------------------------

grant select, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;

-- Postgres grants EXECUTE to PUBLIC on new functions. For SECURITY DEFINER
-- functions that is an open door, so each one is closed and then reopened to
-- `authenticated` only.
revoke execute on function public.create_organization(
  text, public.business_type, text, text
) from public;
revoke execute on function public.is_organization_member(uuid) from public;
revoke execute on function public.organization_role_of(uuid) from public;
revoke execute on function public.has_organization_role(
  uuid, public.organization_role
) from public;
-- Called only from the membership trigger, which already runs as its owner.
-- No Data API role needs it.
revoke execute on function public.assert_organization_keeps_an_owner(uuid) from public;
revoke execute on function public.guard_organization_member_write() from public;
revoke execute on function public.set_updated_at() from public;
revoke execute on function public.validate_organization_timezone() from public;
revoke execute on function public.guard_organization_immutable_columns() from public;

grant execute on function public.create_organization(
  text, public.business_type, text, text
) to authenticated;

-- Policy expressions are evaluated as the querying role, so `authenticated`
-- needs EXECUTE on the helpers its policies call.
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.organization_role_of(uuid) to authenticated;
grant execute on function public.has_organization_role(
  uuid, public.organization_role
) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Publication membership only: it makes changes to these tables streamable.
-- Subscriptions still pass through RLS, so a client receives a change event
-- only for rows it could have selected. Guarded because the publication is
-- created by the Supabase platform and is absent from a bare Postgres.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    alter publication supabase_realtime add table public.organizations;
    alter publication supabase_realtime add table public.organization_members;
  end if;
exception
  when insufficient_privilege or duplicate_object then
    -- Streaming these two tables is a convenience, not a correctness
    -- requirement. Never fail the migration over it.
    raise notice 'Skipped supabase_realtime publication membership: %', sqlerrm;
end;
$$;
