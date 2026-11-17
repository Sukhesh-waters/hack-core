# THE CORE PLAN — Platina AI OS

Master plan, written 17 Nov 2026. Readers: the owner, anyone building on this repo, and any later session or
repo that continues this work.

This file decides **order and priority**. It does not override `CLAUDE.md` (stack, rules, owner decisions) or the
signed study pre-registration (`docs/study/2026-11-09-waters-study-preregistration.md`). Where they disagree, they
win and this file is corrected. Detailed specs stay in `docs/superpowers/plans/` and are linked from here.

How this file changes: §2 (status board) and §13 (log) are updated as work lands. The rest changes only with a dated
entry in §13 that says what changed and why.

---

## 1. The product in one loop

> A B2B marketing team sees a competitor move within days, decides what to do about it with evidence it can
> trust, runs the campaign, records what happened, and the system's claims are graded against what happened.

```
 collect (public + own)  ->  understand (claims with falsifiers)  ->  decide (plan, approved by a person)
        ^                                                                        |
        |                                                                        v
   grade the claims  <-  record results (a person, with a hypothesis)  <-  run the campaign
```

Everything in the repo either serves one arrow of this loop or is not core. The study (27 Oct 2026 – 19 Jan 2027)
asks whether this loop **runs with real people at Waters** and whether it **pays for itself**. That is the only
question that matters before 19 Jan.

**What "real time" means here.** Not streaming. It means the time from a competitor's public move to a finding a
person has reviewed (study measure R1, pass ≤ 3 days median). On a local runtime that runs in sessions, that time
is set by **session cadence**, not by code speed (§6.2).

---

## 2. Status board

States: `todo` · `spec` (spec written, awaiting yes) · `build` · `done` (merged, tests green, measured) ·
`blocked` (named blocker) · `frozen` (deliberately not before 19 Jan).

| ID | Slice | Owner | State | Done when | Due |
|---|---|---|---|---|---|
| O-1 | Replace `APIFY_TOKEN` | owner | blocked (owner) | Ops check shows Apify usage readable; one LinkedIn collection completes | 18 Nov |
| O-2 | Sign pre-registration §9 (L5 budget, split names, thresholds) | owner | todo | §9 filled and signed | 21 Nov |
| O-3 | Name the Waters decision-maker and book the joint sessions (§6.3) | owner | todo | Name in §13; Mon + Thu sessions in calendars to 19 Jan | 19 Nov |
| O-4 | Brand questions answered by a Waters person (in session 1) | Waters user | todo | ≥ 20 active declared passages | 20 Nov |
| O-5 | Waters answer: weekly LinkedIn page export possible? | owner | todo | Yes/no in §13 | 21 Nov |
| T0.1 | Missed-schedule catch-up on session start | build | todo | Every daily/weekly/monthly job whose period passed runs once at start; origin recorded | 20 Nov |
| T0.2 | Stuck-run reaper + embedding backfill on start | build | todo | 0 runs stuck > 1 h; 0 passages waiting after a session | 20 Nov |
| T0.3 | Runtime heartbeat (A0) | build | spec (needs migration 0091) | A0 hours per week read from a table, not the log | 28 Nov |
| T1 | Retrieval that bites (§7) | build | todo | Labelled eval set passes; floors calibrated per plane | 21 Nov |
| T2.1 | Brain write-time refusal (empty, "nothing happened") | build | todo | No new `{}` or null rows; existing ones demoted, not deleted | 21 Nov |
| T2.2 | Event dates out of the hypothesis memory | build | todo | New event facts no longer written as Brain hypotheses | 28 Nov |
| T2.3 | Near-duplicate reinforcement | build | spec | Threshold calibrated on 30 human-labelled pairs first | 5 Dec |
| T3 | Evidence warrant rules (§8) | build | todo | Planner refuses a "this works" statement without results | 28 Nov |
| T4 | CPHI Middle East live campaign (§9) | Waters user + build | todo | Plan approved by a Waters person; creatives registered with hypotheses | 27 Nov |
| T5.1 | CORE-1 minimal: plan status, owner, dates, sealed decision record | build | spec | An approved plan cannot be silently edited | 27 Nov |
| T5.2 | `platina:study` weekly report | build | spec (migration 0091) | Report prints every §3 measure or "not enough data yet" | 4 Dec |
| T5.3 | Calibration reading (descriptive) | build | todo | Brier score per confidence band once ≥ 20 graded claims | 22 Dec |
| T6 | Second client (replication) | owner + build | frozen until 22 Dec | Onboarded in ≤ 1 working day, isolation tests green | 5–16 Jan |
| V-1 | Retire the validator's composite score | build | todo | Report shows statuses and gaps only | 21 Nov |

