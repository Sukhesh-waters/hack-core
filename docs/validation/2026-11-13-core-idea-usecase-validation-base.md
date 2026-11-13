# Platina AI OS — Core Idea, Use-Case Catalog, Real-Time Operations & Strict Validation Base

| Field | Value |
|---|---|
| **Document ID** | `VAL-BASE-2026-11-13` |
| **Date** | 13 November 2026 |
| **Repo / Commit** | `Sukhesh-waters/hack-core` · branch `main` (`b01e453`) |
| **Primary Live Workspace** | `waters-gcc-internal` (`f50c899d-e2a6-4b71-a5a8-1f67cd4addf1`) — Waters Corporation (GCC / Middle East) |
| **Purpose** | Canonical, self-contained specification of the core idea, business proposition, 12 concrete use cases, real-time operational mechanics, adversarial failure analysis, and next-step operational plan — structured for both automated code/runtime validation (`npm run platina:validate-usecases`) and independent interrogation by a higher-intelligence frontier model. |

---

## 1. The Core Idea & Business Proposition

### 1.1 The Problem (Why Current AI Marketing Tools Fail)
Marketing teams in B2B and regulated industries (scientific instruments, healthcare, industrial tech, regional enterprise agencies) face a structural failure in current AI tools:
1. **Fluency Without Calibration:** Standard LLM wrappers generate persuasive campaign plans, briefs, and copy regardless of whether any evidence supports them. Fluency is disguised as strategy.
2. **Zero Memory of Being Wrong:** When a campaign underperforms, current tools do not record what specific hypothesis failed. The same failed angle is re-proposed next quarter under new wording.
3. **Contaminated Evidence (Scraped Public Data Mixed with First-Party Truth):** Tools dump scraped competitor posts and the client's own verified performance data into a single vector store, citing noisy competitor activity as proof of what the client should do.
4. **Apophenia & Invented Numbers:** Three high-engagement posts are declared a "market trend." Missing metrics from ad libraries or organic exports are silently turned into `0` or hallucinated into ROI projections.
5. **Unbounded Model Spend:** Sending every scraped webpage or social post through an LLM makes continuous monitoring economically unviable.

### 1.2 The Platina AI OS Proposition
**One-Sentence Thesis:** *Most AI marketing tools are confident; Platina is calibrated — every insight and campaign plan states what it believes, cites the exact source, names the measurable test that would prove it wrong, and updates its own memory when real-world results come back.*

Platina AI OS operates as an **accountable marketing intelligence and campaign planning system** built around seven non-negotiable engineering laws:
1. **Two-Plane Evidence Law:**
   - **Plane A (First-Party Consented Evidence):** The client's own allowlisted website passages (`platina_first_party_chunks`), declared Brand DNA (`platina_brand_chunks`), logged creative metrics (`platina_creative_metrics`), confirmed reviews (`platina_creative_reviews`), and imported campaign outcomes (`platina_outcomes`). Embedded and citable as proof.
   - **Plane B (Public Pattern Signal):** Competitor pages, LinkedIn company posts, public Meta/LinkedIn ad libraries, and conference pages (`platina_signal_documents`). **Physically has no embedding column** — can never be retrieved or cited as raw proof.
   - **Plane C (The Metacognitive Brain):** Derived, validated hypotheses (`platina_brain_chunks`) that survived interrogation, blind challenge, and deterministic statistical gates. Embedded, capped at $\le 40\%$ of any retrieval context, and never mixed with Plane A in a single plan phase citation.
2. **Cost Cascade (`hash → statistic → rule → fast model → quality model → human`):**
   - Never spend a model call on what a content hash, HTTP header probe (`ETag`/`Last-Modified`), Welford running-variance surprise filter, or regex/min-N rule can decide for free.
3. **Popperian Falsifiability at Write Time:**
   - Every Brain claim (`kind = 'claim'`) must carry a structured falsifier (`metric`, `subject`, `direction`, `threshold`, `window_days: 30 | 90`) from the fixed metric registry (`src/lib/platina/falsifier-metrics.ts`). Untestable claims are rejected by code (`assertFalsifiableClaim`). Pure facts (`kind = 'fact'`) are exempt only if code verifies a verbatim quote on the source page.
4. **Veil-of-Ignorance Blind Challenger:**
   - A second model from a *different provider* critiques every proposed claim seeing only `what`, `how`, and the numbered evidence spans — stripped of proposer model identity, self-reported confidence, and URL provenance.
5. **Deterministic Gates Override Every Model:**
   - Code checks schema validity, minimum sample size (`minN`), Mann–Whitney U trend significance ($p < 0.10$), citation existence, single-plane phase purity, and banned/regulated claims (`claimsGate`). Proposer self-confidence is recorded for calibration telemetry but given **0% weight** in `resolveV2`.
