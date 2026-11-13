# Waters feasibility study — pre-registration (DRAFT)

Date: 2026-11-09 · Workspace: `waters-gcc-internal` · Status: **DRAFT — every threshold below is a proposal
until the owner signs §9.** Once signed, this file is not edited; a change is a new dated file that says what
changed and why, written before the next reading.

Study window: 27 Oct 2026 – 19 Jan 2027 (12 weeks). Checkpoints: 24 Nov and 22 Dec. Decision: 19 Jan.
Measures are defined in `docs/superpowers/plans/2026-10-22-wtr-0-study-readiness.md` §5 (Part D).

## 0. Integrity note

This is written on 9 Nov, two weeks after the study started. **No study data was read before writing it**: the
database has been unreachable since at least today, and the weekly report (WTR-0 Part D) does not exist yet. The
first reading will be the 24 Nov checkpoint.

## 1. Questions the study answers

| # | Question | Answered by |
|---|---|---|
| Q1 | Does the product survive: do real people at Waters use it for decisions, at a cost it can carry? | L1, R4, L5 (+ K1, K4) |
| Q2 | Is the market watch useful: does it turn competitor moves into reviewed findings fast, without noise? | R1, R2, L4 (+ K3) |
| Q3 | Does the learning loop get fed: do real results come back so plans can be scored? | R3, L3 (+ K2) |
| Q4 | Should the product be split in two? | The pattern of Q2 against Q3 (§6) |

## 2. Operating conditions (new, because of the runtime)

The runtime is local (`npm run dev:all`) and, as of 9 Nov, runs **only during demos and development**. Collection,
analysis and grading happen only while it runs. A week the product was not running says nothing about whether the
product works. So:

- **A0 — runtime availability:** hours and completed study sessions per week the job runner was up, from the OPS-0
  heartbeat (or §8 log until the heartbeat table lands).
- **Operated week (owner decision 12 Nov 2026):** **≥ 2 scheduled study sessions in the week (each ≥ 2 hours with
  collection + analysis + grading completed) OR A0 ≥ 15 hours of runtime.** This fits a local demo/development
  runtime while still separating "not run this week" from "nobody used it."
- Every product measure is computed **over operated weeks only**. Non-operated weeks are listed separately with
  their A0.
- Until the heartbeat exists, a week counts as operated only if the owner records it as operated in §8 (log).
- Weeks 1–2 (27 Oct – 9 Nov): **not operated** (database paused, runner off). Recorded now, before any reading.
- Competitor moves dated inside a non-operated week are excluded from R1 (otherwise a backfill would show huge
  delays the product never had a chance to avoid) and reported as a count.

## 3. Measures, floors and thresholds

"Floor" = the minimum N below which the measure reads "not enough data yet" and counts as neither pass nor fail.

| ID | Measure | Floor | Pass (proposal) | Fail (proposal) |
|---|---|---|---|---|
| A0 | Runtime availability per week | — | ≥ 2 completed study sessions (≥ 2 h each) or ≥ 15 h in ≥ 75% of remaining weeks | < 2 sessions and < 15 h in > 50% of weeks → study **inconclusive** (K5) |
| R1 | Median time from a competitor move (post or ad's own date) to a reviewed finding, high/medium severity | 5 findings | ≤ 3 days | > 7 days |
| R2a | Share of fetched documents the surprise filter would skip (shadow) | 50 documents | ≥ 30% | < 10% (filter adds nothing) |
| R2b | Spot checks that found something | 10 spot checks | < 20% | > 40% (filter is skipping real news) |
| R3a | Operated weeks with a LinkedIn import, from the first import onward | 4 weeks | ≥ 75% | < 50% |
| R3b | Rows matched to a registered creative, per import | 1 import | ≥ 50% | < 20% |
| R4 | Suggestions decided (planned or dismissed with reason) within 7 days | 10 suggestions | ≥ 50% | < 20% |
| L1 | People other than the builder who made a decision in an operated week | — | ≥ 1 person in ≥ 75% of operated weeks | 0 people in ≥ 50% of operated weeks |
| L2 | Runs by origin: schedule + event + person, against operator scripts | 20 runs | operator ≤ 30% | operator > 60% (product runs on scripts) |
| L3a | Insight grades written (any verdict) | — | ≥ 10 by 22 Dec | < 3 by 22 Dec |
| L3b | Re-plans triggered by evidence (not "on request") | — | ≥ 1 by 19 Jan | — (descriptive) |
| L4 | Failed or degraded runs, share of all runs | 20 runs | ≤ 10% | > 25% |
| L5 | AI cost + collection spend per month | — | ≤ budget **[owner fills]** | > budget two months running |

No measure is ever shown as a number below its floor; "not enough data yet" is a result, and it is reported as
such, never filled in.

## 4. Readings

| When | Read | Allowed decisions |
|---|---|---|
| 24 Nov | A0, L1, L2, L4, R3 status, R1 if above floor | continue · fix the runtime first · narrow scope (§7). **No product verdict** at this checkpoint: at most two operated weeks will exist |
| 22 Dec | All measures | continue · stop one half (§6) · stop |
| 19 Jan | All measures + kill criteria | survive · split · stop · inconclusive |

## 5. Kill criteria (fixed now, applied on 19 Jan)

| # | Criterion | Consequence |
|---|---|---|
| K1 | L1 fails (no non-builder decisions in ≥ 50% of operated weeks) | No evidence of use: stop, or keep only as a demo |
| K2 | R3a below floor or failing by 22 Dec (fewer than 4 import weeks) | Learning loop unproven: drop learning claims from the pitch; product continues as market watch only |
| K3 | R1 fails with N ≥ 5 at 22 Dec | Real-time market watch not shown: stop the watch half |
| K4 | L5 over budget two months running | Cost not carried: cut collection scope before anything else |
| K5 | A0 fails | **Inconclusive** — the product was not run enough to judge. This is not a product failure and not a pass |

Rules: a criterion with its measure below the floor is "not decidable", never a pass. K5 is checked first; if it
holds, K1–K4 are reported but not applied.

## 6. The split question (Q4)

| Market watch (R1, R2, L4) | Learning loop (R3, L3) | Reading |
|---|---|---|
| passes | passes | One product survives as designed |
| passes | fails | Evidence for splitting: the watch stands alone; the planner/learning half waits for a data source |
| fails | passes | Evidence for keeping the planner and dropping continuous monitoring |
| fails | fails | Stop (unless K5) |

**[owner fills]**: name the two products a split would produce, so the 19 Jan reading cannot redefine them.

## 7. Scope changes allowed during the study

Allowed without breaking the study: bug fixes, OPS-0, WTR-0, CORE-3, and Brain stages moved to shadow. Any change
that alters what a measure counts (for example, turning a Brain stage `on`, changing the finding severity rules)
is logged in §8 with its date **before** it takes effect, and readings are split at that date.

## 8. Log (append only)

| Date | Entry |
|---|---|
| 2026-10-27 | Study starts. |
| 2026-11-09 | Database unreachable (Supabase pause suspected). Runner not running. Weeks 1–2 recorded as not operated. Pre-registration drafted before any reading. |

## 9. Sign-off

| | |
|---|---|
| Thresholds in §3 approved as written / changed (list) | |
| L5 budget | |
| Split products named (§6) | |
| Operated-week floor (default 30 h) | |
| Signed by, date | |
