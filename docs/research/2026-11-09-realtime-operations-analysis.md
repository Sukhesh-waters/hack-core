# Real-time operations analysis (9 Nov 2026)

Status: research and analysis, **not a plan**. Nothing here is approved or built. `CLAUDE.md` outranks it.
Inputs: the code at commit `3cd6091` (15 Oct, the last commit), the WTR-0 and planner/evaluator plans, the
Platina-lane research brief of 9 Nov, `docs/research/2026-11-09-ground-zero-research.md`, and live checks
run today. Refresh rule: write a new dated note rather than editing this one.

Evidence labels: **[code]** read in the repo today · **[live]** observed today · **[web]** checked online today
(source at the end) · **[brief]** taken from the research brief, not re-checked.

---

## 1. Bottom line

1. **The product is not running, and nothing raised an alarm.** The Supabase database refuses connections
   [live]. That most likely means the free-plan project was paused after 7 days without enough database
   activity [web]. If so, nothing has run against it for at least a week, which means `npm run dev:all`
   wasn't running either: its 5-minute collection cron would have kept the database awake [code]. So
   collection, analysis, grading, alerts and the live channel are all stopped. The hourly ops check can't
   report the outage because it runs inside the system that is down.
2. **The Waters study is losing data it can't recover.** The study runs 27 Oct 2026 – 19 Jan 2027, with
   checkpoints on 24 Nov and 22 Dec [code: WTR-0 plan]. The slice that makes it measurable (WTR-0) and the
   pre-registration doc are not written. There have been no commits since 15 Oct [live]. The first checkpoint
   is in 15 days.
3. **"Real time" currently means "while one laptop is running".** The runtime is local by owner decision
   (15 Oct). Scheduled jobs are set in UTC, and several fall between 07:30 and 10:00 India time. When the
   laptop is off, those jobs are either skipped or replayed in a burst on start-up, depending on how the
   Inngest dev server behaves. In both cases nothing records it [code + web].
4. **The plans are right, but they assume a runtime that stays up.** Before any further features (CORE-1,
   WTR-1, WTR-3), the product needs a small "stay alive and say when you were down" slice, OPS-0 in §6.
   Without it, the study can't tell "the product didn't help" apart from "the product wasn't on".

---

## 2. Current operational state (9 Nov 2026)

| Item | State | Evidence |
|---|---|---|
| Database | Unreachable: `tenant/user postgres.eqhzajbueglkvgkypran not found` | [live] `scripts/verify-meta.ts` |
| Likely cause | Free-plan inactivity pause (7 days of low activity). Data is kept; restore from the dashboard ("Resume project") within the restore window (docs say 1 year; one secondary source says 90 days) | [web] |
| Runtime | Local only: `npm run dev:all` = `next dev` + `npx inngest-cli@latest dev` | [code] `scripts/dev-all.mjs` |
| Job runner version | **Unpinned** (`inngest-cli@latest`): behaviour can change between two starts with no code change | [code] |
| Last commit | 15 Oct 2026 (`3cd6091`, Brain W3b/W4b handoff) | [live] |
| WTR-0 / CORE-3 (planned 27 Oct–2 Nov) | Not started | [live] git log |
| CORE-1 + WTR-1 (planned 3–16 Nov) | Not started | [live] |
| Study | Week 3 of 12; pre-registration doc not written | [code] WTR-0 plan §0 |
| ARABLAB LIVE (26–28 Oct) | Over. The planned "ARABLAB follow-up as first live campaign" (WTR-1) is ageing | [code] plans |
| Brain stages | Last recorded all `off` (15 Oct); later state unknown until the DB is back | memory file §12.1 |
| Instagram connector | `META_CONNECTOR_ENABLED=false` | [live] |
| Ads insight connector | Called with no campaign and no token: dormant | [code] `ads/actions.ts:59` |

---

## 3. How the real-time system actually moves (as built)

