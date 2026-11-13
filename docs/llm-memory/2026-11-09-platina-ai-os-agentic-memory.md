# Platina AI OS — Agentic and Metacognitive Memory File

> **Purpose.** A complete, point-by-point record of the agentic ideation,
> metacognition work and real-time implementation in this project, from the
> core ideology down to use-case flows. Written to be loaded into another LLM's
> memory so it can reason about, explain and extend the system correctly.
>
> **As of:** 9 Nov 2026. **Code state:** `main` = `3cd6091` (15 Oct 2026). No
> code has been committed since; later items are plans (marked PLANNED).
>
> **Sources:** `CLAUDE.md` (constitution); `docs/newbrain.md` (metacognitive
> brief); `docs/superpowers/specs/2026-09-20-core-spine-design.md`;
> `docs/superpowers/specs/2026-09-21-core-intelligence-architecture.md`;
> plans `2026-09-21-campaign-intelligence`, `2026-09-22-c6-learning-loop`,
> `2026-09-22-c7-live-operations`, `2026-09-23-c8-waters-live-intelligence`,
> `2026-10-13-metacognitive-brain`, `2026-10-14-brain-continuation`,
> `2026-10-22-wtr-0-study-readiness`, `2026-10-23-planner-evaluator-roadmap`;
> `docs/pitch/2026-10-19-platina-pitch-plan.md`; code in `src/lib/platina/*`,
> `src/inngest/functions/platina/*`.

---

## 0. How to read this file

### 0.1 Status labels

| Label | Meaning |
|---|---|
| **BUILT** | Code on `main`, tested, running in the live flow |
| **BUILT · MODE** | Code on `main` behind a per-workspace mode (`off` / `shadow` / `on`); last recorded mode is stated |
| **PLANNED** | Written in a plan document; no code yet |
| **PROPOSED** | Awaiting an owner decision or signature |
| **OPEN** | Known gap or minor defect |

### 0.2 Facts an LLM must not get wrong

1. Product name is **Platina AI OS**. The older surface, **InstaMedia**
   (`/w/*`), still exists and is kept; Platina lives at `/p/[ws]`.
2. It is **not deep reinforcement learning**. It is a feedback loop plus bandit
   re-weighting (Thompson sampling) over the workspace's own results,
   gated by minimum sample size.
3. **A model never produces a number.** Numbers are computed by code; a number
   the platform did not report is "not measured", never zero.
4. **No agent spawns an agent.** The orchestrator runs agents; agents only
   propose; the orchestrator owns every write.
5. **Every Brain stage was `off` in every workspace** at the last recorded
   state (15 Oct 2026). The code exists; switching on is an owner decision.
6. **Public data (Plane B) is never embedded and never cited.** Only derived,
   checked insights (Plane C) and first-party data (Plane A) are embedded.
7. **No ad-account connections, no posting, no scheduling.** Metrics are
   read-only. (A narrowing to "read-only reporting connectors allowed" is
   PROPOSED, not signed.)
8. **Runtime is local** (`npm run dev:all`), no Vercel deployment for now
   (owner decision 15 Oct 2026).

---

## 1. Identity and constitution

### 1.1 What the product is

- An **always-on AI marketing agency in software**: it senses the market and
  acts on it, through one shared memory (the **Brain**), with a person making
  every final call.
- Tagline: **"The AI marketing agency that learns from itself."**
- Proof line: "Every number has a source, and a person makes every final call."
- Closing line: "AI learns from itself. Humans decide what it learns."
- First live client: **Waters** (scientific instruments, Gulf / GCC),
  workspace `waters-gcc-internal`. Competitors tracked: Thermo Fisher
  Scientific, Agilent, Shimadzu, SCIEX, Bruker.

### 1.2 Stack (locked)

- One Next.js App Router TypeScript monolith (no Python service). Route
  handlers and server actions.
- Background work: **Inngest** (not Celery).
- Database: **Postgres + pgvector** via Drizzle ORM, hosted on Supabase.
- Auth: NextAuth v5; workspace membership and capabilities.
- UI: Tailwind + shadcn/ui; three.js for 3D views. No static inline styles.
- AI: **one model router** (`routeAI` / `routeChatWithProvenance`) over Groq,
  Gemini (Flash/Pro), NVIDIA and AWS Bedrock. Every AI call goes through it.
- Collection: **Apify** (social, ad libraries, multi-page competitor crawls)
  and **Firecrawl** (single public pages first, Apify fallback; the client's
  own site multi-page). Firecrawl cannot read linkedin.com (403), so LinkedIn
  is Apify-only.
- Embeddings: `gemini-embedding-001`, 768 dimensions.

### 1.3 Owner decisions (dated, in order)

| Date | Decision |
|---|---|
| 2026-07-13 | Brand Drift, Reports, Ads Management, Cockpit unblocked |
| 2026-08-17 | Internal team chat unblocked (Client Portal still out of scope) |
| 2026-09-20 | Rebrand to Platina AI OS; every feature kept; campaign planner added at `/p/[ws]/plan` |
| 2026-09-21 | Firecrawl first for single public pages, Apify fallback; social, ad library, multi-page stay Apify |
| 2026-09-22 (C6) | Client's own website may be crawled multi-page via Firecrawl (first-party). Learning loop = feedback + Thompson sampling, min-N gated, not deep RL. Read-only metrics through `src/lib/connectors/metrics-read.ts` |
| 2026-09-22 (C7) | First-party ingest accepts only the client's own pages (ownership allowlist, `client_identities`, `src/lib/ingest/ownership.ts`). Every fetch of a URL someone else chose goes through `src/lib/net/safe-fetch.ts`. No ad-account connections; no synthesised metrics |
| 2026-10-13 | **Metacognitive Brain**: every Brain claim carries a falsifier from the metric registry; a daily grader tests it; refuted claims are demoted, never deleted; facts exempt only with a code-verified quote; each new stage behind off/shadow/on; every Brain state change journaled (`setBrainState`). Sub-decisions D1–D7 (§5.11) |
| 2026-10-15 | No Vercel; local runtime `npm run dev:all` against Supabase. All Brain modes `off` for the showcase |
| 2026-10-23 | Five planner/evaluator improvements adopted for the roadmap (plan as a commitment; options + pre-mortem; plan test set; in-flight tracking, scorecard and calibration; plan watch + weekly digest). Read-only reporting connectors allowed in principle — **constitution wording PROPOSED, not signed** |

### 1.4 Non-negotiable rules

- `workspace_id` on every table and every query, enforced in the app layer
  (not Postgres RLS — the app connects as a plain role so `auth.uid()` is
  NULL). Query tests assert the filter appears in the generated SQL.
- **Two-layer rule:** first-party consented data feeds the baseline and
  scoring; public data feeds a separate pattern layer. Never mixed, never both
  cited in one "why this idea" explanation.
- **No agent spawns an agent.**
- **Minimum-N gate:** below the sample threshold show "insufficient baseline",
  never a number.
- **Degradation ladder:** provider throttled → router swaps provider; platform
  API down → CSV import; knowledge stale → flagged, never silently served.
- **Module boundary** (`src/lib/platina/boundary.test.ts`): Platina shares only
  auth, membership, the model router and neutral infra
  (`src/lib/orchestrator/run.ts`, `src/lib/ai/context/types.ts`,
  `src/lib/ai/usage-context.ts`, `src/lib/action-errors.ts`) plus allowlisted
  shared modules (Firecrawl client, metrics-read, safe-fetch, ownership).
  Platina must not call InstaMedia ticket, Hub, SOP, content, calendar,
  campaign or notification modules. `platina_campaigns.sop_run_id` and alert
  actions `hub_message` / `ticket` / `email` are archived.
- Deleting code or tables requires the owner-signed Slice 12 transition matrix
  and a backup.
- Workflow: spec-first, one vertical slice at a time, plan → diff → review;
  every slice ships with tests.

---

## 2. Core ideology

### 2.1 The belief

**Intelligence is knowing how sure you should be, and changing your mind when
the evidence says so.** Most AI marketing tools are confident; Platina is
**calibrated**: it states what it believes, what would prove it wrong, then
checks — and changes its mind visibly.

### 2.2 The problem it answers

