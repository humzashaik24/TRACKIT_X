# Phase 40 — Integration Audit

Audit performed at the start of Phase 40 (baseline `73f7206`). Where Phase 39 asked
"is every screen real?", Phase 40 asks **"do the real screens work together?"** — cross
module navigation, organization switching, the load/empty/error envelope, and whether
a screen ever states a fact the data has not established.

## Method and honesty boundary

This audit is **static inspection over the committed code**, plus the automated suite.
There is no hosted backend to exercise, so every "runtime" claim below is one of:

- **Static** — the code path was read and reasoned about; no execution.
- **Tested** — covered by a unit/integration test in `tests/unit/`.
- **Runtime** — only claims that do not need a backend (pure domain logic, rendering,
  navigation wiring executed by the test renderer).
- **Not verified** — the live behaviour (auth handshake, Postgres RLS, the AI gateway,
  Vault) is untouched and unstarted. This phase does not fake any of it.

The governing rules carried into this phase:

> Every number on every screen is counted from a row that exists.
> Nothing is entered by hand, estimated, sampled, or invented.
> Demo data is a **copilot-feed only**, never a stand-in for a live screen.

### Why the demo data cannot become a demo app

`demoData.test.ts` isolates the Phase 38 fixtures, but the fixtures are consumed in
exactly **one place**: `copilotService.readCopilotFacts` for the Copilot's grounded
context (`src/services/copilotService.ts:201-208`), and `readAccessHolders` returns
`DEMO_HEADCOUNT` for the demo org (`:147-151`). The dashboard, the people / projects /
tasks / workforce / reports screens all read **live Postgres** and render
`NETWORK_UNAVAILABLE` when no backend is running; the "Demo data" badge exists only on
`/ai`. Making the whole app read fixtures would require bypassing real authentication
and authorization for most screens, which this phase explicitly must not do. So the
fixture stays a Copilot-feed, the limitation is documented here and on `/ai`, and no
business screen pretends otherwise.

## Verification status by module

| Module | Route | Source | Authz | Loading/Empty/Error | Navigation | Demo | Status |
|---|---|---|---|---|---|---|---|
| Dashboard | `/dashboard` | `useDashboardSnapshot` (live RLS reads) | role-gated workload cut | atomic snapshot; `DashboardLoading`; error → retry | panels not clickable | none | **Static** — dates-to-watch rows should open the project |
| Projects | `/projects` | `projectService.listProjects` | RLS + `canCreateProject` | DataTable loading/error/retry; empty + filtered-empty distinct | row → detail wired | none | Tested + Static |
| Project detail | `/projects/[id]` | `getProject` + `listProjectMembers` | RLS; `notFound` = empty state | loading/error/notFound distinct | **no tasks link; owner never resolved** | none | **Static** — D3, D5 |
| Tasks | `/tasks` | `taskService.listTasks` | RLS; assignee/status writes role-gated | loading/error/retry; empty + filtered-empty distinct | "New task" → `/tasks/create` | none | Tested + Static |
| Task detail | `/tasks/[id]` | `taskService.getTask` | RLS; `useTaskDetail` pair-tagged | loading/error/notFound distinct; anti-probing | **project name not a link** | none | Tested + Static — D4 |
| Task create | `/tasks/create` | create form | `canCreateTask` | field errors + form banner | arrives from list; saves → back | none | Static |
| People | `/employees` | `employeeService` directory | RLS + admin-gated writes | loading/error/retry; empty + filtered-empty | no detail route (none exists) | none | Static |
| Workforce | `/workforce` | directory + `countMembers` | RLS | **false-empty over failed load** | none (node-first) | none | **Static — false-empty defect** |
| Reports | `/reports` | `DashboardSnapshot` | role-gated workload | loading/error/empty distinct | embeds ProjectPanel/WorkPanel | none | Static |
| Notifications | `/notifications` | `useNotifications()` = honest `empty` | none yet | loading/error/empty/ready distinct | **actionPath pushed unvalidated** | none | Tested + Static |
| Organizations | `/organizations` | `organizationService` | RLS; owner-gated edits | members/edits distinct | leads membership switch | none | Static |
| Settings | `/settings` | `aiProviderService`, `organizationService`, theme | `canManageAIProviders`, `canEditOrganization` | AI load/error handled | theme + org edit | none | Static — D6 |
| AI | `/ai` | Copilot over gateway; `GATEWAY_AVAILABLE=false` | org + role tags on turns | refusal states honest | references not navigable | demo feed only | Tested + Static |
| More | `/more` | org record + prefs | RBAC read | plain | theme + sign-out | none | Static |

