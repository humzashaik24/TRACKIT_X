# Trackit X - Phase 38 Completion Report

## Executive summary

Phase 38 adds a deterministic demo data source so the application can be developed
and demonstrated without a database, while leaving the AI runtime entirely real.

The phase's risk was not "the fixture is wrong". It was that a fixture dataset is
twenty lines away from becoming a fake Copilot: answer a question from a lookup
table and every feature downstream of it is "done", while the credential boundary,
the tenant check and the response normalizer are never once exercised. Nothing
reports the difference.

So the substitution was made at exactly one line — `readCopilotFacts` — and
everything downstream of it is the production code path. A Copilot turn in demo mode
is built by the same `buildDashboardSnapshot`, the same `buildCopilotContext`, and
the same `aiGatewayService.generate` call as a turn against a real organization. If
the provider is unreachable, the turn fails, in demo mode exactly as in production,
with the same error.

**The gateway is still disabled.** `GATEWAY_AVAILABLE = false`. No credential is
configured, no provider has been called, and no answer has been generated. This
document does not claim otherwise. See *Verification status* below.

No SQL was written. No migration, no schema change, no policy.

---

## Verification status - read this first

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `eslint . --max-warnings=0` | **PASS** - zero warnings |
| `npm run verify` (Jest) | **PASS** - 26 suites, **856 tests** (825 before, 31 added) |
| `npx expo export --platform web` | **PASS** |
| Credential-shaped strings in source | **None** (only guard-list variable names and synthetic test fixtures) |
| Credential-shaped strings in the web bundle | **None** - the 2 `service_role` matches are the forbidden-suffix guard list and the gateway's accepted field-name list |
| Real provider call | **NOT VERIFIED** - no credential configured |
| Cross-tenant isolation against a live database | **NOT VERIFIED** - requires the live database, prohibited in this phase |

### What is NOT verified, precisely

- **No Gemini, OpenAI or Anthropic API call has been made.** No provider credential
  exists in this environment. `GATEWAY_AVAILABLE` therefore remains `false`.
- **No connection test has run.** No provider has reported ready.
- **No generated answer has been rendered.** The full request path from
  `aiGatewayService` through the Edge Function, Vault, adapter and normalizer to the
  UI is unexercised end to end.
- **No live organization-isolation matrix.** The RLS assertions live in
  `supabase/tests/rls_isolation.sql` and require a live database, which this phase
  was forbidden to start.
- **The demo dataset has not been seen in a running app.** It is verified by
  25 tests over the real aggregator and context builder, not by a screenshot.

What the tests *do* establish is that every function on the provider path —
selection, failure classification, error normalization, activation gating — behaves
correctly on inputs a real provider will produce.

---

## What was built

### The dataset — `src/domain/demo/dataset.ts`

One organization, five employees (one on probation), three projects, twelve tasks,
seven access holders. Offset-based dates, fixed ids, no clock, no randomness.

The scenarios are chosen so that the questions a delivery workspace actually gets
asked have real answers: 3 overdue tasks, 4 due soon, 2 blocked, one person uniquely
overloaded (Neha Iyer, 3 open and 1 overdue), and one project under strain
(Business Analytics Platform - on hold, critical, 35% done, 5 days to target).

### The service — `src/services/demoDataService.ts`

Projects the rows to the same narrow fact shapes a real `.select()` returns, dropping
`job_title` exactly as the production column list does. `shiftDate` resolves offsets
in UTC midnight, so a date cannot move because of a timezone offset or a DST
boundary.

`readDemoFacts` returns `null` for any organization other than
`DEMO_ORGANIZATION_ID` and errors on a malformed reference date. The distinction
matters: a wrong organization is a transparent fallback to the real table, while an
unusable `asOf` would silently mark every task undated.

### The seam — `src/services/copilotService.ts`

One guarded block at the top of `readCopilotFacts`, and `readAccessHolders` beside it
for the member count. Nothing else in the pipeline changed.

### Configuration — `src/config/envSchema.ts`, `src/config/env.ts`

`EXPO_PUBLIC_DATA_MODE` with unset meaning demo in development and live elsewhere,
production forcing live regardless of the variable, and an unrecognised value
raising a config error rather than falling back.

### UI — `app/(app)/ai.tsx`