---

## 3. Where we actually are (measured 13–17 Nov 2026)

Measured with `platina:validate-usecases --run-tests`, `ops:check`, `platina:brain-readiness` and a read-only
retrieval probe (12 queries against live Waters vectors). Small samples are marked.

### 3.1 Loop health

| Arrow | Reading | Verdict |
|---|---|---|
| Collect, public | Apify HTTP 401; 26 sources late, 15 failing; newest interest signal 25 days old | **Broken** (one token) |
| Collect, own site | 160 of 300 pages read, 97 queued, 43 failed; nothing read for 2 days | Degraded |
| Understand | 240 documents analysed in 30 days (117 analysed, 66 low value, 35 nothing new, 22 own brand) | Works when the runtime runs |
| Understand, claims | 337 active Brain chunks; 0 with a falsifier, 0 with a subject, 0 graded, 0 consolidated | **Fuel missing** for grading |
| Decide | 2 plans, 1 with a stated test; no plan approved by a Waters person | Not proven with a real user |
| Run | 0 creatives registered | **Not started** |
| Record results | 0 metric snapshots, 0 confirmed reviews | **Not started** |
| Grade | 0 grades | **Not started** |
| Cost | AI $0.51 so far this month for Waters, about $1.24 by 30 Nov | Not a risk at this scale |

Brain writes per week: 203 (21 Sep), 77 (12 Oct), 28 (19 Oct), **0 for 26 Oct – 8 Nov** (runtime off), 29 (9 Nov).
The system learns only in the weeks it runs.

### 3.2 Retrieval probe (12 queries, read-only, 13 Nov)

| Check | Measured | Meaning |
|---|---|---|
| Relevance floor in code | 0.35 | — |
| Best first-party score, off-topic queries | 0.450 – 0.476 | Floor passes everything |
| Best first-party score, on-topic queries | 0.620 – 0.821 | Clean separation on this sample |
| Best Brain score, off-topic / on-topic | 0.457 – 0.510 / 0.617 – 0.708 | Narrower margin than first-party |
| Keyword search hits (all words must match) | 0 of 12 queries | Hybrid search is vector-only in practice |
| Keyword hits if any word may match | 10 – 279 | Needs a rank cutoff, not just OR |
| Same page in first-party top 8 | up to 7 of 8 | One page can fill the evidence slot |
| First-party corpus | 2,072 passages from 160 pages: 1,581 under `/au/en/`, 114 under `/us/en/`, 0 under a Gulf path; 1,568 from application notes; 163 contain page boilerplate | Product literature, mostly one locale mirror |
| Brain near-neighbours | 235 of 328 have a neighbour above 0.85; 77 above 0.92 | Possible duplication; **not yet confirmed by a person** |
| Brain junk | 2 rows are `{}`, 3 say nothing happened, 28 are event dates stored as hypotheses (4 dated 2028 or later) | Small count, surfaces for off-topic questions |

Examples that pass every gate today: "CPHI Middle East launch" returns a sustainability blog post as first-party
evidence; "competitor launch in Saudi Arabia" returns the Waters company-history page.

### 3.3 Runtime vs schedule (from the code, 17 Nov)

