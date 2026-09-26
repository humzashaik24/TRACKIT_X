# Phase 34 — Real Dashboard & Business Analytics

## Status
COMPLETE, with known limitations stated below rather than left to be discovered.

## Objective

Replace the dashboard placeholder with a real one. Phase 33 left a screen with exactly
one true figure on it — how many people had access to the workspace — because at that
point the database had two tables. Phase 32 added `employees`, `projects` and `tasks`.
This phase makes the dashboard read them, and states in one typed contract
(`DashboardSnapshot`) every figure the screen shows.

Two constraints shaped the work, and both are consequences of the same rule.

**Every number is counted from a row that exists.** No figure is estimated, sampled,
interpolated or entered by hand. `buildDashboardSnapshot` is a pure function from rows
to a snapshot, so any number on the screen can be traced to the rows that produced it,
and the test suite asserts that mapping directly.

**Absence is stated, never filled.** Where the schema is silent the screen says so. A
figure that would require history, a finance table, an inventory table or an attendance
table is not rendered as a placeholder, a zero, or a guess. This phase adds no SQL
migration, because the schema already carried everything the dashboard needs.

## Implementation

### No migration

`readDashboardFacts` issues three organization-scoped reads against tables Phase 32
already created. Nothing was added to `supabase/migrations/`, and no view or function
was introduced.

The alternative — a `SECURITY INVOKER` analytics view or RPC that does the aggregation
in Postgres — was considered and declined for now. The client-side reads are the right
shape at the scale this product has (see *Known Limitations* for the point at which
that changes), and a view would have locked a UI-shaped contract into the schema before
there was a second consumer to justify it.

### Data layer — `src/services/dashboardService.ts`

Two entry points, and the split is the point:

- **`readDashboardFacts(organizationId)`** — `employees`, `projects` and `tasks` in
  `Promise.all`, each with `.eq('organization_id', organizationId)`. It returns
  `ActionResult`, and the error checks run in a fixed order so a failure always reports
  the same first cause. It is all-or-nothing: three of four tables would be a dashboard
  making claims about the business from partial data.
- **`countOrganizationMembers(organizationId)`** — a separate `head` count on
  `organization_members`. Kept apart because it is a *secondary* figure, and failing it
  must not cost the user the whole screen. The hook degrades it to `null`, which
  renders as an em dash.

Only minimal columns are selected. The task read in particular takes six fields and no
joins, because the workload derivation needs the assignee id and nothing else — the
names are resolved against the employee read already in memory.

### The snapshot — `src/features/dashboard/metrics.ts`

`buildDashboardSnapshot(facts, context)` is pure: rows in, snapshot out. The `asOf` date
is a **parameter** rather than a hidden `new Date()`, which is what makes the date
boundary testable and the derivation reproducible.

The shape is built for the two consumers it has. A person reads it on screen; a future
AI provider would read it as a prompt context. Both need the same thing — every figure
named, typed, and carrying its own basis. So a ratio that cannot be computed is `null`,
never `0`, and a figure that is not computable *for this viewer* is also `null` rather
than `0`. The reasoning on that last point is the most important decision in the file
and is covered under *The workload gate* below.

Derived figures and the reasoning behind each:

| Figure | Basis | Why |
| --- | --- | --- |
| `employees.current` | active + probation + on_leave | Identical to `employeeService.countCurrentEmployees`. Two screens answering "how many people work here" differently would be an unreproducible bug report. |
| `projects.open` | planned + active + on_hold | Neither delivered nor stopped. A paused project is still a live job. |
| `projects.averageProgress` | OPEN projects only | A completed project is 100% by definition, so including them drags the mean toward 100 and it stops describing the work in flight. Cancelled work is excluded for `impliedProgressForProjectStatus`'s reason: work somebody deliberately stopped is not work that failed to progress. |
| `tasks.open` | everything not done | — |
| `tasks.overdue` | open, `due_date < today` | Defers to `isTaskOverdue`, which is `<` and not `<=`: a task due *today* is not yet late, because the day has not finished. `taskService.countOverdueTasks` uses the same rule, so the dashboard and the tasks screen cannot disagree. |
| `tasks.completionRate` | `done / total`, `null` at zero tasks | "0%" beside "0 delivered" would state a measured rate of zero for a business that has not started. |
| `workload.meanOpenTasksPerPerson` | open tasks ÷ people carrying work | Dividing by headcount answers a different question — load per employee across the business — and would read as nobody being busy. |

### The workload gate

Per-person workload is offered to `manager` and above. It is worth being precise about
what this is and is not.

