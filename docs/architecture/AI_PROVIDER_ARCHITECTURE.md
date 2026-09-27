# Trackit X — AI Provider Architecture & Security Specification

Phase 35 establishes the **configuration and security foundation** for multi-provider
AI. It deliberately stops short of calling any model.

---

## 1. Scope, and the honest limit of this phase

Trackit X is a static client bundle. There is no server runtime, no Edge Function,
and no process that a browser cannot read from. That single fact drives the whole
design:

> **A provider API key has nowhere safe to live in this architecture today.**

Rather than invent a local substitute — `expo-secure-store`, an encrypted
`localStorage` entry, a hardcoded key, a `maskSecretKey` helper that returns a
suffix — Phase 35 ships that boundary **unimplemented and says so in the product
UI**. A provider configured without a credential renders as *"Not configured"*,
not as *"Connected"*.

What works today, end to end:

- An organization admin adds, edits, enables, disables, and deletes provider
  configurations.
- Models are chosen from a controlled, dated registry.
- Exactly one provider per organization can be the default, enforced by the
  database.
- All of it is enforced by RLS and column-level grants, not by UI convention.

What does not work today, and is refused rather than faked:

- Storing a provider API key.
- Running a real connection test.
- Generating a completion.

---

## 2. Architecture

```
Organization Admin (owner / admin)
        |
        v
  /settings -> AI Providers            (AIProvidersView.tsx)
        |  reads PROVIDER_REGISTRY, renders only what the role may do
        v
  useAIProviderConfigs.ts              (org-switch guard, RBAC-aware mutations)
        |
        v
  aiProviderService.ts                 (safe metadata CRUD via PostgREST)
        |
        +---------------------------+----------------------------+
        |                           |                            |
        v                           v                            v
  ai_provider_configs          aiSecretVault.ts            aiProviderGateway
  (metadata + opaque handle)    store() -> AI_UNAVAILABLE    testConnection()
        |                           |                       -> AI_UNAVAILABLE
        |                           v                            |
        |                     no server runtime                    v
        |                     nothing is stored         ProviderAdapter (interface only)
        v
  credential_present: boolean  <-- the ONLY credential fact a client ever reads
```

Two ports (`aiSecretVault`, the gateway) are **deliberately dead**. Every call
returns `AI_UNAVAILABLE` with a user-facing explanation. They are interfaces, so
the day a server exists the wiring is already shaped.

---

## 3. Security invariants

These are the properties the phase is judged on. Each is enforced by a mechanism
that does not depend on the UI behaving.

1. **No plaintext credential is ever persisted, in any store.** Not in a
   database column, not in `EXPO_PUBLIC_*`, not in `localStorage`, not in
   `AsyncStorage`, not in a log, not in an error message, not in a bundle.
2. **`secret_reference` is unreadable and unwritable by `authenticated`.** It is
   an opaque vault handle, never a key. This is enforced by *column privileges*,
   so `select *` cannot reach it either — PostgREST resolves `*` against the
   role's column grants.
3. **`credential_present` is the only credential-derived fact a client can read.**
   It is a `STORED GENERATED` boolean derived in the database. The client learns
   *that* a credential exists and nothing derivable from its value — not its
   length, not a suffix, not a hash, not a masked form.
4. **`connection_status` is unwritable by `authenticated`.** A provider therefore
   **cannot be shown as "Connected" by a client**, however the request is
   constructed. Only `record_ai_connection_test`, granted to `service_role`
   alone, may write it, and only after a real server-side call.
5. **`is_default` is unwritable by `authenticated`.** It moves only through
   `set_default_ai_provider`, which is `SECURITY DEFINER`, admin-gated, and
   refuses a disabled provider. A partial unique index makes "at most one
   default" a database fact rather than a client convention.
6. **No secret is returned to a caller in a response body**, including in error
   paths. `redact` in `src/utils/redact.ts` is a safety net, not permission to
   pass a key to the logger.
7. **Organization switching cannot leak across tenants.** RLS scopes every read
   to the caller's membership, and the hook stamps each response with the
   organization it was requested for and discards anything else before render.

### 3.1 Defence in depth against a credential column appearing later

`assertNoCredentialFields` inspects *field names only* — never values, so it
cannot itself leak the thing it is looking for — on every payload bound for
`ai_provider_configs`. It is the tripwire for the most likely future regression:
someone adds an `api_key` column and a service that fills it.

`redact` additionally strips provider key shapes *by value*
(`AIza…`, `sk-proj-…`, `sk-ant-…`, `Bearer …`), which was extended in this phase
after a test demonstrated it did **not** catch OpenAI or Anthropic key shapes.
Redaction by key name alone would have missed a key reaching a log through an
innocuous field like `note`.

