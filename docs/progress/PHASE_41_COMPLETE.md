# Trackit X — Phase 41 Completion Report

## Phase objective

Prepare the existing Trackit X application for eventual real hosted Supabase and
real LLM activation **without activating either one**. Phase 41 is production
readiness: configuration contracts, environment separation, the Supabase client
boundary, the AI Gateway and Edge Function activation contracts, migration
readiness, failure modes, logging, secret scan, session/deep-link hardening, and
the build/deploy contract — all audited, the genuine defects fixed with
regression tests, the rest documented as contracts.

## Baseline

| Item | Value |
|---|---|
| Start commit | `9ae1af14985bb363d43b39dc7d38ae546c67b815` |
| Branch | `fix/format-money-parser-and-date-semantics` |
| Tests at baseline | 28 suites / **881 tests** — PASS |
| TypeScript / ESLint / Expo export at baseline | PASS |

## Verification status — read this first

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `eslint . --max-warnings=0` | **PASS** — zero warnings |
| `npm run verify` (Jest) | **PASS** — 29 suites, **905 tests** (881 before, 24 added) |
| `npx expo export --platform web` | **PASS** |
| `git diff --check` | **PASS** |
| Secret scan (source + dist bundle) | **PASS** — no credential values; the only bundle "hits" are three false positives (an icon glyph name, the app's own leaked-secret refusal text, binary font data) |

### What is NOT verified, precisely

- **The live database is still absent.** No hosted Supabase project exists in
  this environment. Migration application, `rls_isolation.sql` execution against
  a hosted database, Vault availability, and real-role RLS behavior are all
  listed under "REQUIRES HOSTED DATABASE VERIFICATION" in
  `docs/architecture/PHASE_41_DATABASE_READINESS.md` and are NOT claimed.
- **No AI provider has been called.** `GATEWAY_AVAILABLE` remains `false`; no
  credential was stored; no model was invoked; no real LLM generation happened.
- **No deployment occurred.** Render was not deployed; Docker was not used.

## Configuration audit

`docs/architecture/PHASE_41_CONFIGURATION_CONTRACT.md` classifies every variable:

- **CLIENT-SAFE (bundle-inlined)**: `EXPO_PUBLIC_APP_ENV`, `EXPO_PUBLIC_DATA_MODE`,
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `EXPO_PUBLIC_DEBUG_LOGGING` — the only five names `src/config/env.ts` reads
  (the sole `process.env` consumer).
- **SERVER-ONLY**: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (read by the Edge
  Function via `Deno.env`); provider credentials live in Vault, not the
  environment.
- **BUILD-TIME deployment**: `NODE_VERSION` and the four `EXPO_PUBLIC_*` values
  injected externally by Render's Dashboard (`sync: false`), never committed.

### Defects found and fixed

1. **Provider deny-list gap.** `forbiddenPublicSuffixes` listed Gemini-era
   suffixes only (`GEMINI_API_KEY`, `GOOGLE_API_KEY`), so
   `EXPO_PUBLIC_OPENAI_API_KEY` / `EXPO_PUBLIC_ANTHROPIC_API_KEY` would have
   shipped unguarded. Added `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` and the generic
   `API_KEY` suffix. Regression tests cover every provider name plus a generic
   `EXPO_PUBLIC_*API_KEY`.
2. **Production loopback URL.** `clientEnvSchema` accepted
   `http://127.0.0.1:54321` in production — a copied development `.env` would
   start, render the live shell, and fail on the first query. `resolveClientEnv`
   now refuses loopback hosts (`localhost`, `127.*`, `0.0.0.0`, `::1`,
   `*.localhost`) in production, with a message that never echoes the value.
   Development is unchanged.

### Client/server separation

- Server-only names are absent from `EXPO_PUBLIC_*`, from `src/`, from tests,
  fixtures, logs, docs (this one included) and from this commit's diff.
- The bundle is built from the same client-safe names only; the scan confirms no
  credential pattern reaches `dist/`.

## Data mode safety

`effectiveDataMode` is the single decision point; `resolveClientEnv` applies it:

| appEnv | DATA_MODE | Result |
|---|---|---|
| development | unset / `demo` | `demo` |
| development | `live` | `live` |
| staging | `demo` (explicit) | `demo` |
## AI activation contract

`docs/architecture/PHASE_41_AI_ACTIVATION_CONTRACT.md` documents the full path
(Copilot → `aiGatewayService` → gateway request → Edge Function →
authorization → provider config → Vault → adapter → LLM), the statically
verified contracts (configId required, org derived from the config row, role
gates, provider/model checks, `secret_reference` unreadable by clients, Vault
secrets server-side, protected system prompt, bounded guidance, separated
business context, stable gateway error codes, truthful unavailable UI), and the
ten-step activation sequence. The Edge Function's `ALLOWED_ORIGINS` currently
holds only local dev origins plus `trackitx://`; extending it with the
production origin is recorded as an activation step, not invented here.

## Database readiness

`docs/architecture/PHASE_41_DATABASE_READINESS.md` separates:

- **STATICALLY VERIFIED**: migration ordering/dependencies; RLS + org-scoped
  policies on every table; cross-org reference guards; `set search_path = ''`
  on every SECURITY DEFINER function; `auth.role()` gates and explicit
  `p_actor_id` (never `auth.uid()` under service-role); column-level grants that
  exclude `secret_reference` from clients; `service_role` denied table
  privileges on `ai_provider_configs`; STORED GENERATED `credential_present`;
  partial unique index for one-default-per-org.
- **REQUIRES HOSTED DATABASE VERIFICATION**: applying migrations to a hosted
  project, executing `supabase/tests/rls_isolation.sql` (241+ assertions) on
  hosted, real-role RLS behavior, Vault availability, function privilege
  behavior, index enforcement, realtime publication, planner behavior.

No migration file was modified; no local Supabase was started; no live SQL
verification is claimed.

## Security audit

- **Secret scan (source)**: `src/`, `app/`, `tests/`, `supabase/functions`
  contain no credential-shaped values. All `SUPABASE_SERVICE_ROLE_KEY` hits are
  the intentional refusal/deny machinery and documentation.
- **Secret scan (dist bundle)**: no credential values. The three pattern hits
  are false positives: the MaterialCommunityIcons glyph name
  `sk-empty-remove-outline`, the app's own "Refusing to start…" rejection text
  (variable names, never values), and binary font bytes.
- **Client bundle exposure**: `EXPO_PUBLIC_*` carry no secret; the deny-list is
  enforced at startup; the generic `API_KEY` suffix now closes the OpenAI /
  Anthropic gap.
- **Logging audit**: `src/utils/logger.ts` redacts every field before it reaches
  a sink; the Edge Function's `logGateway` runs `redactFields` then a
  `containsSecret` backstop that refuses to write rather than printing part of a
  key. Logs carry correlation ids, gateway error codes, provider/model ids,
  latency and success/failure — nothing credential-shaped.
- **Session audit**: sign-out clears auth and organization client state through
  derivation (the pure `resolveMembershipsForUser` guard + regression suite);
  a stale organization cannot survive a new session or an account switch.

## Failure-mode audit

- Backend unavailable → `NETWORK_UNAVAILABLE`/`DEPENDENCY_FAILED` through
  `attempt`/`toAppError`; screens render `userMessage` only.
- Session expires / auth fails → `SESSION_EXPIRED`/`AUTH_*` codes; the router
  returns to the auth zone via `RouteGate`.
## Deep-link / web URL audit

- Notifications navigate only through the `notificationDestination` allowlist
  (four route families, no schemes, no `..`, no query-string smuggling).
- Copilot citations navigate only through `copilotReferenceRoute` (project/task
  detail; employee stays a badge — no employee detail route exists).
- `/tasks?project=<id>` only seeds the project filter, which is validated
  against the active organization's own project list.
- Auth callback / PKCE handled per platform; `reset-password` sits outside the
  auth gate so a signed-in recovery session can set a password.
- Untrusted query parameters cannot direct navigation; existing allowlists are
  preserved.

## Build & deployment audit

- `package.json` (Node ≥ 20.19.0; engines compatible with Render's
  `NODE_VERSION=22.13.0`), `app.json` (web output `single`, typed routes), one
  `render.yaml` static-site service (`npx expo export --platform web`, publish
  `dist/`), env injected externally, no Docker, no local Supabase required to
  build.
- `tsconfig.json` excludes the Edge Function; `tsconfig.edge.json` type-checks
  it; `npm run verify` covers the app.
- Render infrastructure unchanged; no deployment performed.

## Tests added (24)

| File | Tests | Guards |
|---|---|---|
| `tests/unit/env.test.ts` | +19 | deny-list covers OpenAI/Anthropic/generic `API_KEY`; non-prefixed server names left alone; production rejects loopback URLs (5 host forms); hosted URL accepted in production; dev loopback allowed; refusal never echoes the URL; data-mode matrix at the `resolveClientEnv` boundary (production+demo→live, production+live accepted, staging+explicit demo, development+demo) |
| `tests/unit/organizationSession.test.ts` | +5 (new file) | `resolveMembershipsForUser`: visible to the owning user, hidden when signed out, hidden across an account switch, null-loaded, blank-user refusal |

## Runtime verification status

- Interactive demo (web) behaves as before; Copilot and provider settings return
  the truthful unavailable states; demo data intact.
- No live backend reachable; every claim about hosted behavior is explicitly
  NOT verified.

## Remaining blockers

1. No hosted Supabase project (blocks migration application, RLS execution,
   Vault, Auth verification).
2. Edge Function CORS allowlist needs the production origin before deployment.
3. `GATEWAY_AVAILABLE` must remain `false` until steps 3–9 of the activation
   contract complete.

## Future activation sequence

See `docs/architecture/PHASE_41_AI_ACTIVATION_CONTRACT.md` §3 — hosted project →
migrations → function deployment + secrets → Vault → admin config → credential →
model selection → connection verification → generation verification → security
verification. Not performed in Phase 41.

## Git

- Commit: `feat(phase-41): prepare production activation contracts`
- Branch: `fix/format-money-parser-and-date-semantics`
- Organization membership unavailable → `error` zone (never a guessed
  onboarding/app state); retry path exposed.
- Database query/mutation failure → `ActionResult` with typed codes; RLS silence
  maps to `PERMISSION_DENIED`/`NOT_FOUND` (never a fabricated success).
- AI Gateway/provider unavailable; credentials invalid; model unsupported; rate
  limit; timeout → closed gateway error codes
  (`AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_AUTH_FAILED`,
  `AI_MODEL_NOT_SUPPORTED`, `AI_PROVIDER_RATE_LIMITED`, `TIMEOUT`), truthful UI,
  no misleading "Connected" state (server writes `connection_status` alone).
| staging | unset / `live` | `live` |
| production | anything incl. `demo` | **`live` (demo overwritten)** |

The Phase 41 regression block asserts the matrix at the `resolveClientEnv`
boundary: production + `demo` resolves to `live` with `isDemoData=false`;
production + `live` is accepted; staging + unset is `live`; development
defaults to `demo`. Demo mode changes only where business records come from —
never whether an answer is real — and production can never serve the fixture.

## Supabase client boundary

- `src/lib/supabase.ts` creates one client from `env.supabaseUrl` +
  `env.supabasePublishableKey` (publishable only), PKCE, namespaced storage key,
  `detectSessionInUrl` on web only.
- No service-role key is read in the client, imported by Expo code, or
  referenced under `src/` outside the refusal/deny-list machinery.
- **Localhost is unreachable from production by construction** (new guard).
- Malformed configuration fails at startup via the validated `env` object.
- Auth/session handling uses `scope: 'local'` sign-out, background refresh
  suspend/resume, `getUser()` revalidation, and user-keyed organization
  derivation.