- AI tools are fluent, not calibrated; fluency is mistaken for knowledge.
- They have no memory of being wrong, so they repeat failed ideas.
- Public and first-party data get mixed and cited as equally reliable.
- Small samples become "trends"; missing numbers get invented.
- Machines are trusted blindly or ignored entirely.
- Sending every change to a model is too expensive to run all day.
- Root cause: marketing intelligence is **confident but not accountable** — it
  never states what would prove it wrong, so it cannot learn from being wrong.

### 2.3 Seven principles

1. **Calibrated, not confident** — every claim carries its disproof test.
2. **Attention is earned** — only surprising signals reach the AI.
3. **Challenge before trust** — blind second opinion; code checks numbers.
4. **Measured beats modelled** — models never produce numbers.
5. **Two kinds of knowledge, never mixed** — public informs, first-party proves.
6. **Learn from outcomes, not opinions** — only confirmed, measured results
   change beliefs.
7. **Humans decide** — a person approves every output and every lesson.

### 2.4 The governing rule: the cost cascade

`hash → statistic → rule → cheap model → expensive model → human`

Never spend a model call on something a hash, a statistic or a rule could
decide. Each stage exists to remove volume from the next; a stage is added
only if it reduces total cost or prevents a named failure. A principle with no
mechanism and no metric does not ship.

---

## 3. Timeline of the agentic evolution

| When | Phase | What it added (agentic / metacognitive / real-time) | Status |
|---|---|---|---|
| Jul–Aug 2026 | InstaMedia W1–W8 | Ingestion → KB → Brand DNA → ideation → studio/compliance → calendar → learning loop; real-time collaboration roadmap | BUILT (InstaMedia surface) |
| 16–18 Sep | Platina slices 0–14 | Shell, event spine, audits, findings validation, solutions, execution, event readiness, brand claims, outcomes, admin alerts, cockpit, transition matrix, hardening, live verification | BUILT |
| 20 Sep | **Core spine** (S1–S5, R1–R6) | Sign-in → workspace → subjects → automatic collection (5-min coordinator, header probes, adapter registry) → raw signals → AI insight extraction (debate) → Brain → ideation/planning. Brand-divergence stage. Live-transport state machine (R6). Objection-rate alarm (R5.1). Grading write-back (R5.3) | BUILT |
| 21 Sep | **Campaign intelligence** (C0–C5) | Interest measurement (engagement index vs company median, momentum, min-N 5), event extraction with code-verified dates, insight enhancer (measured insights into the Brain), Opportunities page, planner hand-off, Live flow 3D | BUILT |
| 22 Sep | **C6 learning loop** (L0–L7) | Creatives, metrics (manual/CSV/connected read-only), review drafts (model drafts, human confirms), per-feature Beta posteriors, Thompson ranking, decay, explore share, backtracking demotion; own-site first-party crawl | BUILT |
| 22–23 Sep | **C7 live operations** | Ownership allowlist (fixed third-party pages in first-party KB), removed invented Ads metrics, SSRF safe-fetch, competitor page, events radar, ops board, light theme | BUILT (C7.0, C7.0g, C7.1, C7.9; others folded into C8) |
| 23–25 Sep | **C8 Waters live intelligence** | C8.0 data fill; C8.2 Competitors pattern layer; C8.3 ad-library scans (LinkedIn + Meta via Apify) with live progress; C8.4 Opportunities 2.0; **C8.5 learning engine** (suggestion ledger, credit assignment, idea engine, monthly consolidation); **C8.6 Brain map** (3D graph) | BUILT |
| 13–15 Oct | **Metacognitive Brain** (B0–B9) | Modes, telemetry, undo journal, metric registry; interrogation + falsifier; blind challenger; deterministic gate + significance; surprise filter; daily grading + refutation memory; anti-echo retrieval; token budget; real-time planning (proved-wrong escalation, verdict badges, counter-evidence, stated test); Goodhart check, rule conflicts, human insight review | **BUILT · MODE** (all `off` at last record) |
| 19 Oct | Pitch report | Problem → use cases → data flow → architecture → logic → demo script | Doc |
| 22 Oct | **WTR-0 study readiness** | LinkedIn import fix, operator marker on script runs, re-plan reason, weekly study report (migration 0091) | **PLANNED** (not started) |
| 23 Oct | **Planner + evaluator roadmap** | CORE-1 plan as commitment, CORE-2 options + pre-mortem, CORE-3 plan test set, CORE-4 read-only connectors, WTR-1 live campaigns + in-flight tracking, WTR-2 scorecard + calibration, WTR-3 plan watch + weekly digest | **PLANNED** |
| uncommitted | Production start | `npm run start:all` → `scripts/dev-all.mjs --prod` runs `next start` instead of `next dev` alongside Inngest; `.env.example` adds `AUTH_TRUST_HOST=true` and local/production OAuth redirect notes | Local, uncommitted |

Feasibility study (owner): **27 Oct 2026 – 19 Jan 2027**, checkpoints 24 Nov and
22 Dec, on Waters, to decide whether the product survives and whether to split
it into two products. Waters freeze: no Brain stage `on` in
`waters-gcc-internal` before 27 Oct 2026 (ARABLAB LIVE, Dubai, 26 Oct).

---

## 4. The agent roster

All agents are **single calls orchestrated by code**. None spawns another. The
orchestrator (`src/lib/orchestrator/run.ts` → `runOrchestration`) runs
`assembleContext → agent → validate → critic → apply`; only `apply` writes.

| Agent | Role | Ladder | Input | Output | Code checks after it |
|---|---|---|---|---|---|
| **Triage (code)** | Drop boilerplate, thin text, navigation, own-brand pages | — | Signal document | skip / proceed | `signal-value.ts`, `analysis-plan.ts` |
| **Surprise filter (code)** | Skip changes within the source's normal range | — | Observation vs expectation | skip / proceed / audit sample | `surprise.ts` (B4) |
| **Proposer / Interrogator** | Turn a surprising signal into one claim with what/why/how/falsifier | quality (background) | Numbered evidence `[e1…eN]` | Interrogation JSON | `interrogation.ts` validator (B1) |
| **Blind challenger** | Attack the claim without knowing its author | fast, **different provider** | what + how + cited span texts only | `no_material_objection` or objection + confounder | one round only; redaction test (B2) |
| **Deterministic gate (code)** | Schema, testability, significance, agreement score | — | Interrogation + challenge | write / hold / refuse | `insight-gate.ts`, `significance.ts`, `contradiction.ts resolveV2` (B3) |
| **Topic assigner** | Assign topics to posts (numbers computed by code) | fast | Posts | topic labels | generic-topic filter; median momentum |
| **Event extractor** | Name events, copy date and place words | fast | Event / post pages | events + quoted words | `quotedIn` + `parseDateRange` (words must be on the page) |
| **Insight writer (code)** | Measured interest/pressure/event → one sentence each, code-built falsifier | — | Gated measurements | Brain chunks (keyed) | unchanged = untouched; changed = superseded |
| **Client profile builder** | Profile from the client's own pages | quality | Own-site pages | profile (context only, never evidence) | failure written to `profile_error` |
| **Reranker** | Narrow ~50 candidates to ~8 per plane | fast | Candidates (240 chars each) | ranked ids | token budget (B7) |
| **Planner** | Two-line brief → roadmap | quality (interactive) | Context: profile, first-party + public evidence (separate), counter-evidence, lessons, learned patterns, anchor, prior plan | title, summary, 1–8 phases (days, channel, message, ≤4 evidence ids), revision note, stated test | `validatePlan`, `findCitationProblem` (one plane per phase), `parsePlanFalsifier` |
| **Plan critic** | Independent review of the plan | quality | Plan + context | pass / flagged + feedback | a failed review is shown, never hidden |
| **Idea engine** | Draft ideas when a trigger fires | quality | F (public facts), A (Brand DNA), P (learned patterns) lists | ideas, each citing one list | code drops ideas citing the wrong list or nothing; ~80% learned / ~20% explore (labelled) |
| **Review drafter** | Draft worked/mixed/failed review of a creative | fast | Creative + numbers (code-computed) | draft review | **a person confirms**; only confirmed reviews teach |
| **Brand drift explainer** | Explain drift from the declared standard | quality | Copy + approved standard | drift lines | claims screen runs first; deterministic failure stays a failure |
| **Grader (code)** | Test falsifiers whose window closed | — | Registry metric measurement | promote / hold / refute / insufficient | `falsifier-grade.ts` (B5) |
| **Learning engine (code)** | Beta posteriors, Thompson ranking, credit assignment | — | Confirmed results, ledger | feature stats, trust scores | min-N, decay, explore share |
| **Consolidation (code)** | Merge near-duplicates, retire unused/untrusted, monthly digest | — | Brain, ledger | dry run → apply | idempotent per month |

