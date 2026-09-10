# Audit: Operate Core (overview, hub, plan)
Generated: 2026-07-14 | Agent: Sonnet 5

## overview
Pure read-only screen. No forms, no server actions, no mutations. Auth/membership
is enforced upstream by `src/app/(app)/w/[ws]/layout.tsx` (`requireUser` +
`requireMembership`, `notFound()` on failure) before `overview/page.tsx` ever runs.

### Flows traced
- Page load → `overview/page.tsx:13` `getOverviewData(params.ws)` → `src/lib/data/overview.ts:2` re-exports `liveOverview` → `src/lib/data/live/overview.ts:66` `liveOverview()` → 7 parallel Drizzle queries against `schedule`, `content`, `hubApprovals`, `ideas` → read-only, no DB effect.
- "Generate ideas" / "Review month plan" / "View calendar" quick-action links → `overview/page.tsx:37-53` → plain `<Link>` to `/w/[ws]/ideation`, `/w/[ws]/plan`, `/w/[ws]/calendar` — all three routes exist under `src/app/(app)/w/[ws]/`. Not dead ends.

### Findings
- [Low] Quick actions labeled misleadingly generic — `overview/page.tsx:36-53` — "Review month plan" links to `/plan` (proposed-ideas queue) not a calendar/month view; cosmetic naming only, not a functional bug.
- [Low] `board` query has no explicit `.limit` ordering guarantee beyond insertion order — `src/lib/data/live/overview.ts:120-129` — the production-board preview shows an arbitrary 5 of N draft/review/approved items (no `orderBy`), so the "board" widget can show different rows each request even with no underlying change once ties are broken by physical row order; minor UX inconsistency, not a security/isolation issue.

No workspace-isolation, auth, or two-layer issues found — all 7 queries filter by `workspaceId`, and none touch `posts`/pattern data.

## hub
Team Hub is a client canvas (`team-hub-canvas.tsx`) backed by 9 server actions in
`hub/actions.ts`, all funneled through a shared `guard()` helper
(`requireUser` + `requireMembership`), Zod-validated, and wrapped in
`try { } catch { return { error: actionErrorMessage(error) } }`.

### Flows traced
- Send message → `sendMessage()` (client) → `sendHubMessage()` `hub/actions.ts:59` → `guard()` → `addHubTextMessage()` `db/queries/hub.ts:114` (INSERT `hub_messages`, workspace-scoped via input) → `stateAfter()` broadcasts realtime signal + returns fresh `liveTeamHub()` state, applied directly into React state.
- Request approval → `requestApproval()` → `requestHubApproval()` `hub/actions.ts:82` → `createHubApproval()` `db/queries/hub.ts:122` (INSERT `hub_approvals` + linked system message) → realtime broadcast scope `"approvals"`.
- Approve/reject approval → `decide()` → `decideApproval()` `hub/actions.ts:106` → `decideHubApproval()` `db/queries/hub.ts:144` — transactional UPDATE `hub_approvals` guarded `WHERE workspace_id=... AND id=... AND status='pending'`, cascades to `campaigns.status` (active/rejected) guarded `WHERE workspace_id=... AND id=... AND status='pending_approval'` — correct guard-in-WHERE pattern, workspace-scoped on both statements.
- Add/toggle/reprioritize task → `createTask`/`setTaskDone`/`setTaskPriority` (`hub/actions.ts:131,155,176`) → `db/queries/hub.ts:184,192,208` — all workspace-scoped INSERT/UPDATE.
- Add reminder → `createReminder()` `hub/actions.ts:199` → `addHubReminder()` `db/queries/hub.ts:224` — workspace-scoped INSERT.
- Accept/reject plan idea from Hub's "Plan · Validate" rail → `decidePlan()` (client) → `decidePlanIdea()` `hub/actions.ts:225` → **accepted**: `acceptIdea()` `src/lib/plan/accept-idea.ts:28` (shared with the Plan page — same code path, confirmed single source of truth) → **rejected**: `rejectIdea()` `db/queries/ideas.ts:69`.
- Realtime refresh → `use-hub-realtime.ts` subscribes to `ws:{workspaceId}:hub` Supabase channel; on any signal, client calls `fetchHubState()` → full re-fetch (signal payload carries no tenant data, satisfying the isolation note in `realtime.ts:1-5`). 30s poll fallback covers missed signals (degradation ladder honored).

