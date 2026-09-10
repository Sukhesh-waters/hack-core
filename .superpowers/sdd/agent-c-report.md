# Agent C — U4 detail panel

## Status: DONE

Commit: `63cdfe1` — feat(u4): calendar row detail panel — Jira-style edit without losing your place

## Files touched (exactly the owned set)
- `src/app/(app)/w/[ws]/calendar/detail-panel.tsx` (new)
- `src/app/(app)/w/[ws]/calendar/plan-grid.tsx` (modified)
- `src/app/(app)/w/[ws]/calendar/actions.ts` (modified)
- `src/app/(app)/w/[ws]/calendar/page.tsx` — untouched; nothing new was
  needed there since detail data is fetched on demand client-side.

## What was built
1. `detail-panel.tsx` — fixed right-side panel (`fixed inset-y-0 right-0
   w-full max-w-md`, styling matches `revision-drawer.tsx`). Order: editable
   title + client name + "Open in Studio" deep link → read-only badges
   (status/complianceStatus/productionStage) → editable type, duration
   (video types only, same `isVideoContentType` rule as the grid), pillar,
   strategy note, assignee, due date, scheduled date → pending-suggestions
   count/button (opens the existing `RevisionDrawer` via the same `openRow`
   state) → activity timeline → comment thread + add-comment box.
2. `plan-grid.tsx` — exported `labelize`/`toLocalInput` (reused, not
   duplicated) for the panel; added a dedicated leading "open" affordance
   column/button per row (does not sit on any editable cell); added
   `detailRowId` state; renders `DetailPanel` wired to the SAME `commit()`
   optimistic/rollback closure the grid cells already use, so panel edits
   and grid edits share one code path. `suppressClose` prop stops the
   panel's own Escape/outside-click handling from fighting the
   RevisionDrawer when it's layered on top for the same row.
3. `actions.ts` — added `loadRowDetailAction(workspaceId, contentId)`
   (activity + comments, `requireUser()` + `requireMembership()`,
   workspace-scoped) and `addPlanRowCommentAction` (posts via existing
   `addComment` query, re-reads the capped 200-row thread). Existing
   actions' behavior untouched.

## Gates
`npx tsc --noEmit` clean · `npm run lint` clean · `npm run test`: 769 passed,
1 skipped · `npm run build` succeeds (verified with `.next` fully rebuilt).

## Concerns
- Mid-run, `npm run build` transiently failed on an unrelated,
  concurrently-edited file (`src/components/transition-menu.tsx`, owned by
  another agent) — confirmed via stash-isolation that it was not caused by
  this slice; it resolved once that agent's edit landed. No action taken on
  that file.
- Comment posting re-fetches the full (200-cap) thread on each post rather
  than optimistic client-side append, since `addComment` doesn't return the
  inserted row and that query file is out of scope for this slice.
