# Phase 41 — Configuration Contract

**Trackit X — production configuration boundaries, environment separation, and
secret containment. Statically verified documentation; no activation claimed.**

## 1. Purpose

This document is the single source of truth for every environment variable the
Trackit X application, its build, and its future backend consume. It defines:

- what each variable is for,
- which environment(s) it is valid in,
- whether it is safe to ship in a client bundle,
- whether it must be present,
- what a safe value looks like (example *format*, never a real value), and
- where in the code it is consumed.

Two rules govern the whole table and are enforced in code, not just documented:

1. Anything prefixed `EXPO_PUBLIC_` is inlined into the JavaScript bundle that
   ships to phones and browsers. It is **public** the moment the app is
   distributed.
2. The only consumer of `process.env` in the client is `src/config/env.ts`.
   It reads exactly five literal names, validates them against
   `src/config/envSchema.ts`, and exposes the validated, immutable `env` object
   to the rest of the application. A build whose ambient environment contains a
   server-only credential under an `EXPO_PUBLIC_` prefix is refused at startup.

## 2. Classification legend

| Class | Meaning |
|---|---|
| `CLIENT-SAFE` | Compiled into the bundle. Not a secret. An attacker who reads the bundle learns nothing they could not learn by signing up. |
| `SERVER-ONLY` | Must never enter the client bundle. Consumed by server-side runtimes — the AI Gateway Edge Function, database tooling, or Vault. Lives in the deployment's secret store, never in `EXPO_PUBLIC_*`. |
| `BUILD-TIME` | Read by the Expo build/Babel transform and baked into the bundle. The "bundle exposure" boundary. |
| `OPTIONAL` | Absence is meaningful and handled. |
| `REQUIRED` | Absence is a configuration error that must fail loudly. |
| `DEVELOPMENT-ONLY` | Legitimate only in `development`. |
| `PRODUCTION-ONLY` | Required only once a real hosted backend is activated. |

## 3. The variables

### 3.1 Client-safe (bundle-inlined)

| Variable | Purpose | Environment | Exposure | A/O | Safe format (example) | Consumed by |
|---|---|---|---|---|---|---|
| `EXPO_PUBLIC_APP_ENV` | Which environment this build is. Accepts exactly `development` \| `staging` \| `production`. | all | CLIENT-SAFE, BUILD-TIME | O (defaults to `development`; production deploys should set it explicitly) | `production` | `src/config/env.ts` → `envSchema.ts` → `isProduction`/`isStaging`/`isDevelopment` flags used across the UI |
| `EXPO_PUBLIC_DATA_MODE` | Data-source preference: `demo` (deterministic Phase 38 fixture) or `live` (Postgres). Unset means `demo` in development and `live` everywhere else. Production **ignores** this variable — `effectiveDataMode` overwrites any `demo` to `live`. | all | CLIENT-SAFE, BUILD-TIME | O (unset is meaningful) | `demo`, `live` | `envSchema.ts` → `effectiveDataMode` → `demoDataService.ts` |
| `EXPO_PUBLIC_SUPABASE_URL` | The Supabase project URL (scheme + host + port). **Production builds must not point at a loopback host** — `resolveClientEnv` refuses `localhost`/`127.0.0.1`/`0.0.0.0`/`::1` and `*.localhost` in production (Phase 41 guard). | all | CLIENT-SAFE, BUILD-TIME | R | `https://<project-ref>.supabase.co` | `src/config/env.ts` → `src/lib/supabase.ts` (client creation) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable (anon) key. Carries no privilege on its own — every request is still filtered by Row Level Security. | all | CLIENT-SAFE, BUILD-TIME | R | `sb_publishable_` + base64url (≥ 20 chars) | `src/lib/supabase.ts` |
| `EXPO_PUBLIC_DEBUG_LOGGING` | Enables verbose client logging. Exact strings `true`/`false` only. Should be `false` in production. | all | CLIENT-SAFE, BUILD-TIME | O (default `false`) | `false` | `env.ts` → logger configuration |

### 3.2 Server-only (never client-prefixed)

| Variable | Purpose | Environment | Exposure | A/O | Safe format (example) | Consumed by |
|---|---|---|---|---|---|---|
## 4. Deny-list (`forbiddenPublicSuffixes`)

`envSchema.ts` scans the ambient environment for any key that both begins with
`EXPO_PUBLIC_` and ends with a forbidden suffix, and refuses to start:

```
SERVICE_ROLE_KEY, SERVICE_KEY, SECRET_KEY, SECRET,
GEMINI_API_KEY, GOOGLE_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, API_KEY,
DATABASE_URL, DB_PASSWORD, PASSWORD, PRIVATE_KEY, ACCESS_TOKEN
```