**Model router ladders**

| Workload | Fast | Quality |
|---|---|---|
| Interactive (person waiting) | Groq → Gemini → NVIDIA → Bedrock | Bedrock → Gemini → Groq → NVIDIA |
| Background (Inngest) | NVIDIA → Gemini → Groq → Bedrock | Bedrock → Gemini → NVIDIA → Groq |

- Provider near its rate limit (Groq headers) moves back; a cooling provider
  moves last.
- A "derailed" reply (prose when JSON was asked) falls through to the next
  model; the first reply is salvaged only if every model derails (never for
  interrogation: a parse failure is invalid, never salvaged).
- Every call logged with provider, model and cost context; per-workspace
  budget caps.

---

## 5. The metacognition stack (B0–B9), point by point

Source brief: `docs/newbrain.md`. Build plan:
`docs/superpowers/plans/2026-10-13-metacognitive-brain.md`. All BUILT on `main`
by 15 Oct 2026; tests then 3,198 passed / 0 failed (321 files), up from 2,787
before B0. Migrations 0087–0090 applied to Supabase; readiness check `OK`.

### 5.1 B0 — Foundation: modes, telemetry, journal, metric registry

- **Modes** (`brain-modes.ts`): `platina_workspace_config.brain_modes` jsonb
  with stages `interrogation, challenger, gate, surprise, retrieval, budget,
  grading`, each `off | shadow | on`; missing key = `off`. `off` is
  byte-identical to the old path (legacy-equivalence golden test).
- **Shadow meaning per stage:** interrogation records validation failures but
  rejects nothing; challenger runs a 50/50 split by `hash(signalId)`; gate
  logs its verdict and the write proceeds; surprise logs "would skip" and still
  analyses (measures false negatives for free); retrieval computes the new set
  beside the old (one extra query in parallel); budget logs what would be cut;
  grading stores grades without promoting or demoting.
- **Telemetry** (`brain-telemetry.ts`): append-only `platina_brain_telemetry`
  (stage, decision, subject, detail, prompt version), fire-and-forget, kept 120
  days. Funnel exits recorded: own_brand, low_value, nothing_new, analysed.
- **Undo journal:** `platina_brain_state_log` — every change to status,
  grade_state, confidence or agreement_state goes through **`setBrainState()`**
  in one transaction with its log row (from, to, cause, grade id). Kept forever.
- **Skip cause:** `platina_signal_documents.skip_cause` (`low_value | own_brand
  | nothing_new | surprise | untestable | gate`) so replays select by cause.
- **Metric registry** (`falsifier-metrics.ts`): each metric declares plane,
  table, segment, aggregation, windows, minN, scale version and a measure
  function. Entries: `engagement_index`, `topic_momentum` (30-day window vs a
  fixed 90-day baseline), `ad_days_running`, `event_participants`, Plane A
  `engagement_rate`, `ctr`, `leads`. `active_ads` dropped (nothing collects it).
  `compareMeasurements` throws on mixed scale versions (coastline rule).
- **Brain quality card:** Admin → Health; fails soft before migration.
- **Recovery tooling shipped before any stage could write:** `platina:brain-mode`,
  `platina:brain-snapshot` / `--restore` (`--archive-new`), `platina:brain-undo`,
  `platina:brain-replay`, hand-written `drizzle/down/0087–0090.sql`,
  `platina:brain-readiness`.

### 5.2 B1 — Interrogation schema and falsifier

```ts
type Interrogation = {
  headline: string;          // for lists
  what: string;              // one claim, one sentence, no hedging
  why: string[];             // ids from numbered input, e.g. "e3"
  how: string;               // mechanism
  kind: "claim" | "fact";
  falsifier: {               // required for claims
    metric: FalsifierMetricId;                  // registry only
    subject: { brand?: string; topic?: string };
    direction: "above" | "below";
    threshold: number;
    window_days: 30 | 90;                       // metric's declared windows
  } | null;
  confidence: "low" | "medium" | "high";        // recorded, never scored
};
```

- Input is numbered (`analysis-input.ts`): identity → what changed → engagement
  → page text, each line `[eN]`, with an id→text map.
- **Rejected when:** `why` empty or cites a missing id; `what` has more than one
  sentence, exceeds 220 characters, or hedges (`may`, `might`, `could`,
  `possibly`); a claim lacks a valid falsifier (metric not in registry, window
  not declared, subject not resolvable); a fact has no verbatim quote of its key
  noun phrase in a cited span.
- `what = "nothing new"` is a valid cheap exit.
- **Measured insights get falsifiers from code:** an interest "up" trend is
  refuted if `topic_momentum` falls below 1.0 within 30 days, a "down" trend if
  it rises above 1.0; no stated trend → no falsifier. Ad-pressure and event
  insights carry none (they describe the present).
- When `on`, an invalid claim keeps its transcript, produces no Brain chunk and
  no finding, and the signal is skipped as "the claim could not be tested".
- Brain chunk columns added (0088): `kind, mechanism, evidence_refs, falsifier,
  subject_key, direction, grade_state (untested|holding|promoted|refuted|
  insufficient), due_at, prompt_version, written_by`.

### 5.3 B2 — Blind challenger (veil of ignorance)

- `blindChallengerInput(interrogation, spanMap)` sends only `what`, `how` and
  cited span texts. Excluded: proposer provider/model, confidence, specificity,
  novelty reason, source URL/domain, raw JSON, prior scores. A test asserts
  none of those strings appear.
- Explicit verdict `no_material_objection | objection`; "NONE" maps to the
  no-objection marker with zero confounder strength.
- Exactly one round (`nextRoundAllowed() === false`); different provider.
- Transcript stores providers, models, prompt version, `blinded`, `objected`.
- `objectionRateBy(rounds, key)` per prompt version and proposer model. Alarms:
  ceiling breach (live v1 ceiling kept at **0.8**; brief target 0.7) raises an
  operational finding; agreement gap > 15 points between proposer models at
  N ≥ 20 = "blinding failed". Healthy objection rate: 20–70%.

### 5.4 B3 — Deterministic gate (apophenia defence)

1. Schema validity (B1).
2. **Testability:** the falsifier's segment already has ≥ metric `minN`
   observations, else held `insufficient` (finding yes, Brain no).
3. **Significance:** one-sided **Mann–Whitney U**, recent vs baseline window,
   exact for small N, normal approximation above 20, pass at **p < 0.10**.
   Scoped to the one registry metric framed as a trend (`ratio_of_medians`).
   A "rising" measured topic that fails is written "not clearly different from
   usual".
4. **resolveV2:** agreement score from deterministic inputs only — evidence
   support = valid citations ÷ 2 capped at 1, challenger confounder strength,
   falsifier validity. The proposer's self-reported specificity (45% of the old
   score) is dropped (D7).
- If the gate refuses, no model output overrides it.

### 5.5 B4 — Surprise filter (predictive coding)

