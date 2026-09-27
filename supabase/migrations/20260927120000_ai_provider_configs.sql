-- ---------------------------------------------------------------------------
-- Trackit X -- AI provider configuration.
--
-- This migration is ADDITIVE. It adds the `ai_provider_configs` table and the
-- four functions that are the only sanctioned writers of the columns a browser
-- must never be able to set.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVARIANTS
-- ---------------------------------------------------------------------------
--
-- 1. No column in this table, or in any table readable by the Data API, holds a
--    plaintext provider credential. There is no `api_key` column to leak because
--    there is no column to put one in.
--
-- 2. `secret_reference` holds an OPAQUE HANDLE to a server-side vault, never a
--    key. The `authenticated` role is not granted SELECT on that column at all,
--    so a client cannot obtain the handle even by asking for every column. This
--    is enforced by column-level privileges rather than by convention, because a
--    convention is undone by a single `select *`.
--
-- 3. `credential_present` is a STORED GENERATED COLUMN derived from
--    `secret_reference`. It is the only credential-related fact the client can
--    read, and it is a boolean: the client learns that a credential exists, and
--    nothing derivable from its value -- not its length, not a suffix, not a hash.
--
-- 4. `connection_status` cannot be written by the `authenticated` role. A
--    provider therefore CANNOT be shown as "Connected" by a client, however the
--    request is constructed. Only `record_ai_connection_test`, which is granted to
--    `service_role` alone, may write it, and only after a real authenticated call
--    to the provider.
--
-- 5. `is_default` cannot be written by the `authenticated` role either. It moves
--    only through `set_default_ai_provider`, which is `SECURITY DEFINER`,
--    admin-gated, and refuses to mark a disabled provider.
--
-- Tenancy reuses the existing membership and role helpers. No second
-- authorization system is introduced.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Enums
--
-- A real enum rather than a free-text column with a CHECK, so an unknown
-- provider id is rejected by the type system and adding a provider later is an
-- additive `ALTER TYPE ... ADD VALUE`.
-- ---------------------------------------------------------------------------

create type public.ai_provider as enum ('gemini', 'openai', 'anthropic');

comment on type public.ai_provider is
  'Supported AI providers. Mirrors AIProviderId in src/domain/ai/types.ts.';

create type public.ai_connection_status as enum ('unverified', 'connected', 'failed');

comment on type public.ai_connection_status is
  'Result of the last server-side connection test. Writable only by service_role.';

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table public.ai_provider_configs (
  id uuid primary key default gen_random_uuid(),

  organization_id uuid not null
    references public.organizations (id) on delete cascade,

  -- Stable provider key. The display name is decorative; this is the identity,
  -- so renaming a provider in the registry cannot orphan a stored configuration.
  provider public.ai_provider not null,

  display_name text not null,

  -- Safe configuration metadata. A client may write these, and only these.
  enabled boolean not null default false,
  selected_model text not null,

  -- Marked default. Moved only through set_default_ai_provider().
  is_default boolean not null default false,

  -- Opaque handle to a server-side vault. NOT a key.
  --
  -- This column is the reason the rest of the design is shaped the way it is: the
  -- browser can neither read it nor write it, and the only things derived from it
  -- that leave the server are the boolean below and a connection status.
  secret_reference text,

  -- Derived. True when a vault handle exists. The only credential fact readable
  -- by a client, and deliberately a boolean.
  credential_present boolean generated always as (
    secret_reference is not null and btrim(secret_reference) <> ''
  ) stored,

  -- Written only by record_ai_connection_test() as service_role.
  connection_status public.ai_connection_status not null default 'unverified',
  last_tested_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ai_provider_configs_org_provider_unique
    unique (organization_id, provider),

  constraint ai_provider_configs_display_name_length
    check (char_length(btrim(display_name)) between 1 and 100),

  constraint ai_provider_configs_display_name_trimmed
    check (display_name = btrim(display_name)),

  constraint ai_provider_configs_selected_model_present
    check (char_length(btrim(selected_model)) between 1 and 120),

  constraint ai_provider_configs_selected_model_trimmed
    check (selected_model = btrim(selected_model)),

  -- A handle is an opaque identifier, not a credential. The length bound stops a
  -- key being pasted here by a future mistake; the database cannot tell the
  -- difference, which is exactly why the column is unreadable to clients.
  constraint ai_provider_configs_secret_reference_shape
    check (
      secret_reference is null
      or (
        char_length(btrim(secret_reference)) between 8 and 200
        and secret_reference = btrim(secret_reference)
      )
    )
);