6. **Measured Beats Modelled ("Not Measured, Never Zero"):**
   - Models never output numbers or invent metrics. Any metric not reported by a platform is stored as `null` ("not measured").
7. **Closed-Loop Falsifier Grading & Bandit Re-Weighting:**
   - A daily grader (`05:00 UTC`) tests due claims against real measurements. Refuted claims are demoted (`status = 'demoted'`, `grade_state = 'refuted'`) — **never deleted** — and actively retrieved into a dedicated **Counter-Evidence slot** so the planner sees what previously failed on that subject. Confirmed creative reviews update Beta posteriors per feature (`topic`, `channel`, `format`, `hook`, `day`) using Thompson sampling with an explicit 20% exploration share.

---

## 2. Complete Catalog of Documented Use Cases (UC-01 to UC-12)

Each use case below is defined by its **Trigger**, **System Pipeline**, **Code & DB Contract**, **Deterministic Guardrails**, **Adversarial Failure Modes**, and **Strict Validation Criteria**.

### UC-01 — Client Onboarding & First-Party Ownership Vault (`/p/[ws]/start`, `/p/[ws]/clients`)
- **Business Goal:** Stand up a new B2B client with strict cryptographic/domain separation between the client's own assets (Plane A) and competitors (Plane B).
- **Pipeline:**
  1. Operator registers client brand (`kind = 'own_brand'`) and allowlists domains/social handles (`client_identities`, checked by `src/lib/ingest/ownership.ts`).
  2. Header-only discovery probes check candidate URLs without burning scraper credits.
  3. `platina-own-site` job crawls the client's website via Firecrawl (`map → filter → read`, capped per day), stores `platina_first_party_chunks` (Plane A), and builds `ClientProfile` (context-only summary, offers, audience, claims).
  4. Human declares and confirms Brand Standard chunks (`platina_brand_chunks`, gate `declare`).
- **Guardrails:** `ownership.ts` refuses any non-allowlisted domain in first-party ingest; `safe-fetch.ts` blocks private/internal IPs and re-verifies every HTTP redirect.
- **Strict Validation Criteria:**
  - Every `platina_first_party_chunks` row belongs to an allowlisted client domain (`0` orphan/competitor leaks).
  - Client profile exists and is non-empty.
  - Approved `platina_brand_chunks` count $\ge \text{minBaselineN}$ (default 20) so downstream Solution drafting is unlocked.

### UC-02 — Continuous Low-Cost Market Collection & Cost Cascade (`scan-coordinator` → `probe-tick` → `audit-run`)
- **Business Goal:** Monitor competitor websites, press releases, conferences, LinkedIn company posts, and ad libraries continuously without exhausting scraper or LLM budgets.
- **Pipeline:**
  1. `platina-scan-coordinator` runs every 5 minutes (protected by `OPS-0` `isReplayedTick` burst guard), selects due approved `platina_scan_specs`.
  2. `platina-probe-tick` issues free conditional HTTP probes (`ETag`, `Last-Modified`, sitemap `lastmod`, RSS). Unchanged pages stop at rung 1 ($0 cost).
  3. Changed or probe-less due specs trigger `platina-audit-run` via Firecrawl (single web page) or Apify (LinkedIn posts, Meta/LinkedIn ad libraries, multi-page crawls).
  4. Content is canonicalized and SHA-256 hashed (`platina_signal_documents_spec_hash_unique`). Duplicate content cannot insert twice.
- **Guardrails:** Daily workspace page cap (default 40 pages/day) and per-source cadence floor; fetch failures mark the run `degraded`/`failed` and never insert error HTML as a signal document; `runOrigin` stamps operator scripts vs scheduled/person runs.
- **Strict Validation Criteria:**
  - `0` stuck runs (> 1 hour in `running`/`queued`).
  - `0` approved sources overdue by more than $2\times$ their cadence while the job runner is active.
  - Scraper tokens (Firecrawl & Apify) valid and within budget cap.

### UC-03 — Metacognitive Signal Analysis: Interrogation, Blind Challenge & Gate (`signal-analyze`)
- **Business Goal:** Filter out routine page edits and turn genuinely surprising competitor moves into falsifiable, blind-reviewed findings and Brain insights.
- **Pipeline:**
  1. `planAnalysis`: skips `own_brand`, `low_value` (boilerplate/nav/thin text), and unchanged content.
  2. **B4 Surprise Filter (`surprise.ts`):** Compares page word-novelty (or social engagement index / ad days running) against Welford running mean/SD in `platina_expectations`. Skips if $\text{deviation} < 1.0\text{ SD}$ (with a 10% deterministic spot-check audit sample).
  3. **B1 Interrogation (`interrogation.ts`):** Quality-ladder model extracts `headline`, `what` (single sentence, $\le 220$ chars, no hedge words), `why` (validated `[e1..eN]` span IDs), `how`, `kind` (`claim | fact`), and `falsifier` (registry metric, subject, direction, threshold, window).
  4. **B2 Blind Challenger (`challenger.ts`):** Fast-ladder model on a *different provider* receives only `what`, `how`, and cited span texts. Outputs `no_material_objection` or `objection` + confounder strength.
  5. **B3 Deterministic Gate (`insight-gate.ts`):** Checks schema, segment `minN` testability, Mann–Whitney U significance ($p < 0.10$), and computes `resolveV2` (ignoring proposer confidence).