```
every 5 min   scan-coordinator ── due sources ──▶ probe-tick (header-only check)
                                                    │ unchanged → stop (free)
                                                    ▼ changed / due
                                                audit-run (Apify / Firecrawl, capped per day)
                                                    │ signal documents (hash-deduped)
                                                    ▼
every 6 h +   contradict-sweep ──▶ signal-analyze (surprise → interrogation → challenger → gate)
on new batch                                        │ finding + Brain insight
                                                    ▼
daily (UTC)   02:00 outcome-ingest · 03:00 brand-refresh · 04:30 interest · 04:45 events
              05:00 own-site, grading · 06:00 learning, ideas, event-window · 09:00 receipt-review
weekly        Mon 04:00 brain-maintenance · Mon 05:00 divergence-scan
monthly       1st 02:00 consolidate (merge, retire, digest)
hourly        alert-sweep (in-app only) · ops-check :15
              │
every write ──▶ broadcast `platina:<hmac>:live` {scope,id} ──▶ page refetches (800 ms coalesce,
              120 s safety poll; 20 s polling when the live channel is down)
```

Everything above runs only while `dev:all` runs, against a database that must be awake. [code]

### 3.1 Local time of each daily job (India, UTC+5:30)

| Job | UTC | India | Risk on a laptop started ~10:00 IST |
|---|---|---|---|
| `platina-outcome-ingest` | 02:00 | 07:30 | Missed or replayed (and it does nothing, see O6) |
| `platina-consolidate` (1st of month) | 02:00 | 07:30 | **Missed for the whole month** if replay doesn't happen; no other trigger except a hand run |
| `platina-brand-refresh`, `knowledge-refresh` | 03:00 | 08:30 | Missed or replayed |
| `platina-brain-maintenance` (Mon) | 04:00 | 09:30 | Missed or replayed |
| `platina-interest-extract` | 04:30 | 10:00 | Borderline |
| `platina-event-extract` | 04:45 | 10:15 | Usually runs |
| `platina-falsifier-grade-sweep` | 05:00 | 10:30 | Runs; and it catches up anyway (picks up everything with `due_at <= now`) [code] |
| learning / ideas / event-window | 06:00 | 11:30 | Runs |
| receipt-review, decision-review | 09:00 | 14:30 | Runs |

---

## 4. Failure modes: what happens today, and what is missing

| # | Failure | What the code does today | Gap |
|---|---|---|---|
| F-DB | Database paused or down | Every job step throws; Inngest retries; pages error; ops check can't write | No outside watcher; no "we were down from X to Y" record; Supabase's warning e-mail is the only alert |
| F-LAP | Laptop off / `dev:all` not running | Nothing scheduled runs; nothing is logged | No record of runtime uptime; study measures can't separate "not used" from "not running" |
| F-REPLAY | Job runner restarts after downtime | An Inngest bug report (27 Oct 2026, self-hosted runner) shows **every missed cron tick replayed** in a burst within minutes of start-up. Whether our dev server does the same is **not verified** | Collection: tick bucket is the wall-clock minute (`scan-coordinator.ts:40`), so a burst can create several runs per source within minutes. Spend is bounded by the per-source and daily caps (default 40 pages/day) but a burst can **use most of the day's cap at start-up**. Hourly alerts are protected (24 h delivery ledger). Monthly consolidation is protected (claims the month first) |
| F-SKIP | Runner skips missed ticks instead | Daily jobs whose time passed before start-up don't run that day | No "did it run today?" check except collection freshness and stuck runs |
| F-RT | Supabase Realtime down (same project) | Client falls to 20 s polling after 3 attempts; header pill says so | Fine. But polling hits a dead DB too when the cause is the database |
| F-AI | Model provider throttled | Router swaps provider; signal-analyze releases the claim for the next sweep | Fine |
| F-SCRAPE | Apify / Firecrawl failure | Failure never becomes a document; degraded run with reason; Firecrawl falls back to Apify | Fine |
| F-EMB | Embedding outage | Lessons stored without vector, embedded later by the learning job | Fine |
| F-STALE | Evidence changes under a plan | Freshness computed **on read** only | Known gap (WTR-3) |