Daily jobs fire at fixed UTC times: outcome ingest 02:00, brand refresh 03:00, interest extraction 04:30, event
extraction 04:45, **falsifier grading 05:00**, own-site reading 05:00, event window / ideas / results 06:00,
receipt review 09:00. Weekly: Brain maintenance Mon 04:00, divergence scan Mon 05:00. Monthly: **consolidation
on the 1st at 02:00**. Every 6 h: contradiction sweep. Every 5 min: scan coordinator.

With a local runtime that runs in sessions, **a daily job runs only if a session covers its UTC minute**. A
session outside 02:00–06:30 UTC (06:00–10:30 Gulf, 07:30–12:00 India) runs collection and analysis but never
grades, never extracts interest or events and never consolidates. This matches the readings above (0 consolidated,
0 graded) and is the most important structural finding of this plan. To be verified in T0.1: whether the Inngest
dev server replays missed cron ticks (we expect it does not).

---

## 4. Second opinion on the 13 Nov review

The 13 Nov review (by Fable 5.2) found that the safeguards do not bite and the memory does not behave like memory.
I agree with the direction. Where I disagree or go further:

1. **The 0.55 floor comes from 12 queries.** That is enough to show the 0.35 floor is wrong, not to choose the
   new one. Floors are set per plane (first-party and Brain separate differently), from a labelled set of at least
   40 queries, and versioned with the embedding model. Until then, use the measured off-topic ceiling plus a
   margin, and say so in the code.
2. **"Cap application notes" is the wrong fix.** For a lab-instrument company, application notes *are* the
   marketing content. The problem is not the notes. It is that they are used as evidence for the wrong kind of
   statement. They prove "we can say this about our product", never "this works in market". That is the warrant
   rule in §8, and it matters more than any retrieval tweak.
3. **The `/au/en/` skew is a crawl entry point, not a Gulf gap.** Waters publishes the same note under several
   locales. Dedupe by the path after the locale, keep one copy. There may be no Gulf locale at all; Gulf
   relevance comes from the brand questions and the events, not the website.
4. **"235 near-duplicates" is not proven.** At 0.85 cosine, two different SCIEX webinar posts can look alike.
   Merging on that number would destroy distinct evidence. A person labels 30 pairs first; the threshold follows
   from the labels.
5. **The bigger risk is not retrieval quality. It is people and time.** Two study measures decide survival:
   L1 (a non-builder makes decisions weekly) and R3 (results come back weekly). Neither is touched by code. The
   runtime is `localhost`, so a Waters colleague cannot use it unless they sit at the builder's machine. That is
   solved by how sessions run (§6.3), not by software.
6. **Grading has a calendar deadline that is already close.** Falsifier windows are 30 or 90 days (registry).
   For ten claims to be graded by the 22 Dec reading (L3a pass ≥ 10), they must be written by about 20 Nov and
   the grader must run on or after their due day. That needs the Apify token this week and a session covering
   05:00 UTC between 13 and 22 Dec, or the catch-up in T0.1. If it slips, L3a reads "not enough data yet". That is
   an honest result; the windows are not shortened to rescue it.
7. **The learning claim should be narrowed now.** One client running about ten posts over four weeks cannot move
   a Thompson-sampling bandit past its min-N. Workspace isolation forbids pooling across clients, so the bandit is
   slow by design. Until 19 Jan, "learning" means **claims graded against what happened**, not "the ranker
   improved". The pitch says the same.
8. **Model confidence is not probability.** Brain confidences take 119 distinct values with mean 0.65, written by
   the model. They are shown as "model confidence" until calibration (T5.3) exists. A calibrated grade ledger,
   per client, is the most defensible asset this product can build (§10).
9. **Do not add reasoning layers.** Seven Brain stages guard 337 ungraded rows and zero results. More layers add
   cost and failure modes with no measurable effect. Every existing layer must show its number first (§5).

---

## 5. The thinking architecture, held to account

