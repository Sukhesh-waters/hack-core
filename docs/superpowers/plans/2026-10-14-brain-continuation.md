# Metacognitive Brain — continuation handoff (pause at ~60%)

Written 2026-10-14 for the **next agent** that picks up this work. The plan
is [2026-10-13-metacognitive-brain.md](2026-10-13-metacognitive-brain.md)
(sections cited as §N), and the brief is [docs/newbrain.md](../../newbrain.md).
Read both, plus `CLAUDE.md`, before you touch code.

The owner asked for a pause at a clean stage, with this file as the
continuation point. Everything below was true at the commit that added this
file to `main`.

---

## 1. Where things stand

| Slice | What | State |
|---|---|---|
| B0 | Per-stage modes (off/shadow/on), telemetry, undo journal (`setBrainState` + `platina_brain_state_log`), metric registry, recovery scripts, Admin → Health "Brain quality" card, legacy-equivalence golden test | **Done, on `main`** |
| B1 | Interrogation schema (what/why/how/kind/falsifier), numbered evidence spans, fact quotes checked by code, code-built falsifiers on measured insights. Migration 0088 | **Done, on `main`** |
| B2 | Blind challenger (claim + mechanism + cited span texts only), 50/50 shadow split, objection telemetry. `BRAIN_OBJECTION_CEILING = 0.7` for the card; live `OBJECTION_RATE_CEILING` stays **0.8** | **Done, on `main`** |
| B3 | Deterministic gate (`insight-gate.ts`): testability (min-N via `measureMetric`), significance (`topic_momentum` claims only), schema. `resolveV2` ignores proposer self-confidence (D7); evidence support = valid citations ÷ `SUPPORTING_SPANS` (2), capped at 1, **never** ÷ page span count. A held claim (gate on) gets a transcript and a finding "Held: <reason>", no Brain chunk. Measured "rising/falling" insights must pass Mann–Whitney or read "not clearly different from usual" | **Done, on `main`** |
| B4 | `surprise.ts` (Welford, novelty, overrides, audit sample) and `significance.ts` (Mann–Whitney) | **Pure modules done. NOT wired** |
| B5 | Daily falsifier grader (cron 05:00, fan-out per workspace, pages of 200, catch-up), grades table, refutation memory, re-test of holding/insufficient (due_at pushed; 3 insufficient attempts → terminal), ledger credit link. Migration 0089 | **Done, on `main`** |
| B6/B7 | `diversify.ts` (MMR, derived cap, counter-evidence slot, lineage/self-citation) and `context-budget.ts` | **Pure modules done. NOT wired** |
| B8 | Real-time planning on the new Brain | **Not started** |
| B9 | Proxy-vs-outcome, rule conflicts, insight review | **Not started** |

Tests on `main` at the pause: **3133 passed, 10 skipped, 3 todo, 0 failed**
(317 files). `tsc --noEmit` and `next lint` are clean. Before B0 the suite was
2787 tests.

**Environment (§15.1):**
- **Hosting.** The Vercel plan is cancelled, so nothing deploys from `main`.
- **Database.** The Supabase database was **unreachable** on 2026-10-13: the pooler said "tenant not found" and the host did not resolve. The owner is re-provisioning it. **Migrations 0087, 0088 and 0089 have not been applied anywhere.**
- **Runtime.** Local only: `npm run dev:all` (Next + Inngest dev server).

**Every brain mode is `off` in every workspace.** The live analysis path is
byte-identical to before B0, as `brain-legacy-equivalence.test.ts` proves.

---

## 2. Open findings from review (do these as part of W3)

1. **Surprise filter direction (B4 wiring).** `decideSurprise` uses
   `|observed − mean|`. For novelty only an *upward* deviation matters: make it
   one-sided for `nov:` keys and keep it two-sided for `eng:`. The reason text
   "bigger than this page's usual change" is wrong when the deviation is
   downward.
2. **Counter-evidence needs refuted chunks in the pool (B6 wiring).** Support
   queries filter `status = 'active'`, so `pickDisconfirming` never sees a
   refuted chunk unless the wiring also calls the B5 query for refuted chunks
   by `subject_key` (in `src/db/queries/platina-grades.ts`) and adds them to
   the pool.
3. **`hasDateOrPrice`** only catches year-qualified dates; it reuses
   `findDateRanges` with no reference date. That is acceptable for press
   releases. Revisit only if live shadow numbers show misses.
4. **The CLAUDE.md "Deploy: Vercel only (Pro plan)" line** is out of date.
   Ask the owner for the new target before editing it.
5. **The plan's §4 migration numbers are superseded by §15.4.** Actual numbers:
   0087 B0, 0088 B1, 0089 B5. **B4's expectations table becomes 0090.**

---

## 3. What to build next (≈40% left)

