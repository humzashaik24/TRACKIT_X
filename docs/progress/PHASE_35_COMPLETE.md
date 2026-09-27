# Trackit X — Phase 35 Completion Report

## Executive summary

Phase 35 builds the organization-scoped AI provider **configuration and security
foundation**. An admin can add, enable, disable, edit and delete provider
configurations, choose a model from a controlled registry, and mark one provider
as the organization default — all enforced by RLS and column-level grants rather
than by UI convention.

The phase stops deliberately at the credential boundary. Trackit X is a static
client bundle with no server runtime, so **there is nowhere safe to put a provider
API key today**. Rather than fake one, the secret vault and the AI Gateway ship as
interfaces whose every method returns `AI_UNAVAILABLE` with a user-facing
explanation. No completion, streaming or Copilot execution is implemented.

An earlier attempt at this phase was found to leak a key suffix, fabricate
`secret_reference` values client-side, log the reference, and allow a client to
write `connection_status` and `is_default` directly. It was removed rather than
patched; see *Corrections made to earlier work* below.

---

## Verification status — read this first

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| `npm run lint` (`eslint . --max-warnings=0`) | **PASS** |
| `npm run test` (Jest) | **PASS** — 20 suites, **628 tests** |
| `npx expo export --platform web` | **PASS** — 2 web bundles emitted |
| Bundle scanned for credential shapes | **PASS** — 0 hits (see below) |
| `supabase/tests/rls_isolation.sql` §17 | **NOT EXECUTED** — Docker absent |

### The SQL suite did not run, and no result is claimed for it

`supabase/tests/rls_isolation.sql` section 17 adds **39 assertions** covering
tenancy, role gates, the column-level secret boundary, and database invariants.

It could not be executed. On this machine:

- Docker Desktop is **not installed** (`C:\Program Files\Docker\Docker\Docker Desktop.exe` absent), so `supabase db reset` cannot start a local stack.
- `psql` is not on `PATH`.
- Nothing is listening on `127.0.0.1:54322` (connection actively refused).

The Supabase CLI itself is present (`2.115.0`), but it is only a client for a
daemon that is not running.

**Sections 1–16** of that file carry a prior *executed and passing* result from
Phase 33 (124 assertions). **Section 17 does not.** The file header states this
explicitly, and `docs/architecture/AI_PROVIDER_ARCHITECTURE.md` §9 repeats it. Run
before trusting the column grants:

```bash
supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
```

This matters more than usual, because the secret boundary is a **privilege**
property. `RLS` decides which rows a role may touch; it cannot express "this
column is unreadable". Only a real database can prove that
`secret_reference` raises `42501` for `authenticated`.

### Bundle scan

Scanned all `.js`/`.html` under `dist/` after a web export:

| Pattern | Hits |
|---|---|
| `AIza[0-9A-Za-z_-]{20,}` (Google) | 0 |
| `sk-proj-…` (OpenAI) | 0 |
| `sk-ant-…` (Anthropic) | 0 |
| `secret_reference` | 0 |
| `EXPO_PUBLIC_*API*` | 0 |

`apiKey` appears 4× and `api_key` 1× — all inside the **Supabase Realtime SDK**,
which passes the project's existing anon key as `apikey`. Pre-existing, unrelated
to AI providers, and expected.

---

## Provider architecture

- **provider abstraction:** `ProviderAdapter` in `src/domain/ai/gateway.ts` —
  `testConnection`, `generate`, `listSupportedModels`. Interface only; no
  implementation, because a real one needs a server runtime.
- **capability model:** `AIModelCapability` (`text`, `reasoning`, `code`,
  `long_context`, `structured_output`) declared per model, so routing decisions
  have something to read instead of hard-coded model names.
- **model registry:** `PROVIDER_REGISTRY` in `src/domain/ai/registry.ts`, with
  Gemini, OpenAI and Anthropic. Every model carries a `verifiedOn` date and a
  `contextWindowTokens` that is either published or `null`.
- **selection & default:** per-provider `selected_model`; one organization-wide
  default via `set_default_ai_provider`, enforced by a partial unique index.
- **connection status:** `unverified` \| `connected` \| `failed`, writable only by
  `service_role`. Starts at `unverified`, so a new row cannot look connected.
- **organization scoping:** `ai_provider_configs.organization_id`, RLS via the
  existing `is_organization_member` / `has_organization_role` helpers. No second
  authorization system.
- **error handling:** fixed user-safe copy through `appError` / `ActionResult`.
  No raw `error.message` reaches the UI.

## What was implemented