A `Demo data` badge beside the gateway badge, and one added sentence in the first-run
explanation. The badge is the phase's one non-negotiable UI requirement: nothing
about a fixture is invalid, so every screen renders it perfectly, and "Neha Iyer is
overloaded" would otherwise read as a finding about a colleague. The badge sits
*beside* the gateway badge rather than replacing it, because demo data and a working
provider are independent facts.

---

## The 31 new tests

`tests/unit/demoData.test.ts` (25) is not twenty-five tests of a fixture. Cases
10-20 build a real `CopilotContextPlan` with nothing stubbed between the dataset and
the plan; cases 21-25 exercise the real provider-selection, failure-normalization
and gating functions.

| Group | Cases | What they establish |
|---|---|---|
| I. The dataset | 1-9 | Determinism, valid employees/projects/tasks, overdue and due-soon present and correctly dated, blocked work, an identifiable overloaded person, progress the real calculator reads |
| II. The real Copilot | 10-20 | Context built by the real snapshot and context builder; attention narrowing 12 tasks to 7; the role gate still withholding figures from a `member`; context minimization; no job title or credential in the serialized request; demo data refused to another tenant; a stale snapshot not producing a fresh answer |
| III. The real provider | 21-25 | Model-to-provider binding; failure-kind classification; a provider error normalized without leaking the key, the internal host or the request id; a malformed response treated as failure; the gateway still disabled |
| Configuration | 6 | Unset is unset; per-environment defaults; explicit choice honoured both ways; production refuses demo; unknown values rejected |

Three assertions worth calling out:

- **Case 15** would fail first if demo mode had been built to "just show everything",
  which is exactly what a fixture invites. A `member` still gets zeros.
- **Case 18** asserts against the *serialized request*, not the source rows, because
  the request is what leaves the device. A demo dataset is the most likely place in a
  codebase for somebody to leave a key while "making the data look realistic".
- **Case 20** matters more in demo mode, not less. A fixture that never changes looks
  permanently fresh, so a broken freshness check would still pass a demo walkthrough
  and fail only against real data.

Two of my initial test expectations were wrong and the code was right, which is worth
recording: `employees.current` counts probation as current by the aggregator's own
definition, and the classifier resolves "right now" to `attention` before `workload`.
The questions were rewritten to isolate the rules they meant to test rather than to
match whatever came back.

---

## What was deliberately not done

- **No mock provider, fake answer, or direct client call to a model.**
- **No autonomous agent, workflow execution, SQL execution or action capability.**
- **No credential in chat, source, Git, `EXPO_PUBLIC_*`, storage, context, logs,
  errors, fixtures or snapshots.**
- **No Docker, no `supabase start`, `db reset` or `functions serve`, no Render.**
- **No SQL.** The RLS suite was not run, because running it requires the live
  database this phase was forbidden to start.
- **No changes to the gateway, the Edge Function, the adapters, the Vault RPCs, the
  registry or the provider protocol.** Phase 38 needed none of them.
- **No registry change.** All twelve model ids were checked against provider
  documentation and are current; editing them would have been churn.

The nine pre-existing untracked files in the working tree were left untouched.

---

## Files

| File | Status |
|---|---|
| `src/domain/demo/dataset.ts` | new |
| `src/services/demoDataService.ts` | new |
| `src/services/copilotService.ts` | modified - one guarded block, one helper |
| `src/config/envSchema.ts` | modified - `DataMode`, `dataMode`, `effectiveDataMode`, `isDemoData` |
| `src/config/env.ts` | modified - reads `EXPO_PUBLIC_DATA_MODE` |
| `app/(app)/ai.tsx` | modified - demo badge and one sentence |
| `.env.example` | modified - documented the variable |
| `tests/unit/demoData.test.ts` | new - 25 tests |
| `tests/unit/env.test.ts` | modified - 6 data-mode tests |
| `docs/architecture/AI_RUNTIME_MODES.md` | new |

`.env` was not modified and is not committed.

---

## To make the runtime real

In order, with the current gateway flag left alone until the last step:

1. Store a provider credential through the Edge Function's Vault RPC. Never in
   `.env`, never with an `EXPO_PUBLIC_` prefix, never in a message.