The scheduled ops checks (`src/lib/ops/checks.ts`): knowledge ownership, own site, embeddings, collection
freshness, events ahead, learning, budgets, stuck runs. **None of them answers "did each scheduled job run
when it should have?"** [code]

---

## 5. Findings

| ID | Finding | Evidence | Severity |
|---|---|---|---|
| O1 | Whole product depends on a free Supabase project that pauses after 7 quiet days; nothing outside the system notices | [live] + [web] | **High** |
| O2 | No runtime heartbeat: uptime of `dev:all` is not recorded anywhere, so downtime is invisible in every report and in the study | [code] | **High** (study validity) |
| O3 | Daily jobs scheduled 02:00–04:30 UTC fall before a typical Indian workday start; whether they replay or skip is unverified | [code] + [web] | Medium |
| O4 | Restart replay can create duplicate collection runs (wall-clock tick bucket) and burn the daily cap early | [code] `scan-coordinator.ts:40`, `probe-tick.ts:150` | Medium (cost) |
| O5 | Job runner is `inngest-cli@latest`, unpinned | [code] `dev-all.mjs:28` | Medium |
| O6 | `platina-outcome-ingest` only counts outcome rows and writes nothing: a daily job that looks like learning but isn't | [code] `outcome-ingest.ts` | Low (misleading) |
| O7 | Study instruments missing: WTR-0 (imports that work, operator marker, re-plan reason, weekly report) and the pre-registration doc (thresholds, kill criteria) | [code] + [live] | **High** (deadline 24 Nov) |
| O8 | ARABLAB follow-up is the planned first live campaign; the event ended 28 Oct, so each week reduces the follow-up's value | [code] plans | Medium |
| O9 | No database backup outside Supabase; free plan has no daily backups | [web] | Medium |
| O10 | Plan freshness and refutations reach a plan only when someone opens it; with an intermittent runtime even WTR-3's push only works while the laptop is on | [code] | Medium (known) |

---

## 6. Proposed improvements to the plans (for review, not approved)

### 6.1 New slice OPS-0 — "stay alive, and say when you were down" (before CORE-1)

