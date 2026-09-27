# Trackit X - Copilot Architecture

How a question becomes an answer, and what stops an answer from being something
else.

---

## 1. Scope, and the honest limit of this phase

This document describes the Trackit X Copilot: a question box over one workspace's
own records, answering in prose, with citations, and with the ability to do nothing
else.

**The gateway is not enabled.** `GATEWAY_AVAILABLE = false` in
`src/domain/ai/gateway.ts`. The Edge Function that holds the provider credential
is not deployed in this environment, so no question has ever reached a model and no
successful call to Gemini, OpenAI or Anthropic has been observed. Every layer
described here is built and tested; the end-to-end path is deliberately
unexercised, and no document in this repository claims otherwise.

That is a different situation from Phase 36, whose Edge Function was run against a
local Edge runtime. The distinction is kept explicit rather than blurred, because
"the tests pass" and "the feature works" are different claims and only one of them
is currently true.

---

## 2. The path of a question

```
question (text)
  │
  ├─ trim, reject empty, reject > 1 000 chars          copilotService.ts
  │
  ├─ GATEWAY_AVAILABLE?  no → AI_UNAVAILABLE            domain/ai/gateway.ts
  ├─ listProviderConfigs(organizationId)                 services/aiProviderService.ts
  ├─ filter to this organization, again                  belt and braces
  ├─ resolveDefaultProvider — never promote a second    domain/ai/configuration.ts
  ├─ assertGatewayEligible — enabled, credential stored
  │
  ├─ readCopilotFacts(organizationId)                   three reads, Promise.all
  │    employees · projects · tasks                       all .eq('organization_id', id)
  ├─ countOrganizationMembers(organizationId)            headcount only
  │
  ├─ buildDashboardSnapshot(facts, …)                    features/dashboard/metrics.ts
  │    the same function the dashboard screen calls
  │
  ├─ buildCopilotContext({ question, snapshot, … })      features/copilot/contextBuilder.ts
  │    intent · subject resolution · minimization · gaps · allowed references
  │
  ├─ generateThroughGateway({ configId, userInput, businessContext })
  │    services/aiGatewayService.ts — the only network route in the client
  │
  ├─ normalizeCopilotOutput(output, plan.allowedReferences)   domain/ai/copilot.ts
  │    the trust boundary for the model's text
  │
  └─ CopilotResponse → one in-memory turn                features/copilot/useCopilot.ts
```

Four properties of that diagram are the whole design:

1. **The client cannot write a query.** There is no query language, no tool
   interface and no field the model can use to request one. The set of facts a
   question can be answered from is fixed at the point the request is built.
2. **The client cannot hold a credential.** No provider SDK, no Vault, no
   environment variable, in any Copilot file — asserted as a source scan, not a
   convention.
3. **The tenant is named twice, and both are checked server-side.** Once in the
   read (`organization_id`), once at the top level of the context, where Phase 36's
   `assertContextAgreesWithConfig` compares it against the configuration the server
   authorized. That check *passes when the field is absent*, so omitting it would
   get the check for free and defeat it.
4. **The model describes the context; it does not supply it.** Every figure in an
   answer was computed by `buildDashboardSnapshot` from rows that exist.

---

## 3. Security invariants

| Invariant | Enforced by | Also checked by |
|---|---|---|
| No credential is reachable from the client | Module graph — no SDK, no Vault import, no `process.env` | `copilotSecurity.test.ts` §2, as a source scan |
| One network route | `aiGatewayService.generate` is the only call | `copilotSecurity.test.ts` §2 |
| Every read is tenant-scoped | `.eq('organization_id', organizationId)` on all four reads | `copilotSecurity.test.ts` §3, asserts the filters |
| The context is tenant-stamped | `businessContext.organizationId` at the top level | `copilotSecurity.test.ts` §3 |
| The system prompt cannot be taken over | `buildPrompt` returns fixed system text; the question is quoted, never concatenated into rules | `copilotSecurity.test.ts` §1 |
| The model cannot cause an action | `CopilotRecommendation` is `{ text }`; the response type has no actionable field; the answer card renders no control | `copilotSecurity.test.ts` §5 |
| The model cannot cite what was not sent | References resolved against `plan.allowedReferences`; labels taken from the client | `copilotSecurity.test.ts` §6 |
| An answer cannot outlive its tenant | Turns carry `organizationId` and `role`; visibility is derived by comparison on every render | `copilotHook.test.tsx` |

The last two are worth dwelling on, because they are the ones a future contributor
is most likely to undo by accident. A citation is the feature's credibility
mechanism: it is what makes "four tasks are overdue" checkable. If the model can
name an entity the client never sent, the citation becomes decoration, and a reader
who trusts it is trusting the model rather than the query. Similarly, a
recommendation with an `action` field is one small type change away from a button
that executes something the model wrote.

---

## 4. The context contract

`CopilotBusinessContext` in `src/domain/ai/copilotContract.ts` is authoritative.
`copilotService` fills it and nothing else, and the wire payload is exactly:

```
organizationId   requestedAt   viewerRole   intent   intentLabel
scope            dataGaps      dashboard    employees   projects   tasks
```

**What travels in full.** The `DashboardSnapshot` — about forty aggregate numbers
with no personal data in them. It is what lets an answer put one overdue task in
the context of four, and it is the same object the dashboard renders, so "four
overdue" cannot disagree with the dashboard's "4".

**What is bounded.** Everything identifying. `COPILOT_CONTEXT_LIMITS` caps
projects, tasks and employees at 25 each, truncates task titles at 120 characters,
project names at 80 and employee names at 60. The overview intent narrows further —
ten projects, ten tasks, five people — and a named subject narrows hardest of all:
"What is happening with Alpha" sends one project and its tasks, not the directory.

**What is absent, always.** Credentials and configuration secrets. Employee
compensation or any other column the dashboard deliberately does not select. Raw
rows of any kind: every value is a field of a rollup this file builds.

**Ceiling.** The server refuses a context over `GATEWAY_LIMITS.maxBusinessContextChars`
(64 000). A build-time test seeds an organization at the builder's own caps and
asserts the serialized payload stays under it, so raising a cap without re-checking
the ceiling fails in CI rather than as a user who cannot ask a question.

### Data gaps

The gaps are computed by the client, before the request is sent, and returned on the
response. They are never model-supplied — a model asked to explain its own gaps will
produce a sentence, and the honest source for what was withheld is the code that
withheld it.

| Gap | Meaning |
|---|---|
| `no_matching_project` | A project was named and no such record exists in this workspace |
| `no_matching_employee` | Same, for a person |
| `workload_not_visible_to_your_role` | The viewer is below manager, so no per-person counts were sent |
| `no_business_records` | The workspace has no employees, projects or tasks at all |

There is deliberately **no** `no_matching_task`. Task words in a question
("what needs my attention", "how are tasks going") are category questions rather
than references to a named task, so a missing-task gap is unreachable — and an
unreachable gap is a lie in the type.

The gaps are rendered under the answer whether or not the model mentioned them.
This is the difference between "I could not find that project" and a confident
description of a project that is not there.

---

## 5. Intent and subject resolution

`classifyCopilotIntent` maps a question to one of eight intents. Resolution is in
this order, and the order is the design:

1. **Strip resolved record names.** A project, person or task named in the question
   is removed before classification, so "How is Alpha doing?" classifies by *how is
   … doing* rather than by whatever word the project's name happens to contain.
2. **Classify what remains.** Bare name left over resolves to that record's kind, so
   a question that is only a name still produces the right kind of answer.
3. **Apply the rule table**, in a fixed precedence: attention, workload,
   employee work, progress, task status, project status, overview.

Subject matching is normalized, full-name only, longest match wins. A first name
alone does not resolve: "What about Sam?" in a workspace with two Sams must not
pick one silently, and a partial name that matches several people should produce a
question about the ambiguity rather than an answer about the wrong person.

Named subjects narrow the context rather than filtering it. "What is Priya carrying?"
sends that person's rollup. It does not send everyone else's, because a question
about one person is not improved by six unrelated rows.

---

## 6. Output normalization — the trust boundary

`normalizeCopilotOutput` is where model text becomes something the app renders.
It does four things:

1. **Extracts** the first complete JSON object from the output, tolerating
   surrounding prose and code fences.
2. **Bounds** every field — lengths, counts, array sizes — against
   `COPILOT_OUTPUT_LIMITS`. A model that returns ten thousand key points is
   truncated, not rendered.
3. **Rebuilds the response from named fields.** `actions`, `command`, `tool`,
   `execute`, `approve` and anything else the model invented have nowhere to land,
   because the object is assembled field by field rather than spread.
4. **Resolves references** against `plan.allowedReferences`. An unknown entity id is
   dropped, and a known one takes its **label from the client** — a model-supplied
   label is discarded, so a citation cannot be relabelled to something it is not.

If the provider returns prose rather than the agreed JSON, the summary is that
prose and `structured` is `false`. The screen says so. Presenting an unstructured
reply as an analysis would be a claim about its provenance that is not true.

---

## 7. The transcript

There is no conversation table, no history to page through, and nothing stored on
the server. An AI answer is a reading of the business as it was at a moment, and
persisting one invites it to be quoted later as though it were a record. A
conversation that disappears when the screen closes is the honest version.

The hook models the transcript as **turns** — a question and its outcome, including
having no answer — because the refusal is the state worth designing for.
"AI provider is not configured for this organization" belongs under the question
that caused it.

### Organization switching

The failure this is built against: organization A's business rendered under
organization B's name. Nothing about a late response reveals that it is wrong — it
arrives perfectly well-formed, with A's projects and A's people's names, and there
is no error in it to notice. So the protection is structural:

- Every turn carries the `organizationId` and `role` it was asked under.
- Visibility is **derived by comparison on every render**, so the render that shows
  B's header cannot show A's transcript. No cleanup has to have run first for this
  to be true.
- State is also reset during render when the organization changes, which stops A's
  answers sitting in memory. That is tidiness; the comparison is the guarantee.
- A response is patched into its turn **by id**. An answer resolving after a switch
  or a clear finds no turn and does nothing.

There is no `AbortController`. By the time the user switches workspaces the call has
been made and paid for; cancelling the fetch would only stop the response being
*read*. What must be prevented is the answer being *shown*, and the comparison above
prevents that by construction.

---

## 8. Refusals, in order

Every early return is a refusal with a code, and there is no path that produces a
`CopilotResponse` without a successful provider call behind it. If a response
exists, a model read real context. That is the property the UI depends on.

| # | Condition | Code | User sees |
|---|---|---|---|
| 1 | Question empty or > 1 000 chars | `AI_REQUEST_INVALID` | "Type a question first." / "That question is too long…" |
| 2 | Gateway not deployed | `AI_UNAVAILABLE` | "The AI assistant is not available in this build yet. Your business data is unaffected." |
| 3 | No configuration for this organization | `AI_PROVIDER_NOT_CONFIGURED` | "AI provider is not configured for this organization." |
| 4 | Marked default is disabled | `AI_PROVIDER_DISABLED` | "…is switched off. Ask an administrator to turn it on." |
| 5 | No stored credential | `AI_ACTION_NOT_PERMITTED` | "That AI provider has no stored credential yet." |
| 6 | Any fact read failed | `NETWORK_UNAVAILABLE` | The read's own message |
| 7 | Gateway failure | as returned | The gateway's own message |

The order is cheapest-and-most-specific first, and one of the entries is a
deliberate absence: **a disabled default is not replaced by another provider.** The
fallback would spend a different account's money, which is a decision the
organization has not made.

Entry 6 is all-or-nothing. A partial context produces a confident answer about a
business whose numbers do not add up, with nothing on screen saying which part was
real.

---

## 9. The screen

`app/(app)/ai.tsx`, with `/copilot` as a re-export so the URL can name the feature.
The navigation points at `/ai`; both render the same component.

While the gateway is unavailable the screen says so **above** the transcript, and
the composer is replaced by that sentence. The reason it is not a live input that
always refuses: a user who learns the state from the screen does not have to spend
a question to learn it, and "AI is not working" invites the belief that the data is
at fault — which costs more to undo later than the refusal does.

The screen also shows three things a chat UI would usually hide:

- **The data gaps**, whether or not the model mentioned them.
- **Whether the reply was structured**, as a badge.
- **When the question was asked**, because the context is a reading of the business
  at one moment and a stale answer otherwise reads as a current one.

Citations render as labelled badges carrying the real record id. **They do not
navigate yet.** A citation that goes nowhere is worse than one that is plainly a
label, so they are honest about being labels; wiring them to `/projects/[id]` and
`/tasks/[id]` is the obvious next step and is listed as deferred rather than
half-done.

---

## 10. Testing

| Suite | Tests | What it holds down |
|---|---|---|
| `copilotData.test.ts` | 68 | Classification, subject resolution, minimization, bounds, gaps, role gating, dashboard agreement, parsing, normalization |
| `copilotSecurity.test.ts` | 27 | Prompt containment, no credential reach, tenant scoping of every read, refusal order, action stripping, citation resolution |
| `copilotHook.test.tsx` | 12 | Organization and role switching, stale-answer discard, turn lifecycle |
| Full suite | 825 | — |

`copilotSecurity.test.ts` is mostly source scanning, and the distinction is the
point rather than a compromise. The risk this feature carries is the shape
"somebody will need the credential here later", and the only durable defence
against it is a test that fails the moment an import appears — not a review
convention, and not a comment explaining why it would be a bad idea.

**What these tests cannot prove.** They cannot prove tenant isolation: that is
PostgreSQL row-level security and the `SECURITY DEFINER` RPCs, and a test with a
mocked database asserts only that the mock behaves as written. Those live in
`supabase/tests/rls_isolation.sql`. They also cannot prove a provider call
succeeds, because `GATEWAY_AVAILABLE` is false.

---

## 11. Known limitations

1. **No live provider call has been made.** The single most important limitation,
   and the reason the screen says the assistant is unavailable.
2. **Citations are not navigable.** See §9.
3. **One question in flight.** Enforced, and correct — two concurrent questions
   would race on the same snapshot and imply a single reading that never existed.
4. **No conversation persistence.** Deliberate; see §7.
5. **First-name questions do not resolve.** Deliberate; see §5.
6. **Eight intents.** A question outside them falls back to `general_business`,
   which sends the dashboard and bounded rollups. That is a safe default rather than
   a good one, and it is where the next intents should be added.
7. **The RLS suite was not re-run.** No SQL changed in this phase, so the Phase 36
   result stands; it is not a claim about this phase's code.
