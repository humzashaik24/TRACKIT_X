# Phase 41 — AI Activation Contract

**Trackit X — what must be true before real LLM generation can be switched on.
This document only verifies the contracts. Nothing here is activated, and no
credential value is stored in this repository or this document.**

## 1. The path being contracted

```
Copilot (client)
  → aiGatewayService          src/services/aiGatewayService.ts
  → gateway request           src/domain/ai/gatewayProtocol.ts (shared wire contract)
  → Supabase Edge Function    supabase/functions/ai-gateway/index.ts
  → authorization             src/domain/ai/gatewayAuthz.ts (pure, role + tenant)
  → provider config           RPC ai_gateway_read_config (SQL membership check)
  → Vault                     RPC ai_gateway_read_credential (SQL membership check)
  → provider adapter          supabase/functions/ai-gateway/providers/* (server-only)
  → LLM
```

Every hop of this path exists in this repository and is statically verified;
none of it is live. `GATEWAY_AVAILABLE` (`src/domain/ai/gateway.ts`) is `false`,
and every client method short-circuits to the same truthful "not available"
error. There is no mock provider, no fake response, and no path that pretends a
provider call happened.

## 2. What is already verified (statically)

| Contract | Where | Status |
|---|---|---|
| `configId` is required on every operation that names a configuration | `gatewayProtocol.ts` — UUID parsing, refused before authorization | Verified |
| Organization is derived from the configuration row, never from a client parameter | `gatewayAuthz.ts`, `index.ts` `loadAuthorizedConfig` | Verified |
| Role authorization (member ≥ generate; admin ≥ credential writes and connection tests) | `gatewayAuthz.ts` `AI_INVOKE_MINIMUM_ROLE`, `AI_CREDENTIAL_MINIMUM_ROLE` + SQL `ai_gateway_role_of` | Verified |
| Provider/model capability checks | `registry.ts` `isModelSupportedForProvider`, `toConfigFacts` refusal of unknown providers | Verified |
| `secret_reference` never reaches clients | column grant list excludes it; client `AIProviderConfig` has no such field; RPC returns metadata only | Verified |
## 3. The activation sequence (do this at activation time, not now)

Each step below is the minimum that must be true before real generation. The
commands are given as commands with placeholders — no real values, no real
project refs, no keys.

### Step 1 — Hosted Supabase project

Create a hosted Supabase project. Record:

- project URL (`https://<project-ref>.supabase.co`),
- publishable/anon key,
- service-role key (kept secret, never in the client or in git).

### Step 2 — Correct database migrations

Apply the four migrations in order to the hosted database:

1. `20260825120000_organizations_and_members.sql` — tenancy root, RLS, role types.
2. `20260925120000_core_business_data.sql` — departments, employees, projects,
   tasks, activity log.
3. `20260927120000_ai_provider_configs.sql` — provider configs, column-level
   grants, `set_default_ai_provider` RPC.
4. `20260927130000_ai_gateway_vault.sql` — five `ai_gateway_*` SECURITY DEFINER
   RPCs, `service_role`-only EXECUTE grants.

Verify the applied schema by running
`supabase/tests/rls_isolation.sql` against the hosted database (sections 17 and
18 cover provider configs and Vault access). This is **not** done in Phase 41.

### Step 3 — Edge Function deployment

Deploy the `ai-gateway` function:

```
supabase functions deploy ai-gateway --project-ref <project-ref>
```

Set its server secrets (never `EXPO_PUBLIC_*`):

```
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<...> --project-ref <project-ref>
supabase secrets set SUPABASE_URL=<https://<project-ref>.supabase.co> --project-ref <project-ref>
```

Extend `ALLOWED_ORIGINS` in `supabase/functions/ai-gateway/http.ts` with the
production web origin before deploying — the current allowlist holds only local
development origins plus the `trackitx://` scheme.

### Step 4 — Vault configuration

Confirm the hosted project has Vault enabled (`vault.secrets` exists and
`vault.create_secret` is executable by `service_role`). The gateway reaches the
Vault only through the five RPCs; no direct table privilege is granted.

### Step 5 — Admin provider configuration

As an organization admin, create provider configurations in the Settings
screen (or through the client APIs). The client can only write
`display_name`, `enabled`, `selected_model` and create rows; `is_default`
moves through `set_default_ai_provider`; `connection_status` is server-written.

### Step 6 — Provider credential

An admin submits the provider key using **store-credential**. The plaintext
travels browser → function → vault once, and only a boolean comes back. The
client then observes `credential_present = true` through the generated column.

### Step 7 — Model selection

The admin chooses a model from the registry (`registry.ts`). Model ids are
provider-scoped and written to `selected_model`. `GATEWAY_AVAILABLE` flips to
`true` only after steps 3–6 complete and are verified.

### Step 8 — Connection verification

Run **Test Connection** from the Settings screen. The gateway performs a real
provider call with the stored credential, records `connected`/`failed`, and
returns a `ConnectionTestReport`. A `connected` status is only ever written by
the server after a real authenticated call.

### Step 9 — Generation verification

Ask the Copilot a question and observe a real `generate` operation: the gateway
reads the config RPC, runs the pure authorization, reads the credential from the
Vault, calls the provider adapter, and returns a normalized answer whose
references match the context the client sent.

### Step 10 — Security verification

Confirm, in the hosted environment:

- a non-member and an unauthorized role are refused before any vault lookup;
- the browser network tab shows no `secret_reference`, no key, no provider text;
- gateway logs contain no credential shapes (the `logGateway` backstop);
- rate limits apply per user, per organization, per provider, and per IP;
- effective data mode is `live` in a production build.

## 4. Truthfulness before activation

Until steps 3–9 complete, every surface tells the truth about that state:

- Copilot: "…is not available yet" refusal (no locally-composed answer).
- Provider settings: Test Connection returns the exact unavailable reason and
  never writes `connected`.
- Credential storage: refused until a server-side vault exists.

## 5. Explicit non-claims

- Hosted Supabase: **NOT activated** in Phase 41.
- Real provider: **NOT activated**.
- Real LLM generation: **NOT verified**.
- Render: **NOT deployed**.
- Docker: **NOT used**.
- `GATEWAY_AVAILABLE`: remains **`false`**.
| Vault secrets remain server-side | `SecretMaterial` brand, vault adapter never returns a handle, plaintext exists only between RPC and adapter | Verified |
| System prompt remains protected | `gatewayPrompt.ts` — caller cannot reach `system`; adapters assert `systemInstructionsAreIntact` | Verified |
| Caller guidance remains bounded | `GATEWAY_LIMITS` bounds `userInput` and `additionalGuidance` before cost is incurred | Verified |
| Business context remains separated | fenced as quoted reference data; `assertContextAgreesWithConfig` refuses a mismatched org | Verified |
| Errors map to stable gateway error codes | `providerErrors.ts` `codeForProviderFailure`, `statusForCode` table | Verified |
| Unavailable gateway remains truthful in UI | `GATEWAY_AVAILABLE=false`; Settings renders the exact unavailable reason; Copilot refuses with no fallback answer | Verified |