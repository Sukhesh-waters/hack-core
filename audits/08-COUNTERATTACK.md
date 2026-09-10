# Counterattack Plan — Audit Findings vs Codebase (2026-07-18)

Execution plan for the Sonnet agent. Every audit finding from 01–07 was re-checked
against the codebase as of 2026-07-18 (branch `main`, uncommitted work in tree).
Items already fixed are listed first so nobody re-does them; everything else is
ordered by severity into phases. Constitution rules apply: one reviewable diff
per phase, every slice ships with tests, CI green before "done."

## Verified status of the two CRITICALs

| Audit finding | Status in tree |
|---|---|
| 06-CRITICAL: Meta sync has no dedup, corrupts baseline hourly | 🟡 **Fixed in uncommitted diff** — `accounts/sync.ts` now filters via new `listExistingPostExternalIds` (`db/queries/posts.ts`). Needs tests + commit (Phase 0). |
| 02-CRITICAL: direct-add content orphaned (empty `body`, can never pass compliance) | 🟡 **Half-fixed** — `startDraftAction` (`studio/[contentId]/actions.ts`) and `start-draft-form.tsx` exist, but **the form is never rendered**: `studio/[contentId]/page.tsx` has zero references to `StartDraftForm`. The critical is still live for users until it's wired in (Phase 0). |

Also uncommitted: new `actionErrorMessage` mappings for URL-ingest failures
(SSL/timeout/non-HTML/too-short), with tests already written.

---

## Phase 0 — Finish and land the in-flight fixes (smallest diff, highest value)

1. **Wire `StartDraftForm` into the studio page.** Render it in
   `studio/[contentId]/page.tsx` only when `!row.body` (mirror the action's own
   guard), with copy explaining this is the manual entry point for direct-add
   cards. Without this the CRITICAL orphan bug remains user-facing.
2. **Scope `startDraftAction`'s UPDATE by workspaceId.** The new action repeats
   the exact Medium defect audit 03 flagged: `.where(eq(content.id, row.id))`
   with no `workspaceId` predicate. Fix it now rather than adding a fourth
   instance of the pattern Phase 2.1 has to clean up.
3. **Tests:**
   - `listExistingPostExternalIds` — empty input short-circuit, workspace+client
     scoping in generated SQL (follow `rescore.test.ts` `.toSQL()` pattern).
   - `runAccountSync` dedup — pulled rows already present are filtered; rows
     without `externalId` pass through.
   - `startDraftAction` — rejects when `row.body` non-empty; hashtag
     normalization (`foo` → `#foo`); produces a body `parseDraftBody` accepts
     (this is the whole point — the card must become compliance-eligible).
4. Typecheck + lint + full suite, then commit the lot as one slice.

## Phase 1 — Remaining HIGHs

### 1.1 Accept-idea race → duplicate content + double AI spend (01-High, 03-Low — same root cause)
`src/lib/plan/accept-idea.ts` still does read-check → multi-second AI call →
insert → unguarded `markIdeaDrafted`. Reachable from Plan, Hub, and Ideation
("Draft it") concurrently.
- **Claim-first:** before the AI call, run a conditional
  `UPDATE ideas SET status='drafted' WHERE workspace_id=... AND id=... AND status='new'`
  and check the affected-row count (`.returning()`); 0 rows → throw
  "already decided." The loser of any race now fails before spending AI budget.
- On draft-generation failure after the claim, revert status to `new` in a
  `catch` so the idea isn't stranded in `drafted` with no content row.
- Add the `status='new'` guard to `markIdeaDrafted` itself (or delete it if the
  claim-first UPDATE subsumes it).
- Optional hardening (owner call, needs a migration): unique index on
  `content.idea_id` (nullable-safe, partial `WHERE idea_id IS NOT NULL`).
- Tests: claim wins exactly once; failed generation restores `new`.

### 1.2 Harness UI can't reach shipped A2/A4 features (04-High)
`kb/harness-form.tsx` has no control for `target: "posts"|"reels"` or
`mineComments` even though schema, validation, and `pattern-scan.ts` fully
support both.
- Add per-segment controls: a target select (posts/reels) shown for
  `competitor_handle`/`hashtag` kinds, and a "Mine comments" checkbox.
- Thread values through the existing JSON payload → `harnessRuleSchema` already
  accepts them; no server change needed.
- Test: form payload round-trips `target`/`mineComments` through
  `harnessRuleSchema.safeParse`.

### 1.3 Dead Inngest trigger `accounts/sync.requested` (06-High)
Still present at `inngest/functions/account-sync.ts:60`; still zero senders.
- **Decision: remove the event trigger** (keep cron only). The manual "Sync
  now" server action is the intended interactive path and gives immediate
  error feedback; routing it through Inngest would lose that. Delete the event
  from `triggers` and note in the function doc that manual sync is action-only.

## Phase 2 — MEDIUMs

### 2.1 Studio content UPDATEs not workspace-scoped (03-Medium)
Add `eq(content.workspaceId, workspaceId)` to the UPDATE WHERE in
`refineDraftAction`, `runComplianceAction`, `markPublishedAction` (and confirm
Phase 0.2 covered `startDraftAction`). Pure defense-in-depth; behavior
unchanged. Test via `.toSQL()` predicate assertions if the queries are
extracted, otherwise a comment noting the invariant.

### 2.2 `getPostsByIds` missing `source='first_party'` filter (01-Low + 03-Low — constitution deviation)
`db/queries/posts.ts:151` is still the one query in the file without the
filter. Add `eq(posts.source, "first_party")` + the same inline two-layer
comment its siblings carry. Test: SQL contains the source predicate.