> Phase 41 change: the list previously named Gemini-era suffixes only
> (`GEMINI_API_KEY`, `GOOGLE_API_KEY`), so an `EXPO_PUBLIC_OPENAI_API_KEY` or
> `EXPO_PUBLIC_ANTHROPIC_API_KEY` would have shipped. `OPENAI_API_KEY`,
> `ANTHROPIC_API_KEY` and the generic `API_KEY` suffix were added. Any
> `EXPO_PUBLIC_*API_KEY` is a credential whatever provider issues it.
> Regression: `tests/unit/env.test.ts` → "Phase 41 — cluster boundary and
> data-mode regressions".

The denial is by **name only**; the value is never echoed. If a name is
rejected, the fix is to remove the `EXPO_PUBLIC_` prefix and set the value as a
server secret.

## 5. Environment separation (data mode)

`effectiveDataMode(appEnv, requested)` is the single decision point:

| appEnv | `EXPO_PUBLIC_DATA_MODE` | Result |
|---|---|---|
| development | unset | `demo` |
| development | `live` | `live` |
| development | `demo` | `demo` |
| staging | unset | `live` |
| staging | `demo` | `demo` (explicit requirement to use the fixture) |
| staging | `live` | `live` |
| production | anything (incl. `demo`) | **`live` — `demo` is overwritten** |

The table is enforced by `envSchema.ts`'s `effectiveDataMode` and asserted at the
`resolveClientEnv` boundary in `tests/unit/env.test.ts`. There is no fallback
path that turns demo data on in production; the failure direction is always
toward the real database, which is the safe one.

## 6. Production activation prerequisites (extract)

For the full sequence see `PHASE_41_AI_ACTIVATION_CONTRACT.md`. The
configuration-relevant prerequisites are:

1. A hosted Supabase project URL and publishable key, injected as
   `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. `EXPO_PUBLIC_APP_ENV=production` and `EXPO_PUBLIC_DEBUG_LOGGING=false`.
3. `EXPO_PUBLIC_DATA_MODE` left unset or set to `live` (never `demo`).
4. Service-role key and URL set as **Edge Function secrets**, not
   `EXPO_PUBLIC_*`.
5. The Edge Function CORS allowlist (`ALLOWED_ORIGINS` in
   `supabase/functions/ai-gateway/http.ts`) extended with the production web
   origin before the gateway is deployed.

## 7. What was deliberately NOT changed

- No Render deployment, no Docker, no hosted Supabase project, no provider key,
  no real LLM call.
- `GATEWAY_AVAILABLE` remains `false`.
- The local `.env` (git-ignored) holds only the four client-safe variables;
  server-only values are absent from it and from this document.
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key. Bypasses RLS. Root-level credential. | Server runtime | SERVER-ONLY | R (for a deployed gateway) | opaque JWT secret | `supabase/functions/ai-gateway/index.ts` via `Deno.env.get`; refused for the deploy if it starts with `sb_publishable_` |
| `SUPABASE_URL` | Supabase URL as seen from inside an Edge Function. | Server runtime | SERVER-ONLY | R (for a deployed gateway) | `https://<project-ref>.supabase.co` | `supabase/functions/ai-gateway/index.ts` |
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS` | Documented in `.env.example` for the earlier server-side provider flow. **Not read by the current client and not read by the current `ai-gateway` function** — the current gateway reads the provider credential from Vault, not from the environment. Documented here as legacy/tooling references; they are SERVER-ONLY if ever reintroduced. | Server runtime (historical) | SERVER-ONLY | O (no current consumer) | — | none in the current tree |

### 3.3 Deployment/build tooling

| Variable | Purpose | Environment | Exposure | A/O | Safe format | Consumed by |
|---|---|---|---|---|---|---|
| `NODE_VERSION` | Node runtime for the Render build environment. | Render blueprint only | BUILD-TIME | R | `22.13.0` | `render.yaml` |
| `EXPO_PUBLIC_*` (four above) | Injected externally into the Render build from the Dashboard, never committed. | Render | CLIENT-SAFE | R in production | as above | `render.yaml` `envVars` with `sync: false` |

### 3.4 Provider credentials and Vault

Provider credentials are **not environment variables**. They are held in
Supabase Vault, referenced by an opaque handle in
`ai_provider_configs.secret_reference`, and read only by the AI Gateway through
server-side RPCs. See `docs/architecture/PHASE_41_AI_ACTIVATION_CONTRACT.md`.