### Journeys (end-to-end reading)

- **A. Open dashboard → a late project.** Dead-end: "Dates to watch" rows are text,
  not links (`ProjectPanel.tsx` `DeadlineList`). The project exists on the list one
  hop away but the overdue project is the one the row names. → Fix: rows open
  `/projects/{id}`.
- **B. Project detail → its tasks.** No link. The tasks module has a `projectId`
  filter built into the list (`TaskFilters.projectId`) but it is reachable only by
  hand. → Fix: "View tasks" action on the detail navigates `/tasks?project={id}` and
  the tasks screen seeds that filter from the query param.
- **C. Task detail → its project.** The header names the project (`shownProjectName`,
  `TaskDetailView.tsx:440-443`) but it is inert text. → Fix: pressable → `/projects/{id}`.
- **D. Org switch while a detail route is open.** Tasks: `useTaskDetail` pair-tags
  (`TaskDetailLoad{organizationId, taskId}`, `useTasks.ts:334-348`) and drops stale
  writes (`:401`), but the fetched row's own `organization_id` is never compared to the
  active org — an org-A task can render under org-B's header. Projects: `useProjectDetail`
  is tagged on **project id only** (`useProjects.ts:265`), so switching orgs leaves a
  stale project on screen and there is no per-row org check at all. → Fix: D4 (row-level
  check), D3 (project detail gains the org param + row check).
- **E. Create while a modal is open through an org switch.** `ProjectCreateForm` /
  `EmployeeCreateForm` hold picks (owner, manager, department) that were valid for the
  org that opened them. The `<Modal>` unmounts children when closed, so a closed modal
  is safe; an **open** modal across a switch keeps stale picks while
  `organizationId ?? ''` now points at the new org. → Fix: key the forms by org.
- **F. Settings while switching orgs.** `AIProvidersView` owns local draft state (model,
  enabled, default, credential) that is not cleared on an org switch — an admin who
  begins configuring provider X in org A and switches to B can save the draft into B. →
  Fix: remount via `key={organization?.id}`. Also the code path a credential
  submission has no whole-save busy guard → double-submit window. → Fix: local
  submit-guard in the view.
- **G. Notifications → record.** `AppNotification.actionPath` is a free string pushed
  as a route (`NotificationCenter.tsx:46-50`). The model is pure and unit-tested for
  its state machine but nothing constrains the destination. → Fix: a pure
  `notificationDestination` allowlist applied before `router.push`.
- **H. Copilot citation → record.** Answers cite `CopilotReference{entity,entityId}`
  — records the client itself supplied, never LLM-chosen (`domain/ai/copilot.ts`
  references section). They render as inert badges with a comment admitting no route is
  wired. → Fix: `copilotReferenceRoute` maps project/task to the typed routes; employee
  has no detail route, so employee citations stay badges (documented, not a dead link).

## Findings and dispositions

