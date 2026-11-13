# WTR-0 — Study readiness: make the Waters feasibility study measurable

Date: 2026-10-22 · Lane: Waters (WTR) · Status: **DRAFT — plan only, awaiting owner review before any code**
Workspace: `waters-gcc-internal` · Branch (when approved): `wtr/0-study-readiness`, built in a worktree

## 0. Why this slice exists

The owner is running a 12-week feasibility study on Waters (27 Oct 2026 – 19 Jan 2027, checkpoints 24 Nov and
22 Dec) to decide whether the product survives and whether to split it into two products. Each study question has
a measure, a threshold and a deadline, fixed before the study starts (pre-registration doc, not written yet).

A read-only pass over the code (22 Oct) found that most measures can already be read from existing tables, but
three cannot, and one existing bug would corrupt the weekly campaign numbers:

| Study measure | Problem in the code today | Part |
|---|---|---|
| R3 — the weekly LinkedIn export is uploaded | `importNumbersAction` refuses the **whole sheet** when any row matches no registered creative ("Nothing was imported … Add those creatives first"). A page export lists every post on the page, so the weekly upload fails unless every post was registered by hand first, each with a written hypothesis. No record is kept of an upload that matched nothing | A |
| R3 and later pacing — numbers grow week by week | In the LinkedIn layout, `created_date` (the day the **post** was created) is mapped to `capturedAt`. `upsertMetricSnapshots` conflicts on `(workspace, creative, captured_at, source)` and updates, so every weekly re-import of a post **overwrites** the previous week's numbers, dated at the post's creation. This breaks the schema's own rule that snapshots accumulate | A |
| L2 — routine work runs through the product, not scripts | Scripts create runs with `trigger: "manual"`, the same as the buttons. Only idempotency-key prefixes (`seed:`, `ads:operator:`) tell some of them apart; `add-linkedin.ts`, `linkedin-backfill.ts`, `onboard-client.ts` and `add-events.ts` are indistinguishable from a person | B |
| L3 — re-plans triggered by evidence | `revisePlanAction` saves the revision with `origin.kind = "revision"` but not what triggered it: new checked signals, cited evidence proved wrong, or a person's choice | C |
| All — a weekly reading of every measure | No report computes them; each would be a hand-written query | D |

