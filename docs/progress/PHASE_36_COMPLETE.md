# Trackit X — Phase 36 Completion Report

## Executive summary

Phase 36 closes the credential boundary Phase 35 deliberately left open. It adds
a Supabase Edge Function — the **AI Gateway** — that authenticates the caller,
authorizes the provider configuration in SQL, reads the API key from Supabase
Vault, calls the provider, and returns a normalized result. Client code sends
only its own session token; there is no service key in the bundle and no way to
name a tenant and have it believed.

The headline of this report is not the feature. It is that **three defects
shipped-clean unit tests and were found only by running the function** against a
local Edge runtime, and each would have been a total outage or a total lockout in
production. A fourth surfaced while writing these documents.

They are documented in full below, with the fix and the regression test for each,
because the failures were not subtle and the reason is instructive: every one of
them was invisible to a test that mocks the thing that was broken.

**The gateway is not enabled.** `GATEWAY_AVAILABLE = false`, no real provider
credential exists in this environment, and nothing has been deployed. No
successful call to Gemini, OpenAI or Anthropic has been observed, and this
document does not claim one.

---

## Verification status — read this first

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| `npx tsc --noEmit -p tsconfig.edge.json` | **PASS** — the Deno graph type-checks |
| `npm run lint` (`eslint . --max-warnings=0`) | **PASS** |
| `npm run test` (Jest) | **PASS** — 22 suites, **718 tests** |
| `npx expo export --platform web` | **PASS** — 2 web bundles emitted |
| Bundle scanned for credential shapes | **PASS** — 0 hits |
| `supabase/tests/rls_isolation.sql` §18 | **PASS** — 89 assertions, 0 failures, executed 2026-09-27 |
| Whole `rls_isolation.sql` | **PASS** — 252 assertions, 0 failures, rolled back |
| **Live local Edge runtime** | **PASS** — 12 scenarios, real Postgres and real Vault (see below) |

### The live runtime was exercised, and it found three bugs

`npx supabase functions serve ai-gateway --env-file … --no-verify-jwt` against a
local stack, driven with real HTTP requests and a real user JWT. Not a mock, not
a unit test. Scenarios, all observed:

| # | Scenario | Result |
|---|---|---|
| 1 | `status`, authenticated | `200` — `available: true`, `vaultAvailable: true` |
| 2 | `status`, no token | `401 AI_UNAUTHORIZED` |
| 3 | `status`, hostile `Origin` | `401` — refused as CSRF |
| 4 | `generate`, own config, no credential | `409 AI_PROVIDER_NOT_CONFIGURED` |
| 5 | `generate`, another tenant's config id | `401`, message identical to non-member |
| 6 | `store-credential`, admin, fake key | `200` — one Vault row, `trackitx:ai:<config-id>` |
| 7 | `status` after store | `200` |
| 8 | `generate` with the fake key | `502 AI_PROVIDER_UNAVAILABLE`, `retryable: true` |
| 9 | `test-connection` with the fake key | `200`, `reachable: false`, `failureReason: provider_error` |
| 10 | `delete-credential` | `200` — Vault row revoked, handle nulled |
| 11 | `generate` after delete | `409 AI_PROVIDER_NOT_CONFIGURED` again |
| 12 | unknown operation | `400 AI_REQUEST_INVALID` |

Then, with a marker credential in place:

- The marker appears in **no** response body.
- The marker appears in **no** public table column.
- The marker appears in **nowhere** in the Edge runtime log.
- The marker **is** in `vault.secrets`, and `ai_provider_configs.secret_reference`
  resolves to that row.

The disposable user, organization, configuration, Vault rows, session token, env
file and function container were all removed afterwards.

---

## The three defects

Each of these passed the full unit suite. Each is now covered by a test that was
verified to fail when the defect is reintroduced.

### 1. The gateway refused every native client

`if (!isOriginAllowed(origin))` rejected a request with **no** `Origin` header.
The Expo app on Android and iOS sends none. So did `curl`.

The failure mode was nasty: the client received `401 AI_UNAUTHORIZED`, which is
byte-identical to what "not signed in" returns. The symptom points at
authentication, so it would have been debugged in the auth layer indefinitely
while the actual cause was a CORS allowlist.

**Fixed** by splitting the rule in two. `isOriginAllowed` stays strict and is
used for preflight, where a browser always sends `Origin`. The request path uses
`isRequestOriginAcceptable`, which requires a *present* `Origin` to be
allowlisted and accepts an absent one.

This is not a loosening. The allowlist is a CSRF control, and CSRF requires a
browser: a browser cannot obtain a cross-origin bearer token without CORS
approval, which is exactly what `isOriginAllowed` governs. An absent `Origin` is
a native app or a server, neither of which a hostile page can impersonate.

**Tests:** §18a, four cases, including that preflight stays strict and that the
two functions are deliberately not interchangeable.

### 2. The Edge Function could not boot at all