Each cognitive idea in the design maps to one mechanism and one number. An idea without a number is decoration
until it gets one.

| Idea | What it guards against | Mechanism in code | Number that proves it works | Today |
|---|---|---|---|---|
| Base rates | Treating any match as relevant | Relevance floor (`retrieval.ts` `relevanceGate`) | Off-topic queries refused on the labelled set | **Fails**: floor below the off-topic ceiling |
| Prediction error (surprise) | Spending reasoning on what we already expected | Surprise filter (`surprise.ts`) | R2a skip share ≥ 30%; R2b spot checks < 20% | Shadow, unread |
| Falsifiability | Unfalsifiable "insights" | Interrogation schema + metric registry | Share of claims with a registry falsifier | 0 so far (no collection) |
| Adversarial review | Confirmation bias | Blind challenger (`challenger.ts`) | Challenger disagreement rate; disagreements later borne out by grades | Shadow, unread |
| Anti-echo | Self-reinforcing memory | MMR, lineage dedupe, derived share cap, counter-evidence slot | Counter slot filled; derived share ≤ 40% in briefs | Shadow; counter slot empty (0 subject keys) |
| Dual process | Paying for thinking on noise | Cost cascade: cheap filter, then model | Cost per reviewed finding | Not reported |
| Metamemory | Stale or duplicate memory | Supersede, demote, consolidate | Duplicate rate; consolidated share | 0 consolidated (schedule never fires) |
| Calibration | Overconfident claims | Grades against falsifiers | Brier score by confidence band, N ≥ 20 | Not built (T5.3) |
| Human judgment | Automation without accountability | Declare / confirm / approve gates with hashed payloads | Decisions per week by a non-builder (L1) | 0 recorded |

**Rule for turning a stage `on`:** each stage has a written "on" criterion logged in the pre-registration §8
before its shadow numbers are read, for example "retrieval on when the diversified path matches or beats the
current path on the labelled set and the counter slot is filled in ≥ 50% of briefs". No stage goes `on` on a
feeling or a demo.

---

## 6. Runtime and sessions on the free tier

### 6.1 Constraints we accept

- Supabase free tier until funding. It pauses after a period without activity. The study sessions keep it awake.
- Local runtime (`npm run dev:all`), no Vercel. The product runs only during sessions.
- No email or Hub alerts from Platina (archived actions). A person sees findings by opening the app.

### 6.2 What session cadence does to "real time"

With sessions on Monday and Thursday, the gaps are 3 and 4 days. For a competitor move at a random time, the
expected wait to the next session is (3² + 4²) / (2 × 7) ≈ 1.8 days, median about 1.75 days. **R1 (≤ 3 days to a
reviewed finding) can pass only if findings are reviewed in the same session they are collected.** So every
session has a fixed review slot. A Monday + Friday pattern (gaps 4 and 3) gives the same numbers; two sessions
back to back (for example Mon + Tue) would fail R1 structurally.

### 6.3 The session protocol (both sessions, every week, to 19 Jan)

| Time | What | Who |
|---|---|---|
| Start, before 02:00 UTC if possible | `npm run dev:all`; catch-up runs (T0.1); ops check | builder |
| First 60–90 min | Collection, analysis, grading complete | runtime |
| 30 min | Review new findings; decide suggestions (plan or dismiss with reason) | **Waters person, under their own login** |
| 15 min | Register posted creatives with hypotheses; import LinkedIn export (weekly) | Waters person |
| End | §8 log line: session start and end, operated yes/no | builder |

The Waters person logs in on the builder's machine or the session is run together in person. A public tunnel to
`localhost` is **not** opened without an owner decision (security, and likely corporate IT policy). If L1 fails
at the 24 Nov reading, that decision is taken then, not before.

If no session can start before 02:00 UTC, T0.1 makes the start of any session behave as if the scheduled jobs had
run.

### 6.4 Weeks recorded in advance

