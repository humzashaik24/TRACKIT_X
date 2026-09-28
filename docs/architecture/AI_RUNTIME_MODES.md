# AI Runtime Modes

How Trackit X decides where business records come from, what a Copilot turn is
allowed to do, and which of those decisions are enforced where.

Phase 38 added a data source. It did not add a model.

---

## The one rule

**Demo mode changes where business records come from. It changes nothing else.**

There is no mock provider, no mocked gateway response, no canned answer, and no
locally-composed Copilot reply anywhere in this repository. A Copilot turn in demo
mode runs the same code as a turn against a real organization:

```
demo dataset  ──┐
                ├─→ buildDashboardSnapshot ─→ buildCopilotContext ─→ buildCopilotRequest
real database ──┘            (real)                  (real)                (real)
                                                                              │
                                              aiGatewayService.generate(configId)   │
                                                                              ▼
                                       supabase/functions/ai-gateway  (real, Edge)
                                              │  auth → config → membership
                                              │  → rate limit → Vault RPC
                                              ▼
                                       real provider adapter (Gemini / OpenAI / Anthropic)
                                              │
                                              ▼
                                       normalized response ─→ cite-checked answer
```

If the provider is unreachable, the turn fails — in demo mode exactly as in
production, and with exactly the same error, because the refusal path is the same
code path.

## Why this is enforced rather than preferred

The tempting shortcut is a lookup table: if the question matches a known string,
return a prepared answer. That makes every feature downstream of it look finished
while the credential boundary, the tenant check and the response normalizer are never
once exercised. Nothing reports the difference, and the first person to find out is
whoever tries to enable the gateway for real.

`tests/unit/demoData.test.ts` case 25 is the tripwire. It asserts the gateway is
still disabled in demo mode, so the day someone makes the fixture answer locally, the
suite fails rather than the feature quietly becoming a mock.

---

## Configuration

One variable, read in exactly one place.

| `EXPO_PUBLIC_DATA_MODE` | development | staging | production |
|---|---|---|---|
| unset | `demo` | `live` | `live` |
| `live` | `live` | `live` | `live` |
| `demo` | `demo` | `demo` | **`live`** |
| anything else | config error | config error | config error |

Resolved by `effectiveDataMode` in `src/config/envSchema.ts`. Three properties
matter:

**Unset is not the same as either value.** It is collapsed to a value per
environment, at resolve time. A developer who has just cloned the repository gets a
working Copilot over a realistic business with no database and no setup — the reason
the mode exists — and the same unset variable in staging means the opposite.

**Production overwrites rather than warns.** A staging build flipped to demo and
promoted by copying `.env` would otherwise show five invented employees as a
customer's business, and every screen would render it successfully, because nothing
about a fixture is invalid. Overwriting makes the failure mode of getting this wrong
"reads the real database", which is the safe direction. A production organization
that genuinely wants sample data should seed through Postgres, where RLS applies to
it as it applies to everything else.

**An unrecognised value is a config error, not a fallback.** A typo must not
silently resolve to live data in development, leaving a developer staring at an empty
database with no explanation.

---

## The substitution

One function, `readCopilotFacts` in `src/services/copilotService.ts`, decides
whether a read comes from Postgres or from the fixture set. It is the only changed
line in the pipeline.

```ts
if (isDemoDataMode()) {
  const demo = readDemoFacts(organizationId, asOf);
  if (!demo.ok) return demo;          // a bad reference date is a real error
  if (demo.value !== null) return ok(demo.value);  // the demo organization
}
// otherwise: the real organization-scoped reads
```

Two properties keep this from becoming a security hole:

**It is keyed on the organization, not on the flag alone.** `readDemoFacts` answers
only for `DEMO_ORGANIZATION_ID` and returns `null` for every other id, so a demo
build still cannot show fixture data for a real tenant — the caller falls through to
the real reads. `null` rather than an error, because "not my data, go and read the
real table" is the correct behaviour and an error would turn a mode mismatch into a
broken screen.

**It substitutes data, never authorization.** The fixture describes an organization
that does not exist, and its records are a public constant compiled into the bundle,
so there is nothing to authorize and no membership check to skip. Real reads still
`.eq('organization_id', …)` and RLS still applies to them; demo mode never reaches a
table at all.

`readAccessHolders` follows the same rule for the `organization_members` count, so
demo mode requires no live table for the headcount figure either.

---

## Determinism

The dataset stores due dates as **offsets**, not as dates. Something has to resolve
them, and that something is the caller's `asOf`.

- `shiftDate` works in UTC midnight, so a result cannot move by a day because the
  machine is in a timezone with a half-hour offset or a DST boundary falls in range.
- Nothing reads the clock. `Math.random()` appears nowhere in the dataset.
- `asOf` is threaded from the same call that builds the snapshot, so the overdue set
  the model is told about is the overdue set the dashboard computed.