- **Guardrails:** Every skip guarantees `0` model calls; `surprise` and `retrieval` fail open on DB errors; `objectionRate` above ceiling raises an ops alert.
- **Strict Validation Criteria:**
  - Brain stages (`interrogation`, `challenger`, `gate`, `surprise`) configured in `shadow` or `on` mode so telemetry and falsifiers are actively recorded.
  - Objection rate within healthy bounds ($20\%–70\%$).
  - Every `kind = 'claim'` chunk in `platina_brain_chunks` has a valid registry falsifier.

### UC-04 — Measured Market Interest & Competitor Ad Pressure (`interest-extract`, `ads-scan-run`)
- **Business Goal:** Quantify which topics are genuinely gaining buyer engagement across the market and where competitors are concentrating paid ad spend — without hallucinated numbers.
- **Pipeline:**
  1. Fast model assigns topic labels to collected LinkedIn/social posts (generic phrases like "analytical systems" filtered out by code).
  2. Code computes each post's engagement index relative to *that company's own median post*, then computes 30-day vs 90-day baseline median momentum (`minN = 5` posts).
  3. Mann–Whitney U test checks whether a rising topic is statistically significant ($p < 0.10$).
  4. Ad-library sweep extracts active ads per competitor, theme, region, and `ad_days_running` (activity only, never invented spend/impressions).
  5. `market-insight-writer.ts` syncs gated measurements into `platina_brain_chunks` with deterministic code-built falsifiers.
- **Guardrails:** Topics with $N < 5$ return `insufficient` and never enter campaign recommendations; median neutralizes single viral outliers.
- **Strict Validation Criteria:**
  - At least 3 topics pass the `minN = 5` gate with non-null momentum.
  - Ad-library detections carry proof links and `0` synthesized performance metrics.

### UC-05 — Trade Show & Event Readiness Intelligence (`event-extract`, `/p/[ws]/events`)
- **Business Goal:** Detect industry conferences in the client's target region, prove which competitors are exhibiting or speaking from their own posts/pages, and anchor backwards-planned campaigns.
- **Pipeline:**
  1. Model proposes event name, date words, and place words from conference pages and competitor posts.
  2. Code verifies that the exact date and place strings appear verbatim in the source text (`quotedIn`) and deterministically parses start/end dates (`parseDateRange`).
  3. Stores `platina_events` and `platina_event_participants` with per-competitor proof quotes and URLs.
- **Guardrails:** Any event date not verbatim on the page is rejected by code; events $< 21$ days away are flagged `short_notice`.
- **Strict Validation Criteria:**
  - Upcoming dated events exist in the target region (e.g. GCC) with verified source URLs.
  - Event participation rows link to real signal documents.

### UC-06 — Ranked Opportunities & Evidence-Cited Campaign Briefs (`/p/[ws]/opportunities`)
- **Business Goal:** Present the marketing lead with a ranked, noise-free list of actionable opportunities (events + rising topics + ad white space) and stream a source-cited brief in one click.
- **Pipeline:**
  1. `loadOpportunities` combines gated topic momentum, upcoming events, and ad detections, applying Thompson-sampled learned adjustments when confirmed results exist ($N \ge \text{minN}$).
  2. Clicking **AI campaign brief** streams `POST /p/[ws]/opportunities/brief`:
     - Builds `F1..Fn` (Plane B public facts) and retrieves `A1..An` (Plane A client own-site passages, filtering out investor/quarterly earnings noise via `NOT_PRODUCT`).
     - When `retrieval` mode is `on`, runs `selectBriefEvidence` (MMR + derived cap + `C1` counter-evidence slot + token budget).
     - `parseBrief` verifies every `whyNow` line cites only `F`-ids, every `fit`/`salesAngle` line cites only `A`-ids, and every number in the text appears verbatim in its cited source. Unverified lines are dropped by code.
     - Records the brief in `platina_suggestions` ledger.