2. Run `Test Connection` from Settings. A real round trip, reporting ready.
3. Deploy the Edge Function to the configured Supabase project.
4. Ask a question in the app and read the answer. Confirm the citations resolve and
   that the figures match the dashboard.
5. Confirm isolation: a second organization, a real question, no cross-tenant data.
6. Re-run the full suite and the secret scan over source and the built bundle.
7. Only then set `GATEWAY_AVAILABLE = true`, and record the evidence in this file.

---

## Runtime activation verification pass (2026-09-28)

Phase 38 was reviewed against commit `413db1d` with the sole goal of moving the
runtime from "gated and unverified" to "real LLM, verified end to end". The pass
did **not** rebuild, redesign or redeploy anything. `GATEWAY_AVAILABLE` was left
alone. Docker was not used. No SQL was written.

### Status

| Claim | Value |
|---|---|
| **REAL LLM** | **NOT VERIFIED** |
| Provider | **NONE** |
| Model | **NONE** |
| Connection | **NOT VERIFIED** |
| Real Copilot generation | **NOT VERIFIED** |
| UI rendering | **NOT VERIFIED** |
| GATEWAY_AVAILABLE | **false** |
| Live RLS matrix | **NOT VERIFIED** |

### Why the runtime is blocked

Two preconditions from step 1 and 2 of *To make the runtime real* could not be
met in this environment, and section 3 of the activation brief requires stopping
rather than faking a success when a credential is unavailable:

1. **No hosted Supabase environment exists here.** The project has only ever been
   pointed at the local Docker stack: `EXPO_PUBLIC_SUPABASE_URL` in `.env` is
   `http://127.0.0.1:54321` (`supabase/config.toml` `api_url = "http://127.0.0.1"`).
   Every Supabase CLI trace under `~/.supabase/traces` targets
   `127.0.0.1:54322`. No `*.supabase.co` project URL, project ref, linked project
   or service-role key exists on this machine, and Docker (the only way the local
   stack runs) is forbidden in this workflow.
2. **No AI provider credential is available.** No `GEMINI_API_KEY`,
   `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` exists in `.env`, in the ambient
   environment, or in any secure store reachable from here. The Edge Function's
   Vault path (`ai_gateway_read_credential`) is therefore empty by construction,
   and it is not permitted to ask for a key in chat or to invent one.

Without a hosted project the Edge Function cannot be deployed; without a deployed
Edge Function the Vault RPC cannot be reached; and without a stored credential no
adapter can be selected and no provider call can be made. A live request would
have failed at the very first gate (`AI_UNAVAILABLE`, gateway not deployed), so
**no connection was attempted and no answer was generated**. Nothing was
substituted for them.

### What this pass did verify

- `git status` clean against `413db1d`; nine pre-existing untracked files left
  untouched; no history rewritten.
- `npm run verify` — **PASS**, 26 suites, **856 tests**.
- `npx tsc --noEmit` — **PASS**.
- `eslint . --max-warnings=0` — **PASS**, zero warnings.
- `npx expo export --platform web` — **PASS**.
- Secret scan over `src`, `supabase`, `tests` and the built `dist/` bundle —
  **NO SECRET LEAKAGE**. The only credential-shaped strings are synthetic test
  fixtures (`FAKE_GEMINI_KEY`, `FAKE_ANTHROPIC_KEY`, `A_SESSION`) and the two
  known bundle literals: the `service_role_key` field-name allowlist and the
  `forbiddenPublicSuffixes` guard list. The gitignored
  `supabase/.temp/start-secrets/**/docker.env` (local-stack leftovers, untracked)
  holds local JWT fixtures and is not part of source, tests or the bundle.
- `GATEWAY_AVAILABLE` correctly remains `false`; activation was not forced and no
  client-side bypass exists. Failure handling for all eight documented codes
  remains **UNIT TEST VERIFIED** only (see `docs/architecture/AI_GATEWAY_ARCHITECTURE.md`).
- Demo data mode is active in development with no `EXPO_PUBLIC_DATA_MODE` set
  (`effectiveDataMode` → `demo`), so the app is currently configured for
  **demo business data + real (blocked) AI**.

### Explicitly NOT verified (do not claim otherwise)

Live connection test, real Copilot generation, rendered real response, live
organization isolation matrix, and every "LIVE VERIFIED" failure case. These
require the hosted project and a real credential, which do not exist in this
environment.
