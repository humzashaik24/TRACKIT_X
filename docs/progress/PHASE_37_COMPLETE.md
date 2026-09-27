# Trackit X - Phase 37 Completion Report

## Executive summary

Phase 37 builds the Copilot: a question box over one workspace's own records,
answering in prose, with citations, and with the ability to do nothing else.

The feature's risk was never "the model might be wrong". It was three specific
things, and the phase is structured around each:

1. **A credential reaching the client.** Solved structurally — the Copilot's module
   graph contains no provider SDK, no Vault import and no environment variable, and
   a test fails the moment one appears. The only network route is
   `aiGatewayService.generate`, which sends a `configId` rather than a key.
2. **One tenant's figures rendered under another tenant's name.** Solved
   structurally — turns carry the organization and role they were asked under, and
   visibility is derived by comparison on every render, so no cleanup has to have
   run first for a stale answer to be unpaintable.
3. **A confident answer about something that is not there.** Solved by
   minimization: the client builds the context, decides what the question is about,
   and states in the payload what it withheld. A project named in a question that
   does not exist produces a `no_matching_project` data gap and no project rollup —
   and the gap is rendered under the answer whether or not the model mentioned it.

**The gateway is not enabled.** `GATEWAY_AVAILABLE = false`, nothing is deployed,
and no question has ever reached a model. No successful call to Gemini, OpenAI or
Anthropic has been observed, and this document does not claim one. The screen says
so to the user rather than offering an input that always refuses.

No SQL was written. No migration, no schema change, no policy.

---

## Verification status - read this first

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **PASS** |
| `npm run lint` (`eslint . --max-warnings=0`) | **PASS** |
| `npm run test` (Jest) | **PASS** - 25 suites, **825 tests** |
| `copilotData.test.ts` | **PASS** - 68 tests |
| `copilotHook.test.tsx` | **PASS** - 12 tests |
| `copilotSecurity.test.ts` | **PASS** - 27 tests |
| `npx expo export --platform web` | **PASS** - 2 web bundles emitted |
| Bundle scanned for credential shapes | **PASS** - 0 hits |
| `supabase/tests/rls_isolation.sql` | **NOT RE-RUN** - no SQL changed in this phase |
| **Live provider call** | **NOT VERIFIED** - `GATEWAY_AVAILABLE = false`, nothing deployed |

The bundle scan covered `sk-`, `sk-ant-`, `AIza`, `ghp_`, `gho_`, JWT-shaped
strings, `SUPABASE_SERVICE_ROLE_KEY`, `vault:` and `trackitx:ai:`. Two matches on
`service_role` are the Phase 35/36 *forbidden-column name list* that rejects a
payload trying to set such a field — the string, not a value.

The last row is the one that matters. Every layer described here is tested and the
end-to-end path is unexercised, and those are different claims.

---

## What was implemented

### Domain (`src/domain/ai/`, no Supabase or React imports)

**`copilot.ts`** — the contract and the trust boundary. Eight intents and their
precedence; JSON extraction tolerant of prose and code fences; bounded
normalization; `referenceIndex`; `normalizeCopilotOutput`, which rebuilds the
response from named fields so an `actions` array has nowhere to land, resolves
citations against the set the client actually sent, and takes the citation *label*
from the client so a model cannot relabel one. `CopilotRecommendation` is
`{ text }` and the response type has no actionable field.

**`copilotInstructions.ts`** — `COPILOT_BEHAVIOUR_RULES` and
`COPILOT_OUTPUT_CONTRACT`, joined into the one protected system turn by
`gatewayPrompt.ts`. They are constants, not a request parameter: a
`systemInstructions` field on `GenerateRequestBody` would hand every Copilot user
the ability to rewrite the rules that keep business data inside the organization.
The server still re-checks the exact string with `systemInstructionsAreIntact`.

### Context (`src/features/copilot/contextBuilder.ts`)

Pure and deterministic. No I/O, no clock — it reads `snapshot.asOf` rather than
`Date.now()`, so a test is not clock-bound and an answer cannot disagree with the
dashboard about what day it is.

- **Resolution before classification.** Named records are stripped from the
  question first, so "How is Alpha doing?" classifies by *how is … doing* rather
  than by a word in the project's name.
- **Named subjects narrow; category questions include.** "What is happening with
  Alpha" sends one project and its tasks. "What needs my attention" sends the
  bounded attention set.
- **Workload is withheld below manager** by reading `snapshot.workload === null` —
  the same gate the dashboard uses, not a second opinion about it. A member asking
  about workload gets a `workload_not_visible_to_your_role` gap and no per-person
  numbers.
- **Bounds.** 25 projects / tasks / employees, titles at 120 characters, project
  names at 80, employee names at 60. The overview intent narrows to ten and five.

### Service (`src/services/copilotService.ts`)

Four reads, all `.eq('organization_id', …)`, issued together; all-or-nothing, so a
partial context can never produce a partial answer. `buildDashboardSnapshot` is the
only source of aggregates — the same function the dashboard screen calls, which is
why "four overdue" cannot disagree with the dashboard's "4". The refusal order is
cheapest-and-most-specific first, and a disabled default is **not** replaced by
another provider: the fallback would spend a different account's money.

`CopilotTaskFact extends DashboardTaskFact` and the task column list is composed
from the dashboard's, so the Copilot cannot start reading a column the dashboard
deliberately excluded.

### UI

`app/(app)/ai.tsx`, with `app/(app)/copilot.tsx` as a re-export so the URL can name
the feature. `CopilotTurnView` renders a turn — the refusal case included, because
"AI provider is not configured" belongs under the question that caused it. It shows
the data gaps, whether the reply was structured, and when the question was asked.

