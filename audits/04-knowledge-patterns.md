# Audit: Knowledge & Patterns (kb, patterns, rules)
Generated: 2026-07-14 | Agent: Sonnet 5

## kb
### Flows traced
- Save harness rules → `kb/harness-form.tsx:222-235` (submits JSON payload) → `kb/actions.ts:22 saveHarnessRule` → `harnessRuleSchema.safeParse` (`src/lib/validation.ts:139-166`) → `requireUser`/`requireMembership` → `db/queries/harness.ts:31 upsertHarnessRule` → `harness_rules` table (upsert on `workspaceId` unique idx).
- Run now → `kb/harness-form.tsx:218-221` → `kb/actions.ts:48 requestPatternRun` → auth+membership → `getHarnessRule` guard (segments.length>0) → `inngest.send("patterns/run.requested")` → `src/inngest/functions/pattern-scan.ts:190 patternScan` → `executeRule` (line 48) → `runSegment` (clamped) → `insertPatternItems` → `pattern_posts`.
- Generate insight brief → `kb/insight-brief.tsx:40` → `kb/actions.ts:76 generateInsightBrief` → auth+membership → `listTopPatternPosts(workspaceId,12)` (pattern-only) → `generatePatternInsights` (AI) → rendered observations.
- Page render → `kb/page.tsx:36-45` → `getKbStats`/`listPosts` (`posts` table, first-party) + `listPatternPosts`/`countPatternPosts` (`patternPosts` table, `db/queries/accounts.ts`) + `getHarnessRule`/`listPatternRuns`/`listTopPatternPosts` (`db/queries/harness.ts`) — all filtered by `workspaceId`. Page-level auth comes from `src/app/(app)/w/[ws]/layout.tsx:14-15` (`requireUser` + `requireMembership`, `notFound()` on failure) — `page.tsx` itself does not re-check, which is correct since layout wraps it.

### Findings
- [LOW] "Layer" badge column checks a condition that can never be true — `kb/page.tsx:172-175` — `rows` comes exclusively from `listPosts` (`src/db/queries/posts.ts:37-52`), which queries the `posts` table only; nothing in the codebase inserts a non-`first_party` `source` into `posts` outside `src/db/layer-separation.integration.test.ts`. So the ternary `post.source === "first_party" ? "First-party" : "Public"` will always render "First-party". Not a two-layer violation (no leak), just dead/misleading code that implies mixed-layer rows can appear in this table when they structurally cannot.
- [LOW] `patternPosts.weight` defaults to `1` (`src/db/schema.ts:469`), not an explicitly-neutral value (e.g. 0), and is never set by either write path (`insertPatternItems` in `db/queries/harness.ts`, or `addPublicPage` in `accounts/actions.ts`). The constitution language "weight=neutral" is only enforced by omission from scoring (`src/lib/scoring.ts` never reads `patternPosts` or its `weight` column at all — verified via grep, no matches), so it's a non-issue in practice, but the column name/default doesn't self-document the neutrality guarantee.

## patterns
### Flows traced
- Any navigation to `/w/[ws]/patterns` → `src/app/(app)/w/[ws]/patterns/page.tsx:3-5` → immediate `redirect(`/w/${params.ws}/kb#scraper-ops`)`. No auth/membership check of its own (relies on the `[ws]` layout guard which runs first) and no independent logic — this route is a pure alias.

### Findings
- [INFO] `patterns` page is a stub redirect to `kb#scraper-ops`; all real logic lives in `kb`. Nothing further to audit here — no dead ends, no separate DB access.

## rules
### Flows traced
- Any navigation to `/w/[ws]/rules` → `src/app/(app)/w/[ws]/rules/page.tsx:3-5` → immediate `redirect(`/w/${params.ws}/kb#scraper-ops`)`. Same pattern as `patterns` — pure alias, no independent logic.

### Harness UI vs schema staleness check
`HarnessSegment` type (`src/db/schema.ts:497-505`) and `harnessRuleSchema` (`src/lib/validation.ts:139-166`) both define three fields per segment beyond `kind`/`value`/`note`:
- `target?: "posts" | "reels"` (A2: routes competitor_handle/hashtag segments to the reel-scraper actor; consumed by `actorKeyForSegment`/`segmentToActorInput` in `src/lib/harness.ts:41,54`, and by `pattern-scan.ts:60-61`).
- `mineComments?: boolean` (A4: opt-in comment mining; consumed by `hasCommentMining`/segment filter in `pattern-scan.ts:134-138`).

