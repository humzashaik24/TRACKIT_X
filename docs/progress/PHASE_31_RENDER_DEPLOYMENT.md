# Phase 31 — Actual Render Deployment

## Status

**Deployment configuration: READY. Live deployment: PENDING OWNER ACTION.**

Render auth is not available from this environment (no `render` CLI, no
`RENDER_API_KEY`). Deploying requires the owner's Render account, which needs a
browser sign-in. Per the phase rules nothing is fabricated: the Blueprint,
docs and this branch are pushed to GitHub so the Render Dashboard can create and
deploy the service from them in a few clicks (steps below).

## Objective

Host the actual Trackit X web application on Render as a **Static Site** built
from this repository. The deployed app keeps using the existing Supabase project
as its backend during this first staged-migration milestone:

```
GitHub ──► Render Static Site (trackit-x-web) ──► existing Supabase backend
```

## Render Service

| Field | Value |
| --- | --- |
| Type | Static Site (`type: web`, `runtime: static`) |
| Name | `trackit-x-web` |
| Public URL | `https://trackit-x-web.onrender.com` (assigned by Render) |
| Auto-deploy | Every push to the linked branch |
| SPA fallback | `routes: – rewrite /* → /index.html` |

## GitHub Source

- Repository: `https://github.com/humzashaik24/TRACKIT_X`
- Branch: `fix/format-money-parser-and-date-semantics`
- Blueprint: `render.yaml` (repo root)
- `master` holds only the Phase 1 foundation; the full application requires
  this branch. After merge, switch `branch:` to `master`.

## Build Configuration

- Build command: `npx expo export --platform web`
- Output: `dist/` (index.html + `_expo/static/js/web/*.js` + fonts/icons) —
  fully static
- Publish path: `./dist`
- Node: `NODE_VERSION=22.13.0` (Expo SDK 57 requirement)
- Deps: automatic `npm install` (package-lock.json present)
- Validated locally: export succeeds, `dist/` served over HTTP, SPA fallback
  returns `index.html`, JS bundle and favicon return 200.

## Environment Variables

Set in the Render Dashboard (declared in `render.yaml` with `sync: false`, so
values stay out of Git):

- `EXPO_PUBLIC_APP_ENV=production`
- `EXPO_PUBLIC_SUPABASE_URL` → hosted Supabase URL, e.g. `https://<ref>.supabase.co`
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → anon/publishable key (public by design,
  RLS is the boundary)
- `EXPO_PUBLIC_DEBUG_LOGGING=false`

These are client-safe and inlined into the bundle at build time. Server secrets
(`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DB_PASSWORD`, `JWT_SECRET`,
`GEMINI_API_KEY`) are never used by the static site and must not be committed
or set with an `EXPO_PUBLIC_` prefix.

## Deployment URL

- Assigned on service creation: `https://trackit-x-web.onrender.com`

### Owner action required (exact steps)

1. Go to https://dashboard.render.com and sign in with the TRACKIT_X owner
   account.
2. **New + → Blueprints** (not "Static Site").
3. Connect the GitHub repo `humzashaik24/TRACKIT_X` (Grant Render access if not
   already connected). It will auto-detect `render.yaml`; choose branch
   `fix/format-money-parser-and-date-semantics`.
4. When prompted for the `sync: false` variables, enter:
   - `EXPO_PUBLIC_APP_ENV` = `production`
   - `EXPO_PUBLIC_SUPABASE_URL` = hosted Supabase project URL
   - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = hosted project anon key
   - `EXPO_PUBLIC_DEBUG_LOGGING` = `false`
5. Click **Apply** → Render creates the static site and runs the first build.
6. Confirm the deploy succeeds, then open `https://trackit-x-web.onrender.com`.

Do not use local Docker Supabase values (`127.0.0.1:54321`) here.

## Verification

Local (done this phase):

- `npx expo export --platform web` → `Exported: dist` (1,592 modules, 2 web
  bundles)
- Static server smoke test over `dist/`: `/` 200 · `/sign-in` 200 (SPA fallback,
  serves `index.html`) · entry JS bundle 200 · favicon 200
- Env inlining proven: bundle contains build-time `EXPO_PUBLIC_*` values, so the
  Render build will inline the Dashboard values.

To verify after deploy: open the URL, expect the Trackit X landing screen, JS
bundle in Network tab, Supabase config present, auth screen reachable, no
runtime crash, no server secrets in the page or bundles.

## Known Limitations

- Live deploy is blocked on owner Render access; this environment has no Render
  credentials (see **Owner action required**).
- The app currently requires a reachable Supabase instance; until the hosted
  project's values are set in the Dashboard the first Render build will fail
  with an explicit env error (by design).
- Each `EXPO_PUBLIC_*` change requires a rebuild to take effect.
- `branch:` is pinned to the feature branch; update to `master` after merge.

## Next Migration Phase

Phase 32: Render-web-hosted frontend + new backend/API on Render (still against
Supabase PostgREST/Auth during transition). Supabase itself is not removed until
the final staged-migration phase.

## Git Commit

`57805e3` — `feat(phase-31): deploy Trackit X web to Render`
(render.yaml + both docs; 3 files, +414 lines)

## GitHub Push

**FAILED — blocked by GitHub auth.** `git push origin
fix/format-money-parser-and-date-semantics` returned HTTP 403:
`Permission to humzashaik24/TRACKIT_X.git denied to HUMZASHAK`. No prior
commits were pushed, so nothing was rewritten.

Owner action required to unblock the Render handoff: authenticate git against
GitHub with an account that has write access to `humzashaik24/TRACKIT_X`
(recommend the owner account + a fine-grained/classic PAT with `repo` scope, or
`gh auth login`), then run:

```
git push origin fix/format-money-parser-and-date-semantics
```

Once that push lands, complete the Render Dashboard steps under
**Deployment URL → Owner action required** above.

---
Phase 31 files: `render.yaml` · `docs/architecture/RENDER_DEPLOYMENT.md` ·
`docs/progress/PHASE_31_RENDER_DEPLOYMENT.md`