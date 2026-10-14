# Metacognitive Brain — continuation handoff (~90%, showcase-ready)

Written 2026-10-14 at the ~60% pause; **updated 2026-10-15** after W3a, W3b,
W4a and the readiness check landed. For the **next agent** and for the owner
preparing the showcase. The plan is
[2026-10-13-metacognitive-brain.md](2026-10-13-metacognitive-brain.md)
(sections cited as §N), and the brief is [docs/newbrain.md](../../newbrain.md).
Read both, plus `CLAUDE.md`, before you touch code.

Everything below was true at the commit that last changed this file on `main`.

---

## 1. Where things stand

| Slice | What | State |
|---|---|---|
| B0 | Per-stage modes (off/shadow/on), telemetry, undo journal (`setBrainState` + `platina_brain_state_log`), metric registry, recovery scripts, Admin → Health "Brain quality" card, legacy-equivalence golden test. Migration 0087 | **Done, on `main`** |
| B1 | Interrogation schema (what/why/how/kind/falsifier), numbered evidence spans, fact quotes checked by code, code-built falsifiers on measured insights. Migration 0088 | **Done, on `main`** |
| B2 | Blind challenger, 50/50 shadow split, objection telemetry. Live `OBJECTION_RATE_CEILING` stays **0.8** | **Done, on `main`** |
| B3 | Deterministic gate, `resolveV2` (no proposer confidence; evidence support = valid cites ÷ 2, capped at 1), Mann–Whitney on measured "rising/falling" | **Done, on `main`** |
| B4 | Surprise filter **wired** (W3a): `platina_expectations` (migration 0090), novelty one-sided, engagement/ad-days two-sided, audit sample, card rows "Pages skipped as nothing unusual" and "Spot checks that found something". **Fails open:** a broken expectation store analyses as with the stage off | **Done, on `main`** |
| B5 | Daily falsifier grader (05:00 cron, per-workspace fan-out, catch-up), grades table, refutation memory, re-test of holding/insufficient. Migration 0089 | **Done, on `main`** |
| B6/B7 | Wired into the **planner** (W3b, `plan/diversified-evidence.ts`): one parallel batch, MMR, derived-share cap, counter-evidence slot (refuted Brain rows are counter-evidence only, never support), token budget 2400. Mode `retrieval` (`budget` for the cap); in-request fallback to the old path, telemetry `retrieval.fallback` | **Planner done, on `main`.** Not yet wired at `retrieve.ts`, `opportunity-brief.ts`, `idea-run.ts` |
| B8 | Real-time planning (W4a): freshness counts only gated insights; any cited evidence later **proved wrong** forces "re-plan"; verdict badges ("Held up when tested" / "Proved wrong on …"); counter-evidence section; the plan's own **stated test** ("How we'll know if this plan is wrong") | **Done, on `main`.** Grading of the plan's stated test is deferred (no plan-level measure yet) |
| — | `npm run platina:brain-readiness`: read-only check that 0087–0090 exist, plus per-workspace stages, Brain counts, 7-day telemetry, grades. Exit 1 when not ready | **Done, on `main`** |
| B9 | Proxy-vs-outcome, rule conflicts, insight review | **Not started** |

Tests on `main` (`d0ecddc` + this doc): **3198 passed, 10 skipped, 3 todo,
0 failed** (321 files). `tsc --noEmit`, `next lint` and `next build` are clean.
Before B0 the suite was 2787 tests.

**What is NOT verified:** nothing has run against a database. Migrations
0087–0090 have never been applied, and no stage has run in shadow on real
data. Everything above is verified by unit/invariant tests, typecheck, lint,
the production build and code review only.

**Environment (§15.1):**
- **Hosting.** The Vercel plan is cancelled, so nothing deploys from `main`.
- **Database.** Unreachable since 2026-10-13 ("tenant not found"); the owner is re-provisioning it. **Migrations 0087–0090 have not been applied anywhere.**
- **Runtime.** Local only: `npm run dev:all` (Next + Inngest dev server).

**Every brain mode is `off` in every workspace.** The live analysis path is
byte-identical to before B0, as `brain-legacy-equivalence.test.ts` proves.

**One change is NOT behind a mode:** the planner prompt now asks every
workspace's planner for a stated test (`plan/falsifier.ts`). It is additive:
the field is optional, a malformed one is dropped (`parsePlanFalsifier` →
null), and the plan is saved either way.

---

## 2. Open findings

Fixed since the pause: finding 1 (surprise direction, W3a), finding 2 (refuted
chunks reach the counter-evidence pool, W3b), finding 5 (0090 is the
expectations table). Still open:

1. **`hasDateOrPrice`** only catches year-qualified dates. Revisit only if
   shadow numbers show misses.
2. **The CLAUDE.md "Deploy: Vercel only (Pro plan)" line** is out of date.
   Ask the owner for the new target before editing it.
3. **Novelty compares against one previous version,** not the pure module's
   "last 5" (there is no multi-version history query). Acceptable for now.
4. **"Spot checks that found something" slightly overstates the hit rate:** an
   audit sample whose debate ends "nothing new" returns before the final write
   and is not in the denominator. Thread `plan.audit` through that early
   return if the number matters.
5. **`signal-analyze.ts` now reads the workspace config before the "plan"
   step** (needed for the surprise mode). That is one extra cheap read on
   own-brand/low-value skips. No provider cost.
6. **Plan stated-test grading is deferred:** there is no per-plan measure of
   leads/CTR/engagement yet. When one exists, grade it in B5 and write
   `platina_plan_feedback` worked/failed plus a ledger event.

---

## 3. What is left (≈10%)

Build these as **separate branches off `main`**, one slice per branch,
reviewed before merge, every new stage behind its mode with "off" unchanged.

### W3b-rest — B6/B7 at the other retrieval call sites
`retrieve.ts retrieveBuckets`, `opportunity-brief.ts`, `idea-run.ts`. Reuse
`selectDiversified` / `retrieveDiversifiedEvidence` from
`plan/diversified-evidence.ts`. Same rules: no new serial round trip,
in-request fallback, planes never merged.

### W4b — B9 (§5 B9)
- **Proxy-vs-outcome:** Spearman ρ (proxy vs leads) in the monthly
  consolidation digest; optional `qualified_leads` column on results import.
- **Rule conflicts:** a top-third idea blocked by `claims-gate.ts` raises an
  inbox escalation showing both sides.
- **Insight review:** approve / edit / reject-with-reason on Brain map and
  Findings, recorded as ledger events.
- **Invariants:** fill the last `it.todo` entries in `brain-invariants.test.ts`.

---

## 4. Rules that kept the live job safe (keep them)

- **Modes:** with a mode `off`, the path is byte-identical. Fork early on
  `modeOf(config, stage)`. Never change `runContradictionRound` (v1) or the
  legacy fixture JSON.
- **Shadow and on fail open:** a new stage's own failure must fall back to the
  old path (W3b `retrieval.fallback`, W3a surprise try/catch), never block the
  live job.
- **Additive migrations only,** each with a hand-written `drizzle/down/00NN.sql`
  (`migrations-down.test.ts` checks them). Never edit an applied migration.
  When adding one, add its objects to `BRAIN_MIGRATIONS` in
  `src/lib/platina/brain-readiness.ts` (the test checks them against the SQL).
- **Brain state** (status, confidence, agreement_state, grade_state) changes
  **only** through `setBrainState`.
- **`workspace_id` on every query,** with a `toSQL()` test.
- **Module boundary:** `src/lib/platina/boundary.test.ts`. `@/lib/ai/pricing`
  is **not** allowed.
- **No synthesised numbers:** a missing measurement is "not measured" or
  "insufficient", never 0.
- **Operator copy never uses the internal terms** (§9); the card's banned-word
  test enforces this.
- **Deploy order:** migrate first, then run the new code.

---

## 5. Traps found in this run

- **Account usage limits stop subagents mid-task** (HTTP 429). Their work
  survives in the worktree; resume them with SendMessage.