comment on table public.ai_provider_configs is
  'Organization-scoped AI provider configuration. Holds safe metadata plus an opaque vault handle. Never a plaintext credential.';

comment on column public.ai_provider_configs.secret_reference is
  'Opaque handle to a server-side secret vault. Unreadable and unwritable by the authenticated role. Never a key.';

comment on column public.ai_provider_configs.credential_present is
  'Generated boolean. True when a vault handle exists. The only credential-derived fact readable by a client.';

comment on column public.ai_provider_configs.connection_status is
  'Last server-side connection test result. Writable only by service_role via record_ai_connection_test().';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index ai_provider_configs_org_idx
  on public.ai_provider_configs (organization_id);

comment on index public.ai_provider_configs_org_idx is
  'Serves the organization-scoped list query in listProviderConfigs().';

-- At most one default provider per organization, enforced by the database so it
-- does not depend on any client sending the right sequence of statements.
create unique index ai_provider_configs_single_default_idx
  on public.ai_provider_configs (organization_id)
  where is_default;

comment on index public.ai_provider_configs_single_default_idx is
  'Enforces at most one default provider per organization. Partial, so non-default rows are unconstrained.';

create trigger ai_provider_configs_set_updated_at
  before update on public.ai_provider_configs
  for each row execute function public.set_updated_at();

-- Reuses the foundation trigger: pins id, organization_id and created_at, so a
-- configuration cannot be moved between organizations by any writer.
create trigger ai_provider_configs_guard_tenant_columns
  before update on public.ai_provider_configs
  for each row execute function public.guard_tenant_columns_immutable();

-- ---------------------------------------------------------------------------
-- Default provider switching
--
-- SECURITY DEFINER because the write target is `is_default`, which the client
-- role deliberately cannot write. The role check is performed here and is the
-- only authorization for this operation.
-- ---------------------------------------------------------------------------

create or replace function public.set_default_ai_provider(
  p_organization_id uuid,
  p_provider public.ai_provider
)
returns table (
  id uuid,
  organization_id uuid,
  provider public.ai_provider,
  display_name text,
  enabled boolean,
  is_default boolean,
  selected_model text,
  credential_present boolean,
  connection_status public.ai_connection_status,
  last_tested_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  -- Every table reference below is aliased as `c` and every column is qualified
  -- with it. That is not a style choice. This function's OUT parameters are named
  -- after the columns it returns, so an unqualified `organization_id` in a WHERE
  -- clause is ambiguous between the OUT parameter and the column, and PL/pgSQL
  -- defaults to variable_conflict = error, which raises at runtime. Dropping the
  -- alias reintroduces a bug that no static check in this project can see.
  if actor is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_organization_role(p_organization_id, 'admin') then
    raise exception 'Admin privileges required to configure AI providers'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.ai_provider_configs c
    where c.organization_id = p_organization_id
      and c.provider = p_provider
      and c.enabled
  ) then
    -- Covers both "no such provider" and "that provider is switched off". The
    -- two are deliberately not distinguished: telling them apart would let a
    -- caller enumerate which providers an organization has configured.
    raise exception 'No enabled AI provider configuration for %', p_provider
      using errcode = 'P0002';
  end if;

  update public.ai_provider_configs c
  set is_default = false
  where c.organization_id = p_organization_id
    and c.is_default
    and c.provider is distinct from p_provider;

  return query
  update public.ai_provider_configs c
  set is_default = true
  where c.organization_id = p_organization_id
    and c.provider = p_provider
  returning
    c.id,
    c.organization_id,
    c.provider,
    c.display_name,
    c.enabled,
    c.is_default,
    c.selected_model,
    c.credential_present,
    c.connection_status,
    c.last_tested_at,
    c.created_at,
    c.updated_at;
end;
$$;

comment on function public.set_default_ai_provider(uuid, public.ai_provider) is
  'Marks one enabled provider as the organization default, atomically. Admin only. Returns safe metadata only: the composite row type is NOT returned, because it carries secret_reference.';