- **Guardrails:** Strict two-plane separation (`whyNow` = Plane B only; `fit` = Plane A only); digit check drops any invented number; fails closed if `0` `whyNow` lines survive validation.
- **Strict Validation Criteria:**
  - Opportunities load in $< 500\text{ ms}$ with valid proof URLs.
  - Generated briefs pass 100% of citation and number-verification checks.

### UC-07 — Anti-Echo Campaign Planner & Stated Falsifier (`/p/[ws]/plan`)
- **Business Goal:** Turn a two-line brief (or finding/event handoff) into a phased 1–180 day campaign roadmap that weighs counter-evidence, separates Plane A and Plane B per phase, and states the exact test that would prove the plan wrong.
- **Pipeline:**
  1. `assemblePlanContext` gathers client profile (context-only), Plane A baseline evidence, Plane B pattern evidence, worked/failed plan lessons, and learned patterns. When `retrieval`/`budget` modes are `on`, `retrieveDiversifiedEvidence` applies MMR ($\lambda = 0.7$), the $40\%$ derived token cap, the 2,400-token evidence budget, and fills the `counterEvidence` slot (`role: "counter"`).
  2. `generateCampaignPlan` proposes `title`, `summary` (word-boundary trimmed $\le 300$ chars), `3–6` phases (`startDay`, `endDay`, `channel`, `message`, `evidenceIds`), `revisionNote`, and a plan-level `falsifier` (`parsePlanFalsifier`).
  3. `validatePlan` enforces: known citation IDs, **at most one plane (`A` or `B`) per phase** (`findCitationProblem`), days in `[1, 180]`, and event anchor coverage.
  4. Independent `critiquePlan` reviews the roadmap; any critique flags are saved and shown openly to the operator.
- **Guardrails:** `CORE-3` evaluation suite (`PLAN_EVAL_CASES` + `CRITIC_EVAL_SET`) checks `generated`, `citations_known`, `one_plane_per_phase`, `days_in_range`, `phase_count`, `stated_test`, `anchor_covered`, `anchor_finish`, `no_citations_without_evidence`, `revision_note`, and `no_invented_figures`.
- **Strict Validation Criteria:**
  - `platina:plan-eval` achieves $\ge 90\%$ pass rate across all 11 deterministic checks and $\ge 75\%$ critic agreement.
  - Saved plans in the workspace carry a valid `falsifier` and pass `validatePlan`.

### UC-08 — Real-Time Plan Freshness & Evidence-Triggered Re-Planning (`plan/freshness.ts`)
- **Business Goal:** Alert the team when the market shifts under an active plan — or when a Brain insight the plan relied upon is proved wrong — and generate an updated revision that explains what changed.
- **Pipeline:**
  1. `readPlanFreshness` checks all gated Brain insights created after `plan.createdAt` within the plan's client/competitor scope, plus the `grade_state` of every Brain chunk cited in the plan's frozen evidence snapshot.
  2. If $\ge 3$ new gated insights arrived, or **any cited chunk was `refuted`**, the plan escalates to `replan` ("Worth re-planning" / "Evidence behind this plan was proved wrong").
  3. Phase cards render verdict badges (`Held up when tested` / `Proved wrong on <date>`).
  4. Clicking **Re-plan with the new evidence** runs `revisePlanAction`, stamping `origin.trigger = { level, newSignals, refuted }` (`WTR-0 Part C`) and rendering `revisionReason`.
- **Guardrails:** Ungated/superseded insights do not trigger false re-plan alarms; revision must include a non-empty `revisionNote`.
- **Strict Validation Criteria:**
  - `readPlanFreshness` accurately escalates on refuted citations and $\ge 3$ new gated insights.
  - Revisions record `origin.trigger` for study measure `L3b`.

### UC-09 — Brand DNA Drift & Deterministic Claims Gate (`/p/[ws]/solutions`, `/p/[ws]/admin/claims`)
- **Business Goal:** Prevent regulated or off-brand claims ("cure", "guaranteed", "best in class", "clinically proven", "FDA approved", or custom workspace rules) from ever being approved without a named executive exception.
- **Pipeline:**
  1. `retrieveBuckets` retrieves Plane A (`platina_brand_chunks`) and Plane C (`platina_brain_chunks`), enforcing `relevanceGate` (floor $0.35$), `minNGate` (default $20$ approved brand chunks), and `checkSupport` (Plane C can never be sole support; generation $\ge 2$ compacted chunks cannot be sole support).
  2. `claimsGate` runs deterministic substring/token checks across solution plans and task titles. Any violation sets `blocksApproval = true` unless a `claims_exception` gate event with a written reason and approver hash exists.
  3. **B9 Heinz Rule-Conflict Escalation (`detectRuleConflicts`):** When a top-third scoring recommendation is blocked by `claimsGate`, the deterministic rule wins (`ruleWins: true, blocked: true`) and an escalation surfaces both the rule violation and the evidence score.
