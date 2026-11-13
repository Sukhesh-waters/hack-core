# Planner and evaluator — from retrieval to plans that are committed, watched and scored

Date: 2026-10-23 · Lane: Core (CORE) + Waters (WTR) · Status: **DRAFT — roadmap for owner review; each slice gets its own spec before code**
Visual companion: the canvas "Platina architecture and data flows" (Today / Target views per flow, and the Improvement gate tab).
Builds on: `2026-10-22-wtr-0-study-readiness.md` (WTR-0), the feasibility study (27 Oct 2026 – 19 Jan 2027).

## 0. Why

Read from the code on `main` (3cd6091), 23 Oct 2026:

- In operation today the product retrieves evidence and writes a plan from it. What makes it more than retrieval
  (interrogation, blind challenger, code gate, grading) is built but every Brain stage is `off`.
- The "evaluator" half does not exist for plans: the only evaluation harness (`src/lib/platina/eval.ts`) measures
  retrieval recall; the plan's own stated test is never graded (deferred in B8); the model's recorded confidence is
  never compared with outcomes (no calibration measure anywhere).
- "Worth re-planning" is computed only when someone opens a plan, the plan list or the Cockpit; nothing pushes it.
- A plan is a document: no status, owner, budget, targets or calendar dates.

The owner adopted five improvements on 23 Oct (plan as a commitment; options and a pre-mortem; a plan test set;
in-flight tracking, scorecard and calibration; plan watch and a weekly digest) and allowed read-only reporting
connectors. This roadmap orders them as slices inside the feasibility study.

## 1. The target loop

```
 brief or opportunity
   → context + EXPECTED RANGES (code, from the client's own history)
   → planner: 2–3 OPTIONS + PRE-MORTEM (three ways it fails, each with a measurable early warning)
   → citation check (+ warnings must be measurable) → critic compares the options
   → PERSON CHOOSES AND APPROVES → DECISION RECORD (alternatives, why, stop conditions, approver, hash)
   → LIVE CAMPAIGN (status, real dates, owner, budget; creatives linked to phases)
   → IN-FLIGHT TRACKER (each phase vs its range: on track / off track / not enough data yet;
                        early warnings; competitor moves on the same subject, labelled public)
   → PLAN WATCH pushes to the owner (in-app alert, Cockpit inbox, Monday digest)
   → re-plan (records why)  ·  or close → SCORECARD (stated test graded; decision shown beside outcome)
   → CALIBRATION (does "high confidence" hold more often than "low"?) → next plans
 Guarding every change to the planner: the PLAN TEST SET (offline, before a prompt or model change ships).
```

The thinking habits behind each step, in plain words: expected ranges from the client's own past are the
"outside view" against the planning fallacy; a decision record separates decision quality from luck; options
stop anchoring on the first draft; a pre-mortem counters overconfidence; calibration turns "calibrated, not
confident" into a number.

## 2. Rules every slice keeps

- **Manual gate before code (G1):** the owner reviews the slice in the canvas (Today vs Target, Improvement gate
  tab) and marks it "Approved to build". Then its own spec is written (plan → review), then code.
- **Manual gate after code (G2):** the slice's "verify after build" checks pass by hand on the fixture workspace,
  then its live proof on Waters is recorded.
- No number from a model: ranges, pacing, scorecards and calibration are computed by code; below the minimum count
  they say "no baseline yet" / "not enough data yet".
- Two-layer rule: competitor context during a flight is public data, labelled, never evidence for a first-party
  verdict.
- Additive migrations with a hand-written down file; `workspace_id` on every table and query, with `toSQL()` tests.
- Fail open: a malformed option, pre-mortem or range is dropped and the plan is still saved (as the stated test is
  today).
- One slice in build at a time (one developer); the 27 Oct freeze on Waters stands.

## 3. Slices

### WTR-0 — Study readiness (specced: `2026-10-22-wtr-0-study-readiness.md`)

LinkedIn import that works, operator marker on script runs, re-plan reason, weekly study report. Migration 0091.

### CORE-3 — Plan test set (size M, no migration) — first, so later planner changes are measured

- `src/lib/platina/plan/eval-set.ts`: fixed briefs with synthetic contexts (no Waters data), each with checks code
  can run: every cited id exists; no phase mixes planes; days within 180 and anchored dates respected; a stated
  test from the registry is present; (after CORE-2) options are distinct and every early warning is measurable;
  a small labelled set for critic-vs-person agreement.