Pre-register now (§8 log, before any reading): the week of 21 Dec – 3 Jan is expected **not operated**
(holidays). Its absence is then a declared gap, not a surprise.

---

## 7. T1 — Retrieval that bites

Spec: `docs/superpowers/plans/2026-11-17-t1-retrieval-that-bites.md` (to write before code). No migration.

1. **Labelled set first.** `src/lib/platina/__fixtures__/retrieval-eval.ts`: at least 40 queries (30 on-topic
   from real Waters questions, 10+ off-topic), each with expected kind of evidence. A script runs them against
   live vectors and prints separation per plane. This set is the regression test for every later retrieval change.
2. **Floors per plane**, chosen from the set, stored next to `PLATINA_EMBEDDING_MODEL_VERSION` so a model change
   forces re-calibration.
3. **Keyword search that can hit.** Match any meaningful word, rank with `ts_rank_cd`, keep only results above a
   cutoff, and always keep exact hits on tokens that contain digits (model numbers, method codes). An index
   (generated `tsvector` column + GIN) waits for the second client; at 2.4k rows a scan is fine.
4. **At most 2 passages per page** in any evidence list.
5. **Locale dedupe** at own-site read time: one copy per path after the locale; existing duplicates superseded,
   never deleted.
6. **Boilerplate stripped** at chunking (navigation, "Back to top", sales-office lists, price widgets).

Pre-registration: changes what briefs cite, so it is logged in §8 with its date before it lands. It does not
change any measure's definition.

---

## 8. T3 — Evidence warrant rules

Each kind of statement a plan or brief makes is allowed only certain kinds of evidence. This is the two-plane rule
taken one step further, and it is the main protection against confident nonsense.

| Statement | Allowed evidence | Never |
|---|---|---|
| "Competitor X did Y" | A public document with a verbatim quote (Plane B) | Brain hypothesis alone |
| "Interest in topic T is rising" | Interest signals ≥ min-N over the window | A single post |
| "We can say X about our product" | Declared brand standard; own-site product literature, verbatim; passes the claims gate | Competitor pages |
| "Format or channel X works for us" | Our recorded results ≥ min-N | Own-site pages, Brain, public data |
| "Competitor will likely do Z" | Brain hypothesis **with a falsifier**, shown as a hypothesis | Shown as fact |
| "Event E is on date D" | The event page with the date verbatim | A model guess |

Implementation: a pure module `src/lib/platina/warrant.ts` mapping statement types to evidence kinds (declared =
brand chunk, product literature = first-party `own_site`, result = first-party `lesson` or reviewed outcome), used
by the planner and the brief route. Below the bar the section says "not enough evidence of this kind", the same
way the min-N gate says "insufficient baseline". No migration.

---

## 9. T4 — CPHI Middle East: the one live campaign

CPHI Middle East, Riyadh, from 14 Dec 2026, is the only event in the window with a GCC date on the page. It is the
real-time use case: competitors announce for it, Waters runs content around it, results come back after it.

| Date | Step | Proves |
|---|---|---|
| By 20 Nov | Apify working; competitor and exhibitor watch running; brand questions answered | Collect + declared standard |
| 24–27 Nov | Planner drafts the CPHI plan in session; a Waters person edits and **approves** it (sealed decision record, T5.1) | Decide, by a person |
| 27 Nov – 13 Dec | Pre-event content posted by Waters; each post registered with its hypothesis | Run |
| 1–16 Dec | Competitor moves around CPHI reviewed in-session (R1 cases) | Real-time watch |
| 14–16 Dec | Event | — |
| 17–21 Dec | LinkedIn export imported; reviews confirmed; due claims graded | Record + grade |
| 22 Dec | Checkpoint reading | — |

If Waters does not post around CPHI, the plan still proves "decide by a person", and the learning half reads
"not enough data yet". That is a valid study result (K2 → product continues as market watch).

---

## 10. Strategy: what is defensible