`CopilotComposer` holds the text and calls `onAsk`. It performs no read and builds
no context; `askCopilot` owns those rules, including the refusal to send an empty
or over-long question.

While the gateway is unavailable the screen states it above the transcript and the
composer is replaced by that sentence. A user who learns the state from the screen
does not spend a question learning it, and "AI is not working" does not leave them
believing their data is at fault.

### Navigation

`/ai` is `ready: true`. It was removed from the dashboard's "Not built yet" cards,
because a card reading "AI Copilot — a later phase" directly above a working
Copilot in the bottom bar is exactly the contradiction that section exists to
prevent. `/copilot` is deliberately **absent** from `destinations.ts` — a second
entry would list the same destination twice in the sidebar, and that table is read
by both the sidebar and the bottom bar. The honest cost: no tab highlights on
`/copilot`, which is correct for a route with no menu entry.

---

## Security rules enforced

| Rule | Enforced by |
|---|---|
| No credential reachable from the client | Module graph; source-scanned in `copilotSecurity.test.ts` §2 |
| One network route | `aiGatewayService.generate` only; no `fetch` in the service |
| Every read tenant-scoped | `.eq('organization_id', …)` on all four reads; asserted |
| Context tenant-stamped | `businessContext.organizationId` at the top level, where `assertContextAgreesWithConfig` checks it |
| System prompt untakeable | Fixed system text; the question is quoted, never concatenated into rules |
| The model cannot act | `{ text }` recommendations; no actionable response field; the answer card renders no `Button` and opens no URL |
| The model cannot invent a citation | References resolved against the sent set; labels from the client |
| A stale answer cannot be painted | Organization and role compared on every render; answers patched by turn id |
| Workload not shown below manager | `snapshot.workload === null` — the dashboard's own gate |

---

## Corrections made to earlier work

- **`dashboardService` column lists were private.** They are now exported, and
  `copilotService` composes its task list from `DASHBOARD_TASK_COLUMNS` rather than
  restating it. Restating would have created a second place to forget an email
  column — the failure the narrow list exists to prevent.
- **The dashboard's "Not built yet" list contradicted the sidebar.** `/ai` was
  listed as a later phase while a working Copilot sat in the bottom bar. Removed.
- **`appMap.test.ts` named "the four finished screens"** while seven were ready.
  Reworded to be count-free, so the assertion below it is the only place the number
  lives.
- **The classifier matched on the whole question**, so a project whose name happened
  to contain one of the intent keywords could decide the intent — the record being
  asked *about* could choose the question being asked. Resolution now precedes
  classification, and the subject's own words are removed first.
- **A successful parse with an invalid summary fell back to raw JSON**, rendering a
  wall of braces under the question. The raw fallback is now confined to a parse
  that actually failed.
- **`destinations.ts` claimed "Phase 1 ships two working destinations"** while six
  were ready. Reworded, since the flag's whole meaning is honesty.

---

## Deferred / not implemented

- **A live provider call.** Blocked on deploying the Edge Function and holding a
  credential. Not deferred by choice.
- **Navigable citations.** The ids are real and correct; wiring them to
  `/projects/[id]` and `/tasks/[id]` is the obvious next step. Left unwired rather
  than half-wired, because a citation that goes nowhere is worse than one that is
  plainly a label.
- **Conversation persistence.** Deliberate, not deferred. See the architecture
  document, §7.
- **Actions.** Not deferred — declined. `CopilotRecommendation` has no `action`
  field, and adding one plus an execution path is a security change to be reviewed
  as one.
- **Provider-side streaming, tool use, and a model-written query.** All declined;
  each would require the client to execute something.

## Known limitations

1. No live provider call has been made (above, twice, on purpose).
2. Citations are not navigable.
3. One question in flight, enforced. Two concurrent questions would race on the
   same snapshot and imply a single reading of the business that never existed.
4. Eight intents; anything else falls back to `general_business`, which sends the
   dashboard and bounded rollups. Safe, not good — and where the next intents go.
5. First-name questions do not resolve. In a workspace with two Sams, picking one
   silently is worse than asking.
6. The RLS suite was not re-run, because no SQL changed. That is not a claim about
   this phase's code.

---

## Files changed

**New**

```
src/domain/ai/copilot.ts                      contract, classifier, trust boundary
src/domain/ai/copilotInstructions.ts          protected behaviour and output rules
src/services/copilotService.ts                reads, context, gateway call, normalization
src/features/copilot/contextBuilder.ts        minimization, resolution, gaps, bounds
src/features/copilot/useCopilot.ts            in-memory transcript, tenant-safe rendering
src/features/copilot/CopilotTurnView.tsx      one turn, including the refusal
src/features/copilot/CopilotComposer.tsx      the question input
app/(app)/copilot.tsx                         alias route
tests/unit/copilotData.test.ts                68 tests
tests/unit/copilotHook.test.tsx               12 tests
tests/unit/copilotSecurity.test.ts            27 tests
docs/architecture/COPILOT_ARCHITECTURE.md
docs/progress/PHASE_37_COMPLETE.md
```

**Modified**

```
src/services/dashboardService.ts     column lists exported; renamed to DASHBOARD_*
src/domain/ai/gatewayPrompt.ts       two constants joined into the protected turn
app/(app)/ai.tsx                     placeholder -> the real screen
app/(app)/dashboard.tsx              /ai removed from "Not built yet"
src/navigation/destinations.ts       /ai ready: true
tests/unit/appMap.test.ts            /ai added to READY_PATHS
```

**No SQL, no migrations, no schema or policy changes.**