### Findings
- [Medium] Wrong/nonexistent realtime scope broadcast on idea decision — `hub/actions.ts:238` — `decidePlanIdea()` calls `stateAfter(input.workspaceId, "messages")` after accepting/rejecting an idea, but the actual mutation affects the "Plan · Validate" rail (`planQuickView`), not chat messages. `HubScope` (`src/lib/realtime.ts:7`) only defines `"messages" | "approvals" | "tasks" | "reminders"` — there is no scope for plan/ideas. Concrete failure: the acting user's own screen updates correctly (the action return value is applied directly via `apply()`), but every **other** connected teammate's tab receives a `"messages"`-labeled signal and blindly refetches full state anyway (current `refresh()` ignores `scope` entirely — see below) so in practice this is masked; if a future refactor makes the client scope-selective (a reasonable next step given the type exists), idea accept/reject stops propagating live and silently falls back to the 30s poll.
- [Medium] `onSignal` ignores `scope` entirely, making `HubScope` dead code today — `team-hub-canvas.tsx:77` (`onSignal: () => refresh()`) — the `scope` parameter threaded all the way from `broadcastHubSignal` through `useHubRealtime` is discarded; every signal triggers a full `fetchHubState()` regardless of scope. Not wrong per se (correctness is preserved) but the entire scope-typing exercise (`HubScope`, per-action scope literals) is unused/dead — wasted plumbing that also hides the bug above.
- [High] Race condition on idea accept can create duplicate content rows — `src/lib/plan/accept-idea.ts:33-37` + `hub/actions.ts:233` + `plan/actions.ts:37` — `acceptIdea()` does a plain `SELECT` (`getIdea`) then an application-level `if (idea.status !== "new") throw`, then performs a multi-second AI draft generation, an `INSERT INTO content`, and only *afterward* an UPDATE guarded `WHERE status='new'` (`markIdeaDrafted`, `db/queries/ideas.ts:35-40`). There is no transaction and no row lock spanning the check + AI call + insert. Concrete failure scenario: the same idea is visible in both Hub's "Plan · Validate" rail and the Plan page simultaneously (by design — both read `status='new'` ideas); if User A clicks Accept in Hub and User B clicks Accept on the same idea in Plan within the several-second AI-generation window, both requests pass the `status !== "new"` guard before either writes, both call `generateDraft` (double AI spend), both `INSERT INTO content` (two duplicate content rows for one idea, no unique constraint on `content.ideaId` — confirmed absent in `src/db/schema.ts:225`), and both then hit `markIdeaDrafted`'s WHERE-guarded UPDATE (only the first succeeds, but by then the damage — duplicate content — is already done). Client-side, `decidingIdeaId` state (`team-hub-canvas.tsx:53,144`) only prevents a *single browser tab* from double-submitting; it does nothing across tabs, sessions, or the Hub/Plan page pair.
- [Low] Hub idea-decision actions never call `revalidatePath` — `hub/actions.ts` (entire file) — every hub action relies on returning fresh `TeamHubData` directly into client state plus a best-effort realtime broadcast; this is fine for the Hub canvas itself (client-rendered), but `decidePlanIdea` mutates the same `ideas`/`content` rows the server-rendered Plan page (`plan/page.tsx`, `dynamic = "force-dynamic"`) reads via `listNewIdeas`. Concrete scenario: user accepts/rejects an idea from Hub, then client-navigates (soft nav, e.g. via the sidebar `<Link>`) to `/plan` — Next.js's client Router Cache can serve a previously-cached RSC payload for a dynamic route for a short window, showing the just-decided idea as still "new." A hard refresh or the cache's own expiry fixes it, so this is transient/low-severity, but it is a genuine gap versus `plan/actions.ts`, which correctly calls `revalidatePlanAndProduction()`/`revalidatePath('/plan')` after the equivalent server-side mutation.
- [Low] `format` fallback for the Hub plan quick-view silently defaults to "Post" — `src/lib/data/live/team-hub.ts:120` (`format: i.format ?? "Post"`) — if `ideas.format` is null (permitted by schema), the badge always reads "Post" instead of an "unspecified"-style label, which could mislead a reviewer accepting from the rail without opening the full Plan card.