| Source kind | Observation | Expectation key | Test |
|---|---|---|---|
| Web / press / trade page | novelty = 1 − max Jaccard(added words, previous version's words) | `nov:<canonicalUrl>` | one-sided |
| Social post | engagement index vs company median | `eng:<brandId>` | two-sided |
| Ad library | median days running | `ads:<brandId>` | two-sided |

- `deviation = |observed − mean| / max(sd, floorSd)`; skip when below
  `surprise_floor` (default **1.0**). Expectations in `platina_expectations`
  (Welford running mean/variance, one upsert per observation), updated on every
  observation.
- Cold start: < 5 observations per key → proceed. Always proceed: first sight
  of a URL; a diff containing a (year-qualified) date or a price.
- **Audit sample:** deterministic 10% (`surprise_audit_share`) of would-skip
  documents analysed anyway, labelled "Checked anyway (spot check)". > 20%
  finding a move at N ≥ 20 raises an alert recommending a lower floor. **Code
  never moves the floor; a person does.**
- Placement: own_brand → signal-value → loadPrevious → change summary →
  **surprise** → analyse. Skip ⇒ no provider call (tested).
- Only the two-call debate is gated; interest, pressure, events and the public
  learning lane still read every document.
- **Fails open:** a broken expectation store analyses as if the stage were off.

### 5.6 B5 — Falsifier grading and refutation memory

- Inngest `platina-falsifier-grade-sweep` (cron **05:00 UTC** daily) fans out
  `platina/falsifier.grade` per workspace (`concurrency 1` per workspace);
  grades in pages of 200, so a crash resumes at the next page; catches up.

| Measured result | Action | Operator copy |
|---|---|---|
| Window not elapsed | none | — |
| `n < minN` or not measured | `insufficient`, re-tested later | "Not enough data to test yet" |
| Falsifier triggered | **refute**: `grade_state=refuted`, `status=demoted`, confidence floored, `refuted_by_grade_id` set, excluded from support, **kept** as counter-evidence | "Proved wrong on <date>: <metric> was <value>" |
| Not triggered, effect significant | **promote** | "Held up when tested" |
| Not triggered, effect weak | **hold** | (watching) |

- **Confidence becomes earned:** after the first grade, confidence =
  mean of Beta(1 + held, 1 + refuted). A model never sets it again.
- Each grade becomes a measured-result event in the suggestion ledger for every
  suggestion that cited the chunk → `credit.ts` trust updates.
- Refutation broadcasts on the `insights` real-time scope.
- A Plane B-derived claim may be graded on a Plane A metric ("slow loop wins");
  the grade records which plane measured it.
- `platina_insight_grades` is append-only (metric, scale version, window,
  threshold, direction, measured value, n, verdict).
- Holding and insufficient grades are re-testable.

### 5.7 B6 — Anti-echo retrieval

Shared pure module `diversify.ts` / `plan/diversified-evidence.ts`
(`selectDiversified`), wired into **all four call sites**: planner
(`plan/context.ts`), `retrieve.ts retrieveBuckets`, `opportunity-brief.ts`,
`idea-run.ts`.

1. Wider pool: ~50 candidates (`DIVERSIFIED_POOL = 50`) from vector + keyword,
   fused by **reciprocal rank fusion**, relevance floor.
2. **MMR** (λ = 0.7), Jaccard over words, in process.
3. **Derived cap:** Brain chunks ≤ **40%** of the evidence token budget
   (`derived_context_share`); confirmed lessons and own-site pages count as
   first-party.
4. **One counter-evidence slot:** most relevant chunk with same subject and
   opposite direction, else a refuted chunk on that subject; labelled
   `COUNTER-EVIDENCE (may contradict the above)`, role `disconfirming`. Refuted
   rows are counter-evidence only, never support. Empty → "no counter-evidence
   found" (fill rate is a metric).
5. **Self-citation check:** a derived chunk may not support itself or its
   lineage (`absorbedChunkIds`, shared `sourceSignalIds`); write-time refusal
   of derived-only support; parents and compactions never in one context.
6. Two-layer rule unchanged; `canCiteHypothesisAlone(generation < 2)` stays.
- One parallel batch, no new serial round trip; in-request fallback to the old
  path with telemetry `retrieval.fallback`.

### 5.8 B7 — Token budget and quality eval

| Section | Cap (planner) |
|---|---|
| Client standard | 400 tokens, always |
| Evidence total | **2,400 tokens** (first-party largest share) |
| Derived hypotheses | ≤ 40% of evidence |
| Counter-evidence | 1 chunk |
| Lessons + learned patterns | 500 tokens |

- Tokens ≈ characters / 4. Whole chunks dropped from the bottom; never cut
  mid-sentence. Rerank ~50 → ~8 per plane (`DIVERSIFIED_K = 8`), 240 characters
  per candidate.
- Eval: `scripts/brain-eval.ts` (operator-run) — 15 fixed briefs at k = 4, 6,
  8, 12; deterministic scores (citation validity, plane rule, phases with
  evidence, counter-evidence acknowledged, tokens, latency) plus blind owner
  rating. `eval.ts` measures retrieval recall@k.

### 5.9 B8 — Real-time planning on the new Brain

- Freshness counts only **gated** new insights in the plan's scope;
  `REPLAN_THRESHOLD = 3` → "worth re-planning".
- Any cited evidence later **refuted** forces level `replan` with
  `refutedMessage` ("evidence behind this plan was proved wrong").
- Phase verdict badges: "Held up when tested" / "Proved wrong on …".
- Roadmap shows "Counter-evidence the planner weighed".
- **Plan's own stated test** (`plan/falsifier.ts`): "How we'll know if this plan
  is wrong". Not behind a mode; additive; malformed → dropped, plan saved.
  **Grading of the plan's stated test is deferred** (no per-plan measure yet).

### 5.10 B9 — Goodhart, rule conflicts, human insight review

- **Proxy vs outcome:** Spearman ρ (`spearmanCorrelation` in `consolidate.ts`)
  between proxy (engagement index, review verdicts) and outcome (`leads`,
  optional `qualified_leads` import column) in the monthly digest; flag ρ < 0.3.
- **Rule conflict (Heinz, narrow):** a top-third recommendation blocked by
  `claims-gate.ts` (`detectRuleConflicts`) raises an escalation showing both
  sides; the deterministic rule wins. No moral-reasoning layer.
- **Human gate on insights:** approve / edit / reject-with-reason (wrong fact,
  not new, not testable, other) on Brain and Findings (`planInsightReview`,
  `reviewInsightAction`), through `setBrainState` and ledger events.
- **Invariants file:** `brain-invariants.test.ts`, one named test per invariant.

### 5.11 Owner sub-decisions D1–D7 (13 Oct 2026)

| # | Decision |
|---|---|
| D1 | Factual moves are `kind = fact`: code-verified quote, no falsifier, never promoted, labelled "fact (quoted)" |
| D2 | Surprise floor 1.0 SD; 10% audit sample; review after a week of shadow |
| D3 | Derived share 40% of evidence budget |
| D4 | Goodhart outcome = `leads` now, optional `qualified_leads`; never estimated |
| D5 | Grading shadow for the first month; owner reads the first batch; then automatic (reversible) |
| D6 | No flip to `on` in Waters before 27 Oct 2026 |
| D7 | Drop proposer self-confidence from agreement score after B3 shadow |

### 5.12 Structural invariants (each with a named test)

- No model call on unchanged content.
- No insight without a testable falsifier.
- Challenger blind, exactly once.
- Deterministic gates override every model.
- Derived ≤ cap, never self-cited.
- Every metric declares its scale; no cross-scale comparison.
- Refuted insights demoted, never deleted (no delete query exported).
- A human approves every output that leaves the system.

---

## 6. Psychological principles → mechanism → metric

| Principle (internal name) | Failure prevented | Mechanism | Metric | Operator copy |
|---|---|---|---|---|
| Predictive coding | Every item to a model | Hash + surprise filter | Share of fetched items reaching a model | "Nothing unusual compared with this page's normal changes" |
| Metacognition | Untestable claims | One call: what/why/how/falsifier | Testable share | "How we'll know if this is wrong" |
| Veil of ignorance | Bias by author identity/confidence | Blind challenger | Objection rate; agreement by proposer model | "Second opinion" |
| Apophenia | Trends from noise | Min-N + Mann–Whitney | Gate rejections; later-refuted rate | "Not clearly different from usual" |
| Echo chamber | Brain confirms itself | 40% cap, MMR, counter-evidence slot, self-citation check | Derived share; self-citation rate; fill rate | "Counter-evidence" |
| Info overload paradox | More context, worse answers | Wide retrieve, narrow rerank, token budget | Tokens per generation; quality vs k | (not shown) |
| Coastline paradox | Value depends on scale | Versioned scale per metric | No cross-scale comparisons | (not shown) |
| Reinforcement / Goodhart | Optimising a proxy | Reward on confirmed outcomes; labelled explore; proxy-vs-outcome ρ | ρ ≥ 0.3 | "Trying something new" |
| Memory consolidation | Compaction into platitudes | Additive layers, provenance, generation ceiling | Max generation as sole support < 2 | (digest) |
| Falsification (Popper) + refutation memory | Sunk cost, repeated failures | Daily grading; demote and keep | Later-refuted rate | "Proved wrong on …" / "Held up when tested" |
| Exploration vs exploitation | Lock-in on early luck | Thompson sampling seeded per workspace+day; explore slot | — | "Trying something new" |
| Credit assignment ("backprop in spirit") | Not knowing which input caused success | Outcomes flow back to features and input trust | Trust scores | ledger |
| Heinz dilemma (narrow) | Rule vs high score | Rule wins; escalate with both sides | Escalations per week | inbox item |
| Human orchestration | Automation bias | Gates declare/confirm/approve/publish; insight review | — | Approve / edit / reject |
| Outside view (PLANNED CORE-1) | Planning fallacy | Expected ranges from client's own history | — | "no baseline yet" |
| Pre-mortem (PLANNED CORE-2) | Overconfidence | Three failure modes with measurable early warnings | — | — |
| Anchoring (PLANNED CORE-2) | First draft dominates | 2–3 options compared by critic | — | — |
| Decision vs outcome (PLANNED CORE-1/WTR-2) | Judging decisions by luck | Decision record beside outcome | — | — |
| Calibration (PLANNED WTR-2) | "High confidence" not meaning anything | Held vs refuted per confidence band | per band, min-N | "not enough graded claims yet" |

Internal names never appear in the operator UI (banned-word test).

---

## 7. Real-time architecture

### 7.1 Live channel

- Supabase Realtime broadcast, Platina's own spine (separate from InstaMedia's).
- Channel: `platina:<token>:live`; token = HMAC of the workspace id, minted only
  in the membership-checked layout (`platinaTopicToken`); the raw workspace id
  never names a channel. Missing secret → client visibly degrades to polling.
