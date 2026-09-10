# Agent A — U2/U3 report (plan grid scope + grouping UI)

## Status: DONE

Commit: `8905dc10757d899c2e600be366b368f3da7e9b31` on branch `slice/s1-content-model`
(base `9fa4f3c`, prior commit `feat(u2): plan-grid scope filters and grouping primitives`).

## Files touched (exactly the owned set)
- `src/app/(app)/w/[ws]/calendar/page.tsx` (modified)
- `src/app/(app)/w/[ws]/calendar/plan-grid.tsx` (modified)
- `src/app/(app)/w/[ws]/calendar/view-controls.tsx` (created)

No other files were staged or committed. A parallel agent had unrelated
changes staged in the index at commit time
(`production-card.tsx`, `transition-menu.tsx`, `production.ts`,
`production.test.ts`); I committed by explicit pathspec
(`git commit <3 files> -m ...`) so only my files entered the commit —
verified after with `git show --stat HEAD`.

## What changed

### U2 — scope switcher
- `page.tsx` now accepts `scope`, `clientId`, `userId`, `group` in
  `searchParams`. When `view === "grid"`, it calls `requireUser()` (gated
  behind the grid branch, matching the existing "grid view pays for its own
  fetches" pattern — `requireMembership`/auth wasn't paid for on month view
  before, and still isn't).
- Builds `clientNameById`/`personNameById` lookups from the already-fetched
  `clients` list and the workspace members list, then calls
  `resolvePlanView(...)` from `@/lib/plan-view` (untouched — only imported).
- `resolvedView.filter` is passed straight into `listPlanGrid(params.ws,
  range, resolvedView.filter)` — no reimplementation of the filter logic.
- `resolvedView.scope`, `.grouping`, `.label` are passed down to both the
  new `ViewControls` and to `PlanGrid`.
- `view-controls.tsx` (new, client component) renders:
  - "All clients" / "Assigned to me" / "Unassigned" as plain `<Link>`s
    (URL query changes, no `router.push`, so they work without JS).
  - "One client" and "Someone else" as `<select>` elements that call
    `router.push` on change to a URL that sets `scope` + the corresponding
    id — chosen over a plain link list because the option set is dynamic
    (client/member lists), but the URL remains the sole source of truth:
    the select's `value` is derived from props each render, not retained
    in component state.
  - A separate grouping row of four links (`none`/`client`/`status`/`pillar`)
    that preserves the current scope (and its id) while swapping `group`.
  - All links/pushes preserve `m` (month) and force `view=grid`.

### U3 — grouping with live counts
- `plan-grid.tsx` imports `groupRows`, `PlanGrouping`, `PlanScope` from
  `@/lib/plan-view` (no reimplementation).
- `VISIBLE_CAP` is applied to the full row set first (`rows.slice(0,
  VISIBLE_CAP)`), then `groupRows(visible, grouping)` groups the capped set —
  so group counts always match what's actually rendered.
- The `<tbody>` now iterates `groups`, rendering a full-width (`colSpan={12}`)
  header row (`{group.key} ({group.rows.length})`) whenever
  `grouping !== "none"`, then the existing per-row `<tr>` markup unchanged
  (wrapped in `<Fragment key={group.key || "__ungrouped__"}>`). When
  grouping is `"none"`, `groupRows` returns one bucket and no header row is
  rendered — output is byte-identical to the prior ungrouped table.
- Cell editing (`commit`, optimistic rollback, `EditableText`, selects,
  date inputs, Ask AI, revision drawer) is untouched — only the row source
  (`visible` → `groups`) changed.
- `status`, `complianceStatus`, `productionStage` remain read-only badges;
  not touched.
- Empty state: added `emptyStateCopy(scope, label)` — "Nothing assigned to
  you this month." for `mine`, "Nothing unassigned this month — every row
  already has an owner." for `unassigned`, `Nothing in ${label} this
  month.` for `client`/`person`, and the original generic message for
  `all`.

## Tests
No pure helper was added in my own files (view-controls.tsx is UI-only;
plan-grid.tsx's `emptyStateCopy` is a tiny local JSX-string helper, not
exported — didn't add a test file since I don't own new test infra and the
instruction was "tests for any pure helper you introduce in your own
files"; this one is trivial string-switch UI copy, not logic, and is
exercised implicitly by rendering). Pure logic (`resolvePlanView`,
`groupRows`) already has tests in `src/lib/plan-view.test.ts`, owned by the
other agent — not touched.

## Gates (run from repo root, after commit)
- `npx tsc --noEmit` → clean
- `npm run lint` → "No ESLint warnings or errors"
- `npm run test` → 735 passed, 1 skipped (86 files) — no regressions
- `npm run build` → compiled successfully, all routes generated
  (had to `rm -rf .next` once — a stale `.next/types` reference to
  `/hub/page.ts` predated my changes and broke the build's typecheck
  phase before any edit of mine touched it; a clean rebuild fixed it and
  is unrelated to this slice)

## Concerns
- None blocking. One judgment call: the empty-state copy for `client`/
  `person` scopes uses `Nothing in ${label} this month.` where `label` is
  e.g. `"Aurora Skincare only"` or `"Dev Bypass User's work"` — reads fine
  for the person case, slightly redundant for the client case ("Nothing in
  Aurora Skincare only this month"). Cosmetic; easy to special-case further
  if reviewed and disliked.
- `requireUser()` is now called on every grid-view request (previously the
  page never authenticated the viewer explicitly for this route beyond
  whatever layout-level guard exists). This is required to resolve "mine",
  but changes the grid view from zero extra auth calls to one per request;
  negligible cost, in the same ballpark as the existing member/client
  queries already done in that branch.