`harness-form.tsx` (`src/app/(app)/w/[ws]/kb/harness-form.tsx`) has **no UI control for either field**:
- `SEGMENT_KINDS` (line 17-21) only lists `kind` options; the segment row (lines 96-153) renders a `kind` select, a `value` input, a `note` input, and a Remove button — nothing for `target` or `mineComments`.
- New segments are always created as `{ kind: "competitor_handle", value: "" }` (line 163) with `target`/`mineComments` left `undefined`.
- Because `target` defaults to `"posts"` and `mineComments` defaults to `false` in the Zod schema, a user can never opt into reels routing or comment mining from the UI at all — those features are only reachable by hand-editing the DB row or via a payload crafted outside the form.
- [HIGH] UI is stale relative to schema/backend — `src/app/(app)/w/[ws]/kb/harness-form.tsx:17-169` vs `src/db/schema.ts:497-505` — Two shipped backend features (A2 reels routing, A4 comment mining) are completely inaccessible from the product UI. Concrete failure: an agency user wants pattern-layer Reels benchmarking or comment mining for a competitor segment; there is no checkbox/toggle anywhere in `kb`, `patterns`, or `rules` pages to request it, so they silently only ever get "posts" scraping with no comments — a functionality gap, not a data-safety bug, but user-facing and easy to miss since the backend fully supports it.

### Accounts one-off form vs Harness Rules consistency check
Two independent entry points write to the same `pattern_posts` table:
1. **Harness Rules** (`kb` page → `requestPatternRun` → Inngest `pattern-scan.ts` → `runSegment` (clamped via `clampCap`, hard cap 100) → dedupe via `listExistingExternalIds`/`dedupeItems` → `insertPatternItems` (`db/queries/harness.ts:151-186`), which sets `runId`/`segment` provenance columns).
2. **Accounts one-off form** (`accounts/page.tsx` → `accounts/pattern-form.tsx` → `accounts/actions.ts:98 addPublicPage` → `fetchPublicPosts(handle)` (hardcoded internal limit of 30, not user-configurable, not subject to `HARNESS_HARD_CAP`/`clampCap` at all — see `src/lib/connectors/apify.ts:79-88`) → dedupe via the *same* `listExistingExternalIds`/`dedupeItems` helpers (imported from `@/db/queries/harness` and `@/lib/harness` respectively, confirmed at `accounts/actions.ts:9,15`) → raw `db.insert(patternPosts)` inline (not via `insertPatternItems`), leaving `runId`/`segment` as `null`).

Consistency assessment:
- [RESOLVED] Dedup is now consistent — both paths call the identical `listExistingExternalIds` + `dedupeItems` functions before insert, so the FK/duplicate-row class of bug this session fixed for the harness path is also closed for the one-off Accounts path.
- [MEDIUM] Cap enforcement is inconsistent between the two paths — `accounts/actions.ts:108 fetchPublicPosts(parsed.data.handle)` calls with no `limit` argument, so it uses `fetchPublicPosts`'s own default of `30` (`src/lib/connectors/apify.ts:79-82`), never passing through `clampCap`/`HARNESS_HARD_CAP`. This happens to sit under the 100 hard cap today only because the hardcoded default (30) is conservative, but there is no defensive clamp — if that default is ever changed/parameterized (e.g. exposing a "how many posts" field on the Accounts one-off form), it would bypass the constitution's 100-post hard cap entirely, since this path never imports or calls `clampCap`. Concrete failure scenario: a future PR adds a `limit` input to `pattern-form.tsx` on the Accounts page (natural feature request — "scan more posts") and wires it straight to `fetchPublicPosts(handle, limit)`; nothing in `addPublicPage` or `fetchPublicPosts` would stop a value of e.g. 500, silently exceeding `HARNESS_HARD_CAP=100`.
- [MEDIUM] Provenance divergence — rows inserted via `addPublicPage` have `runId: null` and `segment: null` (no `insertPatternItems` call, raw insert instead, `accounts/actions.ts:118-129`), while Harness Rules rows always carry `runId`/`segment`. `kb/page.tsx:326-333` renders a segment-kind badge only `{post.segment ? (...) : null}`, so Accounts-sourced pattern posts silently show no segment badge in "Top performers" — not a two-layer violation (still tagged `source=public`/pattern table), but a provenance/traceability gap: you cannot tell from the KB UI whether a given pattern post came from a configured Harness segment or a one-off Accounts add.
- [LOW] Two different actors/code paths reach the same table with different insert helpers (`insertPatternItems` vs inline `db.insert(patternPosts)` in `accounts/actions.ts:118`), which is a duplication/maintenance risk — a future schema change to `patternPosts` (e.g. new required column) only needs updating in `insertPatternItems`, but `addPublicPage`'s inline insert would silently need the same update and could be missed.

## Summary
- Critical: 0 | High: 1 | Medium: 2 | Low: 3
- Top 3 by impact:
  1. [HIGH] Harness UI never exposes `target: "reels"` or `mineComments` — shipped backend capability (A2/A4) is unreachable from any page (`kb`, `patterns`, `rules` all funnel through the same stale `harness-form.tsx`).
  2. [MEDIUM] Accounts one-off `addPublicPage` path never calls `clampCap`/`HARNESS_HARD_CAP` — currently safe only because of a conservative hardcoded default (30), not a real enforced cap; latent risk if the form is ever extended with a user-facing count field.
  3. [MEDIUM] Provenance divergence between Harness-Rules-sourced and Accounts-sourced pattern posts (`runId`/`segment` null on the latter) — no functional two-layer leak, but reduces traceability/debuggability of the pattern layer shown on the KB page.
