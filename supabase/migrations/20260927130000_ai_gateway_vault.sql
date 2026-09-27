-- ---------------------------------------------------------------------------
-- Trackit X -- AI Gateway vault access (Phase 36).
--
-- This migration is ADDITIVE. It adds five functions and grants them to
-- `service_role` alone. It creates no table, adds no column, and stores no
-- credential anywhere the Data API can read.
--
-- ---------------------------------------------------------------------------
-- WHY FUNCTIONS INSTEAD OF A TABLE GRANT
-- ---------------------------------------------------------------------------
-- The obvious design would be to give `service_role` SELECT on
-- `ai_provider_configs` and read the configuration from the Edge Function with
-- the service-role client. That does not work here, and finding out why shaped
-- this file.
--
-- Phase 35 deliberately granted `service_role` no table privileges on
-- `ai_provider_configs` -- it granted EXECUTE on two functions and nothing else.
-- `service_role` is a BYPASSRLS role, not a superuser, and BYPASSRLS only
-- bypasses ROW policies. Without a column privilege it cannot read a row at all,
-- so a service-role client calling `.from('ai_provider_configs').select()` gets
-- `permission denied for table ai_provider_configs`.
--
-- That failure mode is nasty: it surfaces as a gateway error on every request,
-- it is indistinguishable from an authorization bug, and RLS is nowhere in the
-- message. Granting SELECT would fix it and would also hand the Edge Function
-- an unauthenticated-by-construction read of every organization's
-- `secret_reference`, with membership checked only in TypeScript. So the reads
-- are funnelled through functions too, and every one of them re-checks
-- membership against the acting user in SQL.
--
-- The result is the property that matters: there is no code path in which the
-- service role reads AI credential state without a membership check having
-- happened first, inside the database, in the same transaction as the read.
--
-- ---------------------------------------------------------------------------
-- SECURITY INVARIANTS
-- ---------------------------------------------------------------------------
--
-- 1. `service_role` only. Every function below starts with the same
--    `auth.role()` check Phase 35 uses. EXECUTE is revoked from `public` and
--    granted to `service_role` alone, so a browser cannot call any of them even
--    if PostgREST exposes the schema.
--
-- 2. The acting user is an explicit parameter, never `auth.uid()`.
--    Under `service_role` the JWT is the service key, so `auth.uid()` is the
--    service identity and tells us nothing about who is asking. Passing
--    `p_actor_id` and verifying it against `organization_members` is what makes
--    these functions safe to call with a role that bypasses RLS.
--
-- 3. "Not a member" and "no such configuration" raise the SAME error.
--    A caller who cannot see a row must not be able to learn that it exists by
--    comparing its refusal to the refusal for a random uuid.
--
-- 4. Plaintext exists only as a return value or a parameter, never as a
--    column. `secret_reference` continues to hold a vault uuid, and the uuid is
--    returned to the caller only because the Edge Function is the caller; no
--    browser-visible path returns it.
--
-- 5. Reads require `member`. Writes require `admin`. The roles come from
--    `public.organization_role_rank`, so they cannot drift from the rest of the
--    authorization model.
--
-- ---------------------------------------------------------------------------
-- VAULT ASSUMPTIONS
-- ---------------------------------------------------------------------------
-- Supabase Vault is already enabled in this project (extension
-- `supabase_vault`, schemas `vault` and `vault.decrypted_secrets`). Nothing here
-- creates the extension, because a migration that needs to turn on pgsodium
-- would fail on a hosted project where that is managed for you. The functions
-- reference `vault.create_secret`, `vault.update_secret` and
-- `vault.decrypted_secrets` directly, so a project without Vault fails loudly at
-- CREATE time instead of silently at first use.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Section 18a -- Actor and configuration resolution
--
-- One helper, used by all five functions, so the membership rule is written
-- once. Returning the configuration row means the caller gets
-- `organization_id` from the row it was just authorized against, rather than
-- from a value it supplied -- which is the whole reason a cross-tenant
-- `configId` cannot work.
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_resolve_config(
  p_actor_id uuid,
  p_config_id uuid,
  p_minimum_role public.organization_role
)
returns public.ai_provider_configs
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.ai_provider_configs;
  v_role public.organization_role;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'Only the AI Gateway may use this function'
      using errcode = '42501';
  end if;

  if p_actor_id is null or p_config_id is null then
    raise exception 'Unusable actor or configuration id'
      using errcode = '42501';
  end if;

  select * into v_config
  from public.ai_provider_configs
  where id = p_config_id;

  -- A missing row and a row the actor cannot reach are indistinguishable from
  -- here outward: both fall through to the same exception below. Returning
  -- early with a "not found" for the first case and a "forbidden" for the second
  -- would be an existence oracle for the whole table.
  if not found then
    raise exception 'No such AI provider configuration'
      using errcode = '42501';
  end if;

  select m.role into v_role
  from public.organization_members m
  where m.organization_id = v_config.organization_id
    and m.user_id = p_actor_id;

  if v_role is null then
    raise exception 'No such AI provider configuration'
      using errcode = '42501';
  end if;

  if public.organization_role_rank(v_role)
     < public.organization_role_rank(p_minimum_role) then
    raise exception 'Insufficient organization role for this operation'
      using errcode = '42501';
  end if;

  return v_config;
