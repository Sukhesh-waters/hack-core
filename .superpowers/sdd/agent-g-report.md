# U9 — Team Hub inline task status control

## Files touched
- `src/lib/hub-workflow.ts` (new) — status graph (`open <-> done`) mirroring `idea-workflow.ts`'s shape: labels, static Tailwind chip classes, a transition table, `isValidHubTaskTransition`, `nextHubTaskStatusesFrom` (disabled-with-reason for illegal moves), and the `hubTaskStatusFromDone` / `doneFromHubTaskStatus` view functions over the existing `done` boolean.
- `src/lib/hub-workflow.test.ts` (new) — unit tests plus the required exhaustive property check: for every `(from, to)` status pair, `nextHubTaskStatusesFrom(from).find(to).allowed === isValidHubTaskTransition(from, to)`.
- `src/app/(app)/w/[ws]/hub/actions.ts` — replaced `setTaskDone` with `setHubTaskStatus(workspaceId, taskId, from, to)`: re-validates the transition server-side against the same graph, then does the UPDATE with `WHERE workspaceId = ? AND id = ? AND done = doneFromHubTaskStatus(from)` using `.returning({id})`. Zero rows back → `{ error: "This task already changed — refresh to see its latest status." }` instead of silently overwriting a raced change. Uses `guard(workspaceId)` as required.
- `src/app/(app)/w/[ws]/hub/team-hub-canvas.tsx` — task row now uses the existing generic `StatusMenu` (imported, not modified) instead of the checkbox toggle. Added a keyed `busyKeys` Set + `runAction(key, fn)` helper so every action trigger (send message, request approval, approve/reject — both in the approval rail and inline in chat, add task, task status, task priority, add reminder) shows a busy label/opacity and disables itself during its round-trip — previously `isPending` from `useTransition` was discarded and nothing showed busy state. Moved the error banner above the whole two-column grid so a failure from any control is visible rather than only appearing inside the chat pane.

## Activity write
Skipped intentionally. `ActivitySubjectType` only allows `content | idea | ticket | campaign | doc | client` — none honestly describes a hub task (a schema-enforced scratch list with no assignee, distinct from tickets by design). Recording it under `"ticket"` would blur exactly the distinction the scope boundary protects, so `recordActivity` is not called for this transition. Documented inline in `actions.ts`.

## Status
Done.

## Commit
`4e924f4` — feat(u9): inline Jira-style status control for hub tasks

## Tests
`npx tsc --noEmit` clean. `npm run test` → 91 files, 816 passed / 1 skipped (baseline 769; delta is new hub-workflow tests + other parallel slices' additions already on the branch). `eslint` scoped to my 4 files: clean. Full `npm run lint` / `npm run build` fail on `calendar/plan-grid.tsx` (a parse error in a file owned by another parallel agent, mid-edit, outside my ownership) — skipped per the gate's own carve-out.

## Concerns
- `hubTasks` has no `status` enum, only `done: boolean`, so `HubTaskStatus` is a derived 2-node view, not a persisted field — by design per the task brief, but flagging since it's a thinner "status graph" than idea-workflow's 3-node one.
- Did not touch `db/queries/hub.ts` (out of ownership) — `setHubTaskStatus`'s guarded UPDATE lives directly in `actions.ts` using `db`/`hubTasks` imported from `@/db` and `@/db/schema`. The old `setHubTaskDone` query function in `db/queries/hub.ts` is now unused dead code (left as-is, not my file to remove).
- Full `lint`/`build` unverified end-to-end due to the parallel agent's in-progress calendar file; re-run once that lands.