Build these as **separate branches off `main`**, one slice per branch,
reviewed before merge. Each new stage stays behind its mode (§2.1). With the
mode `off` nothing changes, and the golden test must stay green.

### W3a — B4 surprise filter, wired (§5 B4)
- **Migration 0090:** `platina_expectations` (`workspace_id`, `key`, `n`,
  `mean`, `m2`, `updated_at`), unique on `(workspace_id, key)`. Hand-write
  `drizzle/down/0090.sql`.
- **In `analysis-plan.ts`,** after `loadPrevious` and before the analyse
  verdict: compute the observation (novelty for web pages from the change
  summary, the engagement index for social posts, `ad_days_running` for ads),
  then call `decideSurprise`. **Upsert the expectation for every
  observation.**
- **Modes:**
  - off: no change.
  - shadow: log "would skip"; the document is still analysed.
  - on: skip with `skip_cause = 'surprise'`. An audit sample is analysed and
    labelled.
- **Cost guarantee:** add the test "surprise skip ⇒ provider never called".
- **Card row:** the false-negative rate from audit samples.
- **Replay:** `platina:brain-replay --cause surprise` already works.
- **Fix review finding 1 here.**

### W3b — B6/B7 retrieval, wired (§5 B6, B7)
- **Wire `diversifyEvidence` + `fitSections` into four places:**
  `plan/context.ts retrievePatternEvidence`, `retrieve.ts retrieveBuckets`,
  `opportunity-brief.ts` and `idea-run.ts`. Use modes `retrieval` and
  `budget`.
- **Pool size:** widen the candidate pool to about 50 and rerank to about 8.
- **Counter-evidence query:** add it inside the existing `Promise.all`. **No
  new serial round trip** on interactive paths; planner p50 may not regress by
  more than 50 ms.
- **In-request fallback:** if the new path throws, use the old one and record
  `retrieval.fallback`.
- **Telemetry:** derived share, counter-evidence fill rate, lineage drops.
- **Fix review finding 2 here.**
- **Two-layer rule:** planes are never merged, and `findCitationProblem`
  still refuses mixed phases.

### W4a — B8 real-time planning (§5 B8, §15.2 V2–V4)
- **Freshness** (`plan/freshness-read.ts`, `brainEvidenceSinceQuery`): count
  only gated insights (exclude `grade_state = 'insufficient'` and
  untestable). Add a refuted-cited check: snapshot ids in `PlanDoc.evidence`
  joined against `grade_state = 'refuted'`. Show the line "evidence behind
  this plan was proved wrong". No plan-table migration (V2).
- **Roadmap badges:** "proved wrong on <date>: <metric> was <value>" and
  "held up when tested", worded per §9.
- **Plan-level falsifier:**
  - add an optional `PlanDoc.falsifier` (jsonb, no migration);
  - the planner prompt asks for it, using the registry only;
  - validate it with `validateFalsifier`;
  - B5 grades it on Plane A metrics;
  - each grade becomes `platina_plan_feedback` worked/failed plus a ledger
    event.
- **Realtime:** the grader already broadcasts `insights`, and the header
  refreshes on any scope (V4).

### W4b — B9 (§5 B9)
- **Proxy-vs-outcome check:** add Spearman ρ (proxy vs leads) to the monthly
  consolidation digest. Add an optional `qualified_leads` column to the
  results import.
- **Rule conflicts:** when a top-third-scoring idea is blocked by
  `claims-gate.ts`, raise an inbox escalation that shows both sides.
- **Insight review:** approve / edit / reject-with-reason on Brain map and
  Findings, recorded as ledger events.
- **Invariants:** fill in the last `it.todo` entries in
  `brain-invariants.test.ts`.

### When the database is back (§15.1 — do this before starting `dev:all`)
- **Case A, same project restored:**
  1. Back up the tables these migrations touch to `backups/`.
  2. Run `npm run db:migrate` (0087 onward).
  3. Verify the columns and tables exist.
  4. Start `dev:all`.
- **Case B, new project:**
  1. `npm run db:migrate` from scratch.
  2. Re-onboard Waters (`scripts/onboard-client.ts --apply`, then
     `platina:force`, `platina:evidence`).
  3. Start `dev:all`.
- **Then roll out per stage (§11.7):**
  1. `npm run platina:brain-snapshot -- --ws <slug>`.
  2. `platina:brain-mode -- --ws <slug> --stage <s> --mode shadow --apply`.
  3. Read a week of shadow numbers on the Brain quality card.
  4. Set the mode to `on`.
  5. Record the result in plan §14.
- **ARABLAB LIVE is 26 Oct 2026:** no flips to `on` in `waters-gcc-internal`
  before 27 Oct.

---

## 4. Rules that kept the live job safe (keep them)