---

## 4. Database design

Migration: `supabase/migrations/20260927120000_ai_provider_configs.sql` (additive).

### 4.1 `public.ai_provider_configs`

| Column | Type | Client-writable | Notes |
|---|---|---|---|
| `id` | `uuid` | no | PK, `gen_random_uuid()` |
| `organization_id` | `uuid` | insert only | FK → `organizations(id)` `ON DELETE CASCADE` |
| `provider` | `public.ai_provider` | insert only | Enum: `gemini`, `openai`, `anthropic` |
| `display_name` | `text` | insert, update | 1–100 chars, trimmed |
| `enabled` | `boolean` | insert, update | default `false` |
| `selected_model` | `text` | insert, update | 1–120 chars, trimmed |
| `is_default` | `boolean` | **no** — RPC only | Partial unique index enforces one |
| `secret_reference` | `text` | **no** | Opaque handle. No grant to `authenticated` |
| `credential_present` | `boolean` | **no** | `GENERATED ALWAYS … STORED` |
| `connection_status` | `public.ai_connection_status` | **no** | `unverified` \| `connected` \| `failed` |
| `last_tested_at` | `timestamptz` | **no** | Set by the server-side writer |
| `created_at` / `updated_at` | `timestamptz` | **no** | `set_updated_at` trigger |

> **Why the enum:** a real `ai_provider` type rejects an unknown provider id at
> the type system, and adding a provider later is an additive
> `ALTER TYPE … ADD VALUE` rather than a data migration.

### 4.2 Constraints

- `UNIQUE (organization_id, provider)` — one configuration per provider per tenant.
- `UNIQUE INDEX … (organization_id) WHERE is_default` — at most one default.
- `CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 100)` and a trimmed-equality check.
- Same pair for `selected_model`.
- `CHECK` bounding `secret_reference` to 8–200 trimmed characters. A handle is an
  opaque identifier, not a credential; the length bound stops a key being pasted
  here by a future mistake. The database cannot otherwise tell the difference —
  which is exactly why the column is unreadable to clients.
- `guard_tenant_columns_immutable()` trigger, reused from the foundation
  migration, pins `id`, `organization_id` and `created_at` so no writer can move a
  configuration between organizations.

### 4.3 RLS

| Operation | Policy | Who |
|---|---|---|
| `SELECT` | `is_organization_member(organization_id)` | any member |
| `INSERT` | `has_organization_role(organization_id, 'admin')` | owner / admin |
| `UPDATE` | `has_organization_role(organization_id, 'admin')` | owner / admin |
| `DELETE` | `has_organization_role(organization_id, 'admin')` | owner / admin |

`anon` receives nothing, as elsewhere in this schema. This reuses the existing
membership and role helpers; **no second authorization system is introduced.**

### 4.4 Grants — where the real secret boundary lives

Supabase grants `ALL` on new `public` tables by default, so the migration opens
with `REVOKE ALL … FROM anon, authenticated` and then re-grants column by column.
Without the revoke, every column below would be client-writable.

```
GRANT SELECT (id, organization_id, provider, display_name, enabled,
              is_default, selected_model, credential_present,
              connection_status, last_tested_at, created_at, updated_at)
GRANT INSERT (organization_id, provider, display_name, enabled, selected_model)
GRANT UPDATE (display_name, enabled, selected_model)
GRANT DELETE
```

`secret_reference`, `is_default`, `connection_status`, `credential_present` and
both timestamps are absent from every list. That absence *is* the security
control, and it is why the design leans on privileges rather than RLS: RLS decides
which **rows** a role may touch, and cannot express "this column is unreadable".

### 4.5 Functions

| Function | Executable by | Purpose |
|---|---|---|
| `set_default_ai_provider(org, provider)` | `authenticated` (admin-gated) | Atomically move the default. Returns a **composite row type, not the table row** — the table row would carry `secret_reference`. |
| `clear_default_ai_provider(org)` | `authenticated` (admin-gated) | Leave the org with no default, rendered as an explicit unresolved state. |
| `set_ai_provider_secret_reference(id, handle)` | **`service_role` only** | Store the opaque vault handle. |
| `record_ai_connection_test(id, status)` | **`service_role` only** | Record a real server-side test result. |

The two `service_role` functions are `SECURITY DEFINER` **and** re-check
`auth.role()` internally. A grant mistake alone is therefore not enough to let a
browser write a connection status — there are two independent locks on the same
door.