- **Not the model, not the scraping.** Both are commodities and both are swappable (router, adapters).
- **The graded claims ledger, per client.** Every claim the system made, its falsifier, and whether it held.
  Over months that is a calibrated track record of judgment about one market, and it cannot be copied or bought.
  It is also the honest answer to "why trust this?": "here is how often we were right, by confidence band".
- **The warrant discipline.** Marketing tools that say "this works" without results are the norm; one that
  refuses to is different, and the refusal is visible in every brief.
- **Speed bounded by humans.** The value is a reviewed decision within days, not a dashboard. Design every screen
  for the 30-minute review slot.

### 10.1 The split question (study Q4), named in advance

Recommended names for §6 of the pre-registration:
- **Market Watch**: competitor, ad and event radar with reviewed findings (R1, R2, L4).
- **Campaign Ledger**: planner + results + graded claims (R3, L3).

---

## 11. Frozen until 19 Jan 2027

Not built, not started, not "quickly added":

- New Brain stages or new reasoning loops.
- Any stage turned `on` without its pre-written criterion met (§5).
- New data sources or adapters (each needs an owner decision in `CLAUDE.md` anyway).
- Ads management, Cockpit, Reports or InstaMedia UI work beyond bug fixes.
- A public tunnel, hosting or paid tiers (owner decision only).
- The validator's composite score (retired in V-1).
- The second client before the 22 Dec reading (T6).

---

## 12. Decisions needed from the owner

| # | Decision | Recommendation |
|---|---|---|
| D-1 | Replace the Apify token | Today. It is the top blocker and gates the grading deadline (§4.6) |
| D-2 | L5 budget | The Apify plan you actually pay, plus AI ≤ $10 per month for Waters (current run rate ≈ $1.24) |
| D-3 | Split product names | Market Watch / Campaign Ledger (§10.1) |
| D-4 | Named Waters person and joint sessions | Mon + Thu, 2 h, with the 30-min review slot (§6.3) |
| D-5 | Public tunnel to localhost | No, unless L1 fails on 24 Nov |
| D-6 | Migration 0091 (heartbeat + study report) | Yes, additive with down-SQL, after the spec |
| D-7 | Pre-register 21 Dec – 3 Jan as not operated | Yes, now |
| D-8 | Accept L3a may read "not enough data yet" on 22 Dec | Yes; never shorten falsifier windows to rescue it |
| D-9 | Second client | After 22 Dec; choose one whose LinkedIn page you administer (fixes the results-data problem by design) |

---

## 13. Continuing this plan elsewhere

This plan may be continued in another repo or session. To resume:

1. Read `CLAUDE.md`, this file, then the pre-registration.
2. Measure before building:
   ```
   npm run platina:validate-usecases -- --ws waters-gcc-internal --run-tests --skip-plan-eval
   npx tsx scripts/ops-check.ts --ws waters-gcc-internal
   npm run platina:brain-readiness -- --ws waters-gcc-internal
   ```
   Run from a path with an upper-case drive letter on Windows (`C:\...`); vitest fails at import otherwise.
3. Take the first `todo` row in §2 whose blockers are clear. Spec first, then a reviewable diff, tests with it.
4. Before anything that changes what a study measure counts, add a dated line to the pre-registration §8 log.
5. When a slice is done, update its row in §2 and add a line below.

Files of record:
- Rules: `CLAUDE.md`
- Study: `docs/study/2026-11-09-waters-study-preregistration.md`
- Validation: `docs/validation/2026-11-13-*.md`, `src/lib/platina/usecase-validation.ts`
- Brain plan: `docs/superpowers/plans/2026-10-13-metacognitive-brain.md`
- Core spine: `docs/superpowers/plans/` (S0–S8, R0–R8)

### Log

| Date | Entry |
|---|---|
| 2026-11-17 | Plan written from the 13 Nov validation, the live retrieval probe and the scheduling check. Second opinion on the 13 Nov review in §4. Nothing in the product changed by this file. |