- `src/lib/platina/plan/eval.ts` (pure scoring) + `scripts/platina-plan-eval.ts`
  (`npm run platina:plan-eval -- [--ladder fast|quality] [--json]`); live mode calls the router and is skipped
  without provider keys, like `eval.live.test.ts`.
- **Gate rule:** a prompt or model change to the planner or critic merges only with a report that does not drop
  below the recorded baseline.
- Verify after build: the runner prints pass rates per check for the current planner; that report becomes the
  baseline.

### CORE-1 — Plan as a commitment (size L, migration 0092)

- **Lifecycle on `platina_plans`:** `status` (draft | approved | live | closed), `owner_id`, `starts_on`, `ends_on`
  (calendar dates; existing plans keep their day offsets and get dates computed once from `created_at`),
  `budget_amount` + `budget_currency` (nullable), `closed_at`.
- **Decision record** `platina_plan_decisions`: plan id, chosen option, alternatives (frozen copies), why, stop
  conditions, approver, payload hash, created at. Approval goes through the existing approve gate
  (`src/lib/platina/gates.ts`, `platina_gate_events`), so who approved exactly what is recorded once.
- **Expected ranges** (pure, `src/lib/platina/plan/expected.ts`): per phase channel and format, the 25th–75th
  percentile of engagement rate and click-through rate from the client's own creatives, reusing `engagementRate`
  and `median` from `src/lib/platina/review.ts`; below the minimum count, "no baseline yet". Stored on each phase
  in `PlanDoc` (jsonb) with its basis (n, window, source).
- Verify after build: approve a plan → status approved, approver and hash recorded; phases show a range or
  "no baseline yet"; an old plan opens with computed dates.

### WTR-1 — Live campaigns and in-flight tracking (size L)

- A live campaign is an approved plan with a start date. Creatives attach to its phases (existing `plan_id`,
  `phase_id`); unassigned posts from the WTR-0 import can be attached from the plan.
- **Tracker (pure + read):** each phase on read: on track / off track / not enough data yet against its range;
  each early warning (CORE-2) checked; competitor moves on the plan's subjects during the flight shown as public
  context. Suggested adjustments are recorded in the suggestion ledger (kind `adjustment`) so accept / dismiss and
  results flow back through credit.
- Live proof: the ARABLAB follow-up is the first live campaign; a weekly import moves its phases.

### CORE-2 — Options and a pre-mortem (size M, no migration)

- `PlanDoc` gains `alternatives` (up to 2 besides the chosen draft: title, summary, trade-off, evidence ids) and
  `premortem` (3 risks, each with an early warning mapped to a registry metric or a market signal; unmappable
  warnings are dropped).
- The critic compares the options. Alternatives drafted on the fast ladder (about one extra fast call per plan).
- Behind a per-workspace planner mode (off | on), off byte-identical; switched on only after CORE-3 shows no drop.
- Verify after build: a plan shows 2–3 options and three measurable early warnings; the test set holds its score.

### WTR-3 — Plan watch and the weekly digest (size M; a small migration only if the alert tables need a new source value)

- `platina-plan-watch` (Inngest), triggered by events that already exist — the end of the insight sync, a grade
  written, `platina/results.updated`, a finding written — debounced per plan. It computes freshness and pacing for
  live plans and raises an in-app alert (new alert source `plan`) plus a Cockpit inbox item (new kind `plan`); a new
  realtime scope `plans` refreshes open pages.
- Weekly digest per member, Mondays 04:00 UTC (09:30 IST, 08:00 GST): what changed, what is off pace, what needs a
  decision. Numbers by code; one model call writes the sentences.
- Delivery stays in-app: email / Teams for Platina alerts remain archived until the owner decides otherwise.
- Needs an always-on runtime to be truly "push"; on local runtime it runs while `npm run dev:all` runs.
- Verify after build: refute a cited insight in the fixture workspace → the owner sees an alert within a minute;
  the Monday digest appears.

### WTR-2 — Scorecard and calibration (size M)

- **Close and score:** at `ends_on` (or a person closing it) the plan's stated test is graded through the existing
  grader and metric registry (the deferred B8 item), each phase is marked in or out of range, and the decision
  record is shown beside the outcome. A plan verdict is written to `platina_plan_feedback` and a ledger event.
