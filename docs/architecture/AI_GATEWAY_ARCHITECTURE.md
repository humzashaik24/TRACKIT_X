# Trackit X — AI Gateway Architecture

Phase 36 introduces the AI Gateway: the only path from a Trackit X client to a
provider API key, and the only component in the system that is allowed to hold
one in plaintext.

Phase 35 built provider *configuration* — organizations could register Gemini,
OpenAI and Anthropic, pick a model, and mark a default — but stopped
deliberately at the credential boundary, because a static client bundle has
nowhere safe to put a secret. This document describes what closes that boundary
and, just as importantly, what is still not proven.

---

## 1. Scope, and the honest limit of this phase

**In scope.** A Supabase Edge Function that authenticates the caller, authorizes
the configuration in SQL, reads the credential from Supabase Vault, calls the
provider, and returns a normalized result. A shared prompt contract. A client
service. Provider adapters for the three registered providers.

**Not in scope, and not claimed.** No streaming. No real provider call has ever
succeeded from this repository — there is no Gemini, OpenAI or Anthropic
credential available here, so provider connectivity is asserted with mocked
adapters and with expected-failure boundary tests only. The client is gated off
(`GATEWAY_AVAILABLE = false`), so the Expo app does not call the gateway at all.
Nothing has been deployed to a hosted project.

Read `docs/progress/PHASE_36_COMPLETE.md` for the verification table, including
the three defects that only appeared when the function was actually run.

---

## 2. Architecture

```
  Expo client (static bundle, no secret, no service key)
        │  supabase.functions.invoke('ai-gateway/<operation>')
        │  Authorization: Bearer <the user's own session JWT>
        ▼
  Kong  ── verifies the JWT, routes on the path
        ▼
  Edge Function  supabase/functions/ai-gateway
        │  1. resolve the caller            auth.getUser(token)
        │  2. authorize the configuration  SQL, not TypeScript
        │  3. read the credential          Vault, server side only
        │  4. call the provider            hard timeout, redacted errors
        │  5. record the verdict           connection_status
        ▼
  Gemini / OpenAI / Anthropic
```

The client sends **its own session token** and nothing else. There is no
service-role key in the bundle, and no way for a client to name a tenant, a
provider, or a secret handle and have it believed.

### 2.1 The operation is in the path, not the body

```
POST /functions/v1/ai-gateway/generate
POST /functions/v1/ai-gateway/store-credential
```

`callGateway(operation, body)` takes the operation as a typed
`GatewayOperation` and puts it in the URL. The body carries only arguments. A
body may not contain `operation` at all — the parser rejects the field if it
does, so there is no second source of truth to disagree with the first.

This matters more than it looks. With the operation in the body, a proxy, a
retry, or a future refactor could disagree with the URL about what was being
asked for, and the authorization decision is made *after* the operation is
known.

### 2.2 Operations

| Operation | Minimum role | Writes | Notes |
|---|---|---|---|
| `status` | any member | no | Liveness and reachability. Body must be `{}`. |
| `test-connection` | admin | `connection_status` | Calls the provider with a minimal prompt. |
| `generate` | member | no | The Copilot path. |
| `store-credential` | admin | Vault + `secret_reference` | The only operation that accepts a `credential` field. |
| `delete-credential` | admin | Vault + clears flags | Revokes the secret and resets the verdict. |

`credential` is accepted on `store-credential` and **nowhere else**. The parser
rejects it on every other operation before authorization runs, so a credential
can never be smuggled into a `generate` body and reach a log line.

---

## 3. Security invariants

These are the properties the code is built to hold. Each has at least one test.

1. **No key ever reaches the client.** The credential is read in the Edge
   Function, used, and dropped. `ai_gateway_read_credential` is the only
   function in the schema that returns plaintext, and it is granted to
   `service_role` alone.
2. **`service_role` cannot read the table.** The five original `ai_gateway_*`
   functions exist because `service_role` holds **no** privilege on
   `public.ai_provider_configs`. A direct `.from('ai_provider_configs')` query
   from the function fails with `permission denied`, and `BYPASSRLS` does not
   help because it only bypasses *row* policies, not table grants. This is
   deliberate: the function cannot skip the checks in TypeScript, because it
   cannot read the rows at all without them.