The function imported `OrganizationRole` from `src/domain/organization.ts`,
which gets it from `src/types/database.ts` — **through `import type`**.

Deno includes type-only imports when it builds a module graph. The Supabase
CLI's local `functions serve` bind-mounts only the files its scanner walks, and
that scanner prunes `import type`. So the file existed for Deno and not for the
container, and **every request returned `503`** with
`Module not found "…/src/types/database.ts"`.

The seductive wrong fix is to copy the file into the running container. That
works, appears to solve it, and is silently lost the next time a file changes —
because the container is recreated on edit. I did exactly that first, and it cost
real time while the actual bug stayed in place.

**Fixed structurally.** `src/domain/roles.ts` now holds the role ladder with no
schema dependency; `src/domain/organization.ts` re-exports it so no app import
changed. `OrganizationRole` is therefore declared in two places, which is a real
cost, and it is fenced: a **bidirectional** assignability assertion in
`tests/unit/roles.test.ts` fails `npm run typecheck` on drift. I verified the
guard bites by adding a role to the schema type and confirming the build failed,
because a type assertion written as a union derived from the same array it is
checking is circular and can never fail.

**Tests:** §18b, three cases. `18b` reads the Edge entry points as text and
asserts they import neither `organization.ts` nor `types/database.ts`. I
reintroduced both defects and confirmed the tests fail. Comments are stripped
before the search, because the file documents the import it must not contain and
someone would eventually delete the explanation to make the test pass.

### 3. Every authorized request was refused

The function read the caller's role through the app's `organization_role_of` —
`SECURITY DEFINER`, looks purpose-built, and is unusable here. It takes only an
organization and resolves the actor from **`auth.uid()`**. The gateway calls it
with a `service_role` client, whose JWT carries no `sub`, so `auth.uid()` is
`NULL`, so it returned `NULL` for every call, including for an owner acting on
their own organization.

Every configuration-authorized operation returned `401 AI_UNAUTHORIZED` while
the SQL, the keys, the membership rows, the JWT and the policy were all correct.
I confirmed this by calling the RPC directly over PostgREST with the same
service-role key: `200`. The function's own call was the only broken link.

No grant fixes this. The function answers "what is my own role", and a
service-role client has no auth context by definition.

**Fixed** with `ai_gateway_role_of(actor, organization)`, the same query with the
actor as an argument, granted to `service_role` alone. `NULL` means no
membership and the handler treats it as a **refusal**, never as a fallback to
`member` — a membership revoked mid-request must not be replaced by a weaker role
that still passes the rank check.

**Tests:** §18b asserts the function calls the new RPC and never the old one.
SQL §18.63–18.73 covers the contract, the `NULL` cases, and the grants —
including **18.69**, which asserts that `organization_role_of` returns `NULL` for
a service-role caller, so the reason this function exists cannot be quietly
deleted.

### 4. A fourth problem, found while writing the documentation

Writing the architecture document meant publishing the code-to-status table, and
comparing it against the source found that **the table I had written was wrong
and the source was also wrong in one place**:

- I documented `AI_MODEL_NOT_SUPPORTED` as `400`. It is `409`, and `409` is
  right: the request is well formed, the organization's configuration is what
  does not agree with it.
- I documented `AI_ACTION_NOT_PERMITTED` as `403`. The source returned **500**,
  because that code had no arm in `statusForCode` and fell through to the
  `default`. A correctly refused request would have been reported as a server
  fault and would have fired any 5xx alert threshold.

The second one is a real defect and is fixed. The first was mine and is corrected
in the document. **Tests:** §18c now asserts all nine mappings against
`statusForCode`, which is exported for the purpose, so the table cannot drift
again. The `default` arm is still `500`, which means a future code added without
an arm is still reported as a fault; a compile error would be better and is
noted as a wart rather than quietly fixed.

---

## What was implemented

### Database

`supabase/migrations/20260927130000_ai_gateway_vault.sql`. Six `SECURITY
DEFINER` functions, revoked from `public` and granted to `service_role` only.
`service_role` holds no table privilege on `ai_provider_configs`, so the
functions are the only route and cannot be bypassed in TypeScript. Tenancy is
derived from the actor argument inside the same transaction as the read;
`42501` covers not-a-member, insufficient-rank and not-service-role identically.
`ai_gateway_read_credential` is the only plaintext path in the schema. Orphan
recovery reuses the deterministic Vault name `trackitx:ai:<config-id>` instead
of raising a duplicate-key error.

### Domain (`src/domain/ai/`, no Supabase or React imports)

`gatewayProtocol` (wire contract, bounds, `status` accepts `{}`, `credential`
rejected outside `store-credential`), `gatewayAuthz` (rank, provider agreement,
disabled config), `gatewayPrompt`, `providerErrors` (closed error set),
`registry` (dated source of truth), `gatewayVault` (port plus a fail-closed
`unavailableSecretVault`), `gatewayRateLimit` (per-instance fixed window), and
`systemInstructions` (dependency-free, so Expo and Deno share one definition).