- Event name `platina`; payload **signal-only** `{ scope, id? }` — no tenant
  data crosses the channel; pages refetch through authenticated server render.
- **Scopes:** `audits, findings, solutions, outcomes, alerts, insights, events,
  knowledge, results, ops`. (`plans` PLANNED in WTR-3.)
- Every committed write that changes what a page shows fires a post-commit
  broadcast.

### 7.2 Transport state machine (`realtime-state.ts`, pure, tested)

- States: `live | reconnecting | polling`. `SUBSCRIBED` → live (attempts reset);
  `CLOSED` (deliberate) → polling without error; errors/timeouts → reconnecting
  until `MAX_SUBSCRIBE_ATTEMPTS = 3`, then polling with the reason kept
  (tooltip + Health page). The header pill never claims a transport it lacks.
- **Refresh policy:** live → every signal (bursts coalesced within **800 ms**)
  + safety poll every **120 s**; not live → poll every **20 s**; hidden tab →
  no polling, one catch-up refresh on return if a signal was missed or the
  interval elapsed. (Before: every page refreshed every 20 s, even live and in
  background tabs, once per signal.)

### 7.3 Live visuals

- **Live flow** (`/p/[ws]/live`, `flow-graph.ts`): sources → collected → AI
  analysis → Brain → use → results in three.js. Node size = real count;
  particles per edge proportional to the last 24 h; a refreshed snapshot with
  new arrivals fires a burst along exactly those edges (`arrivals`). Brain as a
  point cloud, one point per stored vector, coloured by kind, faded after 24 h.
  Accessible text list of the same numbers; pauses when hidden; honours reduced
  motion; reports when WebGL is missing. ~75 ms data query (26 counts in one
  statement). Browser test proves non-blank canvas.
- **Brain map** (`/p/[ws]/brain-map`, `brain-map.ts`): every company, subject,
  event, source and AI insight as one graph, each link explained in a sentence,
  deterministic force layout, trace mode. Client's own pages excluded.
- C6 bursts: saving a metric shows a burst on Results → Learning →
  Opportunities, and a reverse burst for a backtrack (demotion).

### 7.4 Render cost work (22 Sep 2026)

| Path | Before | After |
|---|---|---|
| Opportunities data | ~387 ms, 4 rounds | ~260 ms, 2 rounds |
| Cockpit first paint | waited on plan freshness | freshness streams via Suspense |
| Planner / freshness scope | 3 rounds | 2 rounds |

### 7.5 Background jobs (Inngest, times UTC)

| Job id | Trigger | What it does |
|---|---|---|
| `platina-scan-coordinator` | cron every 5 min | Selects due approved sources; fans out one probe tick each; never fetches content |
| `platina-probe-tick` | event `platina/probe.tick` | Header-only conditional request decides whether a paid actor run is warranted; adaptive cadence for probe-less sources |
| `platina-audit-run` | event `platina/audit-run.requested` (concurrency 2) | Durable run worker; orchestrator state machine; guarded writes + post-commit broadcast; idempotent per run |
| `platina-contradict-sweep` | event `platina/contradict.requested` + cron every 6 h (:30) | Dispatcher: one `platina/signal.analyze` per unprocessed doc, newest first, bounded by daily cap; computes objection rate, raises an ops finding on breach |
| `platina-signal-analyze` | event `platina/signal.analyze` (per-workspace concurrency 4, global 2, throttled ~8/min) | Cascade → interrogation → challenger → gate → finding + Brain chunk; telemetry |
| `platina-interest-extract` | event + cron 04:30 | Topic interest and momentum per client; idempotent by measurement key; ends with insight sync |
| `platina-event-extract` | event + cron 04:45 | Events + participation proofs from recent docs; ends with insight sync |
| `platina-own-site` | event + cron 05:00 (per brand concurrency 1) | Client's own site: map → filter → read, capped per day, then change probes |
| `platina-falsifier-grade-sweep` / `-grade` | cron 05:00 / event | B5 grading |
| `platina-learning` | event `platina/results.updated` + cron 06:00 | Read connected metrics (read-only); open due review drafts; embed lessons stored during an embedding outage. Confirming is always a person |
| `platina-idea-trigger` | cron 06:00 | Idea engine on fired triggers; skips triggers that got ideas recently |
| `platina-event-window` | cron 06:00 | Flags campaigns whose event anchor approaches (legacy; SOP link archived by constitution) |
| `platina-brand-refresh` | cron 03:00 | Re-fetch approved own-brand sources; changed hash re-chunks and re-embeds |
| `platina-outcome-ingest` | cron 02:00 | Outcome ingestion |
| `platina-receipt-review` | cron 09:00 | Receipt review queue |
| `platina-alert-sweep` | cron hourly + event | Alert rules (outcome metrics min-N gated, open findings, pending approvals, failed runs); delivery ledger (sent / suppressed with reason, 24 h window); in-app only |
| `platina-client-profile` | event | Profile from the client's own pages right after they are stored |
| `platina-divergence-scan` | cron Mon 05:00 | Weekly backstop for brand divergence |
| `platina-brain-maintenance` | cron Mon 04:00 | Weekly Brain maintenance |
| `platina-consolidate` | cron 1st of month 02:00 | Merge, retire, snapshot weights, digest; idempotent per month |

Nothing scheduled runs without the Inngest dev server (`npm run dev:all`).

---

## 8. Real-time flows, end to end

Each flow: trigger → steps → writes → broadcast → what the person sees.

### F1 — Collection tick
1. Every 5 min the coordinator selects due sources (approved + enabled).
2. Per source, a probe tick: ETag / If-Modified-Since / sitemap lastmod / RSS.
   Unchanged → stop (no cost).
3. Changed or probe-less and due → create an audit run (budget: per-client
   first-pass allowance, then workspace daily cap; retry every 6 h until first
   success, then cadence floor).
4. Run worker fetches through the adapter registry (Firecrawl single page /
   own site; Apify social, ads, multi-page), via safe-fetch for chosen URLs.
5. Signal documents inserted with content hash (unique `(scan_spec_id,
   content_hash)`); a fetch failure never becomes a document.
6. Broadcast `audits`; Live flow fires a burst on source → collected.

### F2 — Signal analysis (the metacognitive pipeline)
1. Contradict sweep (new batch event or 6-h backstop) dispatches one
   `signal.analyze` per unprocessed doc.
2. Plan the analysis: own-brand? low value? nothing new? → skip with cause.
3. Surprise filter (B4) → skip / audit / proceed.
4. Interrogation (B1) on numbered evidence → validate.
5. Blind challenger (B2), one round, other provider.
6. Gate (B3): testability, significance, resolveV2.
7. Write: finding (+ Brain chunk if it passed) through the orchestrator;
   transcript with provenance; telemetry for each exit.
