# Phase 32 — Core Business Data Foundation

## Status
COMPLETE, with one unverified area — see **Known Limitations**.

## Objective

Give Trackit X real business data. Until now the tenancy root existed and nothing
sat on top of it: `/employees` and `/projects` were honest placeholders saying so.
This phase adds the tables a working business actually runs on — departments,
employees, projects, project membership, tasks and an activity log — together
with the RLS that keeps one organization's rows away from another's, the typed
services that read and write them, and the two screens that make the foundation
visible.

Two constraints shaped everything below.

**Additive only.** The foundation migration
(`20260825120000_organizations_and_members.sql`) owns the tenancy root and is
never edited by a later phase. This phase adds
`20260925120000_core_business_data.sql` and reuses `is_organization_member`,
`has_organization_role` and `set_updated_at` rather than redefining them, so the
database keeps exactly one answer to "is this caller allowed to see this
organization".

**No invented data.** A payslip computed from a field nobody entered is a wrong
payslip, not an unfinished one. Where a later phase owns a rule — wage basis,
attendance, documents, leave, a nested org chart — this phase leaves the column
out rather than guessing at it.

## Implementation

### Schema

Six tables and five enums, all in
`supabase/migrations/20260925120000_core_business_data.sql`:

- **departments** — a flat per-organization list, deliberately carrying no
  manager. A two-level org chart is a later question, and encoding one now would
  mean rewriting the table the first time somebody needs it.
- **employees** — a person, independent of any login. `user_id` is nullable
  because most of a small business's workforce never signs in, and the record must
  survive the account: the FK is `on delete set null`, never cascade.
- **projects** — a unit of work with a schedule, an owner and a progress figure.
  `owner_id` is nullable on purpose (a project outlives whoever started it) and
  `progress` is stored rather than averaged from tasks, because a project's
  progress is a judgement its owner makes.
- **project_members** — who is on which project, in what capacity, at what
  allocation.
- **tasks** — a work item, optionally on a project. Both `project_id` and
  `assignee_id` are nullable, because a real business has work that is not tied
  to a job and work that nobody has claimed.
- **activity_log** — append-only. No UPDATE policy, no UPDATE grant.

Decisions worth stating because they look like omissions:

- **`project_members` has no `organization_id`.** The organization is reachable
  through `project_id`, and a third copy could disagree with the other two. RLS
  resolves the tenant with `is_organization_member(project_organization(project_id))`.
- **`employee_id_for_user(p_organization, p_user default auth.uid())` refuses any
  `p_user` that is not the caller's own.** The default alone would not have been
  enough. With the argument accepted unchecked, a member of A could call it with
  organization B and any auth uid, and a non-NULL answer would confirm that login
  is employed by B — an existence oracle straight across the tenant boundary,
  defeating the `employees` policy for the one fact it exists to withhold. Every
  call this schema makes passes the caller's own id, so closing it costs nothing.
- **A member cannot claim an unassigned task.** The `USING` clause compares
  `assignee_id = employee_id_for_user(...)`, which is NULL — not true — for an
  unassigned row, so a plain member's update matches nothing. A manager can still
  pick it up. This is pinned by a test rather than left to be discovered.

### RLS

SELECT is membership everywhere. Writes are role-gated, and the gates differ
because the tables are not the same kind of thing:

| Table | Insert / update | Delete |
| --- | --- | --- |
| departments, employees | admin | admin |
| projects, project_members | manager | admin (projects) / manager (memberships) |
| tasks | member, for their own or unassigned work; manager for any | manager |
| activity_log | any member (append only) | nobody |

Employees are admin-managed rather than manager-managed because an employee row
is the root of payroll, attendance and project attribution; a manager who needs
somebody on their project gets them added first. Project *deletion* is
admin-only because it cascades to its tasks.

### Write guards

RLS isolates rows; it cannot stop a row from *referencing* a row the caller must
not see. A member of A who learns the UUID of an employee in B could otherwise
write `projects.owner_id = <that uuid>` on their own organization's project: the
policy checks `organization_id`, which is A's, and sees nothing wrong — and the
join then confirms the stranger exists.

Six trigger guards close that: `guard_tenant_columns_immutable`,
`guard_employee_references`, `guard_project_references`, `guard_task_references`,
`guard_project_member_write` and `guard_activity_log_references`. The last one is
easy to skip because the table looks like a log rather than a relationship, but
every member may append to it, so without the check a member could write an entry
naming a colleague from another organization as its author — a forged audit
record inside a log the other organization can read.

`guard_project_member_write` requires both references to resolve *and* agree,
rather than relying on `project_org <> employee_org`, which is NULL — and
therefore not true — for a dangling reference.

### Client