### Edge Function

`supabase/functions/ai-gateway/`. Entry point with CORS and bearer handling,
`http.ts` (origin rules, JSON reading, envelopes, deep-redacted logging),
`configReader.ts`, `vault.ts`, and three adapters plus a registry-driven index.
45s hard timeout that a caller cannot raise.

### Client

`aiGatewayService` calls `functions/v1/ai-gateway/<operation>` — the URL path is
the only source of the operation, and a body `operation` field is rejected.
`aiProviderService` delegates test, submit and revoke to it, and
`useAIProviderConfigs.submitCredential()` resolves the selected provider to a
`configId` while keeping the provider-based hook API unchanged.

### Tests and docs

718 Jest tests across 22 suites; `aiGatewaySecurity.test.ts` has 18 numbered
sections and 84 tests. 252 SQL assertions. `docs/architecture/AI_GATEWAY_ARCHITECTURE.md`.

---

## Security rules enforced

- No key in the client, in a table a client can reach, or in a log.
- `service_role` cannot read `ai_provider_configs` directly.
- Authorization decided in SQL; TypeScript only applies rank to a role SQL proved.
- A non-member and a nonexistent configuration are indistinguishable.
- The vault handle is never disclosed by a metadata read.
- An orphaned credential is unreadable.
- Logs are redacted recursively, then re-checked; a line that still matches a
  credential pattern is dropped rather than emitted.
- Provider failures become a closed set of codes; no upstream text is passed
  through.
- A `credential` field is rejected on every operation except `store-credential`,
  before authorization runs.
- Untrusted business data is fenced below the system instructions.
- No client-named tenant.

---

## Deferred / not implemented

- **Streaming.** Responses are complete JSON.
- **Per-call budget accounting.** `AI_BUDGET_EXCEEDED` is declared, not enforced.
- **Shared rate-limit store.** Limits are per Edge Function instance.
- **Vault read caching.** Every generate is a Vault round trip.
- **Provider-driven model listing.** The registry is hand-maintained and dated.

## Known limitations

1. **No successful provider call has been observed.** No real credential exists
   here. Adapters are tested with mocked `fetch`; the live runtime was driven
   with a deliberately invalid key to confirm the failure path is clean and
   leaks nothing. Connectivity to Gemini, OpenAI and Anthropic is **unverified**.
2. **Not deployed.** Everything was verified against a local `functions serve`.
   The hosted runtime, its secrets and its network path are unverified.
3. **The client is gated off** with `GATEWAY_AVAILABLE = false`. Turning it on is
   a deliberate follow-up, after a credential is configured in a hosted project.
4. **Rate limiting is per instance**, which is a loop guard, not a defence
   against a determined attacker.

## Corrections made to earlier work

- **Client routing.** `callGateway()` accepted an `operation` argument that went
  into the body while the URL path also carried it. Two sources of truth for the
  value that decides which handler runs and which minimum role applies. The path
  is now canonical and the body field is rejected.
- **`status` could not be called.** The parser required every operation to have a
  body, but `status` is the bodyless liveness probe and the client sends `{}`.
- **Nested credential leak in logging.** `logGateway` redacted known top-level
  fields; a credential nested one level down passed through. Now recursive, with
  a final pattern check that drops the line entirely.
- **Provider/config mismatch was checked twice**, in two places that could
  disagree. Centralized in `authorizeInvocation()`.
- **App and server prompt definitions were coupled**, which made the Edge
  Function unbootable. Split into `systemInstructions.ts`.

## Files changed

**New**

- `src/domain/ai/` — `gatewayProtocol`, `gatewayAuthz`, `gatewayPrompt`,
  `systemInstructions`, `providerErrors`, `registry`, `gateway`,
  `gatewayVault`, `gatewayRateLimit`, `types`
- `src/domain/roles.ts`
- `src/services/aiGatewayService.ts`
- `supabase/functions/ai-gateway/` — `index`, `http`, `configReader`, `vault`,
  `deno.json`, `providers/{base,index,gemini,openai,anthropic}`
- `supabase/migrations/20260927130000_ai_gateway_vault.sql`
- `tests/unit/aiGatewaySecurity.test.ts`, `tests/unit/roles.test.ts`
- `docs/architecture/AI_GATEWAY_ARCHITECTURE.md`, this file

**Modified**

- `src/services/aiProviderService.ts`,
  `src/features/ai-providers/useAIProviderConfigs.ts`,
  `src/domain/organization.ts`, `src/domain/ai/copilotContract.ts`,
  `src/utils/errors.ts`, `src/utils/result.ts`, `eslint.config.js`,
  `tsconfig.json`, `supabase/tests/rls_isolation.sql`
- `src/domain/ai/{registry,gateway,types}.ts` — explicit `.ts` specifiers for
  the Deno graph

**Not changed**

- `supabase/functions/ai-gateway` is gated behind `GATEWAY_AVAILABLE = false`;
  no UI surface was added and no existing screen's behaviour changes.
