/**
 * Trackit X — `/copilot`, an alias for the AI Copilot screen.
 *
 * ── Why this route exists ───────────────────────────────────────────────────────
 * The navigation calls the feature "AI" because that is the slot in the information
 * architecture; the feature itself is a Copilot, and `/copilot` is the URL that says
 * so. A shared link from a support conversation, a bookmark, or a future deep link
 * from a notification should not have to claim to be an "AI" page to reach it.
 *
 * ── Why it is a re-export and nothing more ──────────────────────────────────────
 * The screen lives at `/ai` because that is where the navigation points and where the
 * breadcrumbs, the active tab and the destination metadata are keyed. This file adds
 * no component, no state and no logic, so there is nothing here that can drift from
 * the screen it points at. It is deliberately absent from `destinations.ts`: a second
 * entry in the sidebar would be the same destination listed twice, and the table is
 * read by both the sidebar and the bottom bar.
 *
 * The one honest cost: `activeDestination('/copilot')` resolves to `undefined`, so no
 * tab highlights on this path. That is the correct behaviour for a route with no menu
 * entry, and it is cheaper than the alternative — a duplicate sidebar item.
 */
export { default } from './ai';