No workspace-isolation or two-layer leaks found in Hub: every `db/queries/hub.ts` read/write filters `workspace_id`, `decideHubApproval`'s campaign cascade double-guards workspace_id on both statements, and `ideasQuickViewQuery` only reads the `ideas` table (no pattern-layer `posts` involved). Error handling is consistently routed through `actionErrorMessage` — no raw error leakage found in any of the 9 actions.

## plan
Server-rendered queue (`plan/page.tsx`) backed by 3 server actions in
`plan/actions.ts` (`acceptIdeaAction`, `editIdeaAction`, `rejectIdeaAction`),
each independently calling `requireUser` + `requireMembership` (no shared
`guard()` helper here, unlike Hub, but equivalent coverage).

### Flows traced
- Page load → `plan/page.tsx:15` `listNewIdeas(params.ws)` → `db/queries/ideas.ts:63` → `newIdeasQuery()` `db/queries/ideas.ts:43` (INNER JOIN `clients`, `WHERE workspace_id=... AND status='new'`) → then `getPostsByIds(params.ws, allCited)` `db/queries/posts.ts:129` to resolve citation captions for the "why this idea" panel — read-only.
- Click "Accept" (form submit, no client JS state beyond `useFormState`) → `acceptIdeaAction()` `plan/actions.ts:23` → Zod-parse → `requireUser` + `requireMembership` → `acceptIdea()` `src/lib/plan/accept-idea.ts:28` (same shared path as Hub) → `revalidatePlanAndProduction()` `plan/actions.ts:13` (`revalidatePath('/plan')` + `revalidatePath('/production')`) — correct, since accept creates a `content` row that Production reads.
- Click "Edit" → local `mode="editing"` (client-only, no server round trip to open) → Save → `editIdeaAction()` `plan/actions.ts:65` → Zod-parse (topic 3-120 chars, hook 3-200, angle/format optional ≤300/60) → `requireUser`+`requireMembership` → `updateIdeaFields()` `db/queries/ideas.ts:87` (UPDATE guarded `WHERE workspace_id=... AND id=... AND status='new'`) → `revalidatePath('/plan')`.
- Click "Reject" → local `mode="rejecting"` → Confirm → `rejectIdeaAction()` `plan/actions.ts:98` → Zod-parse (reason required, 3-500 chars) → guard → `rejectIdea()` `db/queries/ideas.ts:69` (UPDATE guarded `WHERE status='new'`, sets `status='archived'`, `rejectionReason`) → `revalidatePath('/plan')`.
- Empty state → 0 ideas → `plan/page.tsx:50-63` renders a real CTA card linking to `/ideation` — not a dead end.