Not in this slice: the plan lifecycle and live-campaign registry (CORE-1 / WTR-1, next), Brain stage modes
(operational, owner's yes per stage), a page-view log (not selected), a LinkedIn Campaign Manager layout (waits for
Waters' answer on paid data), automatically attaching parked numbers when a post is registered (decision E2).

## 1. Rules this slice keeps

- **Nothing merges or migrates before 27 Oct.** The app serving the ARABLAB watch runs from the main checkout, so
  the work happens in a worktree (`.claude/worktrees/wtr-0`, `node_modules` as a junction, removed only with
  `cmd /c rmdir node_modules`).
- **Strict parsing stays strict.** A bad number, a bad date or an unknown layout still refuses the whole sheet with
  line numbers. Only "this post is not in any campaign" stops being an error, and it is never silent: every such row
  is listed on the page and in the import record.
- **No synthesised numbers or hypotheses.** An unassigned post is not a creative and never reaches learning,
  reviews or credit. Nothing writes a hypothesis for it; a person does when registering it. A number the export did
  not give stays null ("not reported").
- **`workspace_id` on every query**, with a `toSQL()` test; every new table carries `workspace_id`.
- **Additive migration only**, with a hand-written `drizzle/down/0091.sql` (`migrations-down.test.ts`). Migrate first,
  then run the new code. The migration needs the owner's yes.
- **Boundary test unchanged.** Everything lives under `src/lib/platina`, `src/app/(platina)`, `src/db/platina-schema.ts`,
  the Platina query modules, and `scripts/`.
- **No Waters data in fixtures.** Tests use the real LinkedIn export *header* with made-up rows.
- **Operator copy uses plain words** (no internal terms), as the existing banned-word tests require.

## 2. Part A — A weekly LinkedIn import that works (size M)

**What a person sees:** they paste the weekly export on Results. Numbers for posts that belong to a campaign are
saved, dated the day of the import. A panel shows the import: when, by whom, how many numbers were saved, and the
posts that are **not in any campaign yet**, each with its title, posting date, impressions (or "not reported") and a
**Register as a creative** link that opens the form with the link, date and title filled in. A registered post gets
its numbers on the next import. The panel advises exporting the last 30 days each week so late-registered posts are
still covered.

| ID | Task | Files | Test first |
|---|---|---|---|
| A1 | **Parser.** In the LinkedIn layout `created_date` becomes a new `postedAt` field (the post's date), not `capturedAt`. `capturedAt` is an explicit `captured_at` column when present, otherwise the import day. `update_title` / `title` is carried as `title` for display. In the Platina layout `date` keeps meaning the capture date. | `src/lib/platina/metrics-import.ts` (+ test) | the existing LinkedIn test flips: `capturedAt` = TODAY, `postedAt` = 2026-09-18; an explicit `captured_at` column wins; a Platina-layout `date` is still the capture date |
| A2 | **Split (pure).** `splitImportRows(rows, creatives)` → `{ matched, unassigned, duplicates }`. Matching uses the existing `refKey` on id, URL and external id. Two rows for the same post in one sheet: the last one wins and the duplicate is counted (today this would make Postgres reject the insert: one statement cannot update the same row twice). | `src/lib/platina/metrics-import.ts` (+ test) | an unknown post lands in `unassigned`, never in `matched`; duplicates collapse to one row |
| A3 | **Import record table** `platina_metric_imports`: `id`, `workspace_id`, `layout`, `source`, `rows_total`, `rows_matched`, `rows_written`, `duplicates`, `unassigned` (jsonb: `{ ref, title, postedAt, impressions }[]`, capped at 200), `created_by_id`, `created_at`; indexes on `workspace_id` and `(workspace_id, created_at)`. Migration `0091` + `drizzle/down/0091.sql`. Queries `insertMetricImport`, `latestMetricImport`, `getMetricImport`. | `src/db/platina-schema.ts`, `drizzle/0091_*.sql`, `drizzle/down/0091.sql`, `src/db/queries/platina-learning.ts` (+ test) | workspace filter in every query's SQL; the schema test that every Platina table has `workspace_id` still passes; the down file drops exactly what 0091 adds |
| A4 | **Action.** `importNumbersAction`: parse errors still refuse everything; otherwise write the matched snapshots (possibly zero), **always** write the import record, redirect with `?import=<id>`. The "match no creative" refusal goes. | `src/app/(platina)/p/[ws]/results/actions.ts` | covered by A2 (pure) plus the browser spec in A5 |
| A5 | **Page.** Results shows the latest import record and its unassigned list; `results/new` accepts `url`, `posted` and `title` as prefilled values. | `results/page.tsx`, `results/new/page.tsx`, `e2e/platina/results-import.spec.ts` | browser spec on the fixture workspace: a sheet with one known and one unknown post saves one snapshot, lists the other, and its link opens the form prefilled |

**Live proof (after 27 Oct, owner's yes for the migration):** a real Waters export pasted on Results saves the
numbers for registered posts dated that day and lists the rest; the import a week later adds a **second** snapshot
for the same post instead of overwriting the first.

## 3. Part B — Mark work started by a script (size S, no migration)

| ID | Task | Files | Test first |
|---|---|---|---|
| B1 | `PlatinaRunConfigSnapshot` gains optional `operator?: string` (the script's path). jsonb type only. | `src/db/platina-schema.ts` | — |
| B2 | Every script that creates a run sets it: `platina-force.ts`, `add-linkedin.ts`, `linkedin-backfill.ts`, `onboard-client.ts`, `add-events.ts`, and the ads sweep (`startAdScan(..., "operator")` writes it into the snapshot). | those scripts, `src/lib/platina/ads-scan-run.ts` | B3 |
| B3 | **Guard test:** any file under `scripts/` that calls `createAuditRun(` must pass `operator`, so a new script cannot slip through. | `src/lib/platina/run-origin.test.ts` | the test itself (fails today on the five scripts) |
| B4 | **Classifier (pure):** `runOrigin(run)` → `schedule` \| `event` \| `person` \| `operator`. Runs from before this slice fall back on the known key prefixes (`seed:`, `ads:operator:`); anything else from before is reported as "person or script, unknown" rather than guessed. | `src/lib/platina/run-origin.ts` (+ test) | a marked run is `operator`; a schedule run is `schedule`; an old unmarked manual run is `unknown`, never `person` |

**Live proof:** the next force run or ads sweep on Waters shows `operator` in its run record.

## 4. Part C — Record why a plan was revised (size S, no migration)

| ID | Task | Files | Test first |
|---|---|---|---|
| C1 | `PlanOrigin` gains optional `trigger?: { level: FreshnessLevel; newSignals: number; refuted: number }`, set only on revisions. | `src/db/platina-schema.ts` | — |
| C2 | `revisePlanAction` reads the parent's freshness with the existing `readPlanFreshness` (no model call; the same inputs the plan page uses) and stores the trigger. If the read fails, the revision proceeds without a trigger. | `src/app/(platina)/p/[ws]/plan/actions.ts` | C3 |
| C3 | **Label (pure):** `revisionReason(origin)` → "Revised after evidence it cited was proved wrong" / "Revised after N new checked signals" / "Revised on request"; nothing for revisions made before this slice. Shown in the revised plan's origin line. | `src/lib/platina/plan/freshness.ts` (+ test), `plan/[planId]/page.tsx` | refuted ≥ 1 wins over any count; level `current` reads "on request"; no trigger renders nothing |

**Live proof:** a re-plan on Waters shows why it happened, and the stored origin carries the counts.

## 5. Part D — Weekly study report, read-only (size M, after the pre-registration doc)

`npm run platina:study -- --ws <slug> [--since YYYY-MM-DD] [--exclude-user <email>] [--json]`. It never writes.
Every figure carries its N; below its floor it says "not enough data yet". It reports raw measures only;
thresholds come from the pre-registration doc.

| Measure | Read from |
|---|---|
| R1 time from a competitor move to a reviewed finding (high and medium severity) | `platina_findings.ruled_at` against the signal's `fetched_at`, and the post or ad's own date where the raw record has one |
| R2 share the surprise filter would skip; spot checks that found something | `platina_brain_telemetry` (stage `surprise`) — needs the stage in shadow |
| R3 weeks with a LinkedIn import; rows matched | `platina_metric_imports` (Part A) |
| R4 suggestions decided within 7 days | `platina_suggestions` + `platina_suggestion_events` |
| L1 people (excluding `--exclude-user`) who made a decision each week | `ruled_by`, plan and creative `created_by_id`, suggestion-event `actor_id`, metric-import `created_by_id` |
| L2 runs by origin | `platina_audit_runs` through `runOrigin` (Part B) |
| L3 grades by verdict; revisions by trigger | `platina_insight_grades`; `platina_plans.origin.trigger` (Part C) |
| L4 failed or degraded runs; amber/red ops checks | `platina_audit_runs`, `platina_ops_checks` |
| L5 AI cost per week; collection spend | `ai_usage` (per workspace); Apify month usage (account-wide, labelled so) |

| ID | Task | Files | Test first |
|---|---|---|---|
| D1 | Pure measures over plain rows, each returning value, N and a floor state | `src/lib/platina/study/measures.ts` (+ test) | below the floor: "not enough data yet", never a number |
| D2 | Read queries, every one filtered by workspace | `src/db/queries/platina-study.ts` (+ test), imported by the script only | workspace filter in every query's SQL |
| D3 | The script and `package.json` entry | `scripts/platina-study.ts` | dry output on the fixture workspace |

## 6. Order and definition of done

Order: A → B → C (each mergeable alone) → D once the pre-registration doc is approved. Build during the freeze
in the worktree; merge and migrate from 27 Oct.

Done for each part: tests first; `tsc --noEmit`, `next lint`, the full `vitest` suite (including the boundary,
migrations-down and Brain invariant tests) and the part's browser spec pass; the live proof is recorded in §8.

## 7. Decisions, each with a default

| # | Question | Default if not answered |
|---|---|---|
| E1 | Cap on the unassigned list per import | 200 posts; the count above the cap is still recorded |
| E2 | Should registering a post attach its numbers from the last import at once? (needs all numbers of unassigned rows stored) | No: the next weekly import attaches them |
| E3 | Exclude the builder from L1 | Yes, through `--exclude-user` |
| E4 | LinkedIn snapshots already stored with the post's date as capture date (if any) | Left unchanged and listed in the PR; no rewrite without approval (checked read-only before merge, with the owner's yes) |

## 8. Risks and open questions

| Risk | What's done about it |
|---|---|
| The Gulf team are not admins of the global Waters LinkedIn page, so there is no export, or it is full of global posts | Question to Waters before 27 Oct; Part A still ships (it is a bug fix), but R3 is marked "no data source" until answered |
| The export's columns differ from the tested header | Header aliases are tested; an unknown layout is refused with its line number, as today |
| Changing the running app during ARABLAB | Worktree build; nothing merges before 27 Oct |
| The import record grows | One small row per import; the unassigned list is capped |

## 9. Progress

| Part | Status | Commit | Live proof |
|---|---|---|---|
| A | A1, A2, A4 built & unit-tested offline (12 Nov); A3 migration 0091 + A5 UI table wait on DB restore | uncommitted | |
| B | B1–B4 built & unit-tested offline (12 Nov, `run-origin.ts` + static script guard test) | uncommitted | |
| C | C1–C3 built & unit-tested offline (12 Nov, `revisionReason` + `revisePlanAction` trigger) | uncommitted | |
| D | waiting on DB restore + signed pre-registration (`docs/study/2026-11-09-waters-study-preregistration.md`) | | |