### 2.3 Hub `decidePlanIdea` — no revalidate, wrong realtime scope (01-Medium ×2)
- Add `revalidatePath` for `/w/[ws]/plan` and `/w/[ws]/production` after an
  accepted/rejected idea (mirror `plan/actions.ts`'s helper).
- Add `"plan"` to `HubScope` (`src/lib/realtime.ts`) and broadcast it from
  `decidePlanIdea` instead of `"messages"`. Client `onSignal` ignores scope
  today so this is safe; it un-lands the latent bug for any future
  scope-selective refresh.

### 2.4 `advanceStage` silent no-op on race (02-Medium)
Use `.returning({ id: content.id })`; 0 rows → throw
"This card was already moved." so `advanceProductionStageAction` surfaces it
via `actionErrorMessage`. Add the missing `production.test.ts` covering the
stale-transition path.

### 2.5 Reports min-N leak on Avg ER (05-Medium)
`reports/page.tsx:97` still renders `pct(client.avgEngagement)` unconditionally.
- Gate the header stat behind the same `insufficient` branch — render
  "Insufficient baseline" instead of a number.
- Exclude the raw average from `buildReportDraft` (`lib/reports.ts`) when
  insufficient, so it can't leave the app in an email.
- **Also verify the gate itself:** page currently computes
  `insufficient = client.scored < 1`, which is not `MIN_BASELINE_N = 20`
  (`src/lib/scoring.ts`). Align the threshold with the constitution's min-N
  gate (import the constant, don't hardcode).

### 2.6 `addPublicPage` cap + provenance divergence (04-Medium ×2, 04-Low)
`accounts/actions.ts` still calls `fetchPublicPosts(handle)` with no clamp and
does a raw `db.insert(patternPosts)`.
- Route the insert through `insertPatternItems` (or a thin shared helper) so
  future schema changes hit one code path; pass a synthetic segment note
  (e.g. `segment: "one-off"`) or explicitly document the null-provenance choice.
- Wrap the fetch limit in `clampCap` so `HARNESS_HARD_CAP=100` is enforced
  structurally, not by a lucky default of 30.
- Test: cap applied; insert path shared.

### 2.7 Calendar duplicate-slot guard (02-Medium)
In `createScheduledPost`, check for an existing `schedule` row at the same
`scheduledFor` minute for the same client inside the transaction; return a
"That slot already has a post for this client" error. Test the collision path.

### 2.8 Import jobs stuck at `processing` (06-Medium)
Cheapest honest fix: when rendering job status, treat `processing` older than
15 min as "stalled (may have been interrupted)" using `createdAt` — no schema
change, no sweep job. If a real retry sweep is wanted later, it's an Inngest
function, but that's out of this phase's scope.

### 2.9 Ideation citation traceability (03-Medium)
`retrieval.citedPostIds` is computed but never used. Pass it into
`generateIdeas` and have `validateCitations` validate against the cited subset
(fall back to the full driver pool only when the brief cited nothing). Test:
idea citing an un-briefed driver id gets stripped.

### 2.10 Ads dead-write audience/creative fields (05-Medium)
`audience`, `creativeContentId`, `creativeNote` are persisted but unreadable.
Smallest fix consistent with "brief, not dashboard": select them in
`campaignsQuery` and render an expandable detail section on `campaign-row.tsx`.
Do **not** build a campaign detail page (scope). If owner prefers, dropping the
wizard steps instead is the alternative — flag at review, default to rendering.

## Phase 3 — LOWs / cleanup (single housekeeping diff)

- Delete `getScheduledFor`/`scheduleSlotQuery` from `db/queries/rescore.ts` and
  their cases in `rescore.test.ts` (dead since the manual-metrics removal).
- Fix stale comment in `calendar-board.tsx:17-19` (clientId IS threaded now).
- Remove the always-"First-party" layer-badge ternary in `kb/page.tsx:172-175`
  (render the constant label, drop the dead branch).
- `updateBrandContext`: add the `getClientById` existence check for an explicit
  "Client not found" error, matching its sibling actions.
- `editIdeaAction`: use `.returning()` from `updateIdeaFields`; 0 rows →
  "This idea was already decided by someone else." instead of silent success.
- Remove the hardcoded non-interactive "Unassigned" badge in
  `production-card.tsx` (implies a feature that doesn't exist).
- Hub plan quick-view `format ?? "Post"` fallback → render "Format not set"
  style label instead of a fake "Post".
- Note (no code): cron sweep fairness (06-Medium) and `sendReportAction`
  send-log/client-recipient gap (05-Medium) are **deferred** — both need
  owner/product decisions (batching strategy; `report_sends` table +
  `clients.contactEmail`). Do not start without approval.

## Explicitly NOT actionable (audit re-verified clean — don't "fix")

- Cross-cutting audit (07) found zero issues: auth/membership on all 16 action
  files, AI router discipline, workspace isolation (with 4 documented cron-only
  exceptions), secrets handling. Leave alone.
- `campaigns` dead columns (`spend` etc.) are dead-on-purpose per commit
  `dc3bf73`'s comment — do not remove.
- `posts`/`pattern_posts` two-layer separation is correct everywhere traced.
- Drift page min-N gating is correct.

## Done criteria (every phase)

`npx tsc --noEmit` clean · lint clean · full vitest suite green (currently
~314 tests + the new ones) · no new inline styles · no direct provider calls ·
every new query workspace-scoped · diff posted for review before the next
phase starts.