The consequence worth stating: the same reference date always yields the same
overdue set, on any machine, on any day. A developer debugging a Copilot answer gets
the same context back tomorrow.

---

## The projection

`DemoEmployeeRow` → `DashboardEmployeeFact` and `DemoProjectRow` →
`DashboardProjectFact` in `src/services/demoDataService.ts`.

The job titles in the dataset are dropped, and that is not an oversight. It is the
same narrowing a real `.select(DASHBOARD_EMPLOYEE_COLUMNS)` performs, done here so
both feeds hand the aggregator an identical shape. The titles exist because the
`employees` table has that column; the Copilot does not read it because Phase 37
decided it should not, and a demo that quietly widened the read would be a demo that
quietly removed the guarantee.

There is no parallel business model and no precomputed aggregate. The demo feeds the
real `buildDashboardSnapshot`; workload bands, progress percentages, overdue counts
and deadline windows are all computed by the production code from the projected
rows.

---

## What the dataset contains

Five employees (one on probation), three projects, twelve tasks, and a headcount of
seven access holders — the last deliberately different from the employee count,
because the two are different claims and a demo that made them equal would hide a
real distinction.

The scenarios exist to make the Copilot's questions have answers worth asking:

| Scenario | Where |
|---|---|
| Overdue work | 3 tasks, dated strictly before the reference date |
| Due soon | 4 tasks, inside the 7-day window, none in the past |
| Blocked work | 2 tasks, at least one inside the window |
| An overloaded person | Neha Iyer: 3 open, 1 overdue, uniquely highest |
| A project under strain | Business Analytics Platform: on hold, critical, 35% done, 5 days to target |
| A healthy project | Mobile App Development: active, 62%, 34 days to target |
| Unambiguous urgency | The only due-soon project is also the only one on hold |

---

## What demo mode is not

Not a mock provider. Not a fake answer. Not a bypass of the gateway, the Vault, the
provider, or the rate limit. Not a way to run without a provider credential — the
business data is local, but the model is not, so a Copilot turn still needs a
configured provider and a deployed gateway.

Not a testing strategy. The 31 tests in `tests/unit/demoData.test.ts` and
`tests/unit/env.test.ts` are deterministic and need no network, no database and no
credential, which is what makes them different from the live checks.

Not available in production. See the table above.

---

## Current development configuration (2026-09-28)

**REAL LLM + DEMO BUSINESS DATA** is the intended development configuration:

- **Demo business data**: `EXPO_PUBLIC_DATA_MODE` unset, `appEnv=development`
  → `effectiveDataMode` resolves to `demo`; the Copilot reads the deterministic
  fixture (`DEMO_ORGANIZATION_ID`) exactly as described above.
- **Real LLM**: there is no mock provider and no local answer composer. Every turn
  is meant to leave the device through `aiGatewayService` → the deployed Edge
  Function → Vault → the real provider adapter → the real provider.

The runtime is currently **blocked**, not simulated: as of the 2026-09-28
verification pass there is no hosted Supabase project configured on this machine
(`.env` points at the local Docker stack, `http://127.0.0.1:54321`), the
`ai-gateway` Edge Function is not deployed to any project, and no provider
credential exists in any secure store. `GATEWAY_AVAILABLE` therefore stays
`false`, and no provider call has ever been made. See
`docs/progress/PHASE_38_COMPLETE.md`.

This composition is temporary and its boundary is the data feed, not the AI
stack. The later migration replaces the fixture with real organization data:

```
DEMO BUSINESS DATA
   buildDashboardSnapshot ─→ buildCopilotContext ─→ aiGatewayService
   (the only thing that changes)
REAL ORGANIZATION DATA
```

The AI half — gateway, Edge Function, Vault, adapter, provider, normalizer and
UI — is identical in both rows of that table. Switching modes must be a change of
source records plus the same effective-mode move that already exists
(`EXPO_PUBLIC_DATA_MODE=live`, or a production build forcing `live`), never a
change to the Copilot or the gateway.

---

## Enabling the gateway

`GATEWAY_AVAILABLE` in `src/domain/ai/gateway.ts` is `false`, and Phase 38 left it
that way. It flips only when all of the following have been observed against a real
provider, and recorded as such:

1. A credential stored through the Edge Function's Vault RPC, never on a client.
2. `Test Connection` completing a real round trip and reporting ready.
3. A real generated answer arriving, normalized, with resolvable citations.
4. That answer rendered in the UI from real data.
5. Cross-organization isolation confirmed against the live database.
6. A secret scan over source and the built bundle.
7. The full test suite green.

Until then the screen says the assistant is not running, and it says *why* — the
server holding the provider key — because "AI is not working" invites the belief that
the data is at fault.