- **Guardrails:** Deterministic rules always override model opinions; four human gates (`declare`, `confirm`, `approve`, `publish`) require capability checks and SHA-256 payload hashes.
- **Strict Validation Criteria:**
  - `claimsGate` blocks banned/regulated terms 100% of the time without exception.
  - Workspace has confirmed `platina_brand_chunks` ($\ge 20$) so `minNGate` is satisfied in production.

### UC-10 — Triggered Idea Engine with 80/20 Explore Split (`/p/[ws]/learning`, `idea-run.ts`)
- **Business Goal:** Proactively draft 5 concrete campaign ideas when a high-priority market trigger fires (upcoming regional event, rising topic, competitor ad push, regional ad gap), grounding 80% in proven patterns and 20% in labelled exploration.
- **Pipeline:**
  1. `findTriggers` ranks live triggers from events ($\le 120$ days), rising topics, and ad detections.
  2. `runIdeaEngine` builds three separate lists: `F1..Fn` (Plane B trigger facts), `A1..An` (Plane A client own-site Brand DNA, excluding investor/results pages), and `P1..Pn` (confirmed learned patterns past `minN`).
  3. One quality-model call generates 5 ideas (4 following `P`-ids, 1 with `explore = true, pattern = null` labelled `"trying something new"`).
  4. `parseIdeas` verifies citations per list and strips any idea with an unverified number.
  5. Records every kept idea in `platina_suggestions` with normalized input weights (`F: 0.5, A: 0.3, P: 0.2`).
- **Guardrails:** Daily cap (`DAILY_IDEA_CAP = 15`); strict per-list citation check; explicit exploration label.
- **Strict Validation Criteria:**
  - `parseIdeas` rejects mixed-list citations, missing citations, and invented numbers.
  - Ideas are persisted to `platina_suggestions` with traceable input refs.

### UC-11 — Results Import, Human Review Confirmation & Bandit Learning Loop (`/p/[ws]/results`, `learning.ts`, `credit.ts`)
- **Business Goal:** Close the fast learning loop by importing real campaign metrics (LinkedIn page exports, CSVs, or read-only connected accounts), having a human confirm `worked / mixed / failed`, and updating feature weights and input trust scores.
- **Pipeline:**
  1. `parseMetricsSheet` parses Platina CSVs or LinkedIn Update Engagement exports (`WTR-0 Part A`: `created_date` maps to `postedAt`, preserving `capturedAt` as the import date so weekly snapshots accumulate; optional `qualified_leads` parsed for `B9` Goodhart check; empty cells = `null`, never `0`).
  2. `splitImportRows` separates registered creatives (`matched`) from `unassigned` page posts and collapses duplicate rows instead of rejecting the sheet.
  3. Code computes `engagementRate`, `ctr`, and comparison against the client's own median creative; model drafts a review (`what / why / how`); **a person confirms** `worked (1.0)`, `mixed (0.5)`, or `failed (0.0)`.
  4. Confirmed reviews update per-feature Beta posteriors ($\alpha, \beta$ with half-life decay) for Thompson sampling, write Plane A lesson chunks, demote linked Brain chunks when a review fails (`demote.ts`), and flow credit backwards (`creditOf`) to suggestion inputs and features.
- **Guardrails:** Unconfirmed drafts teach nothing; below `minN` (default 5), feature stats return `insufficient`; `wrong_fact` dismissals penalize only the specific input's trust at full weight ($1.0$).
- **Strict Validation Criteria:**
  - Creatives and metric snapshots are logged (`> 0` rows) and at least `minN` reviews are confirmed so learned patterns transition from `insufficient` to `ok`.

### UC-12 — Daily Falsifier Grader, Human Insight Gate & Monthly Consolidation (`falsifier-grade.ts`, `consolidate.ts`, `insight-review.ts`)
- **Business Goal:** Close the slow metacognitive loop: test stored predictions when their 30/90-day windows close, let operators approve/edit/reject insights with reasons, merge duplicate Brain chunks, and check for Goodhart drift ($\rho$ between engagement proxy and leads).
- **Pipeline:**
  1. `platina-falsifier-grade` (daily `05:00 UTC`, catch-up enabled) queries `dueFalsifierChunksQuery` (`due_at <= now`), measures the declared metric via `measureMetric`, and applies `gradeInsight`:
     - Triggered $\rightarrow$ `refuted` (`status = 'demoted'`, `confidence = 0.05`, kept for counter-evidence, broadcasts `insights`, writes `result` reward `0` to citing suggestions).
     - Held & significant $\rightarrow$ `promoted` (`confidence = Beta(1 + held, 1 + refuted)` mean, writes `result` reward `1` to citing suggestions).
     - Weak effect $\rightarrow$ `holding` (advances `due_at`).
     - $N < \text{minN}$ $\rightarrow$ `insufficient` (advances `due_at` up to retry cap).
  2. **Human Insight Gate (`reviewInsightAction`):** Operator approves, edits, or rejects any insight on `/findings` or `/brain` with reason (`wrong_fact | not_new | not_testable | other`), journaled via `setBrainState` and propagated to `platina_suggestion_events`.
  3. **Monthly Consolidation (`consolidate.ts`):** Merges near-duplicate active insights ($\text{Jaccard} \ge 0.30$, preserving `keepFalsifier`), retires old/unused/low-trust chunks ($\ge 120\text{ d}$ old, $\ge 60\text{ d}$ unused, trust $< 0.40$), computes **Spearman rank correlation $\rho$** between engagement proxy and leads/qualified leads (flagging $\rho < 0.30$), and verifies max sole-support generation $< 2$.