create or replace function public.clear_default_ai_provider(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not public.has_organization_role(p_organization_id, 'admin') then
    raise exception 'Admin privileges required to configure AI providers'
      using errcode = '42501';
  end if;

  update public.ai_provider_configs
  set is_default = false
  where organization_id = p_organization_id
    and is_default;
end;
$$;

comment on function public.clear_default_ai_provider(uuid) is
  'Removes the organization default provider. Admin only. Leaves the organization with no default, which the client renders as an explicit unresolved state rather than substituting another provider.';

-- ---------------------------------------------------------------------------
-- Server-side writers
--
-- Neither function below is granted EXECUTE to `authenticated`. They are the
-- interface the future AI Gateway calls with the service role, and the role check
-- inside each is a second lock on the same door: a grant mistake alone would not
-- be enough to let a browser set a connection status.
-- ---------------------------------------------------------------------------

create or replace function public.set_ai_provider_secret_reference(
  p_config_id uuid,
  p_secret_reference text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the AI Gateway may set a secret reference'
      using errcode = '42501';
  end if;

  update public.ai_provider_configs
  set secret_reference = nullif(btrim(p_secret_reference), '')
  where id = p_config_id;
end;
$$;

comment on function public.set_ai_provider_secret_reference(uuid, text) is
  'Stores the opaque vault handle for a configuration. service_role only. The handle is generated by the vault, never by a client.';

create or replace function public.record_ai_connection_test(
  p_config_id uuid,
  p_status public.ai_connection_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the AI Gateway may record a connection test'
      using errcode = '42501';
  end if;

  update public.ai_provider_configs
  set connection_status = p_status,
      last_tested_at = now()
  where id = p_config_id;
end;
$$;

comment on function public.record_ai_connection_test(uuid, public.ai_connection_status) is
  'Records the outcome of a real server-side connection test. service_role only. A client cannot write connection_status, so "Connected" cannot be fabricated by the UI.';

-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- SELECT is membership, so a member of the organization can see which providers
-- are configured. Writes are admin-gated, matching `organizations_update_admins`.
-- `anon` gets nothing, as everywhere else in this schema.
-- ---------------------------------------------------------------------------

alter table public.ai_provider_configs enable row level security;

create policy ai_provider_configs_select_members
  on public.ai_provider_configs
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

create policy ai_provider_configs_insert_admins
  on public.ai_provider_configs
  for insert
  to authenticated
  with check (public.has_organization_role(organization_id, 'admin'));

create policy ai_provider_configs_update_admins
  on public.ai_provider_configs
  for update
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'))
  with check (public.has_organization_role(organization_id, 'admin'));

create policy ai_provider_configs_delete_admins
  on public.ai_provider_configs
  for delete
  to authenticated
  using (public.has_organization_role(organization_id, 'admin'));

-- ---------------------------------------------------------------------------
-- Grants
--
-- Grants decide WHICH COLUMNS and operations a role may perform. RLS decides
-- WHICH ROWS. Both are needed, and for this table the column grants are the
-- security control rather than an optimisation.
--
-- Supabase grants ALL on new public tables by default, so the revoke is not
-- optional: without it every column below would be client-writable.
-- ---------------------------------------------------------------------------

revoke all on table public.ai_provider_configs from anon, authenticated;

-- Readable: safe metadata only. `secret_reference` is absent from this list, so
-- `select *` cannot reach it -- PostgREST resolves `*` against the role's column
-- privileges.
grant select (
  id,
  organization_id,
  provider,
  display_name,
  enabled,
  is_default,
  selected_model,
  credential_present,
  connection_status,
  last_tested_at,
  created_at,
  updated_at
) on table public.ai_provider_configs to authenticated;

-- Writable: the configuration an administrator actually chooses. Note what is
-- absent -- no `is_default` (RPC only), no `secret_reference`, no
-- `connection_status`, no `credential_present`, no timestamps.
grant insert (organization_id, provider, display_name, enabled, selected_model)
  on table public.ai_provider_configs to authenticated;
grant update (display_name, enabled, selected_model)
  on table public.ai_provider_configs to authenticated;
grant delete on table public.ai_provider_configs to authenticated;

revoke execute on function public.set_default_ai_provider(uuid, public.ai_provider) from public;
revoke execute on function public.clear_default_ai_provider(uuid) from public;
revoke execute on function public.set_ai_provider_secret_reference(uuid, text) from public;
revoke execute on function public.record_ai_connection_test(uuid, public.ai_connection_status) from public;

grant execute on function public.set_default_ai_provider(uuid, public.ai_provider) to authenticated;
grant execute on function public.clear_default_ai_provider(uuid) to authenticated;

-- `service_role` is granted here explicitly rather than relying on default
-- privileges, because these two functions are the entire mechanism by which the
-- AI Gateway writes credential state and connection status.
grant execute on function public.set_ai_provider_secret_reference(uuid, text) to service_role;
grant execute on function public.record_ai_connection_test(uuid, public.ai_connection_status) to service_role;
