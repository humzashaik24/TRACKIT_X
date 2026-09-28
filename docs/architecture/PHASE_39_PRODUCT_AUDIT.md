# Phase 39 — Product Module Audit

Audit performed at the start of Phase 39 (baseline `f20858d`). It classifies every
screen in the signed-in application, states what the database genuinely supports,
and prioritises the rebuild work that follows in this phase.

The governing rule of this phase is the one the product has held since Phase 1:

> Every number on every screen is counted from a row that exists. Nothing is
> entered by hand, estimated, sampled, or invented — and no placeholder
> impersonates a real screen.

So the audit separates two questions that are often confused:

1. **Is the screen real?** Does it read real records through a real service, or is
   it a `ComingNext` shell that says so in words?
2. **Could it be real?** Is there a table and a service behind the module, or does
   "building it" mean inventing a backend that does not exist?

A screen that is a placeholder is only worth rebuilding if the second answer is
"yes". Everything else stays an honest placeholder, because turning it into a
"real-looking" screen over no data is the one failure this product refuses to make.

---

## The shell — where the real P0 defect lives

Before the routes, the chrome itself is broken:

- **P0 — the compact bottom bar renders all 24 destinations** instead of the 6 it can
  hold. `src/components/navigation/AppShell.tsx:293` maps `destinations` (24 entries)
  into the narrow `GlassSurface`, while `bottomBarDestinations` (6:
  `/dashboard`, `/projects`, `/tasks`, `/employees`, `/ai`, `/more`) and
  `MAX_BOTTOM_BAR_TABS = 6` (`src/navigation/destinations.ts:421`) exist, are correct,
  and are unit-tested — but are never consumed by the shell. On a phone the bar draws
  twenty-four tabs in a row, most of them leading to "not built yet" screens. This is
  the single highest-priority defect in the product: it is the primary navigation of
  the most common form factor, and it is broken by construction.
- **P1 — the Phase 29 navigation chrome is entirely unwired.** `AppHeader`,
  `Sidebar`, `MobileDrawer`, `GlobalSearch`, `OrganizationSwitcher`, `UserMenu`,
  `NotificationCenter` and `HeaderPopover` (≈880 lines in
  `src/components/navigation/`) have **zero import sites** in the application. Only
  `PageHeader`, `Breadcrumbs`, `RouteGate`, `ComingNext` and `AppShell` are in use.
  The consequence:
  - On **desktop**, `AppShell` renders its own flat 24-item rail with "Soon" badges
    instead of the section-grouped `Sidebar`, and there is no top bar at all — so
    there is no global search, no notification access, no workspace switcher and no
    user menu anywhere on a wide screen.
  - On **mobile**, there is no header and no drawer, so settings, notifications and
    every non-bottom-bar module are unreachable except through the broken bottom bar.
- The codebase is not short of the finished components — it is short of someone
  mounting them.

---

## The routes

Classification: **A** = complete + real, **B** = partial (real but gated/honestly
incomplete), **C** = placeholder (`ComingNext`), **D** = broken, **E** = duplicate.

| Route | Current State | Backend Support | Action |
|---|---|---|---|
| `/dashboard` | A — 14 figures from `useDashboardSnapshot` (employees, projects, tasks, `organization_members`) | organizations, employees, projects, tasks, members | Leave as-is |
| `/projects` | A — `ProjectListView` (DataTable, filters, create) | full | Add row → detail navigation (P1) |
| `/projects/[id]` | **Missing route** — `useProjectDetail`, `getProject`, `listProjectMembers` fully built but unrouted | full | **Create (P1)** |
| `/tasks` | A — task list, filters, summary | full | Leave as-is |
| `/tasks/create` | A — create form | full | Leave as-is |
| `/tasks/[id]` | A — detail | full | Leave as-is |
| `/employees` | A — directory with departments/managers/filters | full | Leave as-is |
| `/more` | A — org record, role, theme, session | orgs/members | Leave as-is |
| `/ai` | B — honest screen; grounded path built, `GATEWAY_AVAILABLE=false` (no deployed Edge Function, no credential) | ai_providers only | Leave; do not fake activation |
| `/settings` | B — AI Providers real; Organization + Preferences cards say "Not built" | orgs + `updateOrganization` | Wire org edit + theme (P2) |
| `/workforce` | C — `ComingNext` | employees, members, snapshot → real headcount-by-status is possible (**no shifts/hours tables**) | **Rebuild honestly (P1)**: employment-state headcount, access holders, workload from `useDashboardSnapshot` |
| `/organizations` | C — `ComingNext` | `organization_members`, `organizationService.listMembers/countMembers` | **Rebuild (P1)**: membership switcher + member list; fixes the dashboard "Switch workspace" dead-end |
| `/reports` | C — `ComingNext` | `DashboardSnapshot` (the analytics contract) | **Rebuild (P2)**: read-only operational report from real facts |
| `/notifications` | C — placeholder that falsely claims the "notification centre lives in the top bar" | **no notification table** | **Honest screen (P2)**: state there is no backend; no fabricated feed |
| `/attendance` | C | **no table** | Keep placeholder |
| `/leave` | C | **no table** | Keep placeholder |
| `/payroll` | C | **no table** | Keep placeholder |
| `/inventory` | C | **no table** | Keep placeholder |
| `/procurement` | C | **no table** | Keep placeholder |
| `/resources` | C | **no table** | Keep placeholder |
| `/customers` | C | **no table** | Keep placeholder |
| `/vendors` | C | **no table** | Keep placeholder |
| `/finance` | C | **no table** | Keep placeholder |
| `/business-health` | C | **no table / no history** (schema stores current state, no history column) | Keep placeholder |
| `/ai-recommendations` | C | AI provider only; no recommendation source | Keep placeholder |
| `/ai-agents` | C | **no agent infrastructure** | Keep placeholder |
| `/knowledge-base` | C | **no document table** | Keep placeholder |
| `/copilot` | E — **intentional** re-export alias of `/ai`, deliberately absent from `destinations.ts` | as `/ai` | Leave; document |

