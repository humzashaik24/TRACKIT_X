# Trackit X — Render Deployment

## Goal

Host the Trackit X **web application** on Render and serve the real Expo web
build from the `dist/` directory produced by `npx expo export --platform web`.

During this transition phase the deployed web app continues to use the existing
Supabase project as its backend. Removing Supabase from production is a separate,
later phase.

```
GitHub                                                     Existing
humzashaik24/TRACKIT_X                                     backend
      │
      ▼
  Render                                                   Supabase
  Static Site (trackit-x-web)                              (unchanged)
      │  EXPO_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY
      ▼                                           
  Trackit X Web (Expo Router SPA) ────────────────────────► Supabase Auth + PostgREST
```

## Render Service

| Field | Value |
| --- | --- |
| Service type | **Static Site** (`type: web` + `runtime: static`) |
| Service name | `trackit-x-web` |
| Plan | Static sites have no compute plan (CDN-hosted) |
| Region | Not applicable (global CDN) |
| Public URL | `https://trackit-x-web.onrender.com` |
| Re-deploy | On every push to the linked branch (`autoDeployTrigger: commit`) |

Why a Static Site and not a web service: the Expo web export is fully static
(one `index.html`, Metro JS bundles, fonts, icons). There is no server-side
runtime to keep alive, so the global CDN Static Site is the correct and cheapest
fit.

## GitHub Source

- Repository: https://github.com/humzashaik24/TRACKIT_X
- Blueprint file: `render.yaml` (repository root)
- Linked branch: `fix/format-money-parser-and-date-semantics`
  - The full Trackit X application (all phases through 31) currently lives on
    this branch. `master` only contains the Phase 1 foundation.
  - After the branch is merged, update `branch:` in `render.yaml` to `master`.

## Build Configuration

Defined in `render.yaml` (`services[0]`):

| Setting | Value |
| --- | --- |
| `runtime` | `static` |
| `buildCommand` | `npx expo export --platform web` |
| `staticPublishPath` | `./dist` |
| `NODE_VERSION` | `22.13.0` (Expo SDK 57 requires Node ≥ 22.13.x) |
| Dependency install | Automatic (Render detects `package-lock.json` → `npm install`) |

Render runs the dependency install first, then the build command. The export
inlines the `EXPO_PUBLIC_*` values into the JavaScript bundle at build time, so
the environment variables must be present **before** the build runs.

### Output directory

`npx expo export --platform web` writes to `dist/`:

```
dist/
├── index.html                     # SPA shell, <div id="root">
├── favicon.ico
├── metadata.json
├── _expo/static/js/web/*.js        # Metro bundles (entry + lazy chunks)
└── assets/…                        # Sora + icon fonts, router assets
```

### Routing / SPA behavior

`app.json` sets `web.output: "single"`, so the export produces one HTML shell.
All routes (`/sign-in`, `/onboarding`, `/dashboard`, …) are client-side. To keep
deep links and hard refreshes working the Blueprint adds an SPA rewrite:

```yaml
routes:
  - type: rewrite
    source: /*
    destination: /index.html
```

Render skips the rule for any path that has a physical file (JS bundles,
`assets/*`, favicon), so real assets are never clobbered.

### Immutable asset caching

```yaml
headers:
  - path: /_expo/static/*
    name: Cache-Control
    value: public, max-age=31536000, immutable
```

Hashed Metro bundles are immutable; this avoids re-fetching them.

## Environment Variables

### Client-safe (set in the Render Dashboard, `sync: false`)

These values are compiled into the public JS bundle by design. They must be set
in the Render Dashboard for the service **before** the first successful build,
because the app refuses to start without them (`envSchema.ts`).

| Variable | Example / notes |
| --- | --- |
| `EXPO_PUBLIC_APP_ENV` | `production` |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` (the hosted project URL, not `127.0.0.1`) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the anon/publishable key. Public by design; RLS is the security boundary |
| `EXPO_PUBLIC_DEBUG_LOGGING` | `false` |

Setting them via `sync: false` means the values are **not** read from or
published to Git — they are entered once in the Render Dashboard and preserved on
every Blueprint sync.

### Build-only (safe to commit)

| Variable | Value | Reason |
| --- | --- | --- |
| `NODE_VERSION` | `22.13.0` | selects the Node runtime for Expo SDK 57 builds; not a secret |

### Never set these anywhere in Render for the web static site

The following are server-side secrets and must **never** be configured as
`EXPO_PUBLIC_*` variables, added to `render.yaml`, or pasted into this
repository:

- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` / `DB_PASSWORD`
- `JWT_SECRET`
- `GEMINI_API_KEY`

The static site is public CDN content; it has no server to safely consume them,
and the app's env guard refuses to build if any `EXPO_PUBLIC_*` name exposes a
server secret (`findLeakedSecrets` in `src/config/envSchema.ts`).

## Supabase Dependency During Transition

This is intentional and part of the staged migration plan:

1. **Phase 31 (this phase)** — Render hosts the frontend; Supabase remains the
   backend. Auth, PostgREST, RLS, database, storage, realtime and edge functions
   are untouched.
2. **Later phases** — migrate backend/API, PostgreSQL, auth and the remaining
   Supabase features one at a time, then remove Supabase from production.

Until those later phases run, the `EXPO_PUBLIC_SUPABASE_URL` must point at the
**hosted** Supabase project (not the local Docker instance at `127.0.0.1:54321`).

## Deployment URL

- Service: `https://trackit-x-web.onrender.com`

> **Status:** readiness confirmed locally; the live URL is created in the Render
> Dashboard by the owner (see `docs/progress/PHASE_31_RENDER_DEPLOYMENT.md`).

## Verification Results

### Local build (equivalent to the Render build)

```
npx expo export --platform web
# → Web Bundled … (1592 modules, 2 web bundles)
# → Exported: dist
```

### Static serving smoke test (local HTTP server over `dist/`)

| Request | Result |
| --- | --- |
| `GET /` | 200, contains `Trackit X` + loads `entry-*.js` bundle |
| `GET /sign-in` (SPA fallback) | 200, serves `index.html` |
| `GET /_expo/static/js/web/entry-*.js` | 200 |
| `GET /favicon.ico` | 200 |

### Environment inlining

The built bundle contains the build-time env values inlined (e.g.
`supabaseUrl:"http://127.0.0.1:54321"` when built against local Supabase). On
Render the same pipeline inlines the Dashboard-configured `EXPO_PUBLIC_*`
values at deploy time.

### Runtime verification (once live)

To confirm the live deploy: load the Render URL, check the landing page renders,
the network tab loads the `_expo/static/js/web/*.js` bundle, the Supabase URL is
config, the auth screen loads, and no console error occurs. If anything is
unreachable, confirm `EXPO_PUBLIC_SUPABASE_URL` points at the hosted Supabase
project and that the project allows browser requests.

## Files

- `render.yaml` — Render Blueprint (one static site service)
- `docs/progress/PHASE_31_RENDER_DEPLOYMENT.md` — phase report