# Phase 29 — Application Shell

## Status
COMPLETE

## Objective

Build the application shell — the chrome every destination lives in. Deliver a
single source of truth for the information architecture in one destinations
table, the navigation surfaces that render from it (wide sidebar and compact
bottom bar), and the header affordances a business product needs: search,
notifications, organization switching, and a user menu. Each screen that is not
built yet must say plainly that it is not built yet rather than pretending to
be an empty working module.

## Implementation

- **24 destination routes** — one `DestinationPath` union and one exhaustive
  `META` table in `src/navigation/destinations.ts`, so a screen pointing at a
  file that does not exist is a compile error, not a tab that silently does
  nothing.
- **6 navigation sections** — Main, Work, Operations, Business, Intelligence
  and System, with `SECTION_ORDER` and `SECTION_LABELS` driving sidebar display.
- **22 ComingNext placeholder screens** — every `ready: false` destination
  renders an honest placeholder that names the page and the phase it arrives
  in. Only `/dashboard` and `/more` are functional.
- **Sidebar** (`src/components/navigation/Sidebar.tsx`) — the wide-layout
  shell, section-grouped from the destinations table.
- **AppHeader** (`src/components/navigation/AppHeader.tsx`) — the page header
  bar that hosts the search, notification bell, organization switcher and user
  menu.
- **MobileDrawer** (`src/components/navigation/MobileDrawer.tsx`) — the
  drawer-based navigation for compact layouts, carrying the full IA.
- **GlobalSearch** (`src/components/navigation/GlobalSearch.tsx`) — the
  command-palette style search surface. `HeaderPopover` supplies the shared
  popover plumbing (`src/components/navigation/HeaderPopover.tsx`).
- **NotificationCenter** (`src/components/navigation/NotificationCenter.tsx`) —
  renders the bell and the feed view states.
- **OrganizationSwitcher** (`src/components/navigation/OrganizationSwitcher.tsx`)
  — switch between the organizations the account works with, from
  `membershipChoices()`.
- **UserMenu** (`src/components/navigation/UserMenu.tsx`) — account and
  session affordances.
- **Breadcrumbs** (`src/components/navigation/Breadcrumbs.tsx`) — the rendered
  trail.
- **PageHeader** (`src/components/navigation/PageHeader.tsx`) — the standard
  page title header.
- **deriveBreadcrumbs()** (`src/navigation/breadcrumbs.ts`) — derives the
  trail from the route, never hand-written per screen; the current page is the
  last crumb and never links to itself, and nested detail routes get a parent
  crumb that links back.
- **NotificationFeedState** (`src/features/notifications/model.ts`) — the pure
  feed contract as a discriminated union over `loading` / `error` / `empty` /
  `ready`, unit-testable without a renderer or database. The feed is honestly
  `empty` today because no notification table exists yet.
- **membershipChoices()** — the organization membership list backing the
  organization switcher.
- **useEscapeToClose** (`src/components/navigation/useEscapeToClose.ts`) — a
  shared hook so every popover and drawer closes on Escape.

## Platform Support

- Desktop Web
- Tablet Web
- Mobile Web
- iOS
- Android

## Validation

- 14 test suites
- 425 tests passing
- ESLint: 0 warnings
- TypeScript: clean

## Known Limitations

Only the implemented routes are functional: `/dashboard` and `/more`. The
remaining 22 ComingNext screens are placeholders — they render honest "not
built yet" pages and must NOT be treated as working features. Every other
destination arrives in a later phase. There is no notification table yet, so
the notification feed is empty by design. The app shell itself is complete for
all five platforms.

## Git Commit

- Commit message: `feat(phase-29): build application shell`
- Commit hash: recorded in the Phase 29 closeout report — see `git log -1`. A commit cannot embed its own hash, because embedding one would rename the commit.

## GitHub

- Remote: https://github.com/humzashaik24/TRACKIT_X
- Push result: _(confirmed after push)_