| Part | What | Needs |
|---|---|---|
| A | Restore the Supabase project; take a full dump (`supabase db dump` schema + data) and keep it outside the repo | Owner action in the Supabase dashboard |
| B | Choose one: **Pro plan ($25/month, never paused, 7-day backups)** or a documented daily keep-alive (not guaranteed by Supabase) | **Owner decision** |
| C | Runtime heartbeat: the job runner writes one row per hour (`runtime up at`), and the study and ops reports show "runtime up N of M hours this week" | Additive migration → owner's yes |
| D | Job-ran check in ops: for each scheduled Platina job, "last successful run" against its schedule; amber when a daily job missed its day, red after two | Code only (reads Inngest run results or the heartbeat table) |
| E | Catch-up policy, one rule for every cron: **if the tick is more than 10 min late, run once and skip the rest** (compare the event's scheduled time with now). Daily jobs become "run if not run today", so a late start still runs them once | Code only |
| F | Pin the job runner version in `dev-all.mjs` | Code only |
| G | Remove or rename `platina-outcome-ingest` (it does nothing) | Code only; deletion follows the constitution's approval rule |

### 6.2 Changes to existing plans

| Plan | Change | Why |
|---|---|---|
| Study pre-registration (not written) | Write it **now**, before any code: each measure's threshold, the 24 Nov checkpoint reading, the kill criteria, and a rule for downtime ("weeks with runtime < X% up are reported separately, not counted as 'not used'") | Brief §5.3: a one-client, 12-week study will often answer "insufficient baseline"; kill criteria must be fixed before the reading |
| WTR-0 | Keep first after OPS-0. Add a measure **A0: runtime availability per week** to Part D, read from the OPS-0 heartbeat | O2 |
| WTR-0 Part A | Confirmed: it handles a **user-supplied LinkedIn export**, not scraping behind a login, which is what the brief asks | [code] WTR-0 plan |
| CORE-1 + WTR-1 | Shift by the lost weeks. Re-check whether ARABLAB follow-up is still the right first live campaign once the DB is back; otherwise use the next dated event from `/events` | O8 |
| WTR-3 (plan watch) | Make it **event-driven plus a start-up catch-up** (on runner start, recompute freshness for live plans once), not only cron-based; the Monday digest (04:00 UTC = 09:30 IST) runs on the first start after its time | O3, O10 |
| CORE-3 (plan test set) | Unchanged; it needs no database and can be built while the DB is down | — |

### 6.3 Plane B and legal, after re-checking the Platina brief

| Brief claim | Today's check | Effect |
|---|---|---|
| Klue as a Gartner MQ Leader "unverified" | Klue **and** Crayon both announce Leader placement on their own blogs (29 Apr 2026); Gartner's report is paywalled | Grade C. The intelligence category is crowded with funded Leaders; Platina should not pitch as "CI platform" |
| LinkedIn v ProAPIs consent judgment | Confirmed (N.D. Cal., 5:25-cv-08393). The complaint covered **member, company and school data** plus posts; relief bars automated access and use of tools that provide LinkedIn data | Our LinkedIn collection is logged-out company posts via `harvestapi~linkedin-company-posts`, no cookies [code]. Privacy risk is low (company level). **Contract/terms risk remains**, and buying from a scraper vendor is the kind of "third-party service" the judgment names. Keep it at company level and keep an exit (user-supplied exports, WTR-0 A) |
| Keep Plane B at company level | Company posts can still name people in their text | When counsel reviews, include whether names inside company posts count (UAE/KSA PDPL) |
| "Do not build ad library scraper, event database, MMM, AEO" | Matches current code: ads via Apify, events extracted from posts and event pages, no MMM, no AEO | No change |

---

## 7. Proposed order of operations

1. **Owner:** resume the Supabase project; decide Pro vs keep-alive (OPS-0 B).
2. **Me, no code:** draft the study pre-registration with kill criteria and the downtime rule.
3. **Me, no database needed:** CORE-3 plan test set, and OPS-0 E/F (catch-up rule, pinned runner) as one
   reviewable diff.
4. After the DB is back: dump it (OPS-0 A), run `scripts/verify-meta.ts`, read Brain modes, read what ran
   since 27 Oct.
5. OPS-0 C/D (heartbeat + job-ran check, one additive migration) → WTR-0 with A0 → CORE-1/WTR-1.

Each step follows plan → diff → review.

---

## 8. Not covered

- Whether the Inngest **dev** server replays or skips missed crons (to be tested locally: stop for 15 min,
  restart, count runs).
- What actually ran between 15 Oct and the pause (needs the database).
- Waters' own CRM / CI tools; Indian competitors; Gartner placements beyond vendor claims.

## Sources

- Supabase, project pausing: https://supabase.com/docs/guides/platform/free-project-pausing
- Supabase FAQ, inactive projects: https://supabase.com/kb/faqs/platform/free-project-pausing
- Inngest issue, missed cron ticks replayed after downtime (27 Oct 2026): https://github.com/inngest/inngest/issues/5217
- Inngest docs, schedules (free plan pauses a function after 20 consecutive failures): https://www.inngest.com/docs/durable-execution/guides-and-advanced/events-and-triggers/schedules-and-delayed-starts
- LinkedIn v ProAPIs, final judgment on consent: https://storage.courtlistener.com/recap/gov.uscourts.cand.457309/gov.uscourts.cand.457309.36.0.pdf
- The Record, LinkedIn court order: https://therecord.media/linkedin-wins-court-order-blocking-mass-scraping
- Klue Leader post: https://klue.com/blog/klue-is-a-leader-in-the-first-ever-gartner-magic-quadrant-for-competitive-and-market-intelligence-platforms
- Crayon Leader post: https://www.crayon.co/blog/crayon-named-a-leader-in-the-inaugural-gartner-magic-quadrant-for-competitive-and-market-intelligence-platforms
- Debriefing.io on the inaugural MQ: https://debriefing.io/intel/gartner-inaugural-mq-competitive-market-intelligence-2026