It is **not** a second security boundary. `organization_members` is readable by any
member of the organization, and so are `employees`, `projects` and `tasks` — the RLS
policies use `is_organization_member(organization_id)`. A manager reading a colleague's
open-task count is not bypassing anything; an owner is an employee too, and reading that
table is how a member sees their own headcount. The gate is a product decision about
whose attention a number is for.

It is also **not a judgement about people**. The panel prints counts. `WORKLOAD_BANDS`
are "None", "1-2", "3-5", "6 or more" — descriptions of a queue. The obvious upgrade is
"free", "balanced" and "overloaded", and every one of those words asserts that some
amount of open work is the *correct* amount, which depends on whether the work is a
two-hour job or a six-week one. The schema has no estimate column, so the panel cannot
tell those apart and would be guessing with somebody's name attached. For the same
reason the list is sorted by open tasks — the order a scheduler needs — with no rank, no
ordinal and no "1st".

For a member, `workload` is `null` and the panel is not rendered. There is no lock icon
and no "restricted" badge, because a member is not being denied a feature; they are
seeing a dashboard suited to their job, and an empty locked panel would invite the
question of what it is hiding.

### Three bugs found and fixed

These were caught by the tests written alongside the code, and each is a case where the
screen would have stated something false rather than merely being wrong.

**1. The workload distribution's "None" band could never be non-zero.**
`buildDistribution` tallied `WorkloadEntry[]`, and an entry is one person holding at
least one open task. People with an empty queue are therefore *structurally absent* from
the input, so the "None" band was permanently `0` — the chart asserted "nobody is idle"
on every dashboard while the same panel's `withoutOpenWork` field listed exactly how many
people were. A distribution row that can never move is worse than no row, because it
looks measured. `withoutOpenWork` is now threaded in explicitly, and the shares are taken
over everyone the bands account for rather than over carriers alone.

**2. A member's snapshot claimed nobody was carrying work.**
`employees.withOpenWork` and `withoutOpenWork` were `?? 0` for a non-manager. That `0`
asserts a fact about the business when it is actually a fact about a permission check.
The headcount numbers on screen would have been harmless — the panel is not rendered —
but `DashboardSnapshot` is the contract a future AI provider reads, so a `0` in that
field would have been quoted back as "nobody has open work" by a model reasoning over a
viewer who was never allowed to be told. Both fields are now `number | null`, and
`null` is legible to both a person and a prompt: the answer is withheld, not absent.

**3. `ProjectPanel` hardcoded its priority keys.**
`['low', 'medium', 'high', 'critical']` was correct on the day it was written and becomes
a silent omission the day a priority is added — the new value would simply not appear in
the chart, with nothing to fail. Both panels now read `PROJECT_PRIORITIES` /
`TASK_PRIORITIES` and their label maps. Writing the test is what exposed this: the task
enum's top priority is `urgent`, not `critical`, which is exactly the difference a copied
literal hides.

### The screen

`app/(app)/dashboard.tsx` is now a snapshot-driven screen. It owns the three states,
because the snapshot is atomic — there is no state in which the headline numbers are real
and the distributions are still arriving:

- **Loading** — `DashboardLoading` draws the page's real shape at its real size with the
  values withheld, so nothing moves when the data lands.
- **Error** — an inline `ErrorState` with retry, and no partial figures beside it. A
  screen with the tiles filled in and the distributions empty would look like a business
  with no projects, which is a claim.
- **Empty** — distinguished from an organization with no *members*. A workspace can have
  ten people on it and no projects yet, and that is an empty dashboard rather than an
  empty company, so the test looks at the three business tables.
- **Ready** — overview tiles, then the project, work and (manager-only) workload panels.

`DashboardSection` is reused unchanged, including its `notBuilt` affordance, which
renders its caveat *above* the section content so a scanner of the numbers cannot miss
it.

**No activity feed, and the reasoning is worth recording.** There is no event log, so a
feed would have to be inferred from row timestamps — a guess about what happened rather
than a record of it. The same absence is why there are no sparklines and no deltas:
`MetricCard` can draw both, and neither is used, because a delta needs two points in
time and this schema stores current state with no history. It is the most conspicuous
omission on the screen and the most defensible.

**The gaps are named, not hidden.** A "Not built yet" section derives from
`src/navigation/destinations.ts` — the same table the sidebar is built from — listing the
four destinations a business owner would expect to find on a dashboard and cannot:
Business Health, Finance, Inventory and AI. Labels, summaries and phase names come from
that registry and each card links to its own placeholder screen, so the section is a
signpost rather than a second copy of copy that can drift.