**Tallies:** 7 A · 2 B · 17 C · 0 D · 1 E (intentional).

### Placeholders worth rebuilding (backend exists)

| Module | What a real screen can honestly show | What it must NOT show |
|---|---|---|
| `/workforce` | People on the books by employment state (active / probation / on leave / notice / inactive), access holders, current headcount, people carrying open work, workload distribution (manager+ only) | Shifts, hours, wage cost, coverage — none of those tables exist |
| `/organizations` | The workspaces this account belongs to, switching between them, and the member list + roles of the active one | Inviting people (needs an invite table and a policy) — kept off the screen |
| `/reports` | The full `DashboardSnapshot` — org-scoped counts of employees, projects, tasks, workload, deadlines, progress — as a read-only report | Trend lines, revenue, profit, a health score — none derivable |

### Placement summary (must stay placeholders)

`/attendance`, `/leave`, `/payroll`, `/inventory`, `/procurement`, `/resources`,
`/customers`, `/vendors`, `/finance`, `/business-health`, `/ai-recommendations`,
`/ai-agents`, `/knowledge-base` — none has a table behind it in
`supabase/migrations/` (only organizations, organization_members, departments,
employees, projects, project_members, tasks and ai_providers exist). A "real"
screen over no data would be the exact lie this product refuses to tell, so each
stays an honest `ComingNext` shell. Their `ready: false` state in
`src/navigation/destinations.ts` already documents this.

### Screens whose metadata must be re-stated

When `/workforce`, `/organizations` and `/reports` are rebuilt, their entries in
`src/navigation/destinations.ts` must move from `ready: false` to `ready: true`,
their `summary` rewritten to describe what they now actually show
(`/workforce` currently promises "shifts, hours, cost and coverage" — a promise the
schema cannot keep), and `arrivesIn` set to `'Available now'` to satisfy the
`appMap` test that pins every ready destination to that exact string.

---

## Other findings

- **GlobalSearch is foundation-only.** `src/components/navigation/GlobalSearch.tsx`
  renders the overlay and an honest "Nothing to search yet" empty state, and lists
  eight future scopes. Three of them — employees, projects, tasks — have real,
  searchable services (`employeeService.listEmployees`, `listProjects`,
  `taskService.listTasks`). Wiring search to those three, org-scoped, is a genuine P2.
- **`/projects/[id]` is pre-built but unrouted.** `useProjectDetail(projectId)`
  returns a tagged `{ project, members, isLoading, notFound, today }`, and
  `DataTable` already supports `onRowPress`. Only the route file and the row press
  are missing.
- **Dashboard "Switch workspace" dead-end.** `app/(app)/dashboard.tsx:300` pushes
  `/organizations` when a user with multiple memberships views an empty workspace —
  and `/organizations` is a `ComingNext` placeholder. Rebuilding it resolves the
  dead-end.
- **`useWorkforceSnapshot` is narrower than the module name implies** — it counts
  only login-access holders. The headcount-by-employment-state figures the workforce
  screen needs come from `useDashboardSnapshot`'s `employees` and `workload`
  sections. Both are real and both are tested (`workforceSnapshot.test.ts`,
  `dashboardMetrics.test.ts`).
- **Demo data is available** (`src/services/demoDataService.ts`, fixture
  `DEMO_ORGANIZATION_ID`: 5 employees / 3 projects / 12 tasks) and is automatically
  active for development; extending it is only justified where a rebuilt screen
  needs it.

---

## Required implementation order

Priorities are defined by the task brief: P0 (broken/core navigation) before P1
(placeholder modules with backend support), P1 before P2 (incomplete modules).
Nothing in P3/P4 (modules with no backend) is built while P0/P1 remains, because
the honest placeholder is the correct deliverable for those.

1. **P0** — fix `AppShell` to render `bottomBarDestinations` in the compact bottom
   bar, and add a regression test asserting the bar renders exactly those six tabs.
2. **P1** — mount the built chrome: `AppHeader` + `MobileDrawer` (+ `Sidebar` in
   the drawer and as the desktop rail) so search, notifications, workspace switching
   and the user menu are reachable on every form factor.
3. **P1** — add `/projects/[id]` and link rows from `ProjectListView` to it.
4. **P1** — rebuild `/workforce` honestly from the snapshot.
5. **P1** — rebuild `/organizations` as a membership list + switcher + member list.
   Re-express its `destinations.ts` metadata.
6. **P2** — wire `GlobalSearch` to org-scoped employees/projects/tasks.
7. **P2** — rebuild `/reports` from `DashboardSnapshot`, re-expressing its metadata.
8. **P2** — wire Settings' Organization/Preferences sections, and make
   `/notifications` an honest statement instead of a false claim.
9. Verify: keep the 856-test / 26-suite baseline green with new tests for every
   rebuilt module; `npm run verify`, `tsc --noEmit`,
   `eslint . --max-warnings=0`, `expo export --platform web`.