### Database
- `supabase/migrations/20260927120000_ai_provider_configs.sql` (additive, 428 lines)
  - `public.ai_provider` and `public.ai_connection_status` enums.
  - `public.ai_provider_configs` with `UNIQUE (organization_id, provider)`, trimmed-length checks, and a handle-shape bound on `secret_reference`.
  - `credential_present` as a `GENERATED ALWAYS … STORED` boolean — the only credential-derived fact a client can read.
  - `ai_provider_configs_single_default_idx`: `UNIQUE (organization_id) WHERE is_default`.
  - `set_updated_at` and `guard_tenant_columns_immutable` triggers, both reused from the foundation migration.
  - 4 RLS policies: member read, admin write.
  - `REVOKE ALL` followed by column-level grants, since Supabase grants `ALL` on new `public` tables by default.
  - 4 functions: 2 admin-gated RPCs (`set_default_ai_provider`, `clear_default_ai_provider`) and 2 `service_role`-only writers (`set_ai_provider_secret_reference`, `record_ai_connection_test`).

### Domain (`src/domain/ai/`, no Supabase or React imports)
- `types.ts`, `registry.ts`, `configuration.ts`, `gateway.ts`, `copilotContract.ts`.
- `copilotContract.ts` imports Phase 34's `DashboardSnapshot` rather than
  re-deriving metrics.

### Services
- `src/services/aiProviderService.ts` — safe metadata CRUD, admin-gated
  mutations, `testProviderConnection` that refuses.
- `src/services/aiSecretVault.ts` — the vault port, unimplemented by design;
  plus `validateCredentialFormat` (length only, never value inspection) and
  `assertNoCredentialFields` (field-name-only tripwire).

### Feature
- `src/features/ai-providers/AIProvidersView.tsx` — provider cards, config
  modal, `secureTextEntry` credential field (disabled, with the reason shown),
  explicit unresolved-default state. Design-system tokens throughout; no
  hardcoded colours; no raw error text.
- `src/features/ai-providers/useAIProviderConfigs.ts` — RBAC-aware mutations and
  an organization-switch guard that stamps each response with the organization it
  was requested for and discards anything else before render.
- `app/(app)/settings.tsx` — real Settings route with an AI Providers entry.

### Types & navigation
- `src/types/database.ts` — `AIProviderConfigRow`, insert/update payloads, RPC
  signatures. Deliberately **excludes** `secret_reference`, so a credential
  handle is not even representable in the client row type.
- `src/navigation/destinations.ts` + `tests/unit/appMap.test.ts` — `/settings`
  marked ready.

### Tests
- `tests/unit/aiProvidersSecurity.test.ts` — 11 groups.
- `supabase/tests/rls_isolation.sql` §17 — 39 assertions (unexecuted).

### Documentation
- `docs/architecture/AI_PROVIDER_ARCHITECTURE.md` — security invariants, grants,
  domain contracts, limitations.
- `docs/progress/PHASE_35_COMPLETE.md` — this file.

---

## Security rules enforced

| Rule | How |
|---|---|
| No plaintext credential in any store | No column accepts one; `assertNoCredentialFields` guards every payload |
| `secret_reference` unreadable by `authenticated` | Absent from the `GRANT SELECT` column list, so `select *` cannot reach it either |
| `secret_reference` unwritable by `authenticated` | Absent from `GRANT INSERT` / `GRANT UPDATE`; only `service_role` may write it |
| `credential_present` is a boolean | `GENERATED` column; no length, suffix, hash or mask is derivable |
| `connection_status` cannot be fabricated | No client grant; only `record_ai_connection_test` as `service_role`, re-checking `auth.role()` internally |
| `is_default` cannot be set directly | No client grant; only the admin-gated `SECURITY DEFINER` RPC |
| One default per organization | Partial unique index, proven against a privileged writer (§17.35) |
| Non-admins cannot change settings | RLS write policies + `has_organization_role(…, 'admin')` inside the RPCs |
| No org-switch leakage | RLS membership scoping + client-side response stamping |
| Nothing secret in logs | Only `organizationId` and `provider` are logged; `redact` extended |
| Nothing secret in the bundle | Verified by scanning the web export |
| No `EXPO_PUBLIC_*` credential | No new environment variable introduced |

---

## Corrections made to earlier work

The previous attempt was removed rather than patched, because each defect was a
security defect:

| Defect | Correction |
|---|---|
| `maskSecretKey` returned a key **suffix** | Deleted. The client now learns only `credential_present: boolean` |
| Client **fabricated** `secret_reference` (`sec_ref_<timestamp>`) | Deleted. Only a server-side vault may produce a handle |
| `secureSecretStore` **logged** the reference | Deleted. The gateway logs no handle at all |
| Client could write `connection_status` and `is_default` | Column grants removed; `service_role`-only writers and an admin RPC added |
| Migration was mojibake-corrupted and permissive | Rewritten as a clean additive migration with `REVOKE ALL` + column grants |
| Stale model ids with no provenance | Registry rewritten; every model carries `verifiedOn`, context is published-or-`null` |
| UI used hardcoded colours and rendered raw `error.message` | Rewritten on design tokens with fixed `appError` copy |
| Old test file imported deleted modules | Replaced; whole suite green |

Two further defects were found and fixed during verification:

| Found by | Defect | Fix |
|---|---|---|
| `npm run lint` | BOM in `AIProvidersView.tsx`; `setState` called synchronously in an effect | BOM stripped; effect rewritten to the repo's async-IIFE pattern; `configs` memoised |
| A new test | `redact` did **not** strip `sk-proj-…` or `sk-ant-…` key shapes by value | Added `sk-proj-`, `sk-ant-` and long-`sk-` patterns to `src/utils/redact.ts` |
| Code review of the migration | `set_default_ai_provider` declared `OUT` params named after its columns; unqualified `WHERE organization_id` would raise `column reference is ambiguous` at runtime (PL/pgSQL defaults to `variable_conflict = error`) | Every table reference aliased `c` and qualified; a comment marks the alias as load-bearing |
| Code review of the registry | `defaultModelForProvider` preferred `models[0]` over the declared `defaultModelId`, so a cosmetic reorder would silently change the default | `defaultModelId` is now authoritative |
| Code review of `aiProviderService` | `saveProviderConfig` used `upsert`. PostgREST expands `ON CONFLICT DO UPDATE` to *every* payload column — including `organization_id` and `provider`, on which the migration withholds UPDATE. Re-saving an already-configured provider (the common case) would have failed with `42501` | Split into explicit insert and update paths; the update names only the three columns the role may write |

The SQL section also had two self-contradictory assertions found on review
(asserting a row was *not* default immediately after setting it default), and a
privilege probe that could pass vacuously because `SELECT … INTO` assigns `NULL` on
success. Both were rewritten; the probe now uses `EXECUTE` and asserts a boolean.

---

## Deferred / not implemented

1. **Credential storage** — needs an AI Gateway (Supabase Edge Function or
   equivalent) plus a vault. `aiSecretVault.availability.requirements` enumerates
   the four prerequisites.
2. **Real connection testing** — `connection_status` stays `unverified` until
   `record_ai_connection_test` runs as `service_role` after a genuine call.
3. **Completions, streaming, Copilot execution** — out of scope. Only the business
   context contract exists.
4. **Prompt assembly, token accounting, per-provider rate limits** — not started.
5. **Audit logging** — no `activity_log` table exists in this schema, so no audit
   trail was written. Configuration changes are currently untracked. When one
   lands it should record organization, actor, provider, action and timestamp, and
   must never record a handle or a key.
6. **Model registry re-verification** — the catalog was compiled from
   provider-documentation searches on 2026-09-27 and **has not been confirmed
   against a live API**, which this phase cannot do. Re-verify each id and context
   figure before it drives a real request, and update
   `MODEL_REGISTRY_VERIFIED_ON`.
7. **`src/types/database.generated.ts`** — git-ignored (`.gitignore:74`) and
   unimported; `src/types/database.ts` is the source of truth. Regenerate when the
   project adopts a generation step.

## Known limitations

- The 39 SQL assertions are **unverified at runtime** (§ above).
- The unit tests cannot prove multi-tenant isolation: `supabase-js` talks to a
  mock in Jest, and RLS lives in Postgres. That is what §17 is for.
- The credential field is rendered but disabled. It is the correct final UI for a
  working vault, not a stub that pretends to save.
- `defaultModelForProvider` and the registry assume model ids are provider-scoped
  and stable. A model retired by its provider stays listed until
  `MODEL_REGISTRY_VERIFIED_ON` is re-checked.

## Files changed

**Added**
```
supabase/migrations/20260927120000_ai_provider_configs.sql
src/domain/ai/types.ts
src/domain/ai/registry.ts
src/domain/ai/configuration.ts
src/domain/ai/gateway.ts
src/domain/ai/copilotContract.ts
src/services/aiProviderService.ts
src/services/aiSecretVault.ts
src/features/ai-providers/AIProvidersView.tsx
src/features/ai-providers/useAIProviderConfigs.ts
tests/unit/aiProvidersSecurity.test.ts
docs/architecture/AI_PROVIDER_ARCHITECTURE.md
docs/progress/PHASE_35_COMPLETE.md
```

**Modified**
```
app/(app)/settings.tsx
src/navigation/destinations.ts
src/types/database.ts
src/utils/redact.ts
supabase/tests/rls_isolation.sql
tests/unit/appMap.test.ts
```

**Deleted**
```
src/services/secureSecretStore.ts
src/domain/ai/adapters/
```