3. **Authorization is decided in SQL.** Every RPC takes `p_actor_id` and checks
   membership in the configuration's own organization, in the same transaction
   as the read. TypeScript then applies the rank rules to a role that SQL
   already proved exists.
4. **A non-member and a nonexistent configuration are indistinguishable.** Both
   raise SQLSTATE `42501` with the same message. The function cannot be used to
   enumerate other tenants' configuration ids.
5. **The vault handle is not disclosed.** `ai_gateway_read_config` omits
   `secret_reference`. No metadata read hands out a vault id.
6. **An orphaned credential is unreadable.** Nothing points at it, so no RPC
   returns it. Re-storing over an orphan reuses the deterministic name
   `trackitx:ai:<config-id>` instead of raising a duplicate-key error.
7. **Logs are redacted recursively, then checked.** `logGateway` runs
   `redactFields` over the payload and then refuses to emit the line at all if
   the serialized result still matches a credential pattern. A new field added
   to a log call cannot leak by being forgotten.
8. **Provider errors are a closed set.** An upstream 401, 500, timeout or HTML
   error page becomes one of a fixed set of codes. No provider text, URL or key
   fragment is passed through.
9. **Untrusted data is fenced.** Business context from the database is wrapped
   in delimiters inside a user-content section, below the system instructions,
   which the parser will not let a request override.
10. **A caller cannot spend another tenant's budget.** There is no client-named
    tenant anywhere in the request.

### 3.1 The origin rule, and why it has two parts

The gateway serves browsers and native clients, which is why there are two
functions and not one:

- **`isOriginAllowed(origin)` — strict.** Used for CORS preflight. A browser
  always sends `Origin` cross-origin, so a request without one is not a browser
  request we serve.
- **`isRequestOriginAcceptable(origin)` — used for the actual request.** An
  `Origin` that is *present* must be allowlisted. An `Origin` that is *absent* is
  accepted.

The second rule is not a loosening. The Expo app on Android and iOS sends no
`Origin`, and so do `curl` and any server-to-server caller. Refusing them made
every gateway call fail with the same `401` as "not signed in" — a symptom that
points at authentication and would have been debugged in the wrong place. The
allowlist is a CSRF control, and CSRF requires a browser: a browser cannot
obtain a cross-origin bearer token without CORS approval, which is what
`isOriginAllowed` governs.

Allowlist: `localhost:8081`, `localhost:19006`, their `127.0.0.1` forms, and the
`trackitx://` scheme. No wildcards.

---

## 4. Database interface

Six `SECURITY DEFINER` functions, all granted to `service_role` only and revoked
from `public`. Every one takes the actor as an **argument** and never reads
`auth.uid()` — see §4.1.

| Function | Returns | Purpose |
|---|---|---|
| `ai_gateway_resolve_config(actor, config, min_role)` | `ai_provider_configs` | Membership + rank check. The core. |
| `ai_gateway_read_config(actor, config)` | safe metadata | What the handler is allowed to see. No `secret_reference`. |
| `ai_gateway_role_of(actor, organization)` | `organization_role` or NULL | The caller's rank, for a service-role caller. |
| `ai_gateway_read_credential(actor, config)` | `text` | The only plaintext path. |
| `ai_gateway_store_credential(actor, config, secret)` | `uuid` (handle) | Writes to Vault, sets `secret_reference`. |
| `ai_gateway_delete_credential(actor, config)` | — | Revokes the secret, clears the client-visible flags. |

`ai_gateway_resolve_config` requires the caller to be `service_role`, refuses a
non-member, refuses a member below `min_role`, and raises `42501` in all three
refusal cases so none is distinguishable from the others.

### 4.1 Why `ai_gateway_role_of` exists

This function is the answer to a defect that no mocked test could have found.

The gateway needs the caller's role to apply `organization_role_rank()`. The
obvious source is the app's existing `organization_role_of`, which is
`SECURITY DEFINER` and looks purpose-built. It is not usable here: it takes only
an organization and resolves the actor from **`auth.uid()`**. The gateway calls
it with a `service_role` client, whose JWT carries no `sub`, so `auth.uid()` is
`NULL`, so the lookup matches no row and returns `NULL` for every call —
including for an owner acting on their own organization.

No grant fixes this. That function answers "what is my own role", and a
service-role client has no auth context by definition. Every
configuration-authorized operation answered `401` while the SQL, the keys, the
membership rows and the JWT were all correct.