- **Guardrails:** `platina_brain_chunks` has no `DELETE` query anywhere in the codebase; every state change writes an undo row in `platina_brain_state_log`.
- **Strict Validation Criteria:**
  - `grading` mode enabled (`shadow` or `on`), due chunks have `due_at` set, and `platina_insight_grades` records verdicts without cross-scale comparisons.

---

## 3. Real-Time World Operations & Unit Economics Reality Check

### 3.1 Live Operational State of `waters-gcc-internal` (Measured 13 Nov 2026)

| Layer / Table | Live Count / State | Operational Verdict |
|---|---|---|
| **Database & Schema (`0087–0090`)** | All 4 Brain migrations `OK`; Postgres round-trip `~115 ms` | **PASS** |
| **Clients & Competitors (`platina_brands`)** | `1` client (Waters) + `5` competitors (Agilent, Bruker, SCIEX, Shimadzu, Thermo Fisher) | **PASS** |
| **First-Party Own-Site (`platina_first_party_chunks`)** | `2,137` passages (`160/300` pages read, `97` queued, `43` failed; `50` awaiting embeddings) | **WARN (Degraded)** — needs embedding backfill + own-site queue drain |
| **Approved Brand Standard (`platina_brand_chunks`)** | `0` confirmed brand chunks | **BLOCKED** — blocks `/solutions/new` (`minNGate = 20`) and Brand Drift audits |
| **Collection Runs (`platina_audit_runs`)** | `266` runs; `42` sources late (runner was off); `2` runs stuck $> 1\text{ h}$ | **WARN (Recovering)** — `dev:all` + `OPS-0` replay guard now draining |
| **External Scrapers (`Apify` / `Firecrawl`)** | Firecrawl: `1,397` credits left (`OK`); Apify account check: `HTTP 401` | **RED (Apify Token)** — `APIFY_TOKEN` in `.env.local` returns 401 on usage check |
| **Raw Signal Documents (`platina_signal_documents`)** | `643` collected items | **PASS** |
| **Debate Transcripts & Findings** | `280+` transcripts, `487` findings (`newest 2026-10-19`) | **PASS** |
| **Brain Insights (`platina_brain_chunks`)** | `322` active (`untested`), `97` superseded (`untested`) | **PASS (v1 data)** — `0` v2 falsifiers stored yet because `interrogation` mode is `off` |
| **Brain Stage Modes (`brain_modes`)** | All 7 stages `off` (`interrogation`, `challenger`, `gate`, `surprise`, `retrieval`, `budget`, `grading`) | **DORMANT** — v2 metacognitive code is built & tested, but turned `off` in DB config |
| **Market Interest & Events** | `703` interest signals; `25` dated upcoming events (`CPHI Middle East` on `2026-12-14`), `26` undated; `255` ad-library reads | **PASS** |
| **Campaign Plans (`platina_plans`)** | `2` saved plans | **PASS** |
| **Results, Creatives & Outcomes** | `0` logged creatives, `0` learning events, `0` outcomes | **BLOCKED (Cold Loop)** — fast/slow learning loops have 0 outcome data to learn from |

### 3.2 Unit Economics & Scaling Profile
- **Collection Cost:** Header-only conditional probes (`ETag` / `Last-Modified`) cost `$0`. Firecrawl single-page reads and Apify weekly social/ad sweeps for 1 client + 5 competitors (~40 specs) cost **~$3–$8/month** per workspace when bounded by the 40-page daily cap and `OPS-0` replay guard.
- **Model Inference Cost:** With the B4 surprise filter active (skipping ~50–70% of routine page edits before any LLM call) and B7 token budgets (2,400 evidence tokens max), AI spend per workspace is **~$2–$5/month** across Groq, Gemini Flash/Pro, and NVIDIA NIM.
- **Infrastructure Bottleneck:** Running on a free Supabase tier + local laptop (`npm run dev:all`) means 7 days of laptop downtime pauses the database and halts all collection, grading, and realtime broadcasts.