### Tests

Two suites, 57 tests, both aimed at the risk rather than at coverage.

`tests/unit/dashboardMetrics.test.ts` (47) — the derivation, because it is pure and the
risk in it is arithmetic and edge cases, which a component test can only observe as "a
number was printed". Ordered by how much damage a failure would do: fabrication (the
empty organization, asserting real zeros and `null` ratios), permission leaks, wrong
denominators, the date boundary, and the off-workforce reconciliation. Purity is asserted
directly, including that the workload sort does not leak state between calls.

`tests/unit/dashboardHook.test.tsx` (10) — the organization switch, following the
`taskHooks.test.tsx` pattern of holding a promise open and releasing it out of order. A
mock that resolves immediately cannot reproduce a race. The dashboard is more exposed than
a list: a list showing the wrong organization's rows is visibly wrong, whereas a
dashboard showing real, correctly-derived figures under the wrong business's name looks
entirely plausible. The cases cover a slow success, a slow *failure* arriving after a
success for the new tenant, a role change re-deriving the gate without a refetch, and
refresh keeping the previous snapshot on screen.

## Validation

**RUNTIME VERIFIED**

- `npm run verify` — 19 suites, 576 tests, all passing. ESLint `--max-warnings=0` clean
  across `app`, `src` and `tests`.
- `npx tsc --noEmit` — clean.
- `npx expo export --platform web` — succeeds, 1,627 modules.

**STATICALLY REVIEWED**

- The RLS policies behind every read: `employees`, `projects` and `tasks` selects use
  `is_organization_member(organization_id)`, and `organization_members` is readable by
  organization members. The workload gate is a presentation gate over data the caller
  could already read, which is why it is documented as a product decision rather than
  security.
- Enum coverage in the panels: status and priority keys are read from the domain
  enums, so a new enum member cannot be silently omitted from a chart.
- `DashboardSnapshot` read as a prompt contract: every field is typed, and every field
  that cannot be computed is `null` rather than `0`.

**NOT YET VERIFIED**

- No SQL was run in this phase, because no migration changed. The Phase 33 result — 124
  assertions, 0 failures — stands for the policy suite as it was then and is not
  re-stated here as a Phase 34 verification.
- No live Supabase project was queried. Every read path is exercised through the mocked
  service in the hook suite, not against a real database.
- No device or simulator run. Layout is flexbox-based and reviewed statically, but the
  panels have not been seen at any breakpoint.
- Render was **not** deployed, per instruction. This phase is local only.

## Known Limitations

- **No history, so no trends.** Everything on the dashboard is current-state. The first
  time-series feature is built, a progress or status-change log will be needed; it cannot
  be reconstructed from current rows.
- **Task reads are linear.** `readDashboardFacts` pulls every task row in the
  organization. That is correct and fast at the scale this product has, and it is the
  first thing to revisit at tens of thousands of tasks — a `SECURITY INVOKER` RPC doing
  the aggregation in Postgres, called with the same typed contract.
- **`unowned` counts a null owner, not an inactive account.** A project whose `owner_id`
  points at a departed employee counts as owned. The workload panel does surface the
  related case for tasks (`offWorkforceWithOpenWork`), and the project panel reports
  unowned separately, but "owned by nobody" and "owned by someone who left" are different
  facts and only the first is labelled.
- **The workload list is capped at eight rows.** The remainder is counted in a line
  beneath it and the directory is pointed at. A distribution over everyone would be
  denser but unreadable on a phone.
- **The primary green is not the requested `#00E599`.** The brief asked for it; the
  design system's `palette.green[400]` is `#26EE7E` and is what `theme.colors.accent`
  resolves to. The existing token was reused rather than hardcoding a second green,
  because a hardcoded hex is a palette fork with no owner. If `#00E599` is wanted, it
  belongs in the token as a deliberate change with the rest of the ramp.
- **The legacy workforce snapshot is retained and unused.** `snapshot.ts`,
  `useWorkforceSnapshot.ts` and `workforceSnapshot.test.ts` are no longer on any code
  path. They were left in place rather than deleted in this phase so the removal is a
  separate, reviewable change.

## Platform Support
Web is the only platform verified, via `expo export`. iOS and Android use the same
React Native primitives and are expected to work, but have not been run.

## Git Commit
`feat(phase-34): build real business dashboard`

## GitHub
Branch `fix/format-money-parser-and-date-semantics`, pushed to `origin`. Phase 33
(`66c7323`) is the parent commit.