`ai_gateway_role_of` is the same query with the actor as an argument. `NULL`
means "no membership" and the Edge Function treats that as a **refusal**, never
as a fallback to `member` — a membership revoked mid-request must not be
replaced by a weaker role that still passes the rank check.

This is asserted in both directions: §18.69–18.70 of the SQL suite proves the
app helper returns `NULL` where the gateway RPC answers correctly, so a future
refactor back to it fails in the suite instead of in production.

### 4.2 The Deno import rule

The Edge Function runs on Deno, which builds its module graph **including**
type-only imports. The Supabase CLI's local `functions serve` bind-mounts only
the files its own scanner walks, and that scanner prunes `import type`.

So a module reachable from an Edge Function *only* through a type import exists
for Deno and not for the container. The symptom is a function that returns
`503` for every request, with `Module not found ".../src/types/database.ts"` in
the runtime log. Copying the file into the running container by hand appears to
fix it and is silently lost on the next edit, which is how the real cause stays
hidden.

The fix is structural, not operational:

- **`src/domain/roles.ts`** holds the role ladder with no schema dependency.
  `src/domain/organization.ts` re-exports it, so no app import changed.
  `OrganizationRole` is declared in both `roles.ts` and `types/database.ts`, and
  a bidirectional assignability assertion in `tests/unit/roles.test.ts` fails
  `npm run typecheck` if they drift.
- **The Edge graph reaches no schema-typed module**, asserted by reading the
  entry points in a test (§18b).

### 4.3 Credentials live in Supabase Vault

A stored credential is a row in `vault.secrets` named deterministically
`trackitx:ai:<config-id>`, with `public.ai_provider_configs.secret_reference`
holding its uuid. The plaintext is never in a table the client can reach, and
`credential_present` is a boolean derived from the presence of the handle, so a
client can ask "is one configured?" without learning anything else.

---

## 5. Domain layer (`src/domain/ai/`)

| Module | Responsibility |
|---|---|
| `gatewayProtocol.ts` | Wire contract. Operation parsing, bounds, `status` accepts `{}`, `credential` allowed only on `store-credential`. |
| `gatewayAuthz.ts` | Rank rules, provider/config agreement, disabled configurations. Pure. |
| `gatewayPrompt.ts` | System instructions + fenced untrusted data. Depends on `systemInstructions.ts`, not on dashboard code. |
| `systemInstructions.ts` | The Copilot instructions, dependency-free so Expo and Deno can share one definition. |
| `providerErrors.ts` | Normalizes any provider failure to a closed code. |
| `registry.ts` | The authoritative provider/model list. Dated. |
| `gatewayVault.ts` | Server-side Vault port. Ships an `unavailableSecretVault` that fails closed. |
| `gatewayRateLimit.ts` | Fixed-window limiter, per operation. |

**The prompt must be dependency-free.** An early version had `gatewayPrompt`
import the Copilot contract, which imported dashboard metrics, which pulled in
Expo modules that do not exist in a Deno container. The function would not boot.
The shared instructions are now in `systemInstructions.ts` with no imports at
all, and `copilotContract.ts` re-exports them.

### 5.1 Rate limits

In-memory, per Edge Function instance, fixed window. The limits are the
defence against a loop, not against a determined attacker — a distributed
deployment needs a shared store, which is deferred.

| Dimension | Limit |
|---|---|
| user / minute | 20 |
| organization / minute | 120 |
| provider / minute | 300 |
| IP / minute | 60 |
| `test-connection` / 5 min | 5 |
| `store-credential` / 5 min | 5 |
| `delete-credential` / 5 min | 10 |

Provider calls have a hard 45s timeout that a caller cannot raise.

---

## 6. Error contract

Every response is `{ ok, requestId, data | error }`. The client can always
correlate a failure with a log line, and a log line never contains a credential.