- **Calibration card** (Admin → Health): graded claims by recorded confidence band (low / medium / high) against
  held vs refuted; per band below the minimum count it reads "not enough graded claims yet". Also critic and
  challenger objections against what people later rejected.
- Verify after build: a closed fixture plan shows its graded test; the calibration card shows bands or the honest
  "not enough" state.

### CORE-4 — Read-only reporting connectors (size L; constitution amendment; external approvals)

- Order by what Waters can grant: Google Analytics Data API (read-only scope), LinkedIn Marketing API reporting
  (read-only reporting scope; needs LinkedIn's API access approval, which takes weeks), CRM lead counts per
  campaign (depends on Waters' CRM).
- All reads go through the shared, already-allowlisted `src/lib/connectors/metrics-read.ts`; tokens encrypted in
  the existing store; numbers are first-party (Plane A) with source `connector:<name>`.
- Tests: no write scope is ever requested; connector modules make no write calls to platform APIs (token refresh
  excepted); tokens never reach the browser.
- Start the paperwork now (ask Waters, apply for LinkedIn access, Waters IT security review); build when access
  exists.

## 4. Proposed constitution wording (not applied — owner signs first)

> **Owner decision 2026-10-23 (read-only reporting connectors):** Platina may read a client's own campaign
> reporting through read-only API scopes the client grants (for example LinkedIn Marketing API reporting, the
> Google Analytics Data API, CRM lead counts). It never requests a write scope, never posts, schedules, edits
> campaigns, audiences or budgets, and never uses a person's password. Every such read goes through
> `src/lib/connectors/metrics-read.ts`; tokens stay in the encrypted store. These numbers are first-party
> (Plane A). The earlier "no ad-account connections" rule is narrowed to: no write access, ever.

## 5. Order inside the study

| Weeks | Dates | Work | Gate |
|---|---|---|---|
| — | now – 26 Oct | G1 reviews in the canvas; WTR-0 built in a worktree; connector paperwork started | freeze on Waters |
| 1 | 27 Oct – 2 Nov | merge WTR-0 (migration 0091); Brain stages to shadow; CORE-3 baseline report | G2 for WTR-0 |
| 2–3 | 3 – 16 Nov | CORE-1 (migration 0092) + WTR-1; ARABLAB follow-up as the first live campaign | G2 for each |
| 4 | 17 – 23 Nov | CORE-2, measured against the CORE-3 baseline | checkpoint 24 Nov |
| 5–6 | 24 Nov – 7 Dec | WTR-3 plan watch + digest; first 30-day grades land; stages on where they pass | |
| 7–8 | 8 – 21 Dec | WTR-2 scorecard + calibration | checkpoint 22 Dec |
| 9–12 | 22 Dec – 19 Jan | CORE-4 if access exists; otherwise buffer and study read-out | study decision 19 Jan |

If the schedule slips, CORE-2 and CORE-4 move later; WTR-0, CORE-1 and WTR-1 do not, because the study's
measures depend on them.

## 6. Risks

| Risk | What's done about it |
|---|---|
| Options and pre-mortem make plans longer, not better | CORE-3 measures before and after; CORE-2 stays off if the score drops |
| Expected ranges rest on few past posts | Minimum count per channel and format; "no baseline yet" instead of a range |
| Alerts become noise | Debounced per plan; only live plans; the study tracks alerts acted on |
| Push needs an always-on runtime | Stated in the canvas and the study; hosting is a separate owner decision |
| LinkedIn API approval is slow or refused | GA4 and CRM first; exports remain the fallback |
| Calibration needs many graded items | The card shows "not enough graded claims yet" until each band has its minimum |

## 7. Progress

| Slice | G1 (design approved) | Spec | G2 (verified) | Live proof |
|---|---|---|---|---|
| WTR-0 | owner approved offline parts, 12 Nov | written 22 Oct | A1/A2, B, C built & unit-tested; A3 migration 0091 + D wait on DB | |
| CORE-3 | owner chose "build" in chat, 9 Nov | this roadmap §3 | built, in review (uncommitted); planner `summary`/`message` word-boundary trim fix applied (12 Nov) | first finding fixed: verbose summary (>300 chars) on 21-day event brief is now trimmed on a word boundary instead of rejecting the plan |
| CORE-1 | | | | |
| WTR-1 | | | | |
| CORE-2 | | | | |
| WTR-3 | | | | |
| WTR-2 | | | | |
| CORE-4 | | | | |