- **Modes:** with a mode `off`, the path is byte-identical. Fork early on
  `modeOf(config, stage)`, as the B1 fork in `signal-analyze.ts` does. Never
  change `runContradictionRound` (v1) or the legacy fixture JSON.
- **Additive migrations only,** each with a hand-written `drizzle/down/00NN.sql`.
  `migrations-down.test.ts` checks them automatically. Never edit an applied
  migration. Unapplied ones (all of them, right now) may be regenerated.
- **Brain state** (status, confidence, agreement_state, grade_state) changes
  **only** through `setBrainState`, which locks the row and journals the change.
  `due_at` is a schedule and is updated directly, guarded on its old value.
- **`workspace_id` on every query,** with a `toSQL()` test asserting it
  (pattern in `src/db/queries/platina-learning.test.ts`).
- **Module boundary:** `src/lib/platina/boundary.test.ts`. Platina may import
  only the allowlisted shared infra. `@/lib/ai/pricing` is **not** allowed,
  so copy small helpers instead.
- **No synthesised numbers:** a missing measurement is "not measured" or
  "insufficient", never 0.
- **Operator copy never uses the internal terms** (§9). The card's
  banned-word test enforces this.
- **Deploy order still applies** once a database exists: migrate first, then
  run the new code.

---

## 5. Traps found in this run

- **Account usage limits stop subagents mid-task** (HTTP 429 "session
  limit"). Their work survives in the worktree. Resume them with SendMessage;
  a new session must start fresh agents on the existing branches instead.
- **Starting several worktree subagents in one message collided:** "git
  identity could not be verified", and the worktrees were left locked. Start
  **one worktree agent per message**. Remove broken worktrees with
  `git worktree remove -f -f`, after checking for uncommitted changes.
- **`node_modules` in worktrees:** use a **junction** to the main checkout's
  `node_modules`. Never delete it recursively, because that deletes the real
  packages. Remove it only with `cmd /c rmdir node_modules`, and only before
  `git worktree remove`.
- **Files are CRLF.** Multi-line `sed`/`node` replacements miss; use the Edit
  tool.
- **The owner edits the main checkout in Cursor**, and its local `main` may
  lag `origin/main`. Integrate in a separate worktree (this run used
  `.claude/worktrees/b0-integration` on branch `feat/b0`) and push with
  `git push origin feat/b0:main` after checking it is a fast-forward. Do not
  `git pull` into the owner's checkout without asking.
- **Known flaky tests under heavy parallel load:** `brand-colour.test.ts` and
  `theme-migration.test.ts` (5 s timeouts). Re-run them alone before
  believing a failure.
- **Two bugs that review caught and agents did not:**
  - code-built falsifiers whose direction or metric contradicted the insight;
  - a shared constant change that leaked into the live path.

  Review every agent diff against the "off = unchanged" rule and the
  semantics of what is being measured, not only the tests.

---

## 6. Continuation prompt (paste this into the next agent)

```
You are continuing the "metacognitive Brain" work in the Platina AI OS repo
(C:\Users\conssar6\Desktop\pd-instamedia-main, GitHub Sukhesh-waters/hack-core,
branch main). Work is paused at ~60%.

Read, in order, before doing anything:
1. CLAUDE.md (binding constitution).
2. docs/superpowers/plans/2026-10-14-brain-continuation.md (this handoff:
   state, open findings, next slices, rules, traps).
3. docs/superpowers/plans/2026-10-13-metacognitive-brain.md (the approved
   plan; sections cited as §N), and docs/newbrain.md (the brief).

Then:
- Run `git fetch` and confirm origin/main contains the handoff commit. Run the
  full suite once (`npx vitest run`) and compare with the counts in the
  handoff §1.
- Ask the owner one thing first: is the database back, and is it the same
  Supabase project (case A) or a new one (case B)? Do not run db:migrate or
  any script against a database without their explicit yes. Also ask for the
  new deploy target, so the CLAUDE.md "Vercel only" line can be corrected.
- Build next, in this order, one branch per slice off main, each reviewed
  before merge, every new stage behind its mode with "off" byte-identical:
  W3a (B4 surprise wiring + migration 0090, including open finding 1),
  W3b (B6/B7 retrieval wiring, including open finding 2), W4a (B8 real-time
  planning), W4b (B9). Specs are in the handoff §3 and plan §5.
- Keep the rules in handoff §4. Avoid the traps in handoff §5 (one worktree
  agent per message; node_modules junction; CRLF files; never pull into the
  owner's checkout; integrate in a separate worktree and fast-forward push).
- Plan → diff → review: propose the slice plan to the owner, build it, review
  the diff yourself against "off = unchanged" and the meaning of what is
  measured, then merge and push.
- When a slice lands, update plan §14 (shadow results) and this handoff §1.
```