8. Broadcast `findings`, `insights`; Findings / Brain map / Live flow refresh.

### F3 — Interest measurement
1. After posts/ads are collected (or daily 04:30): model assigns topics only.
2. Code computes engagement index vs each company's **median** post, momentum
   (30-day recent vs 90-day baseline, median, min-N 5), ad pressure.
3. Writes `platina_interest_signals`; then the insight writer (F5).

### F4 — Events
1. After conference/post collection (or daily 04:45): model names events and
   copies date/place words.
2. Code checks the words are on the page (`quotedIn`) and parses dates;
   failures rejected (two rejected live).
3. Writes `platina_events` + `platina_event_participants` (proof per row).
4. Broadcast `events`; then the insight writer (F5).

### F5 — Insight writer (market-insight-sync)
1. Gated measurements → one sentence each, keyed (`interest:<client>:<topic>`,
   `pressure:…`, `event:<key>`), with code-built falsifiers where a trend is
   stated.
2. Unchanged → untouched; changed → old superseded, new written and embedded.
3. Broadcast `insights`; plan freshness counts new gated insights.

### F6 — Own site (first-party)
1. Daily or on request: map the client's own domain, filter, read up to the
   daily cap; later only changed pages (header probes).
2. Ownership allowlist enforced; competitor pages refused here and tracked as
   public instead.
3. Writes first-party passages (Plane A), client profile rebuild; broadcast
   `knowledge`.

### F7 — Opportunities (computed on read)
1. Open `/opportunities`: read interest, pressure, events (2 rounds, ~260 ms).
2. Order: (1) what people are interested in now, with proof → (2) campaigns
   (online topics, in-person/online events) → (3) plan → (4) creative last.
3. Rules, not invented scores; events < 21 days = short notice, horizon 365
   days; ≤ 5 topic and ≤ 8 event campaigns; below min-N "not enough posts yet".
4. Learned adjustment shown as its own line (C6). Each shown suggestion is
   recorded in the suggestion ledger.
5. One click hands an opportunity to the planner as a two-line brief.

### F8 — Plan creation
1. Brief: 10–400 characters, ≤ 2 lines (what is promoted, who it is for) —
   typed, or built by `briefFromFinding`, `briefFromEvent` (anchor day; must be
   1–180 days out), `briefFromClient`.
2. `assemblePlanContext`: scope (client + competitors + workspace-wide
   sources), profile (context only), diversified evidence (B6/B7 when modes on),
   lessons (worked/failed), learned patterns, anchor, revision input.
3. Planner proposes; `validatePlan` (ids exist, one plane per phase, days in
   range); critic reviews; orchestrator saves; person approves.
4. Cold start: no results → "plan from the brief alone, do not claim past
   evidence".
5. Roadmap renders phases on a timeline by channel, evidence, counter-evidence,
   stated test, critic notes.

### F9 — Freshness and re-plan
1. On opening a plan / plan list / Cockpit: `readPlanFreshness` counts new gated
   insights in scope and verdicts on cited evidence.
2. Levels: `current` / `review` / `replan` (≥ 3 new, or any cited evidence
   refuted).
3. "Re-plan with the new evidence" → revision: planner keeps what holds,
   changes what new evidence contradicts, writes a revision note.
4. Today freshness is computed **on read**; nothing pushes it (PLANNED WTR-3).

### F10 — Results → learning (C6 fast loop)
1. Person registers creatives (with a hypothesis) and imports numbers (CSV /
   LinkedIn export / connected read-only). Empty cell = not measured.
2. `platina/results.updated` → learning job opens review drafts (numbers by
   code, model drafts what/why/how).
3. **Person confirms** worked / mixed / failed (only confirmed reviews teach).
4. Learning engine: reward 1 / 0.5 / 0 per feature (topic, channel, format,
   hook, weekday, opportunity), Beta posteriors with half-life decay, min-N,
   Thompson sampling seeded by workspace+day, explore slot labelled.
5. Write-back: measured verdict becomes Plane A evidence; failed → linked
   hypotheses demoted (`demote.ts`, "slow loop wins", any generation), retained.
6. Confirmation shows "N promoted / N marked down"; broadcast `results`;
   Live flow reverse burst for backtracks; next Opportunities and plans change.

### F11 — Daily grading (slow loop)
1. 05:00 UTC sweep → per-workspace grade job.
2. For each claim due: measure registry metric on its segment and window →
   promote / hold / refute / insufficient (§5.6).
3. Confidence = Beta mean; state via `setBrainState`; grade row; ledger event.
4. Refutation broadcast on `insights` → plans citing it escalate to `replan`
   with "Proved wrong on …".

### F12 — Idea engine
1. Daily 06:00 (or "Draft ideas" streamed on the Learning page, or operator
   script): triggers = dated event in region, subject rising past min-N,
   competitor ad push, region competitors advertise in and client does not.
2. One call with three separate lists: F (public facts, Plane B), A (Brand
   DNA, Plane A), P (learned patterns). Each idea cites one list.
3. Code drops ideas citing the wrong or no list; ~80% learned / ~20% explore.
4. Every idea recorded in the suggestion ledger (inputs with plane and weight,
   features, model, prompt).

### F13 — Alerts
1. Hourly sweep: outcome metric rules (min-N), open findings awaiting a
   decision, pending approvals, failed/degraded runs in 24 h.
2. Delivery ledger records sent or suppressed with reason; in-app only.
3. Broadcast `alerts`; header and Cockpit update.

### F14 — Credit assignment and monthly consolidation
1. Every decision on a suggestion (planned, dismissed with reason, measured
   result) flows backwards: Beta counts to its features, trust to its inputs
   split by weight. Measured result = full weight; person's decision = 0.3;
   "Wrong fact" lowers that input's trust at full weight.
2. 1st of month 02:00: merge near-duplicate insights (superseded, kept),
   retire unused + untrusted (archived, restorable; age alone never retires),
   snapshot weights, digest "What we learnt this month" (numbers by code),
   Spearman proxy-vs-outcome, generation ceiling report.

### F15 — Brand divergence and claims
1. On detected change (and weekly backstop): compare first-party brand chunks
   with Brain chunks from public signals; both cited by id in separate lists;
   uncited finding rejected.