- **Start one worktree agent per message;** several at once collided ("git
  identity could not be verified", locked worktrees).
- **`node_modules` in worktrees:** a **junction** to the main checkout's.
  Remove only with `cmd /c rmdir node_modules`, never recursively.
- **Files are CRLF.** Multi-line `sed`/`node` replacements miss; use the Edit
  tool.
- **The owner edits the main checkout in Cursor,** and its local `main` lags
  `origin/main`. Integrate in `.claude/worktrees/b0-integration` (branch
  `feat/b0`) and `git push origin feat/b0:main` after a fast-forward check.
  Do not `git pull` into the owner's checkout without asking.
- **`next build` needs `.env.local`:** copy it in for the build, delete it
  afterwards.
- **Flaky under heavy load:** `brand-colour.test.ts`, `theme-migration.test.ts`
  (5 s timeouts). Re-run alone before believing a failure.
- **Review catches what tests miss:** wrong falsifier directions, a shared
  constant leaking into the live path, refuted chunks offered as support, a
  shadow stage that could throw inside the live step. Review every diff
  against "off = unchanged", "shadow never blocks", and the meaning of what
  is measured.

---

## 6. Continuation prompt (paste this into the next agent)

```
You are continuing the "metacognitive Brain" work in the Platina AI OS repo
(C:\Users\conssar6\Desktop\pd-instamedia-main, GitHub Sukhesh-waters/hack-core,
branch main). Work is ~90% done; B9 and three retrieval call sites remain.

Read, in order, before doing anything:
1. CLAUDE.md (binding constitution).
2. docs/superpowers/plans/2026-10-14-brain-continuation.md (state, open
   findings, what is left, rules, traps, showcase runbook).
3. docs/superpowers/plans/2026-10-13-metacognitive-brain.md (the approved
   plan; sections cited as §N), and docs/newbrain.md (the brief).

Then:
- git fetch; confirm origin/main has this handoff. Run `npx vitest run` once
  and compare with the counts in handoff §1.
- Ask the owner whether the database is back and whether it is the same
  Supabase project (case A) or a new one (case B). Never run db:migrate or any
  script against a database without their explicit yes. Then follow the
  runbook in handoff §7.
- Build what is left (handoff §3), one branch per slice off main, every new
  stage behind its mode with "off" byte-identical and shadow/on failing open.
- Keep the rules in §4; avoid the traps in §5.
- Plan → diff → review, then merge and fast-forward push.
- When a slice lands or shadow numbers come in, update plan §14 and §1 here.
```

---

## 7. Showcase runbook

Nothing below can run until the database is back. Each step that touches the
database needs the owner's yes.

### 7.1 Bring the database up (§15.1)
- **Case A, same Supabase project restored:**
  1. Back up the tables these migrations touch to `backups/`.
  2. `npm run db:migrate` (applies 0087–0090, all additive).
- **Case B, new project:**
  1. `npm run db:migrate` from scratch.
  2. Re-onboard: `scripts/onboard-client.ts --apply`, then
     `npm run platina:force` and `npm run platina:evidence`.
- **Either case:** `npm run platina:brain-readiness` must print `OK` for
  0087, 0088, 0089 and 0090. If any line says `MISSING`, stop: the live job
  writes those columns.
- `npm run dev:all` (Next + Inngest dev server; nothing scheduled runs
  without the Inngest dev server).

### 7.2 Choose the demo workspace
**ARABLAB LIVE is 26 Oct 2026: no stage goes `on` in `waters-gcc-internal`
before 27 Oct** (D6). Shadow there is allowed. For the `on` features, either
demo in a second workspace or the owner lifts the freeze for the demo.

### 7.3 Set the stages (demo workspace `<ws>`)
```
npm run platina:brain-snapshot -- --ws <ws>          # restore point first
npm run platina:brain-mode -- --ws <ws> --stage retrieval --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage budget --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage interrogation --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage gate --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage challenger --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage surprise --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage grading --mode shadow --apply
npm run platina:brain-mode -- --ws <ws>              # show the result
```
In `waters-gcc-internal` before 27 Oct, use `shadow` for every stage instead.

### 7.4 What the audience can see, and what it needs
| Screen | Shows | Needs |
|---|---|---|
| `/p/<ws>/plan` → new plan → roadmap | "How we'll know if this plan is wrong" (the stated test) | Nothing (any mode) |
| Same roadmap | "Counter-evidence the planner weighed" | `retrieval` on, and a Brain insight pointing the other way |
| Same roadmap, freshness banner | "N new validated signals… Worth re-planning" | New gated insights after the plan was written |
| Same roadmap, evidence badges | "Held up when tested" / "Proved wrong on …" | Grades. Falsifier windows are 30/90 days, so **these will not appear on fresh data** |
| Signals → findings | Testable insight with its own falsifier; "Held: <reason>" for a claim that failed the gate | `interrogation` on (`gate` on for "Held") and a signal analysed after the flip |
| `/p/<ws>/admin/health` → Brain quality | Objection rate, gate holds, skipped-as-unusual share, spot-check hit rate, retrieval stats | Any stage in shadow/on plus a day of job runs (rows stay hidden until they have data) |

Plan the demo around rows 1, 2, 5 and 6. Row 4 needs real time to pass.

### 7.5 Roll back (any time)
- One stage: `npm run platina:brain-mode -- --ws <ws> --stage <s> --mode off --apply`.
- All Brain state: `npm run platina:brain-snapshot -- --restore backups/<file>.json --archive-new --apply`
  (dry run without `--apply`; `--archive-new` sets aside what was written since).
- Writes by one stage since a time: `npm run platina:brain-undo -- --ws <ws> --cause <stage> --since <ISO time> --apply`
  (dry run without `--apply`).
- Schema: the hand-written `drizzle/down/0090.sql` … `0087.sql`, newest first
  (only if the owner asks; every migration is additive, so leaving them is safe
  with all stages off).
