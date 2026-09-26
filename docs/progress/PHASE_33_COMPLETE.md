# Phase 33 — Task & Work Management

## Status
COMPLETE, with known limitations stated below rather than left to be discovered.

## Objective

Finish `/tasks`. Phase 32 built the schema, the service and the hooks and left the
screen as a placeholder that said so; this phase makes it real — a list you can
triage, a form that raises work, and a detail screen where a task is moved,
reassigned, edited and deleted.

Two constraints shaped the work.

**The policy is the authority.** `tasks_insert_members`,
`tasks_update_own_or_managers` and `tasks_delete_managers` were written in Phase 32
and are not edited here. Everything this phase adds on the client is an affordance
that mirrors a policy, and where the two could disagree the policy wins — the
screenshot is a promise, the database is the fact.

**Nothing new is invented.** There is no archive column, no dependency table and no
comment thread, because none of those exist. Where the schema is silent, the screen
is silent too rather than filling the gap with a guess.

## Implementation

### No migration

This phase adds no migration. The Phase 32 schema already carried everything tasks
needed, and the temptation to add an `archived_at` or a `blocked_reason` because a
form felt incomplete was declined. The first change to `tasks` should be a decision
about what the business actually does, not a byproduct of building a screen.

### Domain

`src/domain/task.ts` gained three things, all of them pure and all of them tested:

- **`sortTasks`** — orders by title, status, priority, due date or assignee. Status
  and priority rank against `TASK_STATUSES` / `TASK_PRIORITIES` rather than being
  compared as text, because those arrays are the order work moves through and
  alphabetical order breaks the reading in both directions. Ties break on the row
  id, not on array position, so the result depends on the data and not on the engine.
- **`canCreateTasks` / `canAssignTasksToOthers` / `canAssignTaskTo` /
  `canEditTask` / `canDeleteTasks`** — the five UI decisions the three policies imply.
  A member is offered exactly two assignee targets: themselves and nobody. A manager
  is offered everybody.
- **`OPEN_TASK_STATUSES` and `isOpenTask`** — the one definition of "open", shared
  with the project list's count query so the two cannot disagree about which tasks
  count. `canRecordOwnProgress` came with them: which status moves somebody is
  allowed to record effort against, and which hands the work on.

### The three screens

**`app/(app)/tasks.tsx`** — the list. Metrics across the top, a search field, a
status chip row, a priority chip row, project and assignee pickers, a sortable
`DataTable`, and a "New task" action. Priority got its own row rather than a place
in the status bar: both are chips that look identical, so mixing them would leave a
number whose meaning depends on which side of the row it is on.

**`app/(app)/tasks/create.tsx`** — a route, not a modal. A software keyboard inside a
modal on a phone is a worse place to type than a screen that scrolls under it, and a
route means the create action is linkable instead of being local state.

**`app/(app)/tasks/[id].tsx`** — the detail. Status, progress and assignee write
immediately, because those are the three things somebody changes while reading a
task and the most common action in the app should not require opening a form. The
edit form is for the things that need typing.

### Project and employee integration

`openTaskCountsByProject(organizationId)` groups open tasks by project in one
query, and the project list now shows an **Open tasks** column. The count is a
column on no table: it is a fact about the tasks pointing at a project, it changes
when a task is created, reassigned or closed, and storing it would mean three more
statements to keep it true and a denormalized number quietly wrong the first time
one was forgotten.

Employee integration is through the assignee pickers, filters and the "Mine" chip,
all fed by `useEmployeeDirectory`.

## Three bugs found and fixed

These are the substantive part of the phase. Each was found by writing the test that
should have existed.

### 1. Undated tasks sorted first when the due-date header was ascending

`sortTasks` ranked a missing due date as `''`, on the reasoning that `''` sorts below
every `YYYY-MM-DD` and so lands at the end. That is true going **down** and false
going **up**: ascending put every undated task at the *top* of the list, and the
toggle moved them from top to bottom on each click. A task appearing first under
"due descending" would read as the most urgent thing on screen.

Fixed by taking nulls out of the comparison rather than ranking them. One `null`
argument is not enough to report "these are equal" — an undated task is not equal to
a dated one, it ranks below all of them.

### 2. A member with no employee row could be shown the unassign control

`canAssignTaskTo` returned `true` for a `null` target before it checked whether the
caller had an employee row, contradicting its own doc comment. A login that is not
on the payroll has nothing to show the control would have been assigning away from,
so the one selectable value would be the one already set. The `currentEmployeeId ===
null` check now comes first, on the member path only — a manager's grant comes from
the role and does not depend on being an employee.