2. Final approval: deterministic claims screen (defaults banned "cure",
   "guaranteed", "best in class"; regulated "clinically proven", "FDA
   approved"; or workspace rules) blocks approval unless a named approver
   records an exception; drift explanation by model afterwards.

---

## 9. Use-case flows

| # | Use case | Start | Core flows | Human step | Output |
|---|---|---|---|---|---|
| UC1 | Onboard a client | `/start` | header-only discovery probes, F6 | confirm own domains/socials, competitors, declare brand standard | monitored client + profile |
| UC2 | Competitor watch | schedule or "read this link" | F1, F2 | triage findings | Competitors, Findings, alerts |
| UC3 | Opportunity finding | `/opportunities` | F3, F4, F5, F7 | pick one | ranked opportunities with proof |
| UC4 | Event readiness | event approaching | F4, F8 (anchor) | approve plan | backwards-planned roadmap |
| UC5 | Campaign planning | `/plan` two-line brief | F8 | approve / edit | roadmap, evidence, counter-evidence, stated test |
| UC6 | Briefs and content | approved plan/opportunity | F12, brief route | edit / approve | brief, creative (last) |
| UC7 | Claims screening | final approval | F15 | fix or record exception | approved or blocked |
| UC8 | Results and learning | results arrive | F10, F14 | confirm review | promoted / marked down; new rankings |
| UC9 | Re-plan on changed evidence | freshness / refutation | F9, F11 | click re-plan | revised plan with note |
| UC10 | Retargeting | deck use case | F10 learning on own engagement | decide | who to reach again (general; no dedicated module verified) |
| UC11 | Ads insight | Ads page "Scan now" | ad-library scan with live progress | read | activity (not performance) from public libraries |
| UC12 | Watch the system think | `/live`, `/brain-map`, Admin → Health | §7.3, Brain quality card | — | live counts, graph, quality metrics |

---

## 10. Data model (key Platina tables)

- **Plane B raw:** `platina_signal_documents` (content hash, skip_cause, no
  embedding column), interest signals, events, event participants, ad-library
  documents.
- **Plane C Brain:** `platina_brain_chunks` (embedding, confidence,
  agreement_state, source_signal_ids, absorbed_chunk_ids, generation, status,
  insight_key, kind, what/mechanism, evidence_refs, falsifier, subject_key,
  direction, grade_state, due_at, prompt_version, written_by,
  demoted_by_receipt_id, refuted_by_grade_id, last_retrieved_at).
- **Plane A first-party:** own-site passages, brand standard, creatives,
  `platina_creative_metrics` (snapshots), outcomes, confirmed lessons, plan
  feedback.
- **Reasoning record:** `platina_debate_transcripts`, `platina_findings`,
  `platina_insight_grades`, `platina_expectations`, `platina_brain_telemetry`,
  `platina_brain_state_log`.
- **Decisions and learning:** `platina_plans` (PlanDoc jsonb, origin, evidence
  snapshot), `platina_plan_feedback`, `platina_suggestions` +
  `platina_suggestion_events` (ledger), learning snapshots, gate events
  (`platina_gate_events`: approver, decision, payload hash), alerts + delivery
  ledger, audit runs (config snapshot), ops checks.
- **Config:** `platina_workspace_config` (brain_modes, surprise_floor 1.0,
  surprise_audit_share 0.1, derived_context_share 0.4, analysis caps).
- Migrations through **0090** applied. 0091 (WTR-0) and 0092 (CORE-1) PLANNED.

---

## 11. Guardrails summary

| Guardrail | Rule |
|---|---|
| Memory capped | Brain's own conclusions ≤ 40% of any answer's evidence |
| Opposing view | One counter-evidence slot per answer |
| Evidence floor | Below min-N: "not enough data" (momentum min-N 5) |
| Human confirms | No lesson without a person; four gates (declare, confirm, approve, publish) cannot be disabled; only who may use them is configurable |
| No synthesised numbers | "Not measured, never zero" |
| Two planes never merged | A plan phase citing both is refused by code |
| Deterministic first | Claims screen, gate, citation checks beat any model |
| Isolation | workspace_id on every query, SQL-asserted |
| Network safety | safe-fetch: no private addresses, redirects re-checked |
| Ownership | First-party only from allowlisted own pages |
| Nothing deleted | Demote, supersede, archive; journaled; undoable |

---

## 12. Rollout, current mode state and recovery

### 12.1 Last recorded mode state (15 Oct 2026)

- All seven Brain stages `off` in `e2e-fixture`, `internal-sales`,
  `waters-gcc-internal`. Whether any flip happened after 27 Oct is **not
  recorded** in the repo; check with `npm run platina:brain-mode -- --ws <ws>`.
- Always active regardless of modes: plan stated test, C6 learning loop and
  demotion, measured insights, min-N, two-plane rule, gates, claims screen.

### 12.2 Demo / activation sequence

```
npm run platina:brain-readiness
npm run dev:all
npm run platina:brain-snapshot -- --ws <ws>
npm run platina:brain-mode -- --ws <ws> --stage retrieval --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage budget --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage interrogation --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage gate --mode on --apply
npm run platina:brain-mode -- --ws <ws> --stage challenger --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage surprise --mode shadow --apply
npm run platina:brain-mode -- --ws <ws> --stage grading --mode shadow --apply
```

Visibility needs: counter-evidence needs `retrieval` on and an opposing insight;
"Held" needs `gate` on; verdict badges need grades (30/90-day windows — not on
fresh data); Brain quality rows need a day of runs in shadow/on.

### 12.3 Recovery levels

| Level | Failure | Return path |
|---|---|---|
| L0 | Stage misbehaves | mode → off (seconds) |
| L1 | Wrong Brain state | `platina:brain-undo --cause <stage> --since <time>` |
| L2 | Wrongly skipped docs | `platina:brain-replay` (nothing was deleted) |
| L3 | Derived table wrong | rebuild (e.g. expectations) from history |
| L4 | Migration breaks | table backup or `drizzle/down/00NN.sql` |

Rules kept: off = byte-identical; shadow/on fail open; additive migrations with
down files; Brain state only via `setBrainState`; no new serial round trip on
interactive paths (p50 regression ≤ 50 ms); deploy order migrate → code.

---

## 13. Quality metrics (Admin → Health → Brain quality)

| Metric | Healthy |
|---|---|
| Model-call share (analysed / fetched, 7 d) | Falling after B4 |
| Stopped by stage (hash, triage, surprise, gate) | Each removes volume |
| Spot checks that found something | < 20% |
| Testable share of claims | → 100% when on |
| Objection rate per prompt version | 20–70% |
| Agreement gap by proposer model (N ≥ 20) | < 15 points |
| Gate rejections by reason | Visible, not zero |
| Later-refuted rate of accepted | Tracked monthly |
| Derived share of context | ≤ 40% |
| Self-citation rate | 0 when on |
| Counter-evidence fill rate | Rising as grades land |
| Tokens per generation | Falling after B7 |
| Proxy-vs-outcome ρ | ≥ 0.3 |
| Max generation as sole support | < 2 |
| Escalations per week | Low, explained |

No metric is shown below its minimum N ("not enough data yet").

---

## 14. Live-data facts (dated)

- **21 Sep 2026:** 151 LinkedIn posts from 6 companies after a 3-month backfill
  (~$0.30); 8 interest subjects pass min-N (PFAS analysis 1.34×, 8 posts, 3
  companies; mass spectrometry 1.09×, 41 posts, 6 companies, down from 2.43×
  after switching to the median because one post was 18×); 25 events, 8
  upcoming, 28 participation proofs; Bruker found attending ARABLAB LIVE 2026
  from its own posts though the exhibitor list did not name it; planner brief
  "a Dubai trade show" retrieved the ARABLAB insight first; plan from
  Opportunities in ~10 s.
- **23 Sep 2026:** 238 signal documents, 301 interest signals, 50 events, 43
  participation proofs; 582 own-site pages known, 22 of 300 read; 132 Brain
  insights, 160 transcripts, 229 findings; 0 creatives/results (learning had
  nothing to learn from yet).
- **15 Oct 2026 (migration):** 239 active Brain insights, 61 superseded, 448
  signal documents, 280 debate transcripts, all intact.
- Fixed defects worth remembering: ad search returning charter-boat ads
  (advertiser must carry the name); ads stored without text; third-party pages
  in first-party KB (42 of 67 passages); Ads "sync" inventing metrics (removed);
  SSRF on pasted URLs (safe-fetch); measured insights never reaching the Brain
  (insight writer); viral post inflating averages (median).

---

## 15. PLANNED work (not built as of 9 Nov 2026)

### 15.1 WTR-0 — Study readiness (spec 22 Oct; all parts "not started")
- **A. LinkedIn import that works:** `created_date` → new `postedAt` (not
  `capturedAt`, which was overwriting weekly snapshots); `splitImportRows` →
  matched / unassigned / duplicates; import record table
  `platina_metric_imports` (migration 0091); unassigned posts listed with
  "Register as a creative" prefill; the "match no creative" refusal removed
  (strict parsing otherwise stays).
- **B. Operator marker:** `operator` on run config snapshots from scripts; guard
  test; `runOrigin(run)` → schedule | event | person | operator (old unmarked =
  unknown, never guessed as person).
- **C. Re-plan reason:** `PlanOrigin.trigger { level, newSignals, refuted }`;
  label "Revised after evidence it cited was proved wrong" / "after N new
  checked signals" / "on request".
- **D. Weekly study report:** `npm run platina:study` (read-only) for measures
  R1–R4, L1–L5, each with N and floor.

### 15.2 Planner + evaluator roadmap (23 Oct)

Target loop:
```
brief → context + EXPECTED RANGES (code, client's own history)
→ planner: 2–3 OPTIONS + PRE-MORTEM (3 failure modes, measurable early warnings)
→ citation check → critic compares options
→ PERSON CHOOSES → DECISION RECORD (alternatives, why, stop conditions, approver, hash)
→ LIVE CAMPAIGN (status, dates, owner, budget; creatives linked to phases)
→ IN-FLIGHT TRACKER (on track / off track / not enough data; early warnings; competitor moves labelled public)
→ PLAN WATCH push (in-app alert, Cockpit inbox, Monday digest)
→ re-plan (records why) or close → SCORECARD (stated test graded; decision beside outcome)
→ CALIBRATION (does "high" hold more than "low"?) → next plans
Guard: PLAN TEST SET before any planner prompt/model change.
```

| Slice | Content | Migration |
|---|---|---|
| CORE-3 | Plan test set: fixed briefs, synthetic contexts, code checks; `npm run platina:plan-eval`; merge gate "no drop below baseline" | none |
| CORE-1 | Plan lifecycle (draft/approved/live/closed, owner, dates, budget), decision record via approve gate, expected ranges (25th–75th percentile of client's own engagement rate / CTR; "no baseline yet") | 0092 |
| WTR-1 | Live campaigns; creatives on phases; tracker; adjustments in the ledger; ARABLAB follow-up as first live campaign | — |
| CORE-2 | Alternatives (≤ 2) + pre-mortem (3 risks mapped to registry metrics), behind planner mode off/on | none |
| WTR-3 | `platina-plan-watch` (debounced on insight sync, grade, results, findings); alert source `plan`; Cockpit inbox; realtime scope `plans`; Monday 04:00 UTC digest; in-app only; true push needs always-on runtime | maybe small |
| WTR-2 | Close and score (grade stated test — the deferred B8 item), phase in/out of range, decision beside outcome; calibration card by confidence band | — |
| CORE-4 | Read-only reporting connectors (GA4 Data API, LinkedIn Marketing reporting, CRM lead counts) via `metrics-read.ts`; no write scope ever; needs constitution amendment and external approvals | — |

Gates: G1 owner approves design in the canvas before code; G2 manual
verification after code, then live proof on Waters. Scheduled order (as
planned): WTR-0 + CORE-3 (27 Oct–2 Nov), CORE-1 + WTR-1 (3–16 Nov), CORE-2
(17–23 Nov), WTR-3 (24 Nov–7 Dec), WTR-2 (8–21 Dec), CORE-4 (22 Dec–19 Jan).
**The repo shows none of these started**; the progress tables are empty.

### 15.3 PROPOSED constitution wording (unsigned)

> Platina may read a client's own campaign reporting through read-only API
> scopes the client grants … never requests a write scope, never posts,
> schedules, edits campaigns, audiences or budgets … through
> `src/lib/connectors/metrics-read.ts` … The earlier "no ad-account
> connections" rule is narrowed to: no write access, ever.

---

## 16. Open findings and limits

- Plan stated-test grading deferred (no per-plan measure yet).
- `hasDateOrPrice` catches only year-qualified dates.
- Novelty compares against one previous version, not the last five.
- "Spot checks that found something" slightly overstates the hit rate (audit
  samples ending "nothing new" leave the denominator).
- `signal-analyze` reads workspace config before the plan step (one cheap read
  on skips, no provider cost).
- Freshness is computed on read; no push yet (WTR-3).
- No calibration measure yet (WTR-2); no plan-level evaluator beyond critic
  (CORE-3).
- A plan is a document without status, owner, budget or calendar dates
  (CORE-1).
- LinkedIn weekly re-import overwrites snapshots (WTR-0 A fixes).
- Embedding model migration (768 → larger) is a separate decision.
- Client Portal and org_admin / client_viewer views out of scope.
- Retargeting is a deck-level use case without a verified dedicated module.

---

## 17. Glossary: internal term → operator copy

| Internal | Operator sees |
|---|---|
| Hash stop | "Unchanged since last read" |
| Surprise skip | "Nothing unusual compared with this page's normal changes" |
| Audit sample | "Checked anyway (spot check)" |
| Falsifier | "How we'll know if this is wrong" |
| Refuted | "Proved wrong on <date>: <metric> was <value>" |
| Promoted | "Held up when tested" |
| Insufficient | "Not enough data to test yet" |
| Blind challenger | "Second opinion" |
| Disconfirming slot | "Counter-evidence" |
| Derived cap | (not shown) |
| Explore slot | "Trying something new" |
| Min-N failure | "Insufficient baseline" / "not enough posts yet" / "not enough results yet" |
| Missing metric | "Not measured, never zero" |

Plane A = first-party consented evidence. Plane B = public raw signal (never
embedded/cited). Plane C = Brain (derived, checked hypotheses).

---

## 18. Instructions for an LLM working on this project

1. Read `CLAUDE.md` first; it outranks every plan. On conflict, stop and report.
2. Propose a plan, wait for approval, deliver a reviewable diff; one slice per
   branch; tests first.
3. Every new Brain stage goes behind a mode; `off` must be byte-identical;
   shadow/on must fail open.
4. Change Brain state only through `setBrainState`; never delete Brain rows.
5. Add `workspace_id` to every query with a `toSQL()` test.
6. Keep code under `src/lib/platina/*`; never edit `boundary.test.ts` to pass.
7. Route every model call through the router; never let a model write a number.
8. Additive migrations only, each with `drizzle/down/00NN.sql`; migrate before
   running new code; database actions need the owner's yes.
9. Operator copy uses plain words; internal terms are banned in the UI.
10. Never claim a step works without pasting command output.
11. Traps: files are CRLF (use edit tools, not multi-line sed); worktree
    `node_modules` is a junction (remove with `cmd /c rmdir`); `next build`
    needs `.env.local`; some tests flake under load (`brand-colour`,
    `theme-migration`) — re-run alone.

---

## 19. Key file index

| Concern | Path |
|---|---|
| Constitution | `CLAUDE.md` |
| Brief | `docs/newbrain.md` |
| Brain plan / handoff | `docs/superpowers/plans/2026-10-13-metacognitive-brain.md`, `2026-10-14-brain-continuation.md` |
| Roadmap | `docs/superpowers/plans/2026-10-22-wtr-0-study-readiness.md`, `2026-10-23-planner-evaluator-roadmap.md` |
| Pitch report | `docs/pitch/2026-10-19-platina-pitch-plan.md` |
| Orchestrator | `src/lib/orchestrator/run.ts`, `src/lib/platina/orchestrator.ts` |
| Router | `src/lib/ai/router.ts` |
| Fetch | `src/lib/platina/fetch/*`, `src/lib/scrape/firecrawl.ts`, `src/lib/net/safe-fetch.ts`, `src/lib/ingest/ownership.ts` |
| Cascade | `signal-value.ts`, `surprise.ts`, `significance.ts`, `analysis-plan.ts` |
| Metacognition | `interrogation.ts`, `falsifier-metrics.ts`, `debate.ts`, `challenger.ts`, `objection-rate.ts`, `insight-gate.ts`, `contradiction.ts` |
| Brain | `brain.ts`, `brain-state.ts`, `brain-modes.ts`, `brain-telemetry.ts`, `brain-recovery.ts`, `brain-readiness.ts`, `brain-map.ts` |
| Retrieval | `retrieval.ts`, `retrieve.ts`, `fusion.ts`, `diversify.ts`, `rerank.ts`, `context-budget.ts`, `plan/diversified-evidence.ts` |
| Market | `interest.ts`, `events.ts`, `market-insight-writer.ts`, `market-insight-sync.ts`, `opportunities.ts` |
| Planner | `plan/brief.ts`, `plan/usecases.ts`, `plan/context.ts`, `plan/agent.ts`, `plan/flow.ts`, `plan/evidence.ts`, `plan/falsifier.ts`, `plan/freshness.ts`, `plan/timeline.ts` |
| Learning | `learning.ts`, `credit.ts`, `consolidate.ts`, `demote.ts`, `writeback.ts`, `falsifier-grade.ts`, `idea-engine.ts`, `idea-run.ts`, `suggestions.ts` |
| Trust | `gates.ts`, `claims.ts`, `claims-gate.ts`, `drift.ts`, `stages/cited.ts`, `stages/divergence.ts` |
| Real time | `realtime.ts`, `realtime-server.ts`, `realtime-state.ts`, `flow-graph.ts` |
| Jobs | `src/inngest/functions/platina/*` |
| Invariants | `src/lib/platina/brain-invariants.test.ts`, `src/lib/platina/boundary.test.ts` |
| Navigation | `src/lib/platina/nav.ts` (Cockpit; Watch: Live flow, Brain map, Events, Competitors, Ads, Clients; Decide: Opportunities, Plan; Learn: Results, Learning, Outcomes; Review: Audits, Findings, Solutions; Admin) |