---

## 4. Strict AGI-Level Realism & Self-Critique (Adversarial Audit)

If an adversarial evaluator, technical due-diligence auditor, or skeptical CMO examines Platina AI OS today, here are the **seven hard truths** they will identify — and how our engineering and operational plan addresses each:

1. **Critique 1 — "Your Metacognitive Brain is Built in Code, But Switched Off in Production."**
   - *Reality:* True. All 7 stages (`B0–B9`) are on `main` and covered by ~3,200 unit/invariant tests, and the ARABLAB freeze (`27 Oct 2026`) has now passed, yet `waters-gcc-internal` still has all 7 stages set to `off`. Consequently, all `322` active Brain chunks are legacy `untested` rows without v2 falsifiers.
   - *Fix (Operation OP-1):* Take a fresh snapshot (`platina:brain-snapshot`) and flip `waters-gcc-internal` stages to **active showcase/study configuration**: `retrieval=on`, `budget=on`, `interrogation=on`, `gate=on`, and `challenger=shadow`, `surprise=shadow`, `grading=shadow` (per owner decision D5/D6, now past the 27 Oct ARABLAB window).
2. **Critique 2 — "Your Closed-Loop Learning Engine Has Zero Logged Results."**
   - *Reality:* True. `Results` (`platina_creatives`, `platina_creative_metrics`, `platina_creative_reviews`) and `Outcomes` (`platina_outcomes`) have `0` rows in `waters-gcc-internal`. Until at least 5 creative reviews are confirmed, Thompson sampling (`learning.ts`) and credit assignment (`credit.ts`) honestly report `"not enough results yet"` and cannot demonstrate learned re-ranking.
   - *Fix (Operation OP-2):* Use the newly landed `WTR-0 Part A` LinkedIn metrics importer (or register Waters' recent public LinkedIn posts as creatives and import their real engagement numbers) so the fast loop has real first-party Plane A observations.
3. **Critique 3 — "Brand DNA Confirmation is 0, Blocking Solutions & Drift."**
   - *Reality:* True. Waters has `2,137` scraped own-site passages in `platina_first_party_chunks`, but `0` confirmed rows in `platina_brand_chunks`. Because `NewSolutionPage` enforces `minNGate(evidence.length, 20)`, drafting a solution is blocked by the honesty gate until the brand standard is declared/confirmed.
   - *Fix (Operation OP-3):* Confirm Waters' core brand standard sources into `platina_brand_chunks` (via `/p/[ws]/admin/brand` or onboarding confirmation) so `platina_brand_chunks >= 20`.
4. **Critique 4 — "Apify Token Returned HTTP 401 & 2 Collection Runs Were Stuck."**
   - *Reality:* True. `ops:check` flagged `Apify: couldn't read (HTTP 401)` and `2 runs stuck for over an hour` from a previous interrupted session. While Firecrawl (`1,397` credits) handles single web pages, conference pages, and Waters' own website, LinkedIn posts and Ad Libraries require a valid `APIFY_TOKEN`.
   - *Fix (Operation OP-4):* Reap/reset stuck runs, drain the 50 unembedded passages, and rotate/verify `APIFY_TOKEN` in `.env.local`.
5. **Critique 5 — "Plans Are Static Documents, Not Tracked Commitments Yet."**
   - *Reality:* True. Today a saved plan has phases, citations, counter-evidence, and a stated falsifier, but no `status` (`draft|approved|live|closed`), no calendar `starts_on`/`ends_on`, and `falsifier-grade.ts` grades Brain chunks (`platina_brain_chunks`), not `platina_plans.plan.falsifier`.
   - *Fix (Operation OP-5):* Complete `WTR-0` (migration `0091` + `platina:study` CLI) and `CORE-1` / `WTR-2` (plan lifecycle, decision record, expected ranges, and plan stated-test grading).
6. **Critique 6 — "Competitors Like Lumenous, Signal Plane, and Cogny Claim Similar Territory."**
   - *Reality:* True (`docs/research/2026-11-09-ground-zero-research.md`). However, none of them enforce **physical two-plane separation** (Plane B raw signal unembedded and uncitable), **blind cross-provider challenger with objection-rate alarms**, **refutation memory injected into a counter-evidence slot**, and **zero model-generated numbers** for regulated B2B buyers.
7. **Critique 7 — "Local Laptop Runtime Cannot Guarantee 24/7 Push."**
   - *Reality:* True. Under the 15 Oct owner decision (`npm run dev:all` locally), scheduled jobs run during active study/demo sessions. `OPS-0` (`isReplayedTick` burst guard + `inngest-cli@1.51.0` + `A0` study-session rule: $\ge 2$ sessions/week or $\ge 15\text{ h}$) ensures missed crons do not stampede on boot and non-operated weeks are never misclassified as product failure.

---

## 5. Sequenced Next Operations Plan (OP-1 through OP-6)

| Operation | Scope | Concrete Action | Verification Gate |
|---|---|---|---|
| **OP-1: Activate Brain Stages on Waters (Post-ARABLAB Freeze)** | `waters-gcc-internal` DB config | Take snapshot (`npm run platina:brain-snapshot -- --ws waters-gcc-internal`), then enable `retrieval=on`, `budget=on`, `interrogation=on`, `gate=on`, `challenger=shadow`, `surprise=shadow`, `grading=shadow`. | `npm run platina:brain-readiness -- --ws waters-gcc-internal` shows active modes; new analyses write v2 falsifiers & telemetry. |
| **OP-2: Run Automated Use-Case & Live Planner Validation** | `scripts/platina-validate-usecases.ts` + `platina:plan-eval` | Execute `npm run platina:validate-usecases` (testing all 12 use cases + live DB readiness + live `CORE-3` planner/critic eval + quality-tier AI adversarial review). | Generated report `docs/validation/2026-11-13-live-usecase-validation-report.md` with exact pass/degraded/blocked scores. |
| **OP-3: Unblock Brand DNA Baseline & Drain Embeddings/Stuck Runs** | `waters-gcc-internal` operational hygiene | Reap the 2 stuck audit runs, backfill the 50 pending embeddings, and confirm Waters' first-party Brand Standard chunks ($\ge 20$ chunks) from its verified own-site profile/pages. | `ops:check` shows `Embeddings: OK`, `Runs finishing: OK`, and `/solutions/new` passes `minNGate`. |
| **OP-4: Seed/Import Real Waters LinkedIn Creative Snapshots** | `WTR-0 Part A` (`results`) | Register Waters' public GCC/analytical LinkedIn posts as creatives and import their engagement snapshots via `parseMetricsSheet` / `splitImportRows`. | `readiness` check moves `Results` from `EMPTY` to `OK`. |
| **OP-5: Complete WTR-0 Migration 0091 & `platina:study` CLI** | `WTR-0 Parts A3, A5, D` + `OPS-0 Parts C, D` | Add `platina_metric_imports` (`0091`), `platina_runtime_heartbeats` & `platina_job_runs` (`0092`), and `npm run platina:study` before the **24 Nov checkpoint**. | `npm run platina:study -- --ws waters-gcc-internal` prints `A0`, `R1–R4`, `L1–L5` with exact $N$ and floors. |
| **OP-6: Build CORE-1 & WTR-1 (Plan as a Commitment + Live Campaign Tracker)** | `platina_plans` lifecycle | Add `status`, `owner_id`, `starts_on`, `ends_on`, `platina_plan_decisions`, and expected range calculation (`25th–75th` percentile of client's own creative metrics). | Approving a plan seals a decision record with payload hash and tracks live phase pacing. |

---

## 6. Protocol for External Higher-Intelligence Model Interrogation

When passing this document (alongside `docs/validation/2026-11-13-live-usecase-validation-report.md`) to an external frontier reasoning model, use the following strict prompt:

```text
You are an adversarial Principal Systems Architect and B2B SaaS Due-Diligence Auditor.
Read the Platina AI OS Validation Base Document and Live Validation Report.
Do not flatter or summarize marketing copy. Evaluate strictly on:
1. Epistemic Integrity: Does the Two-Plane Evidence Law (Plane A embedded/citable, Plane B unembedded/uncitable, Plane C capped at <=40% with a mandatory Counter-Evidence slot) genuinely prevent RAG echo chambers and hallucinated proof? Where can it still leak?
2. Statistical & Mathematical Rigor: Are Welford surprise filtering (1.0 SD + 10% spot check), Mann-Whitney U trend gating (p < 0.10, min-N 5), Beta-posterior earned confidence, and Thompson sampling with half-life decay appropriate for small-N B2B marketing data (10-50 observations/month)?
3. Operational Survival & Unit Economics: Given the live audit numbers on waters-gcc-internal, which bottlenecks will break the 12-week study first if not fixed this week?
4. Competitive Defensibility: Against Lumenous, Signal Plane, Cogny, and native platform MCPs, which of the 12 use cases (UC-01..UC-12) deliver irreplaceable buyer value, and which are commodity bloat that should be cut?
5. Score each of the 12 Use Cases (0-10) on: (a) Code/Architectural Soundness, (b) Live Operational Readiness, and (c) Commercial Buyer Value. Output a ranked list of the top 5 engineering/operational actions required next.
```