| # | Finding | Evidence | Disposition |
|---|---|---|---|
| D1 | Workforce snapshot refresh could commit a stale org | `useWorkforceSnapshot.refresh` (`:76`) | **No defect** — `deriveSnapshot` discards any tag mismatching the active org (`snapshot.ts:69`). Verified, no change. |
| D2 | AI config fetch cancelled path could leave a spinner | `useAIProviderConfigs` effect (`:106-123`) | **No defect** — every surviving effect run clears `fetching`; org change re-runs the effect and resets it. Verified, no change. |
| D3 | Project detail not org-scoped | `useProjectDetail(projectId)` only (`useProjects.ts:259`) | **Fixed** — hook takes `(projectId, organizationId)`; a row whose `organization_id` ≠ active org renders `notFound` (anti-probing, same rule as tasks). |
| D4 | Task detail rows never compared to active org | `useTasks.ts:366-388` resolves any visible row | **Fixed** — `result.value.organization_id !== organizationId` ⇒ `notFound` empty state, both read + refresh. |
| D5 | Project detail always "Unclaimed" | `getProject` selects `*` (no owner embed); detail builds `ownerName: null` (`useProjects.ts:292,335`) | **Fixed** — `getProject` returns the owner-embedded entry (same select as the list); detail shows the resolved owner. |
| D6 | AI provider draft survives org switch + no whole-save guard | `AIProvidersView` local state (`:190-195`); `handleSave` (`:221-257`) | **Fixed** — settings remounts the view per org; view guards the full save+credential submit as one busy unit; load-failure no longer renders "Not configured" cards. |
| D7 | Sign-in awaiting-email messaging | Auth screen | **Deferred** — no resend service exists; not a defect this phase regresses or repairs. Documented. |
| D8 | `AsyncStorage.setItem` inside a setState updater | `OrganizationContext.tsx:185-200` | **Fixed** — selection validated and applied first, then persisted. |
| D9 | Global search refetches the whole org per open | `GlobalSearch` | **Deferred** — performance cost, deliberate refetch-to-stay-fresh; documented, no change. |
| N1 | Dates-to-watch rows not navigable | `ProjectPanel.DeadlineList` | **Fixed** |
| N2 | Project detail → tasks missing | `ProjectDetailView` | **Fixed** — `View tasks` → `/tasks?project={id}`, seeded filter. |
| N3 | Task detail project name not a link | `TaskDetailView.tsx:595-598` | **Fixed** |
| N4 | Notification `actionPath` unvalidated | `NotificationCenter.tsx:46-50` | **Fixed** — pure allowlist. |
| N5 | Copilot references inert | `CopilotTurnView` `:129-152` | **Fixed** — project/task citations navigate; employee stays a badge. |
| N6 | UserMenu "Profile" → `/more` | `UserMenu.tsx:106-110` | **Fixed** — honest label. No profile route exists. |
| A1 | ErrorState/EmptyState `accessible` swallow their retry button | `ErrorState.tsx:96-99`, `EmptyState.tsx:67-69` | **Fixed** — container is a flat a11y element only when it has no interactive children. |
| A2 | Create-form failure banners not announced | `ProjectCreateForm.tsx:153-160`, `TaskCreateForm.tsx:187-194`, `EmployeeCreateForm.tsx:167-174` | **Fixed** — `accessibilityRole="alert"`. |
| A3 | AI switch misreports `disabled` | `AIProvidersView.tsx:604-612` | **Fixed** — `accessibilityState.disabled` mirrors the real control. |
| A4 | Menu trigger `expanded` never set | `UserMenu.tsx:62-75`, `OrganizationSwitcher.tsx:119-135` | **Fixed** |
| A5 | Notifications screen error has no retry | `app/(app)/notifications.tsx:45-47` | **Fixed** — wired to `refresh()`. |
| A6 | Reports error card not an alert | `ReportsView.tsx:117-127` | **Fixed** |
| S1 | Workforce shows "No people recorded" over a failed load | `WorkforceView.tsx:128,216-224` | **Fixed** — a load error renders an error state with retry, never the first-run empty. |

## Out of scope / deferred (recorded, not fixed)

- **D7** — awaiting-email-confirmation server messaging; no resend service exists.
- **D9** — global search re-reads the whole org on each open; a deliberate freshness
  trade-off, isolated to the search popover.
- **Employee detail route** — none exists; adding one is new feature work with its own
  permissions, out of Phase 40 scope. Copilot employee citations therefore stay badges.
- **No backend services were started.** Auth handshake, hosted RLS, the AI gateway and
  the Vault remain unverified — and unstarted, deliberately, because Phase 40 must not
  fake them.

## Where the audit stops

This audit and the phase's fixes are bounded by what the code can be made to guarantee
without a running backend. The cross-module navigation, the org-scoping of detail
routes, the honest state envelopes and the accessibility repairs below are all real
changes with real tests. Anything requiring a live database or a deployed edge
function is marked **Not verified** in this document and in the Phase 40 completion
report, rather than being asserted into existence.