`set_default_ai_provider` treats "no such provider" and "that provider is
switched off" as one `P0002`. Distinguishing them would let a caller enumerate
which providers an organization has configured.

> **Implementation note, load-bearing:** every table reference inside
> `set_default_ai_provider` is aliased `c` and every column is qualified. The
> function's `OUT` parameters are named after the columns it returns, so an
> unqualified `organization_id` is ambiguous between an `OUT` parameter and a
> column, and PL/pgSQL defaults to `variable_conflict = error` — it would raise at
> runtime. Dropping the alias reintroduces a bug no static check in this project
> can see.

---

## 5. Domain layer

`src/domain/ai/` — no Supabase import, no React, safe to unit test.

| Module | Responsibility |
|---|---|
| `types.ts` | `AIProviderId`, `AIProviderConfig`, `AIRequest`, `AIResponse`, `AIModelDefinition` |
| `registry.ts` | `PROVIDER_REGISTRY`, the dated model catalog, provider/model lookups |
| `configuration.ts` | Default resolution, RBAC predicates, draft validation, credential/status copy |
| `gateway.ts` | `ProviderAdapter` contract, gateway routes, `assertGatewayEligible`, the refusing implementation |
| `copilotContract.ts` | `AICopilotBusinessContext` built on Phase 34's `DashboardSnapshot` |

### 5.1 The registry is controlled, and dated

Models are **not** discovered at runtime from a provider's API — that would
require shipping a credential to the client, which is the one thing this
architecture forbids. The supported set is declared in `registry.ts`.

Two rules make its claims falsifiable:

- Every model carries `verifiedOn`, the date it was last checked against the
  provider's own documentation. The type makes an undated entry impossible.
  The current catalog is stamped `MODEL_REGISTRY_VERIFIED_ON = '2026-09-27'`.
- `contextWindowTokens` is a published number or **`null`**, rendered as
  "not published". A wrong context window silently truncates a prompt, which is
  worse than an absent one.

> **Verification caveat, stated plainly:** the entries were compiled from
> provider-documentation searches on 2026-09-27 and **have not been confirmed
> against a live API**, which this phase cannot do without credentials and a
> server. Several ids are newer-generation strings; before this registry is used
> to make a real call, re-verify each id and context figure at
> `MODEL_REGISTRY_VERIFIED_ON` and update the date. The registry's structure
> makes that audit cheap; it does not make the current values correct.

### 5.2 Adding a provider

Append to `PROVIDER_REGISTRY`, extend `AIProviderId`, and `ALTER TYPE
public.ai_provider ADD VALUE`. Nothing else changes: the Settings screen, the
service layer and the gateway all read provider data from the registry rather
than switching on provider ids.

### 5.3 Default resolution is explicit, never implicit

`resolveDefaultProvider` returns one of three states:

- **resolved** — exactly one enabled default exists.
- **none** — the organization has deliberately cleared its default.
- **unresolved** — the default is missing *or* points at a disabled provider.

The last case is the interesting one. A disabled default is a legitimate
consequence of two valid operations (set a default, then disable that provider).
The system does **not** silently promote another provider, because that would
change which vendor bills the customer without anyone asking. The UI says so and
requires an explicit choice.

---

## 6. Secret handling rules

| Surface | Rule |
|---|---|
| `EXPO_PUBLIC_*` | Never a credential. These are inlined into the JS bundle. |
| `localStorage` / `AsyncStorage` | Never a credential. Session tokens only. |
| `secureSecretStore.ts` | **Deleted.** It leaked a key suffix and fabricated `secret_reference` values client-side. |
| Logs | No credential, no handle, no key-derived value. Only `organizationId` and `provider`. |
| API responses | No credential. `credential_present` is the only credential-adjacent field. |
| Database | No column holds plaintext. `secret_reference` holds an opaque handle. |
| Error messages | Fixed user-safe copy via `appError`. Never `error.message` from a lower layer. |
| Bundles | Asserted absent: no `AIza…`, `sk-proj-…`, `sk-ant-…`, `secret_reference`, or `apiKey` outside Supabase SDK internals. |

The credential input exists and is a real `secureTextEntry` field with a transient
`useState` value, cleared on every exit path — but it is **disabled**, with the
reason shown, because the vault is not deployed. It is the correct final UI for a
working vault, not a stub that pretends to save.

---

## 7. Why `saveProviderConfig` is not an `upsert`

PostgREST expands `ON CONFLICT DO UPDATE` to set **every** column in the payload.
The payload an upsert needs includes `organization_id` and `provider`, and the
migration deliberately withholds `UPDATE` on those two columns — they are the
row's identity, and `guard_tenant_columns_immutable` pins them anyway.

So an upsert would work for a first-time insert and fail with `42501` for every
subsequent save, which is the common case. Granting the columns to make the
upsert work would widen the write surface and buy nothing: the trigger rejects
the change regardless.

`aiProviderService` therefore uses two explicit paths. The update path names only
`display_name`, `enabled` and `selected_model` — exactly the columns the role
holds. It costs one extra read and keeps the privilege model and the code in
agreement, which is worth more than the round trip.

---

## 8. Copilot contract (future)

`copilotContract.ts` builds `AICopilotBusinessContext` from Phase 34's
`DashboardSnapshot` and the core business entities. It reuses `DashboardSnapshot`
by import rather than re-deriving metrics, so there is one definition of a
number.

Separation of concerns:

- **Provider configuration** decides *which* provider and model answer.
- **Business context** supplies *what* the model reasons over.

No completion, prompt assembly or streaming is implemented.

---

## 9. Testing

| Suite | Coverage | Status |
|---|---|---|
| `tests/unit/aiProvidersSecurity.test.ts` | 11 groups: tenancy, client-type shape, no plaintext anywhere, AsyncStorage, logs/redaction, connection-status fabrication, registry integrity | **Passing** |
| `supabase/tests/rls_isolation.sql` §17 | 40 assertions: tenancy, role gates, column-level secret boundary, database invariants | **Passing** — executed 2026-09-27, 164 assertions across the whole file, 0 failures |
| `npm run verify` | typecheck, ESLint (`--max-warnings=0`), Jest | **Passing** |
| `npx expo export --platform web` | bundle builds; scanned for credential shapes | **Passing** |

The client tests are honest about their ceiling: they cannot prove multi-tenant
isolation, because RLS lives in Postgres and `supabase-js` in a unit test talks
to a mock. That is precisely why §17 exists, and why it was executed against a
real database rather than left as written-but-unrun.

§17 did not pass on its first execution. All five failures were in the test file,
none in the migration, and each is recorded in the file header:

- §17 used `a_admin` for admin-only writes, but assertion 8.5 demotes `a_admin`
  to `manager`, so `has_organization_role(org, 'admin')` is correctly false and
  the `WITH CHECK` correctly refused. The roles are now pinned by assertion 17.0,
  and the refusals are asserted against a *manager*, which is the stronger control:
  a manager holds genuine write authority elsewhere, so being refused proves the
  gate is the admin threshold rather than "not the owner".
- It caught the refusal with `new_row_violates_row_level_security_policy`, a
  condition PostgreSQL 17 does not have. A failed `INSERT ... WITH CHECK` reports
  42501, i.e. `insufficient_privilege`.
- It read organization A's row while impersonating organization B, so RLS returned
  no row and the comparison was `NULL`. The question is now asked as A's owner.
- It called `public.set_config`; `set_config` is in `pg_catalog`.
- It had the service role `SELECT`, `UPDATE` and `DELETE` the table. The migration
  grants the service role none of those, deliberately. See §5.

The last one is worth stating as a property rather than a fix: the service role's
only reach into `ai_provider_configs` is `EXECUTE` on the two `SECURITY DEFINER`
gateway functions, so §17 now has the service role write and the client observe
the effect. The one-default invariant is proved as the table's owner, which is the
only way to exercise the partial unique index — the service role cannot `INSERT`
at all, so a test written from that role would have proved the grant, not the
index.

---

## 10. Known limitations and deferred work

1. **No credential storage.** Requires an AI Gateway (Supabase Edge Function or
   equivalent) plus a vault. `aiSecretVault.availability` enumerates exactly what
   is needed.

2. **No real connection test.** `connection_status` stays `unverified` until
   `record_ai_connection_test` runs as `service_role` after a real call.

3. **No completions, streaming, or Copilot execution.** Out of scope.

4. **Model registry needs re-verification** against provider docs and a live API
   before it drives a real request. See §5.1.

5. **No audit log.** No `activity_log` table or equivalent exists in this schema,
   so no audit trail was written. Configuration changes — who enabled a provider,
   who moved the default — are currently untracked. When an audit facility lands
   it should record: organization, actor, provider, action, and timestamp, and
   must never record a handle or a key.

6. **`src/types/database.generated.ts` is not updated.** It is git-ignored
   (`.gitignore:74`) and unimported; `src/types/database.ts` is the hand-written
   source of truth for the AI types. Regenerate it when the project adopts a
   generation step.