| Code | HTTP | Meaning |
|---|---|---|
| `AI_UNAUTHORIZED` | 401 | No session, hostile origin, or not a member of that configuration. |
| `AI_REQUEST_INVALID` | 400 | Malformed body, unknown operation, or out of bounds. |
| `AI_ACTION_NOT_PERMITTED` | 403 | Authenticated, but not permitted. |
| `AI_PROVIDER_NOT_CONFIGURED` | 409 | No credential stored for this configuration. |
| `AI_PROVIDER_DISABLED` | 409 | The configuration is disabled. |
| `AI_MODEL_NOT_SUPPORTED` | 409 | Model not in the registry, or belongs to another provider. |
| `AI_PROVIDER_RATE_LIMITED` | 429 | The provider throttled us. |
| `AI_PROVIDER_AUTH_FAILED` | 502 | The provider rejected our credential. |
| `AI_PROVIDER_UNAVAILABLE` | 502 | Timeout, network failure, or unparseable upstream response. |
| `AI_UNAVAILABLE` | 500 | No gateway deployed. Client-side sentinel. |
| `AI_BUDGET_EXCEEDED`, `AI_OUTPUT_INVALID` | 500 | Declared for the budgeted execution path; not yet reachable. |

This table is the shipped `statusForCode` mapping, read from the source rather
than from intent. Two things about it are deliberate and one is a known
wart:

- `AI_MODEL_NOT_SUPPORTED` is a **409**, not a 400. The request is
  well-formed; the organization's configuration is what does not agree with it.
- `AI_ACTION_NOT_PERMITTED` is a **403**, not a 500. A denial is a client fact;
  reporting it as a server fault would fire every 5xx alert threshold for a
  request that was correctly refused.
- **Wart:** the `default` arm is 500, so any code added to `AppErrorCode` without
  a mapping arm is reported as a server fault. Codes that are declared but not
  yet reachable (`AI_BUDGET_EXCEEDED`, `AI_OUTPUT_INVALID`) sit there today. The
  alternative — a compile error for an unmapped code — is the better design and
  is deferred.

Only `retryable` tells the client whether to try again, and it is set
deliberately per code rather than inferred from the status.

---

## 7. Adding a provider

1. Add the provider and its models to `src/domain/ai/registry.ts`, with a dated
   comment. The registry is the single source of truth — the adapter index and
   the supported-model checks both read it, so a hardcoded list anywhere is a
   test failure (§16).
2. Add `providers/<id>.ts` implementing the adapter port. The shared base gives
   you the timeout, text body read, redaction and error normalization; you supply
   the request and the response parse.
3. Register it in `providers/index.ts`. There is no other list.
4. Add a Postgres enum value in a migration for `ai_provider` and
   `ai_connection_status`.
5. No client change is needed. The settings screen reads the registry.

---

## 8. Testing

- **`tests/unit/aiGatewaySecurity.test.ts`** — 18 numbered sections, 84 tests.
  Sections 1–17 cover the security properties above with mocked clients.
  Section 18 covers the three defects that only a running function could find,
  plus §18c, which pins the code-to-status table in §6.
- **`tests/unit/aiProvidersSecurity.test.ts`** — the Phase 35 client-side
  boundary.
- **`tests/unit/roles.test.ts`** — the role ladder, including the compile-time
  assertion that the duplicated `OrganizationRole` has not drifted.
- **`supabase/tests/rls_isolation.sql` §18** — 89 assertions on the SQL boundary:
  refusals, cross-tenant equivalence, the column-level secret boundary, orphan
  recovery, and §18.63–18.73 for `ai_gateway_role_of`. The whole file is
  **252 assertions** and rolls back.

Section 18's static tests (`18b`) read the Edge entry points as text and assert
they import neither `organization.ts` nor `types/database.ts`. Both were
confirmed to fail when the defect is reintroduced, so they are not vacuous.

---

## 9. Known limitations

1. **No successful provider call has been observed.** No real credential exists
   in this environment. Adapters are tested with mocked `fetch`, and the live
   runtime was exercised with a deliberately invalid key to confirm the failure
   path is clean and leaks nothing.
2. **Not deployed.** All runtime verification was against a local
   `supabase functions serve`. The hosted edge runtime, its secrets and its
   network path are unverified.
3. **Client is gated off.** `GATEWAY_AVAILABLE = false`. Enabling it is a
   deliberate follow-up, after a real credential is configured in a hosted
   project.
4. **Rate limiting is per instance.** A shared store is required for a real
   deployment.
5. **No streaming.** Responses are complete JSON.
6. **No per-call budget accounting.** `AI_BUDGET_EXCEEDED` is declared, not
   enforced.
7. **Vault is read on every call.** No short-lived credential cache, so every
   generate is a Vault round trip.