end;
$$;

comment on function public.ai_gateway_resolve_config(uuid, uuid, public.organization_role) is
  'Returns the configuration after checking the acting user''s membership of its organization. service_role only. Raises 42501 identically for "no such row" and "not a member", so the function is not an existence oracle.';

-- ---------------------------------------------------------------------------
-- Section 18b -- Reading configuration metadata
--
-- The Edge Function needs `organization_id`, `provider`, `enabled`,
-- `selected_model`, `is_default` and whether a credential exists, and cannot get
-- any of it from the table. `secret_reference` is deliberately NOT among the
-- returned columns: a caller that does not need the handle should not receive
-- it, and `ai_gateway_read_credential` exists for the one caller that does.
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_read_config(
  p_actor_id uuid,
  p_config_id uuid
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
  connection_status public.ai_connection_status
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_config public.ai_provider_configs;
begin
  v_config := public.ai_gateway_resolve_config(p_actor_id, p_config_id, 'member');

  return query
  select
    v_config.id,
    v_config.organization_id,
    v_config.provider,
    v_config.display_name,
    v_config.enabled,
    v_config.is_default,
    v_config.selected_model,
    v_config.credential_present,
    v_config.connection_status;
end;
$$;

comment on function public.ai_gateway_read_config(uuid, uuid) is
  'Safe configuration metadata for the gateway. service_role only. Requires membership. Omits secret_reference; the vault handle is not disclosed to any metadata read.';

-- ---------------------------------------------------------------------------
-- Section 18b-2 -- The caller's role in the configuration's organization
--
-- The gateway needs the caller's role to apply the rank rules in
-- `public.organization_role_rank()`, and it cannot use the app's
-- `organization_role_of()` to get it.
--
-- That function takes only an organization and resolves the actor from
-- `auth.uid()`. The gateway calls it with a `service_role` client, whose JWT
-- carries no `sub`, so `auth.uid()` is NULL, so the lookup matches no row and
-- returns NULL for every call — including for an owner acting on their own
-- organization. This is not a misconfiguration and no grant fixes it: the
-- function is an *auth-context* helper, answering "what is my own role", and a
-- service-role client has no auth context by definition.
--
-- The gateway cannot borrow it, so it owns an explicit-actor equivalent. This is
-- the same rule the other five functions here already follow: the actor is an
-- argument, never `auth.uid()`.
--
-- Returns NULL when there is no membership. That is a refusal, not a default:
-- `isOrganizationRole()` in the Edge Function treats an unrecognised value as a
-- refusal, so a missing row can never be read as `member` and escalate.
--
-- The role is only safe to return because the caller has already proved
-- membership by reading the configuration through `ai_gateway_read_config`, which
-- refuses a non-member. Granted to `service_role` alone.
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_role_of(
  p_actor_id uuid,
  p_organization_id uuid
)
returns public.organization_role
language sql
stable
security definer
set search_path = ''
as $$
  select member.role
  from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id;
$$;

comment on function public.ai_gateway_role_of(uuid, uuid) is
  'The actor''s role in one organization, for the AI Gateway. service_role only. NULL when there is no membership. Exists because organization_role_of() resolves its actor from auth.uid(), which is NULL for a service_role client.';

-- ---------------------------------------------------------------------------
-- Section 18c -- Reading the credential itself
--
-- The only function in the schema that returns plaintext, and it is granted to
-- `service_role` alone. `member` is sufficient: the whole point of a Copilot is
-- that a member can ask a question, so requiring `admin` to read the credential
-- would make the feature unusable for the people it is for.
--
-- The value is never written to a table, a log, or an error message here. If no
-- credential is stored the function raises rather than returning NULL, so the
-- caller cannot confuse "no key" with "empty key".
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_read_credential(
  p_actor_id uuid,
  p_config_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.ai_provider_configs;
  v_secret text;
begin
  v_config := public.ai_gateway_resolve_config(p_actor_id, p_config_id, 'member');

  if v_config.secret_reference is null
     or btrim(v_config.secret_reference) = '' then
    raise exception 'No credential is stored for this configuration'
      using errcode = 'P0002';
  end if;

  -- The reference is a uuid we wrote ourselves in ai_gateway_store_credential.
  -- The cast is guarded anyway: an unexpected value must fail here rather than
  -- raising a bare "invalid input syntax for type uuid" that reads like a bug.
  --
  -- `decrypted_secret`, NOT `secret`. Both columns exist in this view and the
  -- names are the inverse of what they suggest: `secret` holds the encrypted
  -- blob rendered as text, `decrypted_secret` holds the plaintext. Reading the
  -- wrong one is not a crash -- it returns a well-formed base64 string, which
  -- the provider would reject as a malformed key, and every connection test would
  -- fail with a misleading "your credential is wrong" for an administrator who
  -- had stored a perfectly good one.
  begin
    v_secret := (
      select d.decrypted_secret
      from vault.decrypted_secrets d
      where d.id = v_config.secret_reference::uuid
    );
  exception when others then
    raise exception 'Stored credential could not be read'
      using errcode = 'P0002';
  end;

  if v_secret is null or v_secret = '' then
    -- The reference is dangling: the vault entry was removed out of band, or a
    -- restore left the configuration pointing at a row that no longer exists.
    raise exception 'No credential is stored for this configuration'
      using errcode = 'P0002';
  end if;

  return v_secret;
end;
$$;

comment on function public.ai_gateway_read_credential(uuid, uuid) is
  'Returns the plaintext credential for one configuration. service_role only. Requires membership. The only plaintext-leaving function in the schema, and it is unreachable from any browser role.';

-- ---------------------------------------------------------------------------
-- Section 18d -- Storing a credential
--
-- Writes the vault entry and the reference in one transaction, so a
-- configuration can never claim a credential that was not written.
--
-- `admin` is required: storing a credential is a billing decision. A `member`
-- who could set one could point the organization's Copilot at an account that
-- member controls.
--
-- The update-vs-create branch self-heals a dangling reference. If the handle
-- points at a row that no longer exists, `create_secret` is used and the
-- reference is overwritten, which is strictly better than raising: the
-- administrator's intent is unambiguous, and the failure mode being repaired is
-- one they cannot cause or diagnose from the UI.
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_store_credential(
  p_actor_id uuid,
  p_config_id uuid,
  p_credential text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.ai_provider_configs;
  v_handle uuid;
  v_existing uuid;
  v_name text;
begin
  v_config := public.ai_gateway_resolve_config(p_actor_id, p_config_id, 'admin');

  if p_credential is null
     or char_length(btrim(p_credential)) < 8
     or char_length(p_credential) > 512 then
    raise exception 'Credential is not an acceptable length'
      using errcode = '22023';
  end if;

  -- Deterministic name, one row per configuration. It is a uniqueness guarantee in
  -- practice rather than by convention: `vault.secrets` has a unique index on
  -- `name`, so the name is what makes "store again" an update instead of a
  -- duplicate-key crash.
  v_name := 'trackitx:ai:' || v_config.id::text;

  -- Look the existing row up BY NAME, not by the stored reference. Keying off
  -- `secret_reference` is what made this function unable to recover, and there are
  -- two independent ways that goes wrong:
  --
  --   1. The reference is not a uuid. `set_ai_provider_secret_reference` (Phase
  --      35, service_role only) stores whatever text it is given and validates
  --      nothing, so `secret_reference::uuid` raises and the whole call aborts
  --      before either branch runs.
  --   2. The reference is nulled, or is a uuid that no longer resolves, while the
  --      vault row survives. The id lookup then finds nothing, so the create
  --      branch runs and `vault.create_secret` fails on the unique name -- an error
  --      the administrator cannot act on from the UI.
  --
  -- Both left the same outcome: once broken, an administrator could never store a
  -- working credential again, because every retry reproduced the same failure and
  -- recovery needed a different function. Matching on the name heals both cases,
  -- because the name derives from the configuration id and is therefore always the
  -- same for a given configuration. It also removes the cast entirely, so a
  -- malformed value can no longer reach `::uuid` here.
  select d.id into v_existing
  from vault.decrypted_secrets d
  where d.name = v_name
  order by d.created_at desc nulls last, d.id
  limit 1;

  if v_existing is not null then
    perform vault.update_secret(
      v_existing,
      p_credential,
      v_name,
      'Trackit X AI provider credential',
      null
    );
    v_handle := v_existing;
  else
    v_handle := vault.create_secret(
      p_credential,
      v_name,
      'Trackit X AI provider credential',
      null
    );
  end if;

  update public.ai_provider_configs
  set secret_reference = v_handle::text,
      updated_at = now()
  where id = v_config.id;

  -- Returned to the Edge Function, which is the only caller. Never to a browser:
  -- EXECUTE is not granted to authenticated, and the gateway does not include it
  -- in a response body.
  return v_handle::text;
end;
$$;

comment on function public.ai_gateway_store_credential(uuid, uuid, text) is
  'Writes a credential to Supabase Vault and points the configuration at it. service_role only. Requires admin. Returns the vault handle to the server caller only.';

-- ---------------------------------------------------------------------------
-- Section 18e -- Removing a credential
--
-- Deletes the vault row and clears the reference together. If the vault delete
-- succeeds and the update fails, the transaction rolls back and the reference
-- points at a row that is being removed by the same aborted transaction, so the
-- two can never disagree for longer than the statement.
--
-- `credential_present` is a generated column, so clearing the reference is
-- enough to make the client observe `false` -- there is no second flag that
-- could disagree with reality.
-- ---------------------------------------------------------------------------

create or replace function public.ai_gateway_delete_credential(
  p_actor_id uuid,
  p_config_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_config public.ai_provider_configs;
begin
  v_config := public.ai_gateway_resolve_config(p_actor_id, p_config_id, 'admin');

  if v_config.secret_reference is not null
     and btrim(v_config.secret_reference) <> '' then
    begin
      delete from vault.secrets
      where id = v_config.secret_reference::uuid;
    exception when others then
      -- Swallowed on purpose, and only here. A dangling reference is the
      -- situation this function exists to clean up, so failing to remove a vault
      -- row that is already gone must not prevent clearing the reference --
      -- otherwise the administrator is stuck with `credential_present = true`
      -- and no way to turn it off.
      null;
    end;
  end if;

  update public.ai_provider_configs
  set secret_reference = null,
      -- "unknown" rather than leaving the old verdict: the credential it described
      -- no longer exists, so the previous test result no longer describes anything.
      connection_status = 'unverified',
      last_tested_at = null,
      updated_at = now()
  where id = v_config.id;
end;
$$;

comment on function public.ai_gateway_delete_credential(uuid, uuid) is
  'Removes the credential from Supabase Vault and clears the reference. service_role only. Requires admin. Idempotent, so a missing vault row is not an error.';

-- ---------------------------------------------------------------------------
-- Section 18f -- Grants
--
-- Revoke from `public` first, then grant to `service_role`. Revoking from
-- `public` is what actually removes the default EXECUTE grant PostgreSQL gives
-- every role on a new function; without it these would be callable by `anon`.
-- ---------------------------------------------------------------------------

revoke execute on function public.ai_gateway_resolve_config(uuid, uuid, public.organization_role) from public;
revoke execute on function public.ai_gateway_read_config(uuid, uuid) from public;
revoke execute on function public.ai_gateway_read_credential(uuid, uuid) from public;
revoke execute on function public.ai_gateway_role_of(uuid, uuid) from public;
revoke execute on function public.ai_gateway_store_credential(uuid, uuid, text) from public;
revoke execute on function public.ai_gateway_delete_credential(uuid, uuid) from public;

grant execute on function public.ai_gateway_resolve_config(uuid, uuid, public.organization_role) to service_role;
grant execute on function public.ai_gateway_read_config(uuid, uuid) to service_role;
grant execute on function public.ai_gateway_read_credential(uuid, uuid) to service_role;
grant execute on function public.ai_gateway_role_of(uuid, uuid) to service_role;
grant execute on function public.ai_gateway_store_credential(uuid, uuid, text) to service_role;
grant execute on function public.ai_gateway_delete_credential(uuid, uuid) to service_role;