- **Domain modules** (`src/domain/`) — `progress`, `employee`, `project`, `task`.
  Pure and testable with no renderer and no database: progress bounds and
  percentage-versus-ratio, date arithmetic in UTC so a deadline does not move a
  day west of Greenwich, overdue rules that exclude closed work, allocation
  summing that ignores invalid entries rather than poisoning the total.
- **Services** (`src/services/`) — `departmentService`, `employeeService`,
  `projectService`, `taskService`. Every read is organization-scoped, every write
  goes through the `ActionResult` shape the app already uses, and no UI module
  imports the Supabase client.
- **Search filters** (`src/lib/postgrestFilters.ts`) — `or=(...)` is a grammar
  supabase-js assembles by string interpolation, so a search term is a filter
  injection point. Values are quoted and escaped; the user's own `%` and `_`
  wildcards keep working, because a search field is expected to honour them.
- **Hooks** — `useEmployeeDirectory`, `useProjectList` / `useProjectDetail`,
  `useTaskList` / `useTaskDetail`. Filtering runs over rows already in memory, so
  typing in a search box does not generate a query per keystroke.
- **Screens** — `EmployeeDirectoryView` with a create form, and
  `ProjectListView` with a create form. Both replace placeholders, and
  `src/navigation/destinations.ts` now marks them `ready`.

### One design note on the hooks

Every fetched payload is tagged with the organization (or record) it was fetched
*for*, and the render asks "is this data the data in view?" rather than an effect
resetting state when the key changes. The first version used an epoch counter
compared inside a closure, which guards the *reply* but not the *render*: for one
frame after an organization switch the previous tenant's staff were still on
screen, and for the length of a slow read they stayed there. The tag removes that
window and deletes the counter, the reset effect and the cascading render that
came with them.

## Platform Support

- Desktop Web
- Tablet Web
- Mobile Web
- iOS
- Android

## Validation

- **TypeScript** — `npx tsc --noEmit`, clean.
- **ESLint** — `npx eslint . --max-warnings=0`, 0 errors and 0 warnings.
- **Tests** — 16 suites, 492 tests passing, including two new suites:
  - `tests/unit/domainRules.test.ts` (52 tests) — the pure rules, weighted
    towards the cases where the obvious implementation is wrong: `progress || 100`
    turning an untouched project into a finished one, `cancelled` reported as 0%
    rather than as not-progressing, `ramesh%` breaking the filter grammar.
  - `tests/unit/postgrestFilters.test.ts` (14 tests) — the search-filter grammar,
    including that a comma, a parenthesis and a quote in a search term cannot open
    a new clause.
- **SQL** — `supabase/tests/rls_isolation.sql` extended from 8 sections to 15.
  The new sections cover visibility on all six tables, the role gates, task
  ownership, every cross-organization reference, immutability, the append-only
  log, and the cascade behaviour of deletes.

**The SQL was not executed.** Docker is unavailable on the machine this was built
on, so there is no local Postgres to run it against. Every assertion in
sections 9–15 is a claim about intended behaviour, not an observed result. It
becomes evidence only once it has run and printed `PASS` lines. The assertions
were reviewed by hand for structure and for the arithmetic each one depends on —
three mistakes were found and fixed that way, including two row counts that
assumed a fixture had not been deleted by an earlier section, and an expectation
of a CHECK violation on `activity_log` that the missing UPDATE grant made
unreachable. That is review, not execution.

`npx expo-doctor` reports 14 out-of-date dependencies. This is pre-existing:
`package.json` and the lockfile are untouched by this phase, and the failure is
present at the parent commit. It was left alone rather than silently bumping
Expo packages inside a data phase.

## Known Limitations

- The migration and its RLS are unverified against a running database, as above.
  Apply it to a scratch project before trusting it with real rows.
- `/tasks` is still a placeholder. The schema, services and hooks for tasks are
  complete and tested; only the screen is missing.
- The employee form creates. There is no edit screen yet, so the footer does not
  promise one.
- `employee_code` is `NOT NULL` and unique per organization, and the form
  suggests one from the headcount. Two people adding a code at the same moment can
  still collide; the service maps the unique violation to a message the user can
  act on, and the form does not pretend the race cannot happen.
- `ProjectCreateForm` offers every employee as an owner, including those whose
  employment has ended. Restricting that to current staff is a small change and is
  a decision worth making deliberately rather than by omission.
- Over-allocation is reported and never enforced. People really are stretched, and
  making it a database error would mean the only way to record reality is a
  fiction.

## Git Commit

- Commit message: `feat(phase-32): build core business data foundation`
- Commit hash: recorded in the Phase 32 closeout report — see `git log -1`. A
  commit cannot embed its own hash, because embedding one would rename the commit.

## GitHub

- Remote: https://github.com/humzashaik24/TRACKIT_X
- Branch: `fix/format-money-parser-and-date-semantics`
- Push result: `6c4312a..0aed34f` — pushed.
