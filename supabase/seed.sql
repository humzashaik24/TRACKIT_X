-- ---------------------------------------------------------------------------
-- Trackit X — LOCAL DEVELOPMENT SEED.
--
-- Loaded by `supabase db reset` only (see [db.seed] in config.toml). It never
-- runs against the hosted project, and it refuses to run at all if any
-- organization already exists, so it cannot overwrite work in progress.
--
-- Why a seed exists at all: the dashboard is under instruction to show real
-- numbers or an honest empty state, never invented ones. To see it render a
-- populated Workforce panel during development, real rows have to exist. These
-- are those rows — clearly fictional, clearly local.
--
-- ⚠ The password below is a LOCAL TEST FIXTURE, not a secret. It exists so a
--   developer can sign in against 127.0.0.1 immediately after a reset. It must
--   never be used for an account that exists anywhere other than the local
--   Docker stack, and no hosted environment ever loads this file.
--
-- Note on auth.users: GoTrue owns this table and its columns move between
-- versions. Writing rows here directly is the standard local-seed technique but
-- it is coupled to the running GoTrue schema. This file has NOT been executed
-- (Docker is unavailable on this machine), so treat it as unverified until a
-- `supabase db reset` has run cleanly.
-- ---------------------------------------------------------------------------

do $seed$
declare
  fixture_password constant text := 'LocalDev12345';

  user_a_owner  constant uuid := '00000000-0000-4000-a000-000000000001';
  user_a_member constant uuid := '00000000-0000-4000-a000-000000000002';
  user_b_owner  constant uuid := '00000000-0000-4000-b000-000000000001';

  org_a uuid;
  org_b uuid;
  password_hash text;
begin
  if exists (select 1 from public.organizations) then
    raise notice 'Trackit X seed skipped: organizations already exist.';
    return;
  end if;

  -- pgcrypto lives in the `extensions` schema on Supabase. If it is missing we
  -- stop with a clear message rather than inserting an unusable password hash
  -- that would fail at sign-in with a confusing error.
  if not exists (
    select 1 from pg_catalog.pg_proc proc
    join pg_catalog.pg_namespace ns on ns.oid = proc.pronamespace
    where proc.proname = 'crypt' and ns.nspname = 'extensions'
  ) then
    raise exception 'Trackit X seed needs pgcrypto in the extensions schema.';
  end if;

  execute format(
    'select extensions.crypt(%L, extensions.gen_salt(%L))', fixture_password, 'bf'
  ) into password_hash;

  -- --- Fixture identities -------------------------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  values
    ('00000000-0000-0000-0000-000000000000', user_a_owner, 'authenticated',
     'authenticated', 'owner.a@trackitx.test', password_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Asha Rao"}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', user_a_member, 'authenticated',
     'authenticated', 'member.a@trackitx.test', password_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Vikram Shah"}'::jsonb, now(), now(), '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', user_b_owner, 'authenticated',
     'authenticated', 'owner.b@trackitx.test', password_hash, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Leila Haddad"}'::jsonb, now(), now(), '', '', '', '')
  on conflict (id) do nothing;

  -- GoTrue resolves an email login through auth.identities, so a user row on
  -- its own is not signable-in.
  insert into auth.identities (
    id, user_id, provider_id, provider, identity_data,
    last_sign_in_at, created_at, updated_at
  )
  select
    gen_random_uuid(),
    seeded.id,
    seeded.id::text,
    'email',
    jsonb_build_object('sub', seeded.id::text, 'email', seeded.email,
                       'email_verified', true, 'phone_verified', false),
    now(), now(), now()
  from auth.users seeded
  where seeded.id in (user_a_owner, user_a_member, user_b_owner)
  on conflict do nothing;

  -- --- Two unrelated tenants ----------------------------------------------
  -- Two organizations owned by two different users is exactly the shape the
  -- isolation test needs: whatever leaks between these two would leak between
  -- two real customers.
  insert into public.organizations (name, business_type, timezone, currency, created_by)
  values ('Northwind Fabrication', 'manufacturing', 'Asia/Kolkata', 'INR', user_a_owner)
  returning id into org_a;

  insert into public.organizations (name, business_type, timezone, currency, created_by)
  values ('Harbour Logistics', 'logistics', 'Asia/Dubai', 'AED', user_b_owner)
  returning id into org_b;

  insert into public.organization_members (organization_id, user_id, role)
  values
    (org_a, user_a_owner, 'owner'),
    (org_a, user_a_member, 'member'),
    (org_b, user_b_owner, 'owner');

  raise notice 'Trackit X seed loaded: 2 organizations, 3 members.';
  raise notice 'Local sign-in: owner.a@trackitx.test / member.a@trackitx.test / owner.b@trackitx.test';
end
$seed$;