### Findings
- [Low] `getPostsByIds` does not filter `source='first_party'` — `src/db/queries/posts.ts:129-135` — every sibling query in this file (`baselineQuery`, `similarPostsQuery`, `topMoversQuery`) explicitly hard-filters `eq(posts.source, "first_party")` and documents the two-layer rule inline; `getPostsByIds` (used by `plan/page.tsx:21` to resolve citation captions for the "↳ first-party: ..." UI label) has no such filter. Currently **not exploitable**: `idea.citations` can only ever contain ids drawn from `retrieval.drivers` (`src/lib/ai/retrieval.ts`), which are themselves hard-filtered to `source='first_party'` at the SQL layer before the AI ever sees them (`validateCitations()` in `src/lib/ai/ideation-agent.ts:42-54` further strips any id not in that allowed set). So today, no pattern-layer post can reach this query. This is a latent defense-in-depth gap, not a live leak — flagging because the constitution's two-layer rule is enforced by convention (filter present in every other query) and this is the one silent exception; any future code path that writes a pattern-layer id into `ideas.citations` would have the Plan page render it mislabeled as "first-party."
- [High] Same accept-idea race as Hub applies here — `plan/actions.ts:37` calls the identical unguarded `acceptIdea()` (see Hub findings above) — a user double-clicking Accept (network hiccup causing a retry) or two team members racing between Plan and Hub for the same idea can produce duplicate `content` rows / duplicate AI spend. `AcceptButton` (`plan-card.tsx:29-36`) disables on `useFormStatus().pending`, which — like Hub's `decidingIdeaId` — only protects a single tab's own resubmission, not concurrent sessions.
- [Low] Edit form silently drops unsaved changes on reject-mode switch — `plan-card.tsx:63,144-227` — switching from "editing" to "rejecting" (or vice versa) via the two independent `useState` mode/draft pairs doesn't warn about unsaved edits; minor UX papercut, no data corruption since nothing is persisted until Save is explicitly clicked.
- [Low] `editIdeaAction` has no `status='new'` guard *visible in the UI* if the idea was concurrently accepted/rejected — the query itself is correctly guarded (`updateIdeaFields`, `db/queries/ideas.ts:87-107`, `WHERE ... status='new'`), so the UPDATE is a safe no-op in that race, but the action returns `undefined` (success) either way — the editing user gets a silent "Saving… done" with no rows actually changed and no error surfaced, then `revalidatePath` reloads the list where their edited idea has vanished (already accepted/rejected by someone else) with no explanation of why their edit didn't take.

Two-layer rule is otherwise correctly enforced end-to-end for this page's primary
data flow (ideas → citations → captions), and min-N gate (`MIN_BASELINE_N = 20`,
`src/lib/scoring.ts:7`) is enforced upstream in `retrieveDrivers()`
(`src/lib/ai/retrieval.ts:54`) before any idea/citation is ever generated —
insufficient-baseline ideas get `DECLARED_ONLY_REASON` text and empty citations
(`src/lib/ai/ideation-agent.ts:56-67`) rather than a fabricated score, which the
Plan page renders honestly via `whyReason` with no numeric score anywhere on
this page. Auth/membership checks are present and correct on all 3 actions.

## Summary
- Critical: 0 | High: 2 | Medium: 2 | Low: 7
- Top 3 by impact:
  1. **[High] Duplicate content on idea-accept race** (`src/lib/plan/accept-idea.ts:33-37`) — no transaction/row-lock spans the status check, AI draft generation, and content insert; reachable from both Plan and Hub, and from either page alone via double-submit/retry. Fix: wrap in a transaction with `SELECT ... FOR UPDATE` or a conditional `UPDATE ideas SET status='drafted' WHERE status='new'` performed *before* the AI call (claim the row first, generate second), plus a unique constraint on `content.ideaId`.
  2. **[Medium] Hub idea decisions never revalidate the Plan page** (`hub/actions.ts`, entire file) — accepting/rejecting from Hub can leave the server-rendered `/plan` route showing stale (already-decided) ideas after a soft navigation. Fix: call `revalidatePath` for `/plan` and `/production` inside `decidePlanIdea`, mirroring `plan/actions.ts`.
  3. **[Medium] `HubScope` realtime scope is wrong for idea decisions and effectively dead code client-side** (`hub/actions.ts:238`, `team-hub-canvas.tsx:77`) — `decidePlanIdea` broadcasts `"messages"` instead of a proper plan/ideas scope, and the client ignores scope anyway, masking the mismatch today but leaving a latent bug for any future scope-selective refresh optimization.

Secondary items worth tracking: the `getPostsByIds` missing `source='first_party'` filter (`src/db/queries/posts.ts:129`) is a real deviation from this file's own documented pattern and should be closed defensively even though it's not currently reachable with pattern-layer data.
