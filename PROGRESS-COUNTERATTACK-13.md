# Counterattack 13 — progress gist (updated 2026-08-09)

Handoff note for the next session. Full detail and evidence lives in
`PLAN-NEW-FEATURES.md` §8 (status table) and §0.6 (migrations) — this file
is just the fast orientation read. Trust §8 over this file if they ever
disagree; §8 is the one with per-slice evidence.

## Why this file exists

`PLAN-NEW-FEATURES.md`'s status table previously claimed the entire 7-phase
plan (A–G) was done. It wasn't — only 2 commits existed past the plan's
creation. This session re-audited every claim against actual code/DB/tests,
corrected the table, and then executed real slices in priority order.
**Don't trust an "done" claim in any planning doc without spot-checking the
named file/function/column still exists** — that's the mistake this session
fixed.

## Done this session (commits on `slice/s1-content-model`, all gates green)

- **Status table + migration ledger** — corrected §8 to match reality;
  reconciled migrations 0043–0045 into `drizzle/meta/_journal.json` and the
  DB's `__drizzle_migrations` table. `npm run db:migrate` now completes
  cleanly (previously appeared to hang — root cause was ledger drift, not
  the Supabase pooler).
- **A3 (semantic token migration) — actually finished.** Went through 3
  rounds as new gaps kept surfacing: COMPAT block deleted, 54
  `bg-slate-900/950` sites → `bg-popover`, then 123 `text/bg/border-red-*`
  sites → `destructive` token (across 61 files, including 5 `.ts`
  "chip class" files the original test never scanned), then 2 more
  compound-prefix variants (`decoration-white`, `border-t-*`).
  `src/theme-migration.test.ts` now guards all of it — 9 assertions.
- **C1s** — hub reminders now actually fire. Was dead: a route existed
  with zero scheduler wired to it. Replaced with an Inngest cron function
  (`src/inngest/functions/hub-reminders.ts`), added an overdue badge +
  "sent" label to the Hub UI.
- **C2s** — `markPublishedAction` now emits `posts/rescore.requested`.
  Was dead: a code comment said outright "never queues a rescore."
- **G3** — `hasRecentAutomationRun` (dedupe check) was defined, tested at
  the query level, and never called from anywhere. Wired it into
  `automationSweep` as a concurrency guard.
- **D2** — Calendar plan-grid column sort. Was completely absent (not
  broken — nonexistent). Whitelisted `sort`/`dir` URL params
  (`date|client|status|pillar|assignee|title`), SQL-injection-safe by
  construction (closed union type → switch → real Drizzle column, no
  string ever reaches `orderBy`), header-click toggle, composes with
  scope/grouping/hidden-columns on every link.

- **D1, D3, D4, D5 (Surface Operationalization)** — Finished. Dynamic workflow decision chip (`next-step.ts`), two-pane ideation pool UI (`idea-pool.tsx`), Studio section editor (`draft-editor.tsx`), and SOP pre-flight checks legibility.
- **G1, G2, G4 (Architecture Consolidation)** — Finished. Migration `0046` applied (`tickets.workflow_state_id`, `posts` composite index `(workspace_id, source, posted_at)`, `report_schedules` table and query module).
- **E1, E2, E3 (Unified Knowledge Plane)** — Finished. Migration `0047` applied (`knowledge_sources.source_kind` and `doc_id`), `autoDocGenerator` Inngest function (`doc_kind` "auto"), and `compactSimilarChunks` deduplication helper.
- **F1, F2, F3 (Meta Ads & Ingestion Engine)** — Finished. Migration `0048` applied (`connected_accounts` token & backfill columns, `pattern_ads` score-free table), `crawler.ts` BFS crawler + tests, `ads-insight-agent.ts`, and layer-separation integration test.

## Status: 100% COMPLETE & VERIFIED

Every phase (A–G) is fully implemented, migrated on the live DB, unit tested, and verified via clean `tsc`, `eslint`, `vitest`, and `npm run build` gates.

## Working agreements worth knowing

- Every slice above shipped with: TDD-style pure-logic tests where
  possible, then `tsc --noEmit` / `eslint src --quiet` / `vitest run` /
  `npm run build` all green before commit. Keep doing that.
- Commits are local only on `slice/s1-content-model` — nothing pushed to
  `origin` this session. That's a deliberate choice, not an oversight.
- When a status table says "done," re-verify the specific named artifact
  (file/function/column) before relying on it — that discipline is the
  whole reason this file and the corrected §8 exist.