### 3. A viewer-role caller — or any caller whose role had not loaded — was offered edit controls it could not use

`canEditTask` fell through to `assignee_id === currentEmployeeId` for any role below
manager. `tasks_update_own_or_managers` opens with `is_organization_member`, and an
absent role is not a member of anything, so the screen drew an edit form whose every
save was refused. The member floor is now explicit.

There is no `viewer` role in this schema — the hierarchy is owner / admin / manager /
member — so the reachable case is `role === null` while the role is still loading.

## Validation

- **TypeScript** — `npx tsc --noEmit`, clean.
- **ESLint** — `npx eslint . --max-warnings=0`, 0 errors, 0 warnings. Two React
  Compiler rules fired during the work and both were fixed properly rather than
  suppressed: a ref mutated during render (moved into an effect, with a comment on
  why an effect is safe there) and a draft seeded from props inside an effect
  (replaced by keyed child components whose `useState` initialisers run once).
- **Tests** — 17 suites, 519 tests passing, including two extended or new suites:
  - `tests/unit/domainRules.test.ts` (72 tests, up from 52) — sorting, undated-task
    placement in both directions, the lifecycle ordering of status and priority, the
    id tiebreak, and all five permission predicates against the real role set.
  - `tests/unit/taskHooks.test.tsx` (7 tests, new) — the organization switch, using
    a deferred promise rather than a timer so the slow response is released last
    every time instead of depending on machine speed. A task id is stable across a
    switch and the URL does not change, so the organization tag on each load is the
    only thing stopping one tenant's task from rendering under another's header.
    The slow-response test was validated by removing the guard: it fails, with A's
    rows replacing B's.
- **SQL** — `supabase/tests/rls_isolation.sql` **executed** against the local Docker
  stack for the first time. 124 assertions, 0 failures. This is the first phase in
  which the SQL suite is evidence rather than a claim.
  - Section 16 is the addition: the grouped open-task read the project list now
    depends on. It pins the three ways that read can go wrong — counting another
    organization's tasks, counting closed work, and attributing a project-less task
    to some project via a naive join. It also asserts that the status list in the
    read covers every value of the `task_status` enum, so widening the enum without
    widening the query fails here rather than quietly understating a count.
  - The file's header previously claimed sections 16–21 existed. They did not, and
    sections 12–15 already covered task ownership, cross-organization references,
    ranges and cascade. Six sections of invented assertions would have been padding,
    so the header was corrected and the one genuinely uncovered query was added.
- **Web export** — `npx expo export --platform web`, 1,618 modules, and the three
  new screens confirmed present in the bundle.

## Platform Support

- Desktop Web
- Tablet Web
- Mobile Web
- iOS
- Android

## Known Limitations

- **Expo typed routes are generated by `expo start`, not `expo export`.** The nested
  `/tasks/create` and `/tasks/[id]` routes are absent from
  `.expo/types/router.d.ts` until the dev server has run at least once. The routes
  themselves work; only the generated `Href` union lags. A fresh clone will show
  four type errors in these two files until `npx expo start` has been run.
- **Task progress is a recorded figure, not a computed one.** Nothing derives it
  from status, deliberately — a project's progress is a judgement its owner makes and
  a task's is the person doing the work. A `done` task *displays* as 100% because
  that is the honest reading, but the stored number is left exactly as recorded.
- **There is no comment thread, no attachment and no dependency.** A task can be
  blocked but cannot say why. This is a gap, not a decision.
- **The employee picker offers employees whose employment has ended.** Carried over
  from Phase 32 and still true here. It is a small change and it is a decision that
  should be made deliberately.
- **Overdue is derived from the date and the status, never stored.** A task that
  goes past its due date becomes overdue with no write, which is right, and also
  means there is no "was overdue" history.
- **`npx expo-doctor` reports out-of-date dependencies.** Pre-existing and present
  at the parent commit; `package.json` is untouched by this phase.

## Git Commit

- Commit message: `feat(phase-33): build task and work management screens`
- Commit hash: recorded in the Phase 33 closeout report — see `git log -1`. A commit
  cannot embed its own hash, because embedding one would rename the commit.

## GitHub

- Remote: https://github.com/humzashaik24/TRACKIT_X
- Branch: `fix/format-money-parser-and-date-